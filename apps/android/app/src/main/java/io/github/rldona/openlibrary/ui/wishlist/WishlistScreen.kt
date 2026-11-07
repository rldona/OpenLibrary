package io.github.rldona.openlibrary.ui.wishlist

import io.github.rldona.openlibrary.ui.components.DestructiveDialog
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import io.github.rldona.openlibrary.ui.components.readableWidth
import androidx.compose.material3.ButtonDefaults
import io.github.rldona.openlibrary.ui.components.animateListItem
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.remember
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.clickable
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.rldona.openlibrary.ui.components.BackButton
import io.github.rldona.openlibrary.ui.components.BarTitle
import io.github.rldona.openlibrary.ui.components.BookTitle
import io.github.rldona.openlibrary.ui.components.Spacing
import io.github.rldona.openlibrary.ui.components.Tag
import io.github.rldona.openlibrary.ui.components.appBarColors
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
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
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.ui.components.AddFabMenu
import io.github.rldona.openlibrary.ui.components.BusyLabel
import io.github.rldona.openlibrary.ui.components.FabItem
import io.github.rldona.openlibrary.ui.components.TabScaffold
import io.github.rldona.openlibrary.ui.components.rememberFabVisibility
import androidx.compose.ui.input.nestedscroll.nestedScroll
import io.github.rldona.openlibrary.ui.components.Cover
import io.github.rldona.openlibrary.ui.components.EmptyState
import io.github.rldona.openlibrary.ui.components.FillCover
import io.github.rldona.openlibrary.ui.components.LoadingState
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
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
    /** The server answered with an error (not a network failure): its translated message. */
    data class Failed(val message: String) : WishNote
}

class WishlistViewModel(private val c: AppContainer) : ViewModel() {
    /** Deleting waits for the snackbar's "Undo" (app-wide, so it survives this view model); the wish leaves the list at once. */
    private val deletes = c.deletes
    val wishes =
        combine(c.db.catalog().wishes(), deletes.hidden) { list, hidden ->
            deletes.settle(WISH, list.mapTo(HashSet()) { WISH + it.id })
            list.filterNot { WISH + it.id in hidden }
        }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
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

    /** The draft as the form opened, to tell whether closing it would lose something. */
    private var opened: WishDraft? = null

    /** The form has changes: closing it asks first. */
    val dirty get() = draft != null && draft != opened

    fun add() {
        editing = null
        draft = WishDraft("", "", "", "normal", "")
        opened = draft
        note = null
    }

    fun edit(w: WishEntity) {
        editing = w
        draft = WishDraft(w.title, w.authors.joinToString("; "), w.isbn13.orEmpty(), w.priority, w.notes, w.coverAssetId)
        opened = draft
        note = null
    }

    fun close() {
        draft = null
        opened = null
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
                    ?: c.db.catalog().openWishByIsbn(isbn13)
                        ?.takeIf { it.id != editing?.id && WISH + it.id !in deletes.hidden.value }
                        ?.let { WishNote.AlreadyWished }
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
            } catch (e: ApiException) {
                if (note == null) note = WishNote.Failed(e.message)
            } catch (_: Exception) {
                // An answer this app cannot read: treat it as nothing found and let the user type it.
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

    /** False when this wish is already waiting to be deleted. */
    fun delete(w: WishEntity): Boolean = deletes.hide(WISH + w.id) { c.writes.deleteWish(w) }

    /** How many times each wish came back with "Undo": its row starts a fresh swipe state each time. */
    val undone = mutableStateMapOf<String, Int>()

    fun undoDelete(id: String) {
        if (deletes.undo(WISH + id)) undone[id] = (undone[id] ?: 0) + 1
    }

    fun commitDelete(id: String) = deletes.commit(WISH + id)
}

private const val WISH = "wish:"

/**
 * Books you want (BR14). "I bought it" opens the add-book form pre-filled from the wish; once bought, the
 * wish is kept as a record but no longer listed. A wish you no longer want is deleted, with a moment to undo.
 */
@Composable
fun WishlistScreen(vm: WishlistViewModel, onScan: () -> Unit, onPhoto: () -> Unit, onBought: (wishId: String) -> Unit) {
    val all by vm.wishes.collectAsStateWithLifecycle()
    val snackbar = LocalSnackbar.current
    val deleted = stringResource(R.string.wish_deleted)
    val delete = { w: WishEntity ->
        if (vm.delete(w)) snackbar.showUndo(format(deleted, "title" to w.title), onUndo = { vm.undoDelete(w.id) }, onDismiss = { vm.commitDelete(w.id) })
    }

    val fab = rememberFabVisibility()
    var grid by rememberSaveable { mutableStateOf(false) }
    TabScaffold(
        stringResource(R.string.nav_wishlist),
        Modifier.nestedScroll(fab.connection),
        actions = {
            IconButton(onClick = { grid = !grid }) {
                Icon(
                    if (grid) Icons.AutoMirrored.Filled.ViewList else Icons.Default.GridView,
                    contentDescription = stringResource(if (grid) R.string.library_viewTable else R.string.library_viewCovers),
                )
            }
        },
        fab = {
            AddFabMenu(
                listOf(
                    FabItem(stringResource(R.string.wish_add), Icons.Default.Add, onClick = vm::add),
                    // Straight to the camera: scanned in a bookshop, looked up, and the dialog opens filled in.
                    FabItem(stringResource(R.string.add_scan), Icons.Default.QrCodeScanner) { vm.add(); onScan() },
                ),
                visible = fab.visible,
            )
        },
    ) { inner ->
        val open = all
        val modifier = Modifier.padding(inner)
        when {
            open == null -> LoadingState(modifier)
            open.isEmpty() ->
                EmptyState(
                    Icons.Default.FavoriteBorder,
                    stringResource(R.string.wish_emptyTitle),
                    modifier,
                    text = stringResource(R.string.wish_emptyText),
                    action = stringResource(R.string.wish_add) to vm::add,
                )
            else -> Box(modifier) { WishList(vm, open, onBought, delete, grid) }
        }
    }
    vm.draft?.let { d -> WishDialog(vm, d, onScan, onPhoto) }
}

@Composable
private fun WishList(
    vm: WishlistViewModel,
    open: List<WishEntity>,
    onBought: (wishId: String) -> Unit,
    onDelete: (WishEntity) -> Unit,
    grid: Boolean,
) {
    if (grid) {
        LazyVerticalGrid(
            GridCells.Adaptive(104.dp),
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = Spacing.page, end = Spacing.page, bottom = Spacing.fab),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(stringResource(R.string.wish_subtitle), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 4.dp))
            }
            gridItems(open, key = { it.id }) { w -> WishCard(vm, w) }
        }
    } else {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Spacing.fab)) {
            item { Text(stringResource(R.string.wish_subtitle), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(Spacing.page)) }
            items(open, key = { it.id }) { w ->
                // The rows close the gap of a deleted wish (and open it again on "Undo") instead of jumping.
                Column(animateListItem()) {
                    WishRow(vm, w, onBought, onDelete)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

@Composable
private fun WishCard(vm: WishlistViewModel, w: WishEntity) {
    Column(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small).clickable { vm.edit(w) },
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        FillCover(vm.covers, w.coverAssetId, w.title, w.authors, false)
        Text(w.title, style = BookTitle.grid, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (w.authors.isNotEmpty()) {
            Text(w.authors.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (w.priority != "normal") Tag(stringResource(priorityLabel(w.priority)))
    }
}

/**
 * One wish: tap to edit, "I bought it" as its main action. Swiping it away (towards the start) deletes it,
 * with the snackbar's "Undo"; the ⋮ menu and TalkBack's actions offer the same without the gesture.
 */
@Composable
private fun WishRow(vm: WishlistViewModel, w: WishEntity, onBought: (wishId: String) -> Unit, onDelete: (WishEntity) -> Unit) {
    // Back after "Undo": a new swipe state, so the row returns in place, not still swiped away (the list would
    // otherwise restore the saved, dismissed one for the same key).
    val swipe = key(vm.undone[w.id] ?: 0) { rememberSwipeToDismissBoxState() }
    val deleteLabel = stringResource(R.string.wish_delete)
    var menu by remember { mutableStateOf(false) }
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromStartToEnd = false,
        onDismiss = { onDelete(w) },
        backgroundContent = {
            Box(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.errorContainer).padding(horizontal = 24.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
            }
        },
    ) {
        ListItem(
            onClick = { vm.edit(w) },
            modifier = Modifier.semantics {
                customActions = listOf(CustomAccessibilityAction(deleteLabel) { onDelete(w); true })
            },
            verticalAlignment = Alignment.Top,
            leadingContent = { Cover(vm.covers, w.coverAssetId, w.title, Spacing.rowCover, authors = w.authors) },
            trailingContent = {
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.common_more))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(deleteLabel, color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                            onClick = { menu = false; onDelete(w) },
                        )
                    }
                }
            },
            supportingContent = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val meta = listOfNotNull(w.authors.joinToString(", ").ifEmpty { null }, w.isbn13?.let { "ISBN " + formatIsbn(it) })
                    if (meta.isNotEmpty()) Text(meta.joinToString(" · "))
                    if (w.notes.isNotBlank()) Text(w.notes, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (w.priority != "normal") Tag(stringResource(priorityLabel(w.priority)))
                    FilledTonalButton(onClick = { onBought(w.id) }, shapes = ButtonDefaults.shapes()) { Text(stringResource(R.string.wish_bought)) }
                }
            },
            colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
        ) { Text(w.title, style = BookTitle.list, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    }
}

/**
 * Add or edit a wish, full screen: it is a whole form (scan, lookup, cover photo, priority, notes), which an
 * alert dialog squeezes into a scrolling box. ✕ closes without saving.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WishDialog(vm: WishlistViewModel, d: WishDraft, onScan: () -> Unit, onPhoto: () -> Unit) {
    val canSave = d.title.isNotBlank() && (d.isbn.isBlank() || d.isbn13 != null)
    var confirmDiscard by remember { mutableStateOf(false) }
    // ✕ and Back ask before throwing away what was typed; with nothing changed they just close.
    val close = { if (vm.dirty) confirmDiscard = true else vm.close() }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { BarTitle(stringResource(if (vm.editing == null) R.string.wish_add else R.string.wish_editTitle)) },
                    navigationIcon = { BackButton(close, close = true) },
                    actions = { TextButton(onClick = vm::save, enabled = canSave) { Text(stringResource(R.string.common_save)) } },
                    colors = appBarColors(),
                )
            },
            containerColor = MaterialTheme.colorScheme.background,
        ) { inner ->
            Column(
                Modifier.fillMaxSize().padding(inner).imePadding().verticalScroll(rememberScrollState()).readableWidth().padding(Spacing.page),
                verticalArrangement = Arrangement.spacedBy(Spacing.item),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
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
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(onClick = vm::lookup, enabled = d.isbn13 != null && !vm.looking) {
                        BusyLabel(vm.looking, stringResource(if (vm.looking) R.string.form_searching else R.string.form_lookup))
                    }
                }
                vm.note?.let { WishNoteText(it) }
                // Cover: the provider's when the lookup finds one, or a photo of the book (e.g. in a bookshop).
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.item), verticalAlignment = Alignment.CenterVertically) {
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
                Text(stringResource(R.string.wish_priority), style = MaterialTheme.typography.labelLarge)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    PRIORITIES.forEachIndexed { i, p ->
                        SegmentedButton(
                            selected = d.priority == p,
                            onClick = { vm.update(d.copy(priority = p)) },
                            shape = SegmentedButtonDefaults.itemShape(i, PRIORITIES.size),
                        ) { Text(stringResource(priorityLabel(p))) }
                    }
                }
                OutlinedTextField(d.notes, { vm.update(d.copy(notes = it)) }, label = { Text(stringResource(R.string.wish_notes)) }, minLines = 2, modifier = Modifier.fillMaxWidth())
            }
        }
    }
    // After the form's own window, so it shows on top of it.
    if (confirmDiscard) {
        DestructiveDialog(
            title = stringResource(R.string.form_discardTitle),
            text = stringResource(R.string.form_discardText),
            confirm = stringResource(R.string.form_discard),
            onConfirm = { confirmDiscard = false; vm.close() },
            onDismiss = { confirmDiscard = false },
            dismiss = stringResource(R.string.form_keepEditing),
        )
    }
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
            is WishNote.Failed -> str(R.string.form_lookupFailed, "error" to n.message) to true
        }
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = if (warn) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
