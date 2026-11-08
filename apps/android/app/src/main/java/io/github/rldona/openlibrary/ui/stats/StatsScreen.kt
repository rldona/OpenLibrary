package io.github.rldona.openlibrary.ui.stats

import io.github.rldona.openlibrary.ui.components.readableWidth
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.OutlinedCard
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.languageName
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.CountBy
import io.github.rldona.openlibrary.data.Stats
import io.github.rldona.openlibrary.data.computeStats
import io.github.rldona.openlibrary.ui.components.LoadingState
import io.github.rldona.openlibrary.ui.components.TabScaffold
import java.text.NumberFormat
import java.util.Currency
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn

/** Recomputed on the local copy after every sync or local change: works with the server off. */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class StatsViewModel(c: AppContainer) : ViewModel() {
    val stats =
        combine(c.db.sync().stateFlow(), c.db.outbox().pendingCount()) { s, n -> s to n }
            .mapLatest { computeStats(c.db) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

@Composable
fun StatsScreen(vm: StatsViewModel) {
    val s by vm.stats.collectAsStateWithLifecycle()
    TabScaffold(stringResource(R.string.nav_stats)) { inner ->
        val stats = s
        if (stats == null) {
            LoadingState(Modifier.padding(inner))
            return@TabScaffold
        }
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).readableWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Figures(stats)
        }
    }
}

@Composable
private fun Figures(s: Stats) {
    val c = s.collection
    val r = s.reading
    Section(stringResource(R.string.stats_collection)) {
        Tiles(c.works to stringResource(R.string.stats_works), c.editions to stringResource(R.string.stats_editions), c.copies to stringResource(R.string.stats_copies), c.retiredCopies to stringResource(R.string.stats_retired))
        Text(
            listOf(
                plural(R.string.stats_withoutLocation_one, R.string.stats_withoutLocation_other, c.copiesWithoutLocation),
                plural(R.string.stats_provisional_one, R.string.stats_provisional_other, c.provisionalEditions),
                plural(R.string.stats_locations_one, R.string.stats_locations_other, c.locations),
                plural(R.string.stats_wishlistOpen_one, R.string.stats_wishlistOpen_other, s.wishlistOpen),
            ).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
        )
        if (c.value.isNotEmpty()) {
            Text(stringResource(R.string.stats_value) + ": " + c.value.joinToString(" + ") { money(it.cents, it.currency) })
        }
        // How works and copies are counted, next to the figures it explains.
        Text(stringResource(R.string.stats_subtitle), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Section(stringResource(R.string.stats_reading)) {
        Tiles(
            r.read to stringResource(R.string.reading_status_read),
            r.reading to stringResource(R.string.reading_status_reading),
            r.pending to stringResource(R.string.reading_status_pending),
            // No ratings yet: the tile says so instead of leaving a dash to interpret.
            (r.averageRating ?: "—") to stringResource(if (r.averageRating == null) R.string.stats_noRating else R.string.stats_averageRating),
        )
        Text(str(R.string.stats_sessions, "finished" to r.finishedSessions, "abandoned" to r.abandonedSessions), style = MaterialTheme.typography.bodySmall)
        Bars(stringResource(R.string.stats_readByYear), r.byYear.map { Triple(it.year.toString(), it.works, str(R.string.stats_pages, "n" to it.pages)) })
    }
    Section(null) {
        Bars(
            stringResource(R.string.stats_acquiredByYear),
            s.acquiredByYear.map { Triple(it.year.toString(), it.copies, null) },
            // Acquired counts retired copies too, which the collection figures leave out.
            note = if (c.retiredCopies > 0) plural(R.string.stats_acquiredIncludesRetired_one, R.string.stats_acquiredIncludesRetired_other, c.retiredCopies) else null,
        )
    }
    Section(null) { Bars(stringResource(R.string.stats_authors), counts(s.authors)) }
    Section(null) { Bars(stringResource(R.string.stats_subjects), counts(s.subjects)) }
    val unknown = stringResource(R.string.stats_unknownLanguage)
    Section(null) {
        Bars(stringResource(R.string.stats_languages), counts(s.languages) { k -> if (k.isEmpty()) unknown else languageName(k) })
    }
}

private fun counts(list: List<CountBy>, label: (String) -> String = { it }) = list.map { Triple(label(it.key), it.count, null as String?) }

private fun money(cents: Long, currency: String): String =
    NumberFormat.getCurrencyInstance().apply { runCatching { this.currency = Currency.getInstance(currency) } }.format(cents / 100.0)

@Composable
private fun Section(title: String?, content: @Composable () -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            title?.let { Text(it, style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() }) }
            content()
        }
    }
}

@Composable
private fun Tiles(vararg tiles: Pair<Any, String>) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        tiles.forEach { (n, label) ->
            // A figure and its label, read together ("12, Works").
            ElevatedCard(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
                Column(Modifier.padding(8.dp)) {
                    Text(n.toString(), style = MaterialTheme.typography.titleLarge)
                    Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                }
            }
        }
    }
}

/** Long lists (authors, languages) show this many rows until "Show all". */
private const val TOP = 6

/** Horizontal bars relative to the largest value; a [note] under them explains the figures when needed. */
@Composable
private fun Bars(title: String, rows: List<Triple<String, Int, String?>>, note: String? = null) {
    Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
    if (rows.isEmpty()) Text(stringResource(R.string.stats_none), style = MaterialTheme.typography.bodySmall)
    val max = (rows.maxOfOrNull { it.second } ?: 1).coerceAtLeast(1)
    var all by rememberSaveable(title) { mutableStateOf(false) }
    // Cutting one row to show a "Show all" button would be silly: only lists clearly longer are cut.
    val cut = rows.size > TOP + 1 && !all
    (if (cut) rows.take(TOP) else rows).forEach { (label, value, note) ->
        val description = "$label: $value" + (note?.let { ", $it" } ?: "")
        // The bar is a picture: TalkBack reads the row as its label and value instead.
        Row(
            Modifier.clearAndSetSemantics { contentDescription = description },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(label, Modifier.width(140.dp), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Box(Modifier.weight(1f).height(10.dp)) {
                Box(Modifier.fillMaxWidth(value.toFloat() / max).fillMaxHeight().clip(RoundedCornerShape(5.dp)).background(MaterialTheme.colorScheme.primary))
            }
            Text(value.toString() + (note?.let { " · $it" } ?: ""), style = MaterialTheme.typography.bodySmall)
        }
    }
    if (rows.size > TOP + 1) {
        TextButton(onClick = { all = !all }) {
            Text(if (all) stringResource(R.string.stats_showLess) else str(R.string.stats_showAll, "n" to rows.size))
        }
    }
    note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
}
