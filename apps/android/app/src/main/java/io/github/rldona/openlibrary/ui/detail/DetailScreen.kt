package io.github.rldona.openlibrary.ui.detail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
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
import io.github.rldona.openlibrary.ui.components.Cover
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
)

class DetailViewModel(private val c: AppContainer, private val workId: String) : ViewModel() {
    val covers = c.covers
    val state: StateFlow<DetailState> =
        combine(
            c.db.catalog().work(workId),
            c.db.catalog().editionsOf(workId),
            c.db.catalog().copiesOfWork(workId),
            c.db.catalog().locations(),
            c.db.catalog().readingsOfWork(workId),
        ) { w, e, cp, l, r -> DetailState(w, e, cp, l.associateBy { it.id }, r) }
            .combine(c.db.catalog().quotesOfWork(workId)) { st, q -> st.copy(quotes = q) }
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

    fun retire(copy: CopyEntity, reason: String) = viewModelScope.launch { c.writes.retireCopy(copy, reason) }

    fun restore(copy: CopyEntity) = viewModelScope.launch { c.writes.restoreCopy(copy) }

    fun reading(action: ReadingAction) =
        viewModelScope.launch {
            when (action) {
                is ReadingAction.Start -> c.writes.startReading(action.copyId, action.status)
                is ReadingAction.Edit -> c.writes.editReading(action.reading, JsonObject(action.fields.mapValues { (_, v) -> toJson(v) }))
            }
        }

    fun quote(action: QuoteAction) =
        viewModelScope.launch {
            when (action) {
                is QuoteAction.Add -> action.draft.let { c.writes.addQuote(workId, it.text, it.page, it.note, it.copyId) }
                is QuoteAction.Delete -> c.writes.deleteQuote(action.quote)
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

private sealed interface Dialog {
    data class Edit(val copy: CopyEntity) : Dialog
    data class Retire(val copy: CopyEntity) : Dialog
    data class Add(val editionId: String) : Dialog
}

@Composable
fun DetailScreen(vm: DetailViewModel, onEdit: (workId: String, editionId: String) -> Unit, onCover: (assetId: String, title: String) -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val work = s.work ?: return
    val active = s.copies.filter { it.status == "active" }
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    val locations = s.locations.values.toList()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            val coverId = s.editions.firstNotNullOfOrNull { it.coverAssetId }?.takeIf { vm.covers.has(it) }
            // Tapping the cover opens it full screen, zoomable.
            Cover(
                vm.covers,
                coverId,
                work.title,
                128.dp,
                if (coverId != null) Modifier.clickable { onCover(coverId, work.title) } else Modifier,
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
                Text(work.title, style = MaterialTheme.typography.headlineSmall)
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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                work.subjects.take(4).forEach { AssistChip(onClick = {}, label = { Text(it) }) }
            }
        }
        ReadingCard(s.readings, s.copies, vm::reading)
        QuotesCard(s.quotes, s.copies, vm::quote)
        work.description?.let {
            Text(stringResource(R.string.book_synopsis), style = MaterialTheme.typography.titleSmall)
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
            RetireDialog(d.copy.code, onDismiss = { dialog = null }, onRetire = { vm.retire(d.copy, it); dialog = null })
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
            Text(stringResource(R.string.drawer_edition), style = MaterialTheme.typography.labelMedium)
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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onEditBook) { Text(stringResource(R.string.drawer_editBook)) }
                OutlinedButton(onClick = onAddCopy) { Text(stringResource(R.string.drawer_addCopy)) }
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
    Column(Modifier.padding(vertical = 4.dp)) {
        Text(
            c.code.ifEmpty { stringResource(R.string.copy_pendingCode) } + " · " +
                (pathOf(locations, c.locationId).joinToString(" › ").ifEmpty { stringResource(R.string.copy_noLocation) }),
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
        Row {
            if (retired) {
                TextButton(onClick = { onRestore(c) }) { Text(stringResource(R.string.drawer_restore)) }
            } else {
                TextButton(onClick = { onEdit(c) }) { Text(stringResource(R.string.drawer_moveEdit)) }
                TextButton(onClick = { onRetire(c) }) { Text(stringResource(R.string.drawer_retire)) }
            }
        }
    }
}
