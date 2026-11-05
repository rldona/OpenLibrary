package io.github.rldona.openlibrary.ui.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.FilterChip
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.data.LibraryRow
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.sync.SyncStatus
import io.github.rldona.openlibrary.sync.pathOf
import io.github.rldona.openlibrary.ui.components.Cover
import io.github.rldona.openlibrary.ui.components.SyncBar
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class LibraryItem(val row: LibraryRow, val place: List<String>)

data class LibraryState(
    val items: List<LibraryItem> = emptyList(),
    val loaded: Boolean = false,
    val location: LocationEntity? = null,
    /** Books saved without data (scanned offline or unknown to the providers). */
    val provisional: Int = 0,
    val onlyProvisional: Boolean = false,
)

/** Library list over the local copy: works with the server off. */
@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
class LibraryViewModel(private val c: AppContainer, locationId: String?) : ViewModel() {
    val query = MutableStateFlow("")
    private val locationFilter = MutableStateFlow(locationId)
    val onlyProvisional = MutableStateFlow(false)
    private val locations = c.db.catalog().locations()

    val state: StateFlow<LibraryState> =
        combine(query.debounce(150), locationFilter, locations, onlyProvisional) { q, loc, all, prov -> Filter(q, loc, all, prov) }
            .flatMapLatest { (q, loc, all, prov) ->
                val byId = all.associateBy { it.id }
                val ids = loc?.let { subtree(all, it) } ?: emptyList()
                combine(c.db.catalog().library(ftsQuery(q), loc == null, ids), c.db.catalog().placements()) { rows, places ->
                    val firstPlace = places.groupBy({ it.editionId }, { it.locationId })
                    LibraryState(
                        provisional = rows.count { it.metadataStatus == "provisional" },
                        onlyProvisional = prov,
                        items = rows.filter { !prov || it.metadataStatus == "provisional" }.map { r ->
                            val inFilter = firstPlace[r.editionId].orEmpty().firstOrNull { loc == null || it in ids }
                            LibraryItem(r, pathOf(byId, inFilter))
                        },
                        loaded = true,
                        location = loc?.let(byId::get),
                    )
                }
            }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryState())

    val status = c.sync.status
    val covers = c.covers
    val pending = c.db.outbox().pendingCount()
    val problems = c.db.outbox().problemCount()
    val syncState = c.db.sync().stateFlow()

    fun clearLocation() {
        locationFilter.value = null
    }

    fun refresh() {
        viewModelScope.launch { c.sync.sync() }
    }
}

private data class Filter(val q: String, val loc: String?, val all: List<LocationEntity>, val prov: Boolean)

/** A location and everything inside it. */
fun subtree(all: List<LocationEntity>, root: String): List<String> {
    val children = all.groupBy { it.parentId }
    val out = mutableListOf<String>()
    val stack = ArrayDeque(listOf(root))
    while (stack.isNotEmpty()) {
        val cur = stack.removeLast()
        out += cur
        children[cur]?.forEach { stack.addLast(it.id) }
    }
    return out
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    vm: LibraryViewModel,
    now: Long,
    onOpen: (workId: String) -> Unit,
    onAdd: () -> Unit,
    onBulk: () -> Unit,
    onReview: () -> Unit,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val q by vm.query.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val sync by vm.syncState.collectAsStateWithLifecycle(null)
    val pending by vm.pending.collectAsStateWithLifecycle(0)
    val problems by vm.problems.collectAsStateWithLifecycle(0)
    val covers = vm.covers

    Box(Modifier.fillMaxSize()) {

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = q,
            onValueChange = { vm.query.value = it },
            placeholder = { Text(stringResource(R.string.search_placeholder), maxLines = 1, overflow = TextOverflow.Ellipsis) },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            trailingIcon = {
                if (q.isNotEmpty()) {
                    IconButton(onClick = { vm.query.value = "" }) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
                    }
                }
            },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).testTag("search"),
        )
        state.location?.let { loc ->
            InputChip(
                selected = true,
                onClick = vm::clearLocation,
                label = { Text(loc.name) },
                trailingIcon = { Icon(Icons.Default.Close, contentDescription = stringResource(R.string.library_clearFilters)) },
                modifier = Modifier.padding(horizontal = 12.dp),
            )
        }
        if (state.provisional > 0 || state.onlyProvisional) {
            FilterChip(
                selected = state.onlyProvisional,
                onClick = { vm.onlyProvisional.value = !state.onlyProvisional },
                label = { Text(plural(R.string.library_toComplete_one, R.string.library_toComplete_other, state.provisional)) },
                leadingIcon = { Icon(Icons.Default.EditNote, contentDescription = null) },
                modifier = Modifier.padding(horizontal = 12.dp),
            )
        }
        SyncBar(status, sync?.lastSyncAt, now, pending = pending, problems = problems, onReview = onReview)
        PullToRefreshBox(isRefreshing = status is SyncStatus.Running, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
            when {
                !state.loaded -> Unit
                state.items.isEmpty() && (q.isNotEmpty() || state.location != null) ->
                    Empty(stringResource(R.string.library_noMatchesTitle), stringResource(R.string.library_noMatchesText))
                state.items.isEmpty() ->
                    Empty(stringResource(R.string.library_emptyTitle), stringResource(R.string.library_emptyText))
                else ->
                    LazyColumn(Modifier.fillMaxSize().testTag("library")) {
                        item {
                            Text(
                                plural(R.string.library_editionsFound_one, R.string.library_editionsFound_other, state.items.size),
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                        items(state.items, key = { it.row.editionId }) { item ->
                            Row(
                                Modifier.fillMaxWidth().clickable { onOpen(item.row.workId) }.padding(horizontal = 16.dp, vertical = 10.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Cover(covers, item.row.coverAssetId, item.row.title, 48.dp)
                                Column(Modifier.weight(1f)) {
                                    Text(item.row.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        item.row.authors.joinToString(", ").ifEmpty { stringResource(R.string.book_unknownAuthor) },
                                        style = MaterialTheme.typography.bodySmall,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        listOfNotNull(item.row.publisher, item.row.publishedYear?.toString()).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Text(
                                        item.place.joinToString(" › ").ifEmpty { stringResource(R.string.copy_noLocation) } +
                                            if (item.row.activeCopies > 1) " · " + plural(R.string.library_copies_one, R.string.library_copies_other, item.row.activeCopies) else "",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                            HorizontalDivider()
                        }
                    }
            }
        }
    }
    Column(
        Modifier.align(Alignment.BottomEnd).padding(16.dp),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SmallFloatingActionButton(onClick = onBulk, modifier = Modifier.testTag("bulk")) {
            Icon(Icons.Default.QrCodeScanner, contentDescription = stringResource(R.string.bulk_title))
        }
        ExtendedFloatingActionButton(
            onClick = onAdd,
            icon = { Icon(Icons.Default.Add, contentDescription = null) },
            text = { Text(stringResource(R.string.book_add)) },
            modifier = Modifier.testTag("add"),
        )
    }
    }
}

@Composable
private fun Empty(title: String, text: String) {
    LazyColumn(Modifier.fillMaxSize().padding(32.dp)) {
        item {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        }
    }
}
