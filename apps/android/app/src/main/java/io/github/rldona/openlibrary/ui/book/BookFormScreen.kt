package io.github.rldona.openlibrary.ui.book

import io.github.rldona.openlibrary.ui.components.readableWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ImageSearch
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroup
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.SuggestionChip
import androidx.compose.runtime.remember
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.sync.BulkScan
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.conditionLabel
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.core.uuidv7
import io.github.rldona.openlibrary.data.EditionEntity
import io.github.rldona.openlibrary.data.OwnedEdition
import io.github.rldona.openlibrary.data.WishEntity
import io.github.rldona.openlibrary.data.WorkEntity
import io.github.rldona.openlibrary.network.MetadataCandidate
import io.github.rldona.openlibrary.network.MetadataProposal
import io.github.rldona.openlibrary.network.NewBook
import io.github.rldona.openlibrary.network.NewCopy
import io.github.rldona.openlibrary.network.NewEdition
import io.github.rldona.openlibrary.network.NewWork
import io.github.rldona.openlibrary.ui.capture.isbnReasonLabel
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.ui.components.BackScaffold
import io.github.rldona.openlibrary.ui.components.DestructiveDialog
import io.github.rldona.openlibrary.ui.components.BusyLabel
import io.github.rldona.openlibrary.ui.components.Cover
import io.github.rldona.openlibrary.ui.components.LocationPicker
import io.github.rldona.openlibrary.ui.components.Picker
import io.github.rldona.openlibrary.ui.detail.CONDITIONS
import java.io.IOException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** What the ISBN lookup found, shown above the form. */
sealed interface LookupNotice {
    data class Found(val sources: List<String>) : LookupNotice
    data object NotFound : LookupNotice
    data object Offline : LookupNotice
    data class InvalidIsbn(val reason: String) : LookupNotice
    data class Owned(val edition: OwnedEdition) : LookupNotice
    /** The server answered with an error (not a network failure): its translated message. */
    data class Failed(val message: String) : LookupNotice
}

/** Add a book (workId/editionId null; `wishId` for "I bought it") or edit an existing work + edition. */
class BookFormViewModel(
    private val c: AppContainer,
    private val workId: String?,
    private val editionId: String?,
    private val wishId: String? = null,
) : ViewModel() {
    val editing = workId != null
    var isbn by mutableStateOf("")
    var title by mutableStateOf("")
    var subtitle by mutableStateOf("")
    var authors by mutableStateOf("")
    var subjects by mutableStateOf("")
    var suggestions by mutableStateOf<List<String>>(emptyList())
    var publisher by mutableStateOf("")
    var year by mutableStateOf("")
    var language by mutableStateOf("")
    var pages by mutableStateOf("")
    var provisional by mutableStateOf(false)
    var locationId by mutableStateOf<String?>(null)
    var condition by mutableStateOf("good")
    var notes by mutableStateOf("")
    /** Cover photo taken on the phone (asset id), or the provider's proposal. */
    var photoId by mutableStateOf<String?>(null)
    private var coverUrl: String? = null
    /** The provider's cover, already copied to the server and downloaded here, shown before saving. */
    var providerCoverId by mutableStateOf<String?>(null)
        private set
    var providerCoverSource by mutableStateOf<String?>(null)
        private set
    /** What the book will have as its cover: the user's photo wins over the provider's. */
    val coverId get() = photoId ?: providerCoverId
    private var sources: List<String> = emptyList()
    var notice by mutableStateOf<LookupNotice?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    /** Saving (a subset of [busy], which also covers the lookup): the bar's "Save" shows its progress. */
    var saving by mutableStateOf(false)
        private set
    var titleMissing by mutableStateOf(false)
        private set
    /** BR15: the wish this book fulfils (from "I bought it", or found by its ISBN); bought on save. */
    var wish by mutableStateOf<WishEntity?>(null)
        private set
    val fromWish = wishId != null

    val locations = c.db.catalog().locations()
    val covers = c.covers
    private var work: WorkEntity? = null
    private var edition: EditionEntity? = null

    /** Everything the user can change, to tell whether leaving would lose something. */
    private data class Fields(
        val isbn: String, val title: String, val subtitle: String, val authors: String, val publisher: String,
        val year: String, val language: String, val pages: String, val provisional: Boolean, val locationId: String?,
        val condition: String, val notes: String, val photoId: String?, val providerCoverId: String?,
    )

    private fun fields() =
        Fields(isbn, title, subtitle, authors, publisher, year, language, pages, provisional, locationId, condition, notes, photoId, providerCoverId)

    /** The form as it opened (empty, or the book being edited once loaded). */
    private var baseline by mutableStateOf(fields())

    /** Leaving now would lose changes: closing asks first. */
    val dirty get() = fields() != baseline

    init {
        viewModelScope.launch { suggestions = c.db.catalog().subjects() }
        if (wishId != null) viewModelScope.launch {
            val w = c.db.catalog().wishById(wishId) ?: return@launch
            wish = w
            title = w.title
            authors = w.authors.joinToString("; ")
            // "I bought it": the wish's cover becomes the book's (it is on the server already).
            w.coverAssetId?.let { providerCoverId = it }
            baseline = fields()
            // What the automatic lookup fills in is part of the form as it opened, not a change of the user's.
            w.isbn13?.let { isbn = it; lookup(initial = true) }
        }
        if (workId != null && editionId != null) viewModelScope.launch {
            work = c.db.catalog().workById(workId)
            edition = c.db.catalog().editionById(editionId)
            work?.let {
                title = it.title
                subtitle = it.subtitle.orEmpty()
                authors = it.authors.joinToString("; ")
                subjects = it.subjects.joinToString("; ")
            }
            edition?.let {
                isbn = it.isbn13.orEmpty(); publisher = it.publisher.orEmpty(); year = it.publishedYear?.toString().orEmpty()
                language = it.language.orEmpty(); pages = it.pages?.toString().orEmpty(); provisional = it.metadataStatus == "provisional"
                photoId = it.coverAssetId
            }
            baseline = fields()
        }
    }

    fun scanned(code: String) {
        isbn = code
        lookup()
    }

    /** Invalidates the answer of a lookup still in flight when a newer one starts. */
    private var lookupSeq = 0

    /**
     * Local duplicate check first (works offline), then the providers through the server. When a cover
     * candidate is passed as [fallback], its summary fills the form if the lookup finds nothing.
     */
    /** [initial]: the lookup the form starts by itself ("I bought it"); what it fills counts as unchanged. */
    fun lookup(fallback: MetadataCandidate? = null, initial: Boolean = false) {
        val r = normalizeIsbn(isbn)
        if (r !is IsbnResult.Ok) {
            notice = LookupNotice.InvalidIsbn((r as IsbnResult.Invalid).reason)
            return
        }
        isbn = r.isbn13
        val seq = ++lookupSeq
        busy = true
        viewModelScope.launch {
            try {
                // A wish waiting for its "Undo" on the way to being deleted is not one to buy.
                if (!editing && wish == null) wish = c.db.catalog().openWishByIsbn(r.isbn13)?.takeIf { "wish:" + it.id !in c.deletes.hidden.value }
                c.db.catalog().byIsbn(r.isbn13)?.let { if (!editing) { notice = LookupNotice.Owned(it); return@launch } }
                val s = c.sessions.session.first()
                if (seq != lookupSeq) return@launch
                if (s == null) {
                    if (fallback != null) applySummary(fallback) else offline()
                    return@launch
                }
                val result = withTimeout(8_000) { c.api(s.serverUrl, s.token).lookup(r.isbn13) }
                if (seq != lookupSeq) return@launch
                val p = result.proposal
                if (result.found && p != null) {
                    fill(p)
                    // A book being edited keeps the cover it has; a new one shows the provider's right away.
                    if (photoId == null && providerCoverId == null) p.coverUrl?.let { fetchProviderCover(it, result.sources.firstOrNull(), initial) }
                    // The data arrived: the book is no longer provisional (the user can still tick it).
                    provisional = false
                    sources = result.sources
                    notice = LookupNotice.Found(result.sources)
                } else if (fallback != null) {
                    applySummary(fallback)
                } else {
                    notice = LookupNotice.NotFound
                }
            } catch (_: IOException) {
                if (seq == lookupSeq) {
                    if (fallback != null) applySummary(fallback) else offline()
                }
            } catch (_: TimeoutCancellationException) {
                if (seq == lookupSeq) {
                    if (fallback != null) applySummary(fallback) else offline()
                }
            } catch (e: ApiException) {
                if (seq == lookupSeq) {
                    if (fallback != null) applySummary(fallback) else notice = LookupNotice.Failed(e.message)
                }
            } catch (_: Exception) {
                // An answer this app cannot read: treat it as nothing found and let the user type it.
                if (seq == lookupSeq) {
                    if (fallback != null) applySummary(fallback) else notice = LookupNotice.NotFound
                }
            } finally {
                if (seq == lookupSeq) {
                    busy = false
                    if (initial) baseline = fields()
                }
            }
        }
    }

    /** Set once a cover candidate filled the form, so a later candidate can replace it cleanly. */
    private var identifiedOnce = false

    /** A book chosen from the cover search: use its ISBN when known, or its summary directly. */
    fun applyCandidate(c: MetadataCandidate) {
        // An answer for a previous candidate must not land on top of this one.
        lookupSeq++
        busy = false
        // Picking another book from the camera means "this one, not the previous one": clear the fields
        // that the previous candidate wrote, so two books never end up mixed in one form. Location,
        // condition, notes and the user's own photo are kept.
        if (identifiedOnce) resetIdentifiedFields()
        identifiedOnce = true
        if (c.isbn13 != null) {
            isbn = c.isbn13
            lookup(fallback = c)
        } else {
            applySummary(c)
        }
    }

    private fun resetIdentifiedFields() {
        title = ""
        subtitle = ""
        authors = ""
        publisher = ""
        year = ""
        language = ""
        pages = ""
        isbn = ""
        providerCoverId = null
        providerCoverSource = null
        coverUrl = null
        notice = null
        titleMissing = false
    }

    /** Fills only what is still blank, so nothing the user typed is overwritten. */
    private fun applySummary(c: MetadataCandidate) {
        if (title.isBlank()) title = c.title
        if (subtitle.isBlank()) subtitle = c.subtitle.orEmpty()
        if (authors.isBlank()) authors = c.authors.joinToString("; ")
        if (publisher.isBlank()) publisher = c.publisher.orEmpty()
        if (year.isBlank()) year = c.publishedYear?.toString().orEmpty()
        if (language.isBlank()) language = c.language.orEmpty()
        coverUrl = c.coverUrl
        sources = c.sources
        notice = LookupNotice.Found(c.sources)
        provisional = false
        if (photoId == null && providerCoverId == null) c.coverUrl?.let { fetchProviderCover(it, c.sources.firstOrNull()) }
    }

    private fun offline() {
        notice = LookupNotice.Offline
        provisional = true
    }

    /** The proposal only fills what the user has not typed. */
    private fun fill(p: MetadataProposal) {
        // A book scanned in bulk without data has the ISBN as a stand-in title.
        val standIn = (normalizeIsbn(isbn) as? IsbnResult.Ok)?.let { title.trim() == BulkScan.provisionalTitle(it.isbn13) } == true
        if (title.isBlank() || standIn) title = p.title.orEmpty()
        if (subtitle.isBlank()) subtitle = p.subtitle.orEmpty()
        if (authors.isBlank()) authors = p.authors.joinToString("; ")
        if (subjects.isBlank()) subjects = p.subjects.joinToString("; ")
        if (publisher.isBlank()) publisher = p.publisher.orEmpty()
        if (year.isBlank()) year = p.publishedYear?.toString().orEmpty()
        if (language.isBlank()) language = p.language.orEmpty()
        if (pages.isBlank()) pages = p.pages?.toString().orEmpty()
        coverUrl = p.coverUrl
    }

    fun save(onSaved: (workId: String) -> Unit) {
        // A second tap while saving (or looking up) would add the book twice.
        if (busy) return
        if (title.isBlank()) {
            titleMissing = true
            return
        }
        busy = true
        saving = true
        viewModelScope.launch {
            try {
                if (editing) saveEdits() else onSaved(saveNew())
                if (editing) onSaved(workId!!)
            } finally {
                busy = false
                saving = false
            }
        }
    }

    private suspend fun saveNew(): String {
        val newWorkId = uuidv7()
        val cover = photoId ?: providerCoverId ?: providerCover()
        val book =
            NewBook(
                work = NewWork(
                    newWorkId,
                    title.trim(),
                    subtitle.trim().ifEmpty { null },
                    authorList(),
                    subjects = splitSubjects(subjects),
                ),
                edition = NewEdition(
                    id = uuidv7(),
                    publisher = publisher.trim().ifEmpty { null },
                    publishedYear = year.toIntOrNull(),
                    language = language.trim().ifEmpty { null },
                    pages = pages.toIntOrNull(),
                    isbn13 = (normalizeIsbn(isbn) as? IsbnResult.Ok)?.isbn13,
                    coverAssetId = cover,
                    metadataStatus = if (provisional) "provisional" else "complete",
                    metadataSource = sources.joinToString(", ").ifEmpty { null },
                ),
                copy = NewCopy(uuidv7(), locationId = locationId, condition = condition, notes = notes.trim()),
            )
        c.writes.addBook(book, coverPhoto = photoId)
        // After the book's op, so the copy exists when the server applies this one.
        wish?.let { c.writes.acquireWish(it, book.copy.id) }
        return newWorkId
    }

    /** "I bought it" for an edition you already own: just another copy of it (no new work or edition). */
    fun addOwnedCopy(owned: OwnedEdition, onSaved: (workId: String) -> Unit) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                val copyId = c.writes.addCopy(owned.editionId, locationId, condition, notes.trim())
                wish?.let { c.writes.acquireWish(it, copyId) }
                onSaved(owned.workId)
            } finally {
                busy = false
            }
        }
    }

    /** Not bought yet: keep it in the wishlist instead (e.g. scanned in a bookshop). */
    fun addToWishlist(onDone: () -> Unit) {
        if (busy) return
        if (title.isBlank()) {
            titleMissing = true
            return
        }
        busy = true
        viewModelScope.launch {
            try {
                // The same cover the book would get: the photo taken here, else the provider's.
                val cover = photoId ?: providerCoverId ?: providerCover()
                c.writes.addWish(
                    title,
                    authorList(),
                    (normalizeIsbn(isbn) as? IsbnResult.Ok)?.isbn13,
                    coverAssetId = cover,
                    // Only a photo taken on the phone needs uploading; the provider's is on the server already.
                    coverPhoto = photoId,
                )
                onDone()
            } finally {
                busy = false
            }
        }
    }

    /** Copies the provider's cover to the server and downloads it, so the form can show it. */
    private fun fetchProviderCover(url: String, source: String?, initial: Boolean = false) =
        viewModelScope.launch {
            val s = c.sessions.session.first() ?: return@launch
            runCatching {
                val api = c.api(s.serverUrl, s.token)
                val id = withTimeout(10_000) { api.fetchAsset(url).id }
                if (!c.covers.has(id)) c.covers.put(id, withTimeout(10_000) { api.asset(id) })
                providerCoverId = id
                providerCoverSource = source
                // Only the cover, so nothing the user typed meanwhile is taken as unchanged.
                if (initial) baseline = baseline.copy(providerCoverId = id)
            }
        }

    /** "Without this cover": the provider's is not wanted. */
    fun dropProviderCover() {
        providerCoverId = null
        coverUrl = null
    }

    /** The provider's cover is copied to the server now if there is a connection; otherwise the book has none. */
    private suspend fun providerCover(): String? {
        val url = coverUrl ?: return null
        val s = c.sessions.session.first() ?: return null
        return runCatching { withTimeout(10_000) { c.api(s.serverUrl, s.token).fetchAsset(url).id } }.getOrNull()
    }

    private suspend fun saveEdits() {
        val w = work ?: return
        val e = edition ?: return
        val wf = mutableMapOf<String, JsonElement>()
        if (title.trim() != w.title) wf["title"] = JsonPrimitive(title.trim())
        if (subtitle.trim().ifEmpty { null } != w.subtitle) wf["subtitle"] = text(subtitle)
        if (authorList() != w.authors) wf["authors"] = JsonArray(authorList().map(::JsonPrimitive))
        if (splitSubjects(subjects) != w.subjects) wf["subjects"] = JsonArray(splitSubjects(subjects).map(::JsonPrimitive))
        if (wf.isNotEmpty()) c.writes.editWork(w, JsonObject(wf))

        val ef = mutableMapOf<String, JsonElement>()
        if (publisher.trim().ifEmpty { null } != e.publisher) ef["publisher"] = text(publisher)
        if (year.toIntOrNull() != e.publishedYear) ef["publishedYear"] = year.toIntOrNull()?.let(::JsonPrimitive) ?: JsonNull
        if (language.trim().ifEmpty { null } != e.language) ef["language"] = text(language)
        if (pages.toIntOrNull() != e.pages) ef["pages"] = pages.toIntOrNull()?.let(::JsonPrimitive) ?: JsonNull
        val isbn13 = (normalizeIsbn(isbn) as? IsbnResult.Ok)?.isbn13
        if (isbn13 != e.isbn13) ef["isbn13"] = isbn13?.let(::JsonPrimitive) ?: JsonNull
        val status = if (provisional) "provisional" else "complete"
        if (status != e.metadataStatus) ef["metadataStatus"] = JsonPrimitive(status)
        val cover = coverId
        val newCover = cover != e.coverAssetId
        if (newCover) ef["coverAssetId"] = cover?.let(::JsonPrimitive) ?: JsonNull
        // Only a photo taken on the phone needs uploading; the provider's cover is on the server already.
        val upload = photoId.takeIf { newCover && it != null && it != providerCoverId }
        if (ef.isNotEmpty()) c.writes.editEdition(e, JsonObject(ef), coverPhoto = upload)
    }

    private fun authorList() = authors.split(';').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

    private fun splitSubjects(value: String) =
        value.split(';').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

    private fun text(s: String): JsonElement = s.trim().ifEmpty { null }?.let(::JsonPrimitive) ?: JsonNull
}

/**
 * Add or edit a book. The bar carries the way out (✕, which asks before losing changes) and "Save"; the form
 * is grouped as the catalogue is: the work, this edition and, when adding, your copy.
 */
@Composable
fun BookFormScreen(
    vm: BookFormViewModel,
    onScan: () -> Unit,
    onPhoto: () -> Unit,
    onOpenWork: (String) -> Unit,
    onSaved: (String) -> Unit,
    onWishAdded: () -> Unit = {},
    onIdentify: () -> Unit = {},
    onClose: () -> Unit = {},
) {
    val locations by vm.locations.collectAsState(emptyList())
    var confirmDiscard by remember { mutableStateOf(false) }
    val close = { if (vm.dirty) confirmDiscard = true else onClose() }
    // The back gesture asks too; with nothing changed it just leaves.
    BackHandler(enabled = vm.dirty) { confirmDiscard = true }

    BackScaffold(
        stringResource(if (vm.editing) R.string.form_editTitle else R.string.book_add),
        onBack = close,
        close = true,
        actions = {
            TextButton(onClick = { vm.save(onSaved) }, enabled = !vm.busy, modifier = Modifier.testTag("save")) {
                BusyLabel(vm.saving, stringResource(R.string.common_save))
            }
        },
    ) { inner ->
        Column(
            Modifier.fillMaxSize().padding(inner).imePadding().verticalScroll(rememberScrollState()).readableWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = vm.isbn,
                    onValueChange = { vm.isbn = it },
                    label = { Text(stringResource(R.string.form_isbnOptional)) },
                    placeholder = { Text(stringResource(R.string.form_isbnPlaceholder)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f).testTag("isbn"),
                )
                OutlinedButton(onClick = vm::lookup, enabled = !vm.busy && vm.isbn.isNotBlank()) {
                    BusyLabel(vm.busy && !vm.saving, stringResource(if (vm.busy && !vm.saving) R.string.form_searching else R.string.form_lookup))
                }
            }
            if (!vm.editing) CaptureButtons(onScan, onIdentify)

            vm.wish?.let { Notice(it) }
            vm.notice?.let { n -> Notice(n, onOpenWork, onAddCopy = { vm.addOwnedCopy(it, onSaved) }) }

            SectionTitle(stringResource(R.string.form_section_work))
            Field(stringResource(R.string.book_title), vm.title, { vm.title = it }, error = vm.titleMissing && vm.title.isBlank())
            Field(stringResource(R.string.book_subtitle), vm.subtitle, { vm.subtitle = it })
            Field(stringResource(R.string.book_authors), vm.authors, { vm.authors = it }, hint = stringResource(R.string.form_separateWithSemicolon))
            SubjectsField(vm.subjects, vm.suggestions) { vm.subjects = it }

            SectionTitle(stringResource(R.string.drawer_edition))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(vm.covers, vm.coverId, vm.title.ifBlank { "?" }, 72.dp, authors = vm.authors.split(';').map { it.trim() }.filter { it.isNotEmpty() })
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val fromProvider = vm.photoId == null && vm.providerCoverId != null
                    if (fromProvider) {
                        Text(
                            str(R.string.form_providerCover, "source" to (vm.providerCoverSource ?: "")),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    OutlinedButton(onClick = onPhoto) {
                        Text(stringResource(if (vm.coverId == null) R.string.add_takePhoto else R.string.add_retakePhoto))
                    }
                    if (vm.photoId != null && !vm.editing) {
                        OutlinedButton(onClick = { vm.photoId = null }) { Text(stringResource(R.string.add_removePhoto)) }
                    }
                    if (fromProvider) {
                        TextButton(onClick = vm::dropProviderCover) { Text(stringResource(R.string.form_removeCover)) }
                    }
                }
            }
            Field(stringResource(R.string.book_publisher), vm.publisher, { vm.publisher = it })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field(stringResource(R.string.book_year), vm.year, { vm.year = it.filter(Char::isDigit).take(4) }, Modifier.weight(1f), number = true)
                Field(stringResource(R.string.book_pages), vm.pages, { vm.pages = it.filter(Char::isDigit).take(5) }, Modifier.weight(1f), number = true)
                Field(stringResource(R.string.book_language), vm.language, { vm.language = it.take(8) }, Modifier.weight(1f))
            }
            // The whole row is the checkbox, for touch and for TalkBack.
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = vm.provisional, role = Role.Checkbox, onValueChange = { vm.provisional = it }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = vm.provisional, onCheckedChange = null)
                Text(stringResource(R.string.book_provisional), Modifier.padding(start = 12.dp))
            }
            if (!vm.editing) {
                SectionTitle(stringResource(R.string.copy_yourCopy))
                LocationPicker(locations, vm.locationId, { vm.locationId = it }, Modifier.fillMaxWidth())
                Picker(
                    stringResource(R.string.copy_condition),
                    vm.condition,
                    CONDITIONS.map { it to stringResource(conditionLabel(it)) },
                    { vm.condition = it },
                    Modifier.fillMaxWidth(),
                )
                Field(stringResource(R.string.copy_notes), vm.notes, { vm.notes = it }, hint = stringResource(R.string.copy_notesPlaceholder))
            }
            // "Save" is in the bar; keeping it in the wishlist instead is the other way to finish.
            if (!vm.editing && !vm.fromWish) {
                OutlinedButton(onClick = { vm.addToWishlist(onWishAdded) }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.wish_addToWishlist))
                }
            }
            Text(stringResource(R.string.form_hint), style = MaterialTheme.typography.bodySmall)
        }
    }
    if (confirmDiscard) {
        DestructiveDialog(
            title = stringResource(R.string.form_discardTitle),
            text = stringResource(R.string.form_discardText),
            confirm = stringResource(R.string.form_discard),
            onConfirm = { confirmDiscard = false; onClose() },
            onDismiss = { confirmDiscard = false },
            dismiss = stringResource(R.string.form_keepEditing),
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
}

/** Scan the barcode or identify the cover: the two ways to fill the form from the camera (Expressive button group). */
@Composable
private fun CaptureButtons(onScan: () -> Unit, onIdentify: () -> Unit) {
    val scan = stringResource(R.string.add_scan)
    val identify = stringResource(R.string.add_identify)
    ButtonGroup(
        overflowIndicator = { ButtonGroupDefaults.OverflowIndicator(it) },
        modifier = Modifier.fillMaxWidth(),
    ) {
        customItem(
            buttonGroupContent = {
                val source = remember { MutableInteractionSource() }
                Button(onClick = onScan, shapes = ButtonDefaults.shapes(), interactionSource = source, modifier = Modifier.weight(1f).animateWidth(source)) {
                    Icon(Icons.Default.QrCodeScanner, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                    Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                    Text(scan, maxLines = 1)
                }
            },
            menuContent = { menu -> DropdownMenuItem(text = { Text(scan) }, onClick = { menu.dismiss(); onScan() }) },
        )
        customItem(
            buttonGroupContent = {
                val source = remember { MutableInteractionSource() }
                FilledTonalButton(onClick = onIdentify, shapes = ButtonDefaults.shapes(), interactionSource = source, modifier = Modifier.weight(1f).animateWidth(source)) {
                    Icon(Icons.Default.ImageSearch, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                    Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                    Text(identify, maxLines = 1)
                }
            },
            menuContent = { menu -> DropdownMenuItem(text = { Text(identify) }, onClick = { menu.dismiss(); onIdentify() }) },
        )
    }
}

@Composable
private fun Notice(w: WishEntity) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Text(str(R.string.wish_willBeAcquired, "title" to w.title), Modifier.padding(12.dp))
    }
}

@Composable
private fun Notice(n: LookupNotice, onOpenWork: (String) -> Unit, onAddCopy: (OwnedEdition) -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            when (n) {
                is LookupNotice.Found -> {
                    Text(str(R.string.form_foundTitle, "sources" to n.sources.joinToString(", ")), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.form_foundText))
                }
                LookupNotice.NotFound -> Text(stringResource(R.string.form_notFoundTitle) + ". " + stringResource(R.string.form_fillManually))
                LookupNotice.Offline -> Text(stringResource(R.string.add_offline))
                is LookupNotice.Failed -> Text(str(R.string.form_lookupFailed, "error" to n.message), color = MaterialTheme.colorScheme.error)
                is LookupNotice.InvalidIsbn ->
                    Text(str(R.string.form_isbnInvalid, "reason" to stringResource(isbnReasonLabel(n.reason))), color = MaterialTheme.colorScheme.error)
                is LookupNotice.Owned -> {
                    Text(stringResource(R.string.form_duplicateTitle), style = MaterialTheme.typography.titleSmall)
                    Text("«${n.edition.title}» · " + plural(R.string.library_copies_one, R.string.library_copies_other, n.edition.copies))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { onAddCopy(n.edition) }) { Text(stringResource(R.string.form_addAnotherCopy)) }
                        OutlinedButton(onClick = { onOpenWork(n.edition.workId) }) { Text(stringResource(R.string.add_viewDetails)) }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SubjectsField(value: String, suggestions: List<String>, onChange: (String) -> Unit) {
    val selected = value.split(';').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    var text by remember { mutableStateOf("") }

    fun commit(raw: String) {
        val name = raw.trim()
        if (name.isEmpty()) return
        if (selected.none { it.equals(name, ignoreCase = true) }) {
            onChange((selected + name).joinToString("; "))
        }
        text = ""
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.book_subjects), style = MaterialTheme.typography.labelLarge)
        if (selected.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                selected.forEach { subject ->
                    InputChip(
                        selected = true,
                        onClick = { onChange(selected.filter { it != subject }.joinToString("; ")) },
                        label = { Text(subject) },
                        trailingIcon = {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = stringResource(R.string.common_remove),
                                modifier = Modifier.size(16.dp),
                            )
                        },
                    )
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                singleLine = true,
                placeholder = { Text(stringResource(R.string.form_subjectsPlaceholder)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { commit(text) }),
            )
            IconButton(onClick = { commit(text) }, enabled = text.isNotBlank()) {
                Icon(Icons.Default.Add, contentDescription = stringResource(R.string.book_subjects))
            }
        }
        val remaining = suggestions
            .filter { suggestion ->
                selected.none { it.equals(suggestion, ignoreCase = true) } &&
                    (text.isBlank() || suggestion.contains(text.trim(), ignoreCase = true))
            }
            .take(12)
        if (remaining.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                remaining.forEach { suggestion ->
                    SuggestionChip(onClick = { commit(suggestion) }, label = { Text(suggestion) })
                }
            }
        }
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth(),
    hint: String? = null,
    error: Boolean = false,
    number: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        supportingText = hint?.let { { Text(it) } },
        isError = error,
        singleLine = true,
        keyboardOptions = if (number) KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
        modifier = modifier,
    )
}
