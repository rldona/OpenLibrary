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
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.core.subjectLabel
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.material3.Surface
import androidx.compose.material3.Icon
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.clickable

/** Recomputed on the local copy after every sync or local change: works with the server off. */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class StatsViewModel(c: AppContainer) : ViewModel() {
    val stats =
        combine(c.db.sync().stateFlow(), c.db.outbox().pendingCount()) { s, n -> s to n }
            .mapLatest { computeStats(c.db) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Books to fix: without a place, an author or a language (each row links to its list). */
    val fix =
        combine(c.db.catalog().library(ftsQuery(""), true, emptyList()), c.db.catalog().unplacedCopies()) { rows, unplaced ->
            Fix(
                unplaced = unplaced.distinctBy { it.editionId }.size,
                author = rows.count { it.authors.isEmpty() },
                language = rows.count { it.language.isNullOrBlank() },
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Fix(0, 0, 0))
}

data class Fix(val unplaced: Int, val author: Int, val language: Int)

@Composable
fun StatsScreen(vm: StatsViewModel, onFix: (what: String) -> Unit = {}) {
    val s by vm.stats.collectAsStateWithLifecycle()
    val fix by vm.fix.collectAsStateWithLifecycle()
    TabScaffold(stringResource(R.string.nav_stats)) { inner ->
        val stats = s
        if (stats == null) {
            LoadingState(Modifier.padding(inner))
            return@TabScaffold
        }
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).readableWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Figures(stats, fix, onFix)
        }
    }
}

@Composable
private fun Figures(s: Stats, fix: Fix, onFix: (String) -> Unit) {
    val c = s.collection
    val r = s.reading
    // How many books, and since when.
    Card {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(c.editions.toString(), style = MaterialTheme.typography.displaySmall.copy(fontSize = MaterialTheme.typography.displaySmall.fontSize * 1.4f))
            Text(
                plural(R.string.stats_booksWord_one, R.string.stats_booksWord_other, c.editions).substringAfter(' ').ifEmpty { plural(R.string.stats_booksWord_one, R.string.stats_booksWord_other, c.editions) },
                Modifier.padding(start = 12.dp, bottom = 8.dp).weight(1f),
                style = MaterialTheme.typography.titleLarge.copy(fontFamily = MaterialTheme.typography.bodyLarge.fontFamily, fontWeight = FontWeight.Normal),
            )
            val years = s.acquiredByYear.map { it.year }
            if (years.isNotEmpty()) {
                Text(
                    if (years.distinct().size == 1) str(R.string.stats_allAddedIn, "year" to years.first()) else str(R.string.stats_addedSince, "year" to years.min()),
                    Modifier.padding(bottom = 10.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        // Works, editions and copies only when they tell something (they differ).
        if (c.works != c.editions || c.editions != c.copies) {
            Text(
                listOf(
                    plural(R.string.stats_works_one, R.string.stats_works_other, c.works),
                    plural(R.string.library_editions_one, R.string.library_editions_other, c.editions),
                    plural(R.string.library_copies_one, R.string.library_copies_other, c.copies),
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    Card(stringResource(R.string.stats_reading)) {
        Text(
            listOf(
                str(R.string.stats_unreadN, "n" to r.pending),
                str(R.string.stats_readingN, "n" to r.reading),
                plural(R.string.stats_readN_one, R.string.stats_readN_other, r.read),
            ).joinToString(" · "),
            style = MaterialTheme.typography.bodyLarge,
        )
        if (r.averageRating != null) {
            Text(stringResource(R.string.stats_averageRating) + ": " + r.averageRating, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (r.byYear.isEmpty()) {
            Text(stringResource(R.string.stats_readingHint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Bars(stringResource(R.string.stats_readByYear), r.byYear.map { Triple(it.year.toString(), it.works, str(R.string.stats_pages, "n" to it.pages)) })
        }
    }
    val rows = listOfNotNull(
        Triple(fix.unplaced, R.string.stats_fix_unplaced, "unplaced").takeIf { fix.unplaced > 0 },
        Triple(fix.author, R.string.stats_fix_author, "author").takeIf { fix.author > 0 },
        Triple(fix.language, R.string.stats_fix_language, "language").takeIf { fix.language > 0 },
    )
    if (rows.isNotEmpty()) {
        Card(stringResource(R.string.stats_toFix)) {
            rows.forEachIndexed { i, (n, label, what) ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button) { onFix(what) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(n.toString(), Modifier.width(40.dp), style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize), color = MaterialTheme.colorScheme.primary)
                    Text(stringResource(label), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    if (s.authors.isNotEmpty()) Card { Bars(stringResource(R.string.stats_authors), counts(s.authors), top = 5) }
    if (s.subjects.isNotEmpty()) {
        Card { Bars(stringResource(R.string.stats_subjects), counts(subjectCounts(s.subjects)), top = 5) }
    }
    // The rest of the figures, as before, below what the redesign puts first.
    val unknown = stringResource(R.string.stats_unknownLanguage)
    if (s.languages.isNotEmpty()) {
        Card { Bars(stringResource(R.string.stats_languages), counts(s.languages) { k -> if (k.isEmpty()) unknown else languageName(k) }, top = 5) }
    }
    if (s.acquiredByYear.size > 1) {
        Card {
            Bars(
                stringResource(R.string.stats_acquiredByYear),
                s.acquiredByYear.map { Triple(it.year.toString(), it.copies, null) },
                note = if (c.retiredCopies > 0) plural(R.string.stats_acquiredIncludesRetired_one, R.string.stats_acquiredIncludesRetired_other, c.retiredCopies) else null,
            )
        }
    }
    val extra = listOfNotNull(
        plural(R.string.stats_locations_one, R.string.stats_locations_other, c.locations),
        plural(R.string.stats_wishlistOpen_one, R.string.stats_wishlistOpen_other, s.wishlistOpen),
        str(R.string.stats_sessions, "finished" to r.finishedSessions, "abandoned" to r.abandonedSessions).takeIf { r.finishedSessions + r.abandonedSessions > 0 },
        c.value.takeIf { it.isNotEmpty() }?.let { v -> stringResource(R.string.stats_value) + ": " + v.joinToString(" + ") { money(it.cents, it.currency) } },
    )
    Text(extra.joinToString(" · "), Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Genres in Spanish, adding up the ones that end up with the same name ("Philosophy" and "Filosofía"). */
private fun subjectCounts(list: List<CountBy>): List<CountBy> =
    list.groupBy { subjectLabel(it.key) }.map { (k, v) -> CountBy(k, v.sumOf { it.count }) }.sortedByDescending { it.count }

private fun counts(list: List<CountBy>, label: (String) -> String = { it }) = list.map { Triple(label(it.key), it.count, null as String?) }

private fun money(cents: Long, currency: String): String =
    NumberFormat.getCurrencyInstance().apply { runCatching { this.currency = Currency.getInstance(currency) } }.format(cents / 100.0)

/** A rounded card with an optional title, like the redesign's cards. */
@Composable
private fun Card(title: String? = null, content: @Composable () -> Unit) {
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            title?.let {
                Text(it, style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize), modifier = Modifier.semantics { heading() })
            }
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
private fun Bars(title: String, rows: List<Triple<String, Int, String?>>, note: String? = null, top: Int = TOP) {
    var all by rememberSaveable(title) { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            title,
            Modifier.weight(1f).semantics { heading() },
            style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize),
        )
        // "See all 7": only for lists clearly longer than what is shown.
        if (rows.size > top + 1) {
            TextButton(onClick = { all = !all }) {
                Text(if (all) stringResource(R.string.stats_showLess) else str(R.string.stats_seeAll, "n" to rows.size))
            }
        }
    }
    if (rows.isEmpty()) Text(stringResource(R.string.stats_none), style = MaterialTheme.typography.bodySmall)
    val max = (rows.maxOfOrNull { it.second } ?: 1).coerceAtLeast(1)
    val cut = rows.size > top + 1 && !all
    (if (cut) rows.take(top) else rows).forEach { (label, value, note) ->
        val description = "$label: $value" + (note?.let { ", $it" } ?: "")
        // The bar is a picture: TalkBack reads the row as its label and value instead.
        Row(
            Modifier.clearAndSetSemantics { contentDescription = description },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(label, Modifier.width(150.dp), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Box(Modifier.weight(1f).height(12.dp)) {
                Box(Modifier.fillMaxWidth(value.toFloat() / max).fillMaxHeight().clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.primary))
            }
            Text(value.toString() + (note?.let { " · $it" } ?: ""), style = MaterialTheme.typography.bodyLarge)
        }
    }
    note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
}
