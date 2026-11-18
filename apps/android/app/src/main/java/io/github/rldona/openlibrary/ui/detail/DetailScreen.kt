package io.github.rldona.openlibrary.ui.detail

import kotlinx.coroutines.flow.first
import io.github.rldona.openlibrary.ui.components.readableWidth
import androidx.compose.material.icons.filled.Add
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import io.github.rldona.openlibrary.core.fmtDate
import io.github.rldona.openlibrary.core.languageName
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
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Scaffold
import androidx.compose.ui.text.style.TextOverflow
import io.github.rldona.openlibrary.ui.components.LoadingState
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
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
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import io.github.rldona.openlibrary.ui.components.LocationSheet
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Button
import androidx.compose.runtime.derivedStateOf
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.heightIn

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
    /** The place proposed first in the location sheet. */
    val lastLocation = c.libraryPrefs.lastLocation

    /** Puts a copy on a shelf (or moves it): only its location changes; the place is remembered. */
    fun place(copy: CopyEntity, locationId: String?) = viewModelScope.launch {
        if (locationId != copy.locationId) c.writes.editCopy(copy, JsonObject(mapOf("locationId" to (locationId?.let(::JsonPrimitive) ?: JsonNull))))
        if (locationId != null) c.libraryPrefs.setLastLocation(locationId)
    }

    /** The heart in the header: a normal work update, synced like any other field. */
    fun toggleFavorite(work: WorkEntity) = viewModelScope.launch {
        c.writes.editWork(work, JsonObject(mapOf("favorite" to JsonPrimitive(!work.favorite))))
    }

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
    val lastPlace by vm.lastLocation.collectAsStateWithLifecycle(null)
    val snackbar = LocalSnackbar.current
    val quoteDeleted = stringResource(R.string.quotes_deleted)
    val retired = stringResource(R.string.copyForm_retired)
    val reasons = RETIRE_REASONS.associateWith { stringResource(retireLabel(it)) }
    val work = s.work
    val active = s.copies.filter { it.status == "active" }
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    /** The copy being placed in the location sheet. */
    var placing by remember { mutableStateOf<CopyEntity?>(null) }
    val locations = s.locations.values.toList()
    // The edition you came from (or the first one): what the bar's "Edit" and "Add copy" act on.
    val primary = s.editions.firstOrNull { it.id == editionId } ?: s.editions.firstOrNull()
    val scrollState = rememberScrollState()
    var menu by remember { mutableStateOf(false) }
    // The title joins the bar once the header has scrolled away.
    val headerGone by remember { derivedStateOf { scrollState.value > 600 } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (headerGone) Text(work?.title.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = { BackButton(onBack) },
                actions = {
                    if (work != null) {
                        IconButton(onClick = { vm.toggleFavorite(work) }) {
                            Icon(
                                if (work.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                contentDescription = stringResource(if (work.favorite) R.string.favorites_remove else R.string.favorites_add),
                                tint = if (work.favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (work != null && primary != null) {
                        // Editing the book, and the copy's own actions when there is just one.
                        val only = active.singleOrNull()
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.common_more))
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.drawer_editBook)) },
                                    leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                    onClick = { menu = false; onEdit(work.id, primary.id) },
                                )
                                if (only != null) {
                                    DropdownMenuItem(
                                        text = { Text(stringResource(R.string.detail_editCopy)) },
                                        leadingIcon = { Icon(Icons.Default.Tune, contentDescription = null) },
                                        onClick = { menu = false; dialog = Dialog.Edit(only) },
                                    )
                                    DropdownMenuItem(
                                        text = { Text(stringResource(R.string.drawer_retire), color = MaterialTheme.colorScheme.error) },
                                        leadingIcon = { Icon(Icons.Default.Archive, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                                        onClick = { menu = false; dialog = Dialog.Retire(only) },
                                    )
                                }
                            }
                        }
                    }
                },
                windowInsets = TopBarInsets,
                colors = appBarColors(),
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
            Modifier.fillMaxSize().padding(inner).verticalScroll(scrollState).readableWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Header(vm, s, work, primary, editionId, sharedTransitionScope, animatedVisibilityScope, onCover, onSubject)
            ReadingCard(s.readings, s.copies, vm::reading, busy = vm.readingBusy, plain = true)
            PlaceCard(
                active,
                s.locations,
                several = active.size > 1,
                onPlace = { placing = it },
                onEditCopy = { dialog = Dialog.Edit(it) },
                onRetire = { dialog = Dialog.Retire(it) },
            )
            primary?.let { e ->
                val missing = missingFields(work, e)
                if (missing.isNotEmpty()) MissingCard(missing) { onEdit(work.id, e.id) }
            }
            work.description?.let {
                Text(stringResource(R.string.book_synopsis), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }
            Column {
                QuotesCard(s.quotes, s.copies, vm::quote, onDelete = { q ->
                    if (vm.deleteQuote(q)) snackbar.showUndo(quoteDeleted, onUndo = { vm.undoDeleteQuote(q.id) }, onDismiss = { vm.commitDeleteQuote(q.id) })
                }, row = true)
                s.editions.forEach { e ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    DetailRow(
                        stringResource(R.string.detail_fullRecord) + if (s.editions.size > 1) " · " + editionLabel(e) else "",
                        trailing = e.isbn13?.let { "ISBN $it" } ?: stringResource(R.string.book_noIsbn).replaceFirstChar { it.uppercase() },
                    ) { onEdit(work.id, e.id) }
                }
                if (primary != null) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    DetailRow(stringResource(R.string.bulk_addCopy), chevron = true) { dialog = Dialog.Add(primary.id) }
                }
            }
            val gone = s.copies.filter { it.status != "active" }
            if (gone.isNotEmpty()) RetiredCopies(gone, s.locations, onRestore = vm::restore)
        }
    }

    placing?.let { copy ->
        LocationSheet(
            locations,
            lastUsedId = lastPlace,
            initial = copy.locationId,
            subtitle = listOfNotNull(work?.title, work?.authors?.joinToString(", ")?.ifEmpty { null }).joinToString(" · "),
            onConfirm = { vm.place(copy, it); placing = null },
            onDismiss = { placing = null },
        )
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

/** The edition's details in a few words, to tell editions apart. */
@Composable
private fun editionLabel(e: EditionEntity): String =
    listOfNotNull(e.publisher, e.publishedYear?.toString(), e.language?.let { languageName(it) }).joinToString(" · ").ifEmpty { e.isbn13 ?: "—" }

/** What the book still lacks, in the order the warning says it: author, publisher, year, language. */
fun missingFields(work: WorkEntity, e: EditionEntity): List<String> =
    listOfNotNull(
        "author".takeIf { work.authors.isEmpty() },
        "publisher".takeIf { e.publisher.isNullOrBlank() },
        "year".takeIf { e.publishedYear == null },
        "language".takeIf { e.language.isNullOrBlank() },
    )

/** "a", "a y b", "a, b y c". */
fun joinWithAnd(items: List<String>, and: String): String =
    if (items.size <= 1) items.joinToString() else items.dropLast(1).joinToString(", ") + and + items.last()

@OptIn(ExperimentalSharedTransitionApi::class, ExperimentalLayoutApi::class)
@Composable
private fun Header(
    vm: DetailViewModel,
    s: DetailState,
    work: WorkEntity,
    primary: EditionEntity?,
    editionId: String?,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
    onCover: (assetId: String, title: String) -> Unit,
    onSubject: (String) -> Unit,
) {
    val active = s.copies.count { it.status == "active" }
    Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
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
            120.dp,
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
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            // Users see books, not works or editions; copies are only counted when there are several.
            if (active > 1) {
                Text(plural(R.string.library_copies_one, R.string.library_copies_other, active), style = MaterialTheme.typography.labelMedium)
            }
            Text(work.title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
            work.subtitle?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (work.authors.isEmpty()) {
                Text(stringResource(R.string.book_unknownAuthor), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                // In the accent colour because they are links: each one searches the library, like the subjects.
                val searchFor = stringResource(R.string.subject_search)
                FlowRow {
                    work.authors.forEachIndexed { i, author ->
                        Text(
                            if (i < work.authors.lastIndex) "$author," else author,
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier
                                .heightIn(min = 32.dp)
                                .clickable(onClickLabel = format(searchFor, "subject" to author), role = Role.Button) { onSubject(author) }
                                .padding(end = 6.dp),
                        )
                    }
                }
            }
            val facts = listOfNotNull(primary?.pages?.let { "$it p." }, primary?.language?.let { languageName(it) }).joinToString(" · ")
            if (facts.isNotEmpty()) Text(facts, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            work.series?.let {
                val idx = work.seriesIndex?.let { i -> " #" + if (i % 1.0 == 0.0) i.toInt() else i } ?: ""
                Text(str(R.string.drawer_series, "series" to it + idx), style = MaterialTheme.typography.bodySmall)
            }
            if (work.subjects.isNotEmpty()) {
                val searchFor = stringResource(R.string.subject_search)
                // Each genre opens the library searched for it.
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    work.subjects.forEach { subject ->
                        SuggestionChip(
                            onClick = { onSubject(subject) },
                            label = { Text(subject) },
                            shape = RoundedCornerShape(50),
                            modifier = Modifier.semantics { onClick(label = format(searchFor, "subject" to subject)) { onSubject(subject); true } },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Where the book is. One copy: "Not placed yet" with "Put on a shelf", or its full path with "Move". Several:
 * a line per copy, each with its own actions.
 */
@Composable
private fun PlaceCard(
    copies: List<CopyEntity>,
    locations: Map<String, LocationEntity>,
    several: Boolean,
    onPlace: (CopyEntity) -> Unit,
    onEditCopy: (CopyEntity) -> Unit,
    onRetire: (CopyEntity) -> Unit,
) {
    if (copies.isEmpty()) return
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            copies.forEachIndexed { i, c ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                val path = pathOf(locations, c.locationId).joinToString(" › ").ifEmpty { null }
                Row(verticalAlignment = Alignment.Top) {
                    Icon(Icons.Outlined.Place, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 2.dp))
                    Column(Modifier.weight(1f).padding(start = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        if (several) {
                            Text(
                                str(R.string.detail_copyN, "code" to c.code.ifEmpty { stringResource(R.string.copy_pendingCode) }),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(path ?: stringResource(R.string.detail_unplaced), style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize))
                        Text(
                            listOfNotNull(
                                stringResource(conditionLabel(c.condition)),
                                c.acquiredOn?.let { fmtDate(it) },
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (c.notes.isNotBlank()) Text(c.notes, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (several) CopyMenu(c, onEditCopy, onRetire)
                }
                when {
                    path == null -> Button(onClick = { onPlace(c) }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                        Text(stringResource(R.string.detail_place))
                    }
                    else -> OutlinedButton(onClick = { onPlace(c) }, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.detail_move))
                    }
                }
            }
        }
    }
}

@Composable
private fun CopyMenu(c: CopyEntity, onEdit: (CopyEntity) -> Unit, onRetire: (CopyEntity) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val code = c.code.ifEmpty { stringResource(R.string.copy_pendingCode) }
    Box {
        IconButton(onClick = { menu = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = str(R.string.copy_actions, "code" to code))
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.detail_editCopy)) },
                leadingIcon = { Icon(Icons.Default.Tune, contentDescription = null) },
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

/** "Publisher and year missing · Complete": opens the edit form. */
@Composable
private fun MissingCard(fields: List<String>, onComplete: () -> Unit) {
    val names = fields.map {
        stringResource(
            when (it) {
                "author" -> R.string.detail_field_author
                "publisher" -> R.string.detail_field_publisher
                "year" -> R.string.detail_field_year
                else -> R.string.detail_field_language
            },
        )
    }
    val sentence = str(if (fields.size == 1) R.string.detail_missing_one else R.string.detail_missing_other, "fields" to joinWithAnd(names, " " + stringResource(R.string.list_and) + " "))
        .replaceFirstChar { it.uppercase() }
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text(sentence, Modifier.weight(1f).padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyLarge)
            TextButton(onClick = onComplete, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.detail_complete)) }
        }
    }
}

/** A row of the detail's list: a label, and a trailing value or chevron. */
@Composable
private fun DetailRow(label: String, trailing: String? = null, chevron: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        trailing?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (chevron) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Copies given away, sold or lost: listed last, each one can be restored. */
@Composable
private fun RetiredCopies(copies: List<CopyEntity>, locations: Map<String, LocationEntity>, onRestore: (CopyEntity) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.detail_retiredCopies), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.semantics { heading() })
        copies.forEach { c ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    listOfNotNull(
                        c.code.ifEmpty { null },
                        pathOf(locations, c.locationId).joinToString(" › ").ifEmpty { null },
                        stringResource(retireLabel(c.retiredReason)),
                    ).joinToString(" · "),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { onRestore(c) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.drawer_restore)) }
            }
        }
    }
}
