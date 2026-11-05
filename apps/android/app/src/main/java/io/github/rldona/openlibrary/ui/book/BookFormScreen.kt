package io.github.rldona.openlibrary.ui.book

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
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
import io.github.rldona.openlibrary.network.MetadataProposal
import io.github.rldona.openlibrary.network.NewBook
import io.github.rldona.openlibrary.network.NewCopy
import io.github.rldona.openlibrary.network.NewEdition
import io.github.rldona.openlibrary.network.NewWork
import io.github.rldona.openlibrary.ui.capture.isbnReasonLabel
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

    init {
        if (wishId != null) viewModelScope.launch {
            val w = c.db.catalog().wishById(wishId) ?: return@launch
            wish = w
            title = w.title
            authors = w.authors.joinToString("; ")
            // "I bought it": the wish's cover becomes the book's (it is on the server already).
            w.coverAssetId?.let { providerCoverId = it }
            w.isbn13?.let { isbn = it; lookup() }
        }
        if (workId != null && editionId != null) viewModelScope.launch {
            work = c.db.catalog().workById(workId)
            edition = c.db.catalog().editionById(editionId)
            work?.let { title = it.title; subtitle = it.subtitle.orEmpty(); authors = it.authors.joinToString("; ") }
            edition?.let {
                isbn = it.isbn13.orEmpty(); publisher = it.publisher.orEmpty(); year = it.publishedYear?.toString().orEmpty()
                language = it.language.orEmpty(); pages = it.pages?.toString().orEmpty(); provisional = it.metadataStatus == "provisional"
                photoId = it.coverAssetId
            }
        }
    }

    fun scanned(code: String) {
        isbn = code
        lookup()
    }

    /** Local duplicate check first (works offline), then the providers through the server. */
    fun lookup() {
        val r = normalizeIsbn(isbn)
        if (r !is IsbnResult.Ok) {
            notice = LookupNotice.InvalidIsbn((r as IsbnResult.Invalid).reason)
            return
        }
        isbn = r.isbn13
        busy = true
        viewModelScope.launch {
            try {
                if (!editing && wish == null) wish = c.db.catalog().openWishByIsbn(r.isbn13)
                c.db.catalog().byIsbn(r.isbn13)?.let { if (!editing) { notice = LookupNotice.Owned(it); return@launch } }
                val s = c.sessions.session.first() ?: return@launch
                val result = withTimeout(8_000) { c.api(s.serverUrl, s.token).lookup(r.isbn13) }
                val p = result.proposal
                if (result.found && p != null) {
                    fill(p)
                    // A book being edited keeps the cover it has; a new one shows the provider's right away.
                    if (photoId == null && providerCoverId == null) p.coverUrl?.let { fetchProviderCover(it, result.sources.firstOrNull()) }
                    // The data arrived: the book is no longer provisional (the user can still tick it).
                    provisional = false
                    sources = result.sources
                    notice = LookupNotice.Found(result.sources)
                } else {
                    notice = LookupNotice.NotFound
                }
            } catch (_: IOException) {
                offline()
            } catch (_: TimeoutCancellationException) {
                offline()
            } catch (_: Exception) {
                notice = LookupNotice.NotFound
            } finally {
                busy = false
            }
        }
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
        if (publisher.isBlank()) publisher = p.publisher.orEmpty()
        if (year.isBlank()) year = p.publishedYear?.toString().orEmpty()
        if (language.isBlank()) language = p.language.orEmpty()
        if (pages.isBlank()) pages = p.pages?.toString().orEmpty()
        coverUrl = p.coverUrl
    }

    fun save(onSaved: (workId: String) -> Unit) {
        if (title.isBlank()) {
            titleMissing = true
            return
        }
        busy = true
        viewModelScope.launch {
            try {
                if (editing) saveEdits() else onSaved(saveNew())
                if (editing) onSaved(workId!!)
            } finally {
                busy = false
            }
        }
    }

    private suspend fun saveNew(): String {
        val newWorkId = uuidv7()
        val cover = photoId ?: providerCoverId ?: providerCover()
        val book =
            NewBook(
                work = NewWork(newWorkId, title.trim(), subtitle.trim().ifEmpty { null }, authorList()),
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
        if (title.isBlank()) {
            titleMissing = true
            return
        }
        viewModelScope.launch {
            c.writes.addWish(title, authorList(), (normalizeIsbn(isbn) as? IsbnResult.Ok)?.isbn13)
            onDone()
        }
    }

    /** Copies the provider's cover to the server and downloads it, so the form can show it. */
    private fun fetchProviderCover(url: String, source: String?) =
        viewModelScope.launch {
            val s = c.sessions.session.first() ?: return@launch
            runCatching {
                val api = c.api(s.serverUrl, s.token)
                val id = withTimeout(10_000) { api.fetchAsset(url).id }
                if (!c.covers.has(id)) c.covers.put(id, withTimeout(10_000) { api.asset(id) })
                providerCoverId = id
                providerCoverSource = source
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

    private fun text(s: String): JsonElement = s.trim().ifEmpty { null }?.let(::JsonPrimitive) ?: JsonNull
}

@Composable
fun BookFormScreen(
    vm: BookFormViewModel,
    scannedIsbn: String?,
    photoId: String?,
    onScan: () -> Unit,
    onPhoto: () -> Unit,
    onOpenWork: (String) -> Unit,
    onSaved: (String) -> Unit,
    onWishAdded: () -> Unit = {},
) {
    LaunchedEffect(scannedIsbn) { scannedIsbn?.let(vm::scanned) }
    LaunchedEffect(photoId) { photoId?.let { vm.photoId = it } }
    val locations by vm.locations.collectAsState(emptyList())

    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(if (vm.editing) R.string.form_editTitle else R.string.book_add), style = MaterialTheme.typography.headlineSmall)
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
                Text(stringResource(if (vm.busy) R.string.form_searching else R.string.form_lookup))
            }
        }
        if (!vm.editing) Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.add_scan)) }

        vm.wish?.let { Notice(it) }
        vm.notice?.let { n -> Notice(n, onOpenWork, onAddCopy = { vm.addOwnedCopy(it, onSaved) }) }

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
        Field(stringResource(R.string.book_title), vm.title, { vm.title = it }, error = vm.titleMissing && vm.title.isBlank())
        Field(stringResource(R.string.book_subtitle), vm.subtitle, { vm.subtitle = it })
        Field(stringResource(R.string.book_authors), vm.authors, { vm.authors = it }, hint = stringResource(R.string.form_separateWithSemicolon))
        Field(stringResource(R.string.book_publisher), vm.publisher, { vm.publisher = it })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field(stringResource(R.string.book_year), vm.year, { vm.year = it.filter(Char::isDigit).take(4) }, Modifier.weight(1f), number = true)
            Field(stringResource(R.string.book_pages), vm.pages, { vm.pages = it.filter(Char::isDigit).take(5) }, Modifier.weight(1f), number = true)
            Field(stringResource(R.string.book_language), vm.language, { vm.language = it.take(8) }, Modifier.weight(1f))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = vm.provisional, onCheckedChange = { vm.provisional = it })
            Text(stringResource(R.string.book_provisional))
        }
        if (!vm.editing) {
            Text(stringResource(R.string.copy_yourCopy), style = MaterialTheme.typography.titleSmall)
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
        Button(onClick = { vm.save(onSaved) }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth().testTag("save")) {
            Text(stringResource(if (vm.editing) R.string.common_saveChanges else R.string.form_addToLibrary))
        }
        if (!vm.editing && !vm.fromWish) {
            OutlinedButton(onClick = { vm.addToWishlist(onWishAdded) }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.wish_addToWishlist))
            }
        }
        Text(stringResource(R.string.form_hint), style = MaterialTheme.typography.bodySmall)
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
