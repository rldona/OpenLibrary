package io.github.rldona.openlibrary.ui.detail

import kotlinx.coroutines.flow.first
import io.github.rldona.openlibrary.ui.components.readableWidth
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ButtonGroup
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.conditionLabel
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.core.retireLabel
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.EditionEntity
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.data.QuoteEntity
import io.github.rldona.openlibrary.data.ReadingEntity
import io.github.rldona.openlibrary.data.WorkEntity
import io.github.rldona.openlibrary.sync.pathOf
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.ui.components.BackButton
import io.github.rldona.openlibrary.ui.components.Cover
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.SuggestionChip
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.onClick
import io.github.rldona.openlibrary.ui.components.EmptyState
import androidx.compose.material.icons.filled.SearchOff
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Job
import io.github.rldona.openlibrary.ui.components.TopBarInsets
import io.github.rldona.openlibrary.ui.components.appBarColors
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MediumFlexibleTopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextOverflow
import io.github.rldona.openlibrary.ui.components.LoadingState
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import java.util.Locale
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

data class DetailState(
    val work: WorkEntity? = null,
    val editions: List<EditionEntity> = emptyList(),
    val copies: List<CopyEntity> = emptyList(),
    val locations: Map<String, LocationEntity> = emptyMap(),
    val readings: List<ReadingEntity> = emptyList(),
    val quotes: List<QuoteEntity> = emptyList(),
    /** The database answered: a null [work] then means it does not exist (deleted elsewhere). */
    val loaded: Boolean = false,
)

class DetailViewModel(private val c: AppContainer, private val workId: String) : ViewModel() {
    val covers = c.covers
    /** Deleting a quote waits for the snackbar's "Undo" (app-wide, so it survives this view model). */
    private val deletes = c.deletes
    /** Retirements in flight, so "Undo" restores the copy only after its retirement was written. */
    private val retiring = ConcurrentHashMap<String, Job>()
    val state: StateFlow<DetailState> =
        combine(
            c.db.catalog().work(workId),
            c.db.catalog().editionsOf(workId),
            c.db.catalog().copiesOfWork(workId),
            c.db.catalog().locations(),
            c.db.catalog().readingsOfWork(workId),
        ) { w, e, cp, l, r -> DetailState(w, e, cp, l.associateBy { it.id }, r, loaded = true) }
            .combine(
                combine(c.db.catalog().quotesOfWork(workId), deletes.hidden) { q, hidden ->
                    deletes.settle(QUOTE, q.mapTo(HashSet()) { QUOTE + it.id })
                    q.filterNot { QUOTE + it.id in hidden }
                },
            ) { st, q ->
                st.copy(quotes = q)
            }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DetailState())

    /** Sends only what changed, so another device's edits to other fields are merged, not overwritten. */
    fun editCopy(copy: CopyEntity, form: CopyForm) =
        viewModelScope.launch {
            val fields = buildJsonObject {
                if (form.locationId != copy.locationId) put("locationId", form.locationId?.let(::JsonPrimitive) ?: JsonNull)
                if (form.condition != copy.condition) put("condition", JsonPrimitive(form.condition))
                if (form.notes.trim() != copy.notes) put("notes", JsonPrimitive(form.notes.trim()))
            }
            if (fields.isNotEmpty()) c.writes.editCopy(copy, fields)
        }

    fun addCopy(editionId: String, form: CopyForm) =
        viewModelScope.launch { c.writes.addCopy(editionId, form.locationId, form.condition, form.notes.trim()) }

    /** In the app scope: the snackbar's "Undo" may come after this screen is gone. */
    fun retire(copy: CopyEntity, reason: String) {
        retiring[copy.id] = c.appScope.launch { c.writes.retireCopy(copy, reason) }
    }

    fun restore(copy: CopyEntity) = viewModelScope.launch { c.writes.restoreCopy(copy) }

    /** "Undo" after retiring: puts the copy back as it is now (the retirement already reached the outbox). */
    fun undoRetire(copyId: String) =
        c.appScope.launch {
            retiring.remove(copyId)?.join()
            c.db.catalog().copyById(copyId)?.takeIf { it.status != "active" }?.let { c.writes.restoreCopy(it) }
        }

    /** False when this quote is already waiting to be deleted. */
    fun deleteQuote(q: QuoteEntity): Boolean = deletes.hide(QUOTE + q.id) { c.writes.deleteQuote(q) }

    fun undoDeleteQuote(id: String) = deletes.undo(QUOTE + id)

    fun commitDeleteQuote(id: String) = deletes.commit(QUOTE + id)

    /** A reading change is being written (the card disables its status row meanwhile). */
    var readingBusy by mutableStateOf(false)
        private set

    fun reading(action: ReadingAction) {
        // One change at a time: a quick second tap must not start a second reading.
        if (readingBusy) return
        readingBusy = true
        viewModelScope.launch {
            try {
                when (action) {
                    is ReadingAction.Start -> {
                        // Checked against the database, not the screen: with a reading in progress, "read"
                        // finishes it and "reading" does nothing, instead of opening another one.
                        val inProgress = currentReading(c.db.catalog().readingsOfWork(workId).first())
                        when {
                            inProgress == null -> c.writes.startReading(action.copyId, action.status)
                            action.status == "read" -> c.writes.editReading(inProgress, JsonObject(mapOf("status" to JsonPrimitive("read"))))
                        }
                    }
                    is ReadingAction.Edit -> c.writes.editReading(action.reading, JsonObject(action.fields.mapValues { (_, v) -> toJson(v) }))
                    is ReadingAction.Reset -> action.readings.forEach { r ->
                        c.writes.editReading(
                            r,
                            JsonObject(
                                mapOf(
                                    "status" to JsonPrimitive("pending"),
                                    "startedOn" to JsonNull,
                                    "finishedOn" to JsonNull,
                                ),
                            ),
                        )
                    }
                }
            } finally {
                readingBusy = false
            }
        }
    }

    fun quote(action: QuoteAction) =
        viewModelScope.launch {
            when (action) {
                is QuoteAction.Add -> action.draft.let { c.writes.addQuote(workId, it.text, it.page, it.note, it.copyId) }
                is QuoteAction.Edit -> {
                    val q = action.quote
                    val d = action.draft
                    // Only what changed, so another device's edits to other fields are merged.
                    val f = buildMap<String, Any?> {
                        if (d.text != q.text) put("text", d.text)
                        if (d.page != q.page) put("page", d.page)
                        if (d.note != q.note) put("note", d.note)
                        if (d.copyId != q.copyId) put("copyId", d.copyId)
                    }
                    if (f.isNotEmpty()) c.writes.editQuote(q, JsonObject(f.mapValues { (_, v) -> toJson(v) }))
                }
            }
        }

    private fun toJson(v: Any?): JsonElement =
        when (v) {
            null -> JsonNull
            is Number -> JsonPrimitive(v)
            else -> JsonPrimitive(v.toString())
        }
}

private const val QUOTE = "quote:"

private sealed interface Dialog {
    data class Edit(val copy: CopyEntity) : Dialog
    data class Retire(val copy: CopyEntity) : Dialog
    data class Add(val editionId: String) : Dialog
}

@OptIn(ExperimentalSharedTransitionApi::class, ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(
    vm: DetailViewModel,
    editionId: String?,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
    onBack: () -> Unit,
    onEdit: (workId: String, editionId: String) -> Unit,
    onCover: (assetId: String, title: String) -> Unit,
    /** A subject was tapped: search the library for it. */
    onSubject: (String) -> Unit = {},
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val snackbar = LocalSnackbar.current
    val quoteDeleted = stringResource(R.string.quotes_deleted)
    val retired = stringResource(R.string.copyForm_retired)
    val reasons = RETIRE_REASONS.associateWith { stringResource(retireLabel(it)) }
    val work = s.work
    val active = s.copies.filter { it.status == "active" }
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    val locations = s.locations.values.toList()
    // The edition you came from (or the first one): what the bar's "Edit" and "Add copy" act on.
    val primary = s.editions.firstOrNull { it.id == editionId } ?: s.editions.firstOrNull()
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    // A title too long for the bar is shown in full under it, next to the cover.
    var titleCut by remember(work?.title) { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    // The bar belongs to this screen, so it slides in/out with the detail instead of appearing over the
    // library. It starts tall with the title and shrinks to a single row as the page scrolls.
    Scaffold(
        Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            MediumFlexibleTopAppBar(
                title = {
                    Text(
                        work?.title.orEmpty(),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        onTextLayout = { if (it.hasVisualOverflow) titleCut = true },
                        modifier = Modifier.semantics { heading() },
                    )
                },
                navigationIcon = { BackButton(onBack) },
                actions = {
                    if (work != null && primary != null) {
                        IconButton(onClick = { onEdit(work.id, primary.id) }) {
                            Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.drawer_editBook))
                        }
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.common_more))
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.drawer_addCopy)) },
                                    onClick = { menu = false; dialog = Dialog.Add(primary.id) },
                                )
                            }
                        }
                    }
                },
                windowInsets = TopBarInsets,
                colors = appBarColors(),
                scrollBehavior = scroll,
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0),
    ) { inner ->
        if (work == null) {
            // Not read yet, or gone (deleted on another device while you looked at it).
            if (s.loaded) {
                EmptyState(Icons.Default.SearchOff, stringResource(R.string.detail_missing), Modifier.padding(inner), action = stringResource(R.string.detail_back) to onBack)
            } else {
                LoadingState(Modifier.padding(inner))
            }
            return@Scaffold
        }
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).readableWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            val coverEdition =
                s.editions.firstOrNull { it.id == editionId && it.coverAssetId != null && vm.covers.has(it.coverAssetId) }
                    ?: s.editions.firstNotNullOfOrNull { e -> e.coverAssetId?.takeIf { assetId -> vm.covers.has(assetId) }?.let { e } }
            val coverId = coverEdition?.coverAssetId
            // The tapped edition carries the shared element; a different edition's cover is only a fallback.
            val sharedKey = editionId?.takeIf { coverEdition?.id == it }?.let { "cover-$it" }
            val coverModifier = if (sharedKey != null) {
                with(sharedTransitionScope) {
                    Modifier.sharedElement(rememberSharedContentState(sharedKey), animatedVisibilityScope)
                }
            } else Modifier
            // Tapping the cover opens it full screen, zoomable.
            Cover(
                vm.covers,
                coverId,
                work.title,
                128.dp,
                coverModifier.then(
                    if (coverId != null) {
                        Modifier.clickable(onClickLabel = stringResource(R.string.cover_open), role = Role.Button) { onCover(coverId, work.title) }
                    } else {
                        Modifier
                    },
                ),
                authors = work.authors,
                provisional = s.editions.any { it.metadataStatus == "provisional" },
            )
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    str(
                        R.string.drawer_kicker,
                        "editions" to plural(R.string.library_editions_one, R.string.library_editions_other, s.editions.size),
                        "copies" to plural(R.string.library_copies_one, R.string.library_copies_other, active.size),
                    ),
                    style = MaterialTheme.typography.labelMedium,
                )
                if (titleCut) Text(work.title, style = MaterialTheme.typography.headlineSmall)
                work.subtitle?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text(
                    work.authors.joinToString(", ").ifEmpty { stringResource(R.string.book_unknownAuthor) },
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                work.series?.let {
                    val idx = work.seriesIndex?.let { i -> " #" + if (i % 1.0 == 0.0) i.toInt() else i } ?: ""
                    Text(str(R.string.drawer_series, "series" to it + idx), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (work.subjects.isNotEmpty()) {
            val searchFor = stringResource(R.string.subject_search)
            // Each subject opens the library searched for it; they wrap onto as many lines as needed.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                work.subjects.forEach { subject ->
                    SuggestionChip(
                        onClick = { onSubject(subject) },
                        label = { Text(subject) },
                        modifier = Modifier.semantics { onClick(label = format(searchFor, "subject" to subject)) { onSubject(subject); true } },
                    )
                }
            }
        }
        ReadingCard(s.readings, s.copies, vm::reading, busy = vm.readingBusy)
        QuotesCard(s.quotes, s.copies, vm::quote) { q ->
            if (vm.deleteQuote(q)) snackbar.showUndo(quoteDeleted, onUndo = { vm.undoDeleteQuote(q.id) }, onDismiss = { vm.commitDeleteQuote(q.id) })
        }
        work.description?.let {
            Text(stringResource(R.string.book_synopsis), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
            Text(it, style = MaterialTheme.typography.bodyMedium)
        }
        s.editions.forEach { e ->
            EditionCard(
                e,
                s.copies.filter { it.editionId == e.id },
                s.locations,
                onEditBook = { onEdit(work.id, e.id) },
                onAddCopy = { dialog = Dialog.Add(e.id) },
                onEditCopy = { dialog = Dialog.Edit(it) },
                onRetire = { dialog = Dialog.Retire(it) },
                onRestore = vm::restore,
            )
        }
    }
    }

    when (val d = dialog) {
        is Dialog.Edit ->
            CopyDialog(
                str(R.string.copyForm_editTitle, "code" to d.copy.code.ifEmpty { "—" }),
                stringResource(R.string.common_save),
                CopyForm(d.copy.locationId, d.copy.condition, d.copy.notes),
                locations,
                onDismiss = { dialog = null },
                onSave = { vm.editCopy(d.copy, it); dialog = null },
            )
        is Dialog.Add ->
            CopyDialog(
                stringResource(R.string.copyForm_newTitle),
                stringResource(R.string.copyForm_addButton),
                CopyForm(null, "good", ""),
                locations,
                onDismiss = { dialog = null },
                onSave = { vm.addCopy(d.editionId, it); dialog = null },
            )
        is Dialog.Retire ->
            RetireDialog(
                d.copy.code,
                onDismiss = { dialog = null },
                onRetire = { reason ->
                    vm.retire(d.copy, reason)
                    dialog = null
                    // The reason stays in the dialog; the snackbar confirms and offers the way back.
                    val message = format(retired, "code" to d.copy.code.ifEmpty { "—" }, "reason" to reasons[reason].orEmpty())
                    snackbar.showUndo(message, onUndo = { vm.undoRetire(d.copy.id) }, onDismiss = {})
                },
            )
        null -> Unit
    }
}

@Composable
private fun EditionCard(
    e: EditionEntity,
    copies: List<CopyEntity>,
    locations: Map<String, LocationEntity>,
    onEditBook: () -> Unit,
    onAddCopy: () -> Unit,
    onEditCopy: (CopyEntity) -> Unit,
    onRetire: (CopyEntity) -> Unit,
    onRestore: (CopyEntity) -> Unit,
) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.drawer_edition), style = MaterialTheme.typography.labelMedium, modifier = Modifier.semantics { heading() })
            Text(
                listOfNotNull(
                    e.title,
                    e.publisher ?: stringResource(R.string.book_noPublisher),
                    e.publishedYear?.toString(),
                    e.language?.let { Locale.forLanguageTag(it).displayLanguage.ifEmpty { it } },
                    e.pages?.let { "$it p." },
                    e.format,
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
            )
            Text("ISBN " + (e.isbn13 ?: stringResource(R.string.book_noIsbn)), style = MaterialTheme.typography.bodySmall)
            if (e.metadataStatus == "provisional") {
                Text(
                    stringResource(R.string.drawer_provisionalTitle) + " " + stringResource(R.string.drawer_provisionalText),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            // Two related actions on this edition: an Expressive button group (the pressed one widens).
            val edit = stringResource(R.string.drawer_editBook)
            val addCopy = stringResource(R.string.drawer_addCopy)
            ButtonGroup(overflowIndicator = { ButtonGroupDefaults.OverflowIndicator(it) }) {
                clickableItem(onClick = onEditBook, label = edit, icon = { Icon(Icons.Default.Edit, contentDescription = null) })
                clickableItem(onClick = onAddCopy, label = addCopy, icon = { Icon(Icons.Default.Add, contentDescription = null) })
            }
            Text(stringResource(R.string.drawer_copiesOfEdition), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
            copies.sortedBy { it.status != "active" }.forEach { c -> CopyLine(c, locations, onEditCopy, onRetire, onRestore) }
        }
    }
}

@Composable
private fun CopyLine(
    c: CopyEntity,
    locations: Map<String, LocationEntity>,
    onEdit: (CopyEntity) -> Unit,
    onRetire: (CopyEntity) -> Unit,
    onRestore: (CopyEntity) -> Unit,
) {
    val retired = c.status != "active"
    val code = c.code.ifEmpty { stringResource(R.string.copy_pendingCode) }
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f).padding(top = 8.dp)) {
            Text(
                code + " · " + (pathOf(locations, c.locationId).joinToString(" › ").ifEmpty { stringResource(R.string.copy_noLocation) }),
                style = MaterialTheme.typography.bodyMedium,
                color = if (retired) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            Text(
                listOfNotNull(
                    stringResource(conditionLabel(c.condition)),
                    c.acquiredOn?.let { stringResource(R.string.copy_acquired) + " " + it },
                    if (retired) stringResource(R.string.detail_retired) + " (" + stringResource(retireLabel(c.retiredReason)) + ")" else null,
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (c.notes.isNotBlank()) Text(c.notes, style = MaterialTheme.typography.bodySmall)
        }
        // The copy's actions in its own menu, so each line stays one short block.
        Box {
            IconButton(onClick = { menu = true }) {
                Icon(Icons.Default.MoreVert, contentDescription = str(R.string.copy_actions, "code" to code))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (retired) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.drawer_restore)) },
                        leadingIcon = { Icon(Icons.Default.Restore, contentDescription = null) },
                        onClick = { menu = false; onRestore(c) },
                    )
                } else {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.drawer_moveEdit)) },
                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                        onClick = { menu = false; onEdit(c) },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.drawer_retire), color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.Default.Archive, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                        onClick = { menu = false; onRetire(c) },
                    )
                }
            }
        }
    }
}
