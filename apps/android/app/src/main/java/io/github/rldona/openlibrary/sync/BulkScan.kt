package io.github.rldona.openlibrary.sync

import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.uuidv7
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.network.LookupResult
import io.github.rldona.openlibrary.network.NewBook
import io.github.rldona.openlibrary.network.NewCopy
import io.github.rldona.openlibrary.network.NewEdition
import io.github.rldona.openlibrary.network.NewWork
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One scanned code and what became of it. */
data class BulkItem(val isbn13: String, val state: State, val title: String? = null, val workId: String? = null) {
    enum class State { LookingUp, Added, AddedProvisional, Owned }
}

/**
 * Bulk entry (F5): scan a shelf one barcode after another. Each new ISBN is looked up and saved right away
 * as a book with one copy in the chosen location; without a connection, or if the providers do not know it,
 * it is saved as provisional with the ISBN as its title, to complete later. ISBNs already in the library
 * are not added again (they are reported, so another copy can be added on purpose).
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
) {
    private val _items = MutableStateFlow<List<BulkItem>>(emptyList())
    val items: StateFlow<List<BulkItem>> = _items.asStateFlow()
    /** Saves one book at a time, in scan order. */
    private val saving = Mutex()

    /** Returns false if this ISBN was already scanned in this session. */
    fun add(isbn13: String, locationId: String?): Boolean {
        if (_items.value.any { it.isbn13 == isbn13 }) return false
        _items.update { listOf(BulkItem(isbn13, BulkItem.State.LookingUp)) + it }
        scope.launch { process(isbn13, locationId) }
        return true
    }

    /** Another copy of a book that was already in the library. */
    fun addCopy(item: BulkItem, locationId: String?) {
        scope.launch {
            val owned = db.catalog().byIsbn(item.isbn13) ?: return@launch
            writes.addCopy(owned.editionId, locationId, "good", "")
            set(item.isbn13) { it.copy(state = BulkItem.State.Added) }
        }
    }

    private suspend fun process(isbn13: String, locationId: String?) {
        db.catalog().byIsbn(isbn13)?.let { owned ->
            set(isbn13) { it.copy(state = BulkItem.State.Owned, title = owned.title, workId = owned.workId) }
            return
        }
        val found = runCatching { lookup(isbn13) }.getOrNull()
        val p = found?.proposal?.takeIf { found.found && !it.title.isNullOrBlank() }
        val cover = p?.coverUrl?.let { runCatching { fetchCover(it) }.getOrNull() }
        saving.withLock {
            // Scanned twice before the first one was saved, or added on another screen meanwhile.
            db.catalog().byIsbn(isbn13)?.let { owned ->
                set(isbn13) { it.copy(state = BulkItem.State.Owned, title = owned.title, workId = owned.workId) }
                return
            }
            val workId = uuidv7()
            val title = p?.title?.trim() ?: provisionalTitle(isbn13)
            val book =
                NewBook(
                    work = NewWork(workId, title, p?.subtitle, p?.authors.orEmpty(), p?.subjects.orEmpty(), p?.description),
                    edition = NewEdition(
                        id = uuidv7(),
                        publisher = p?.publisher,
                        publishedYear = p?.publishedYear,
                        language = p?.language,
                        pages = p?.pages,
                        isbn13 = isbn13,
                        coverAssetId = cover,
                        metadataStatus = if (p == null) "provisional" else "complete",
                        metadataSource = found?.sources?.joinToString(", ")?.ifEmpty { null }?.takeIf { p != null },
                    ),
                    copy = NewCopy(uuidv7(), locationId = locationId),
                )
            writes.addBook(book)
            // BR15: a wish for this ISBN is fulfilled.
            db.catalog().openWishByIsbn(isbn13)?.let { writes.acquireWish(it, book.copy.id) }
            val state = if (p == null) BulkItem.State.AddedProvisional else BulkItem.State.Added
            set(isbn13) { it.copy(state = state, title = title, workId = workId) }
        }
    }

    private fun set(isbn13: String, change: (BulkItem) -> BulkItem) =
        _items.update { list -> list.map { if (it.isbn13 == isbn13) change(it) else it } }

    companion object {
        /** Title of a book saved without data; the book form replaces it when a lookup finds the real one. */
        fun provisionalTitle(isbn13: String) = "ISBN ${formatIsbn(isbn13)}"
    }
}
