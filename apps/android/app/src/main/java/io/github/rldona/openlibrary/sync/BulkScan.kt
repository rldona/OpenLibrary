package io.github.rldona.openlibrary.sync

import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.uuidv7
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.network.LookupResult
import io.github.rldona.openlibrary.network.MetadataCandidate
import io.github.rldona.openlibrary.network.MetadataProposal
import io.github.rldona.openlibrary.network.NewBook
import io.github.rldona.openlibrary.network.NewCopy
import io.github.rldona.openlibrary.network.NewEdition
import io.github.rldona.openlibrary.network.NewWork
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * One scanned code (or identified cover) and what became of it. [key] tells items apart: the ISBN, or an
 * id of its own for a cover found without one. [saved] is false while the book can still be undone.
 */
data class BulkItem(
    val isbn13: String?,
    val state: State,
    val title: String? = null,
    val workId: String? = null,
    val editionId: String? = null,
    val authors: List<String> = emptyList(),
    val coverId: String? = null,
    val saved: Boolean = false,
    val key: String = isbn13 ?: uuidv7(),
) {
    enum class State { LookingUp, Added, AddedProvisional, Owned, Undone }
}

/**
 * Adding books from the camera (F5 bulk entry and the redesigned scanner): every new ISBN is looked up and
 * shown as saved right away, with one copy in the chosen location; without a connection, or if the
 * providers do not know it, it is saved as provisional with the ISBN as its title, to complete later.
 * ISBNs already in the library are not added again (they are reported, so another copy can be added on
 * purpose).
 *
 * A book is written [graceMs] after it is shown, or as soon as the next one is scanned or the scan
 * finishes ([commitAll]): until then "Undo" ([undo]) drops it without a trace, since a book cannot be
 * deleted once written.
 *
 * The work runs in [scope], an application-wide scope: leaving the screen never loses a scanned book.
 */
class BulkScan(
    private val db: AppDatabase,
    private val writes: LocalWrites,
    private val scope: CoroutineScope,
    /** The server's lookup; null when there is no connection or it fails. */
    private val lookup: suspend (String) -> LookupResult?,
    /** Copies a provider's cover to the server; null if it cannot. */
    private val fetchCover: suspend (String) -> String?,
    /** Downloads a cover already on the server to this phone, so the item can show it. */
    private val downloadCover: suspend (String) -> Unit = {},
    private val graceMs: Long = 0,
) {
    private val _items = MutableStateFlow<List<BulkItem>>(emptyList())
    val items: StateFlow<List<BulkItem>> = _items.asStateFlow()
    /** Saves one book at a time, in scan order. */
    private val saving = Mutex()

    /** A book shown as saved and not written yet, with the photo taken for it (to upload). */
    private data class Pending(val book: NewBook, val coverPhoto: String?, val timer: Job?)
    private val pending = LinkedHashMap<String, Pending>()

    /** Returns false if this ISBN was already scanned in this session. */
    fun add(isbn13: String, locationId: String?): Boolean {
        if (_items.value.any { it.isbn13 == isbn13 && it.state != BulkItem.State.Undone }) return false
        commitAll()
        _items.update { list -> listOf(BulkItem(isbn13, BulkItem.State.LookingUp)) + list.filterNot { it.isbn13 == isbn13 } }
        scope.launch { process(isbn13, locationId) }
        return true
    }

    /**
     * A book found from its cover. With an ISBN it is looked up like a scanned one (the candidate fills in
     * if that finds nothing); [photoId] is the picture taken of the cover, used when no provider has one.
     */
    fun addCandidate(candidate: MetadataCandidate, photoId: String?, locationId: String?): String {
        val isbn = candidate.isbn13
        commitAll()
        val item = BulkItem(isbn, BulkItem.State.LookingUp, title = candidate.title, authors = candidate.authors)
        _items.update { list -> listOf(item) + list.filterNot { isbn != null && it.isbn13 == isbn } }
        scope.launch { process(isbn, locationId, item.key, candidate, photoId) }
        return item.key
    }

    /** Another copy of a book that was already in the library. */
    fun addCopy(item: BulkItem, locationId: String?) {
        val isbn = item.isbn13 ?: return
        scope.launch {
            val owned = db.catalog().byIsbn(isbn) ?: return@launch
            writes.addCopy(owned.editionId, locationId, "good", "")
            set(item.key) { it.copy(state = BulkItem.State.Added, saved = true) }
        }
    }

    /** Drops a book not written yet. False if it was written already (it cannot be undone any more). */
    fun undo(key: String): Boolean {
        val p = synchronized(pending) { pending.remove(key) } ?: return false
        p.timer?.cancel()
        set(key) { it.copy(state = BulkItem.State.Undone) }
        return true
    }

    /** The picture taken for a book saved without a cover: on the pending book, or as an edit once written. */
    fun setPhoto(key: String, photoId: String) {
        scope.launch {
            saving.withLock {
                val p = synchronized(pending) { pending[key] }
                if (p != null) {
                    val book = p.book.copy(edition = p.book.edition.copy(coverAssetId = photoId))
                    synchronized(pending) { pending[key] = p.copy(book = book, coverPhoto = photoId) }
                } else {
                    val editionId = _items.value.firstOrNull { it.key == key }?.editionId ?: return@withLock
                    val edition = db.catalog().editionById(editionId) ?: return@withLock
                    writes.editEdition(edition, buildJsonObject { put("coverAssetId", JsonPrimitive(photoId)) }, coverPhoto = photoId)
                }
            }
            set(key) { it.copy(coverId = photoId) }
        }
    }

    /** Writes every book still pending (another one was scanned, or the scan is over). */
    fun commitAll() {
        val keys = synchronized(pending) { pending.keys.toList() }
        keys.forEach { key -> scope.launch { commit(key) } }
    }

    private suspend fun commit(key: String) {
        saving.withLock {
            val p = synchronized(pending) { pending.remove(key) } ?: return
            p.timer?.cancel()
            val isbn = p.book.edition.isbn13
            // Added on another screen meanwhile.
            if (isbn != null) {
                db.catalog().byIsbn(isbn)?.let { owned ->
                    set(key) { it.copy(state = BulkItem.State.Owned, title = owned.title, workId = owned.workId, saved = true) }
                    return
                }
            }
            writes.addBook(p.book, coverPhoto = p.coverPhoto)
            // BR15: a wish for this ISBN is fulfilled.
            if (isbn != null) db.catalog().openWishByIsbn(isbn)?.let { writes.acquireWish(it, p.book.copy.id) }
            set(key) { it.copy(saved = true) }
        }
    }

    private suspend fun process(
        isbn13: String?,
        locationId: String?,
        key: String = isbn13!!,
        candidate: MetadataCandidate? = null,
        photoId: String? = null,
    ) {
        if (isbn13 != null) {
            db.catalog().byIsbn(isbn13)?.let { owned ->
                set(key) { it.copy(state = BulkItem.State.Owned, title = owned.title, workId = owned.workId, saved = true) }
                return
            }
        }
        val found = isbn13?.let { runCatching { lookup(it) }.getOrNull() }
        val p = found?.proposal?.takeIf { found.found && !it.title.isNullOrBlank() } ?: candidate?.let(::proposalOf)
        val sources = found?.sources?.takeIf { found.found }?.ifEmpty { null } ?: candidate?.sources
        val providerCover = p?.coverUrl?.let { runCatching { fetchCover(it) }.getOrNull() }
        providerCover?.let { runCatching { downloadCover(it) } }
        val cover = providerCover ?: photoId
        val workId = uuidv7()
        val title = p?.title?.trim() ?: provisionalTitle(isbn13 ?: "")
        val authors = p?.authors.orEmpty()
        val book =
            NewBook(
                work = NewWork(workId, title, p?.subtitle, authors, p?.subjects.orEmpty(), p?.description),
                edition = NewEdition(
                    id = uuidv7(),
                    publisher = p?.publisher,
                    publishedYear = p?.publishedYear,
                    language = p?.language,
                    pages = p?.pages,
                    isbn13 = isbn13,
                    coverAssetId = cover,
                    metadataStatus = if (p == null) "provisional" else "complete",
                    metadataSource = sources?.joinToString(", ")?.ifEmpty { null }?.takeIf { p != null },
                ),
                copy = NewCopy(uuidv7(), locationId = locationId),
            )
        val photo = photoId.takeIf { providerCover == null }
        val state = if (p == null) BulkItem.State.AddedProvisional else BulkItem.State.Added
        if (graceMs <= 0) {
            synchronized(pending) { pending[key] = Pending(book, photo, null) }
            commit(key)
            set(key) { if (it.state == BulkItem.State.Owned) it else it.copy(state = state, title = title, authors = authors, workId = workId, editionId = book.edition.id, coverId = cover) }
            return
        }
        val timer = scope.launch {
            delay(graceMs)
            commit(key)
        }
        synchronized(pending) { pending[key] = Pending(book, photo, timer) }
        set(key) { it.copy(state = state, title = title, authors = authors, workId = workId, editionId = book.edition.id, coverId = cover) }
    }

    private fun set(key: String, change: (BulkItem) -> BulkItem) =
        _items.update { list -> list.map { if (it.key == key) change(it) else it } }

    companion object {
        /** Title of a book saved without data; the book form replaces it when a lookup finds the real one. */
        fun provisionalTitle(isbn13: String) = "ISBN ${formatIsbn(isbn13)}"

        /** What a cover search found, as the ISBN lookup's proposal (no pages, subjects nor synopsis). */
        fun proposalOf(c: MetadataCandidate) =
            MetadataProposal(c.title, c.subtitle, c.authors, c.publisher, c.publishedYear, c.language, null, emptyList(), null, c.coverUrl)
    }
}
