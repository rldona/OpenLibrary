package io.github.rldona.openlibrary.ui.locations

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
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
import io.github.rldona.openlibrary.core.locationKindLabel
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.data.LocationEntity
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.ui.components.Picker
import io.github.rldona.openlibrary.ui.components.LocationPicker

data class LocationNode(val location: LocationEntity, val depth: Int, val total: Int)

/** Depth-first tree with cumulative copy counts (a bookcase counts the copies on all its shelves). */
fun flattenTree(all: List<LocationEntity>, directCounts: Map<String?, Int>): List<LocationNode> {
    val children = all.groupBy { it.parentId }.mapValues { (_, v) -> v.sortedWith(compareBy({ it.sortOrder }, { it.name })) }
    fun total(id: String): Int = (directCounts[id] ?: 0) + children[id].orEmpty().sumOf { total(it.id) }
    val out = mutableListOf<LocationNode>()
    fun walk(parent: String?, depth: Int) {
        for (l in children[parent].orEmpty()) {
            out += LocationNode(l, depth, total(l.id))
            if (depth < 50) walk(l.id, depth + 1)
        }
    }
    walk(null, 0)
    return out
}

class LocationsViewModel(private val c: AppContainer) : ViewModel() {
    val all = c.db.catalog().locations()

    fun create(parentId: String?, name: String, kind: String) =
        viewModelScope.launch { c.writes.createLocation(parentId, name, kind) }

    val tree: StateFlow<List<LocationNode>?> =
        combine(c.db.catalog().locations(), c.db.catalog().placements()) { locs, places ->
            flattenTree(locs, places.groupingBy { it.locationId }.eachCount())
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

@Composable
fun LocationsScreen(vm: LocationsViewModel, onOpen: (locationId: String) -> Unit) {
    var adding by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        LocationTree(vm, onOpen)
        ExtendedFloatingActionButton(
            onClick = { adding = true },
            icon = { Icon(Icons.Default.Add, contentDescription = null) },
            text = { Text(stringResource(R.string.locations_add)) },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        )
    }
    if (adding) NewLocationDialog(vm, onDismiss = { adding = false })
}

/** Simple creation from the phone; reorganising the tree stays on the web (design §6). */
@Composable
private fun NewLocationDialog(vm: LocationsViewModel, onDismiss: () -> Unit) {
    val all by vm.all.collectAsState(emptyList())
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("shelf") }
    var parent by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.locations_newTitle)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(80) },
                    label = { Text(stringResource(R.string.locations_name)) },
                    placeholder = { Text(stringResource(R.string.locations_namePlaceholder)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Picker(
                    stringResource(R.string.locations_kind),
                    kind,
                    listOf("home", "room", "bookcase", "shelf", "box", "other").map { it to stringResource(locationKindLabel(it)) },
                    { kind = it },
                    Modifier.fillMaxWidth(),
                )
                LocationPicker(all, parent, { parent = it }, Modifier.fillMaxWidth())
                Text(stringResource(R.string.locations_inside) + ": " + if (parent == null) stringResource(R.string.locations_noParent) else "", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(onClick = { vm.create(parent, name, kind); onDismiss() }, enabled = name.isNotBlank()) {
                Text(str(R.string.common_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}

@Composable
private fun LocationTree(vm: LocationsViewModel, onOpen: (locationId: String) -> Unit) {
    val tree by vm.tree.collectAsStateWithLifecycle()
    val nodes = tree ?: return
    if (nodes.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(32.dp)) {
            Text(stringResource(R.string.locations_emptyTitle), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.locations_emptyText), modifier = Modifier.padding(top = 8.dp))
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Text(stringResource(R.string.locations_subtitle), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp))
        }
        items(nodes, key = { it.location.id }) { n ->
            Row(
                Modifier.fillMaxWidth().clickable { onOpen(n.location.id) }
                    .padding(start = (16 + 20 * n.depth).dp, end = 16.dp, top = 12.dp, bottom = 12.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(n.location.name, style = MaterialTheme.typography.bodyLarge)
                    Text(stringResource(locationKindLabel(n.location.kind)), style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(plural(R.string.library_copies_one, R.string.library_copies_other, n.total), style = MaterialTheme.typography.labelMedium)
            }
            HorizontalDivider()
        }
    }
}
