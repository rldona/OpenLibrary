package io.github.rldona.openlibrary.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import io.github.rldona.openlibrary.data.WorkEntity
import io.github.rldona.openlibrary.sync.pathOf
import io.github.rldona.openlibrary.ui.components.Cover
import java.util.Locale
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class DetailState(
    val work: WorkEntity? = null,
    val editions: List<EditionEntity> = emptyList(),
    val copies: List<CopyEntity> = emptyList(),
    val locations: Map<String, LocationEntity> = emptyMap(),
)

class DetailViewModel(c: AppContainer, workId: String) : ViewModel() {
    val covers = c.covers
    val state: StateFlow<DetailState> =
        combine(
            c.db.catalog().work(workId),
            c.db.catalog().editionsOf(workId),
            c.db.catalog().copiesOfWork(workId),
            c.db.catalog().locations(),
        ) { w, e, cp, l -> DetailState(w, e, cp, l.associateBy { it.id }) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DetailState())
}

@Composable
fun DetailScreen(vm: DetailViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val work = s.work ?: return
    val active = s.copies.filter { it.status == "active" }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Cover(vm.covers, s.editions.firstNotNullOfOrNull { it.coverAssetId }, work.title, 110.dp)
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
                work.subtitle?.let { Text(it, style = MaterialTheme.typography.titleSmall) }
                Text(work.authors.joinToString(", ").ifEmpty { stringResource(R.string.book_unknownAuthor) })
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
        work.description?.let {
            Text(stringResource(R.string.book_synopsis), style = MaterialTheme.typography.titleSmall)
            Text(it, style = MaterialTheme.typography.bodyMedium)
        }
        s.editions.forEach { e -> EditionCard(e, s.copies.filter { it.editionId == e.id }, s.locations) }
    }
}

@Composable
private fun EditionCard(e: EditionEntity, copies: List<CopyEntity>, locations: Map<String, LocationEntity>) {
    Card(Modifier.fillMaxWidth()) {
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
                Text(stringResource(R.string.book_provisional), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
            }
            Text(stringResource(R.string.drawer_copiesOfEdition), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
            copies.sortedBy { it.status != "active" }.forEach { c -> CopyLine(c, locations) }
        }
    }
}

@Composable
private fun CopyLine(c: CopyEntity, locations: Map<String, LocationEntity>) {
    val retired = c.status != "active"
    Column(Modifier.padding(vertical = 4.dp)) {
        Text(
            c.code + " · " + (pathOf(locations, c.locationId).joinToString(" › ").ifEmpty { stringResource(R.string.copy_noLocation) }),
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
}
