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
import androidx.compose.material.icons.filled.Close
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
)

/** Library list over the local copy: works with the server off. */
@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
class LibraryViewModel(private val c: AppContainer, locationId: String?) : ViewModel() {
    val query = MutableStateFlow("")
    private val locationFilter = MutableStateFlow(locationId)
    private val locations = c.db.catalog().locations()

    val state: StateFlow<LibraryState> =
        combine(query.debounce(150), locationFilter, locations) { q, loc, all -> Triple(q, loc, all) }
            .flatMapLatest { (q, loc, all) ->
                val byId = all.associateBy { it.id }
                val ids = loc?.let { subtree(all, it) } ?: emptyList()
                combine(c.db.catalog().library(ftsQuery(q), loc == null, ids), c.db.catalog().placements()) { rows, places ->
                    val firstPlace = places.groupBy({ it.editionId }, { it.locationId })
                    LibraryState(
                        items = rows.map { r ->
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
    val syncState = c.db.sync().stateFlow()

    fun clearLocation() {
        locationFilter.value = null
    }

    fun refresh() {
        viewModelScope.launch { c.sync.sync() }
    }
}

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
fun LibraryScreen(vm: LibraryViewModel, now: Long, onOpen: (workId: String) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val q by vm.query.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val sync by vm.syncState.collectAsStateWithLifecycle(null)
    val covers = vm.covers

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
        SyncBar(status, sync?.lastSyncAt, now)
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
