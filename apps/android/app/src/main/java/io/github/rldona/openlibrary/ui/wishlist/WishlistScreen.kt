package io.github.rldona.openlibrary.ui.wishlist

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.WishEntity
import io.github.rldona.openlibrary.ui.components.Cover
import io.github.rldona.openlibrary.ui.components.Picker
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

val PRIORITIES = listOf("low", "normal", "high")

fun priorityLabel(p: String): Int =
    when (p) {
        "high" -> R.string.wish_priority_high
        "low" -> R.string.wish_priority_low
        else -> R.string.wish_priority_normal
    }

fun wishStatusLabel(s: String): Int =
    when (s) {
        "acquired" -> R.string.wish_status_acquired
        "discarded" -> R.string.wish_status_discarded
        else -> R.string.wish_status_open
    }

data class WishDraft(
    val title: String,
    val authors: String,
    val isbn: String,
    val priority: String,
    val notes: String,
    /** The provider's cover, copied to the server and downloaded when the ISBN was looked up. */
    val coverAssetId: String? = null,
) {
    val authorList get() = authors.split(';').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    val isbn13 get() = (normalizeIsbn(isbn) as? IsbnResult.Ok)?.isbn13
}

/** What looking up the ISBN of a wish found. */
sealed interface WishNote {
    data class Found(val sources: List<String>) : WishNote
    data object NotFound : WishNote
    data object Offline : WishNote
    data class Owned(val title: String) : WishNote
    data object AlreadyWished : WishNote
}

class WishlistViewModel(private val c: AppContainer) : ViewModel() {
    val wishes = c.db.catalog().wishes().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val covers = c.covers

    /** The add/edit dialog lives here so it survives a trip to the camera to scan the ISBN. */
    var draft by mutableStateOf<WishDraft?>(null)
        private set
    var editing by mutableStateOf<WishEntity?>(null)
        private set
    var note by mutableStateOf<WishNote?>(null)
        private set
    var looking by mutableStateOf(false)
        private set

    fun add() {
        editing = null
        draft = WishDraft("", "", "", "normal", "")
        note = null
    }

    fun edit(w: WishEntity) {
        editing = w
        draft = WishDraft(w.title, w.authors.joinToString("; "), w.isbn13.orEmpty(), w.priority, w.notes, w.coverAssetId)
        note = null
    }

    fun close() {
        draft = null
        editing = null
        note = null
    }

    /** A cover photo taken on the phone in this dialog (it must be uploaded), if any. */
    private var photo: String? = null

    fun photo(assetId: String) {
        draft = draft?.copy(coverAssetId = assetId)
        photo = assetId
    }

    fun update(d: WishDraft) {
        draft = d
    }

    fun scanned(isbn13: String) {
        draft = (draft ?: WishDraft("", "", "", "normal", "")).copy(isbn = isbn13)
        lookup()
    }

    /** Checks the library and the wishlist first (works offline), then the providers through the server. */
    fun lookup() {
        val isbn13 = draft?.isbn13 ?: return
        looking = true
        viewModelScope.launch {
            try {
                note = c.db.catalog().byIsbn(isbn13)?.let { WishNote.Owned(it.title) }
                    ?: c.db.catalog().openWishByIsbn(isbn13)?.takeIf { it.id != editing?.id }?.let { WishNote.AlreadyWished }
                val s = c.sessions.session.first() ?: return@launch
                val api = c.api(s.serverUrl, s.token)
                val r = withTimeout(8_000) { api.lookup(isbn13) }
                val p = r.proposal
                if (r.found && p != null) {
                    draft = draft?.let { d ->
                        d.copy(
                            title = d.title.ifBlank { p.title.orEmpty() },
                            authors = d.authors.ifBlank { p.authors.joinToString("; ") },
                        )
                    }
                    if (note == null) note = WishNote.Found(r.sources)
                    // The cover too, as in the book form: copied to the server and shown right away.
                    if (draft?.coverAssetId == null) {
                        p.coverUrl?.let { url ->
                            runCatching {
                                val id = withTimeout(10_000) { api.fetchAsset(url).id }
                                if (!c.covers.has(id)) c.covers.put(id, withTimeout(10_000) { api.asset(id) })
                                draft = draft?.copy(coverAssetId = id)
                            }
                        }
                    }
                } else if (note == null) {
                    note = WishNote.NotFound
                }
            } catch (_: java.io.IOException) {
                if (note == null) note = WishNote.Offline
            } catch (_: kotlinx.coroutines.TimeoutCancellationException) {
                if (note == null) note = WishNote.Offline
            } catch (_: Exception) {
                if (note == null) note = WishNote.NotFound
            } finally {
                looking = false
            }
        }
    }

    fun save() {
        val d = draft ?: return
        val existing = editing
        val upload = photo?.takeIf { it == d.coverAssetId }
        photo = null
        close()
        viewModelScope.launch {
            if (existing == null) {
                c.writes.addWish(d.title, d.authorList, d.isbn13, d.priority, d.notes, d.coverAssetId, coverPhoto = upload)
                return@launch
            }
            // Only what changed, so another device's edits to other fields are merged.
            val f = mutableMapOf<String, JsonElement>()
            if (d.title.trim() != existing.title) f["title"] = JsonPrimitive(d.title.trim())
            if (d.authorList != existing.authors) f["authors"] = JsonArray(d.authorList.map(::JsonPrimitive))
            if (d.isbn13 != existing.isbn13) f["isbn13"] = d.isbn13?.let(::JsonPrimitive) ?: JsonNull
            if (d.priority != existing.priority) f["priority"] = JsonPrimitive(d.priority)
            if (d.notes.trim() != existing.notes) f["notes"] = JsonPrimitive(d.notes.trim())
            if (d.coverAssetId != existing.coverAssetId) f["coverAssetId"] = d.coverAssetId?.let(::JsonPrimitive) ?: JsonNull
            if (f.isNotEmpty()) c.writes.editWish(existing, JsonObject(f), coverPhoto = upload)
        }
    }

    fun setStatus(w: WishEntity, status: String) =
        viewModelScope.launch { c.writes.editWish(w, JsonObject(mapOf("status" to JsonPrimitive(status)))) }
}

/** Books you want (BR14). "I bought it" opens the add-book form pre-filled from the wish. */
@Composable
fun WishlistScreen(vm: WishlistViewModel, onScan: () -> Unit, onPhoto: () -> Unit, onBought: (wishId: String) -> Unit) {
    val all by vm.wishes.collectAsStateWithLifecycle()
    val list = all ?: return
    val open = list.filter { it.status == "open" }
    val done = list.filter { it.status != "open" }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 96.dp)) {
            item { Text(stringResource(R.string.wish_subtitle), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp)) }
            if (open.isEmpty()) {
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text(stringResource(R.string.wish_emptyTitle), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.wish_emptyText), modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
            items(open, key = { it.id }) { w ->
                Row(
                    Modifier.fillMaxWidth().clickable { vm.edit(w) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                Cover(vm.covers, w.coverAssetId, w.title, 56.dp, authors = w.authors)
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(w.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        if (w.priority != "normal") AssistChip(onClick = {}, label = { Text(stringResource(priorityLabel(w.priority))) })
                    }
                    val meta = listOfNotNull(w.authors.joinToString(", ").ifEmpty { null }, w.isbn13?.let { "ISBN " + formatIsbn(it) })
                    if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                    if (w.notes.isNotBlank()) Text(w.notes, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { onBought(w.id) }) { Text(stringResource(R.string.wish_bought)) }
                        TextButton(onClick = { vm.setStatus(w, "discarded") }) { Text(stringResource(R.string.wish_discard)) }
                    }
                }
                }
                HorizontalDivider()
            }
            if (done.isNotEmpty()) {
                item {
                    Text(
                        str(R.string.wish_history, "n" to done.size),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(16.dp),
                    )
                }
                items(done, key = { it.id }) { w ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(w.title + " · " + stringResource(wishStatusLabel(w.status)), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        if (w.status == "discarded") TextButton(onClick = { vm.setStatus(w, "open") }) { Text(stringResource(R.string.drawer_restore)) }
                    }
                }
            }
        }
        Column(
            Modifier.align(Alignment.BottomEnd).padding(16.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Straight to the camera: scanned in a bookshop, looked up, and the dialog opens filled in.
            SmallFloatingActionButton(
                onClick = { vm.add(); onScan() },
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.primary,
            ) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = stringResource(R.string.add_scan))
            }
            ExtendedFloatingActionButton(
                onClick = vm::add,
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.wish_add)) },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        }
    }
    vm.draft?.let { d -> WishDialog(vm, d, onScan, onPhoto) }
}

@Composable
private fun WishDialog(vm: WishlistViewModel, d: WishDraft, onScan: () -> Unit, onPhoto: () -> Unit) {
    AlertDialog(
        onDismissRequest = vm::close,
        title = { Text(stringResource(if (vm.editing == null) R.string.wish_add else R.string.wish_editTitle)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    d.isbn,
                    { vm.update(d.copy(isbn = it)) },
                    label = { Text(stringResource(R.string.form_isbnOptional)) },
                    isError = d.isbn.isNotBlank() && d.isbn13 == null,
                    trailingIcon = {
                        IconButton(onClick = onScan) {
                            Icon(Icons.Default.QrCodeScanner, contentDescription = stringResource(R.string.add_scan))
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(onClick = vm::lookup, enabled = d.isbn13 != null && !vm.looking) {
                    Text(stringResource(if (vm.looking) R.string.form_searching else R.string.form_lookup))
                }
                vm.note?.let { WishNoteText(it) }
                // Cover: the provider's when the lookup finds one, or a photo of the book (e.g. in a bookshop).
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(vm.covers, d.coverAssetId, d.title.ifBlank { "?" }, 64.dp, authors = d.authorList)
                    Column {
                        OutlinedButton(onClick = onPhoto) {
                            Text(stringResource(if (d.coverAssetId == null) R.string.add_takePhoto else R.string.add_retakePhoto))
                        }
                        if (d.coverAssetId != null) {
                            TextButton(onClick = { vm.update(d.copy(coverAssetId = null)) }) { Text(stringResource(R.string.form_removeCover)) }
                        }
                    }
                }
                OutlinedTextField(d.title, { vm.update(d.copy(title = it)) }, label = { Text(stringResource(R.string.book_title)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    d.authors,
                    { vm.update(d.copy(authors = it)) },
                    label = { Text(stringResource(R.string.book_authors)) },
                    supportingText = { Text(stringResource(R.string.form_separateWithSemicolon)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Picker(stringResource(R.string.wish_priority), d.priority, PRIORITIES.map { it to stringResource(priorityLabel(it)) }, { vm.update(d.copy(priority = it)) }, Modifier.fillMaxWidth())
                OutlinedTextField(d.notes, { vm.update(d.copy(notes = it)) }, label = { Text(stringResource(R.string.wish_notes)) }, minLines = 2, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(onClick = vm::save, enabled = d.title.isNotBlank() && (d.isbn.isBlank() || d.isbn13 != null)) {
                Text(stringResource(R.string.common_save))
            }
        },
        dismissButton = { TextButton(onClick = vm::close) { Text(stringResource(R.string.common_cancel)) } },
    )
}

@Composable
private fun WishNoteText(n: WishNote) {
    val (text, warn) =
        when (n) {
            is WishNote.Found -> str(R.string.form_foundTitle, "sources" to n.sources.joinToString(", ")) to false
            WishNote.NotFound -> stringResource(R.string.form_notFoundTitle) + ". " + stringResource(R.string.form_fillManually) to false
            WishNote.Offline -> stringResource(R.string.wish_offline) to false
            is WishNote.Owned -> str(R.string.wish_owned, "title" to n.title) to true
            WishNote.AlreadyWished -> stringResource(R.string.wish_alreadyWished) to true
        }
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = if (warn) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
