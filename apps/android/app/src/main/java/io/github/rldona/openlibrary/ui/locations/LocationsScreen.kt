package io.github.rldona.openlibrary.ui.locations

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
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable
import io.github.rldona.openlibrary.core.str
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.ui.components.Spacing
import io.github.rldona.openlibrary.ui.components.pageListItemColors
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import io.github.rldona.openlibrary.ui.components.EmptyState
import io.github.rldona.openlibrary.ui.components.LoadingState
import io.github.rldona.openlibrary.ui.components.Picker
import io.github.rldona.openlibrary.ui.components.TabScaffold
import io.github.rldona.openlibrary.ui.components.rememberFabVisibility
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.input.nestedscroll.nestedScroll
import io.github.rldona.openlibrary.ui.components.LocationPicker

data class LocationNode(val location: LocationEntity, val depth: Int, val total: Int, val children: Int = 0)

/** Depth-first tree with cumulative copy counts (a bookcase counts the copies on all its shelves). */
fun flattenTree(all: List<LocationEntity>, directCounts: Map<String?, Int>): List<LocationNode> {
    val children = all.groupBy { it.parentId }.mapValues { (_, v) -> v.sortedWith(compareBy({ it.sortOrder }, { it.name })) }
    fun total(id: String): Int = (directCounts[id] ?: 0) + children[id].orEmpty().sumOf { total(it.id) }
    val out = mutableListOf<LocationNode>()
    fun walk(parent: String?, depth: Int) {
        for (l in children[parent].orEmpty()) {
            out += LocationNode(l, depth, total(l.id), children[l.id].orEmpty().size)
            if (depth < 50) walk(l.id, depth + 1)
        }
    }
    walk(null, 0)
    return out
}

/** The tree without what lies under a collapsed location (its descendants stay in [nodes], just hidden). */
fun visibleNodes(nodes: List<LocationNode>, collapsed: Set<String>): List<LocationNode> {
    val out = mutableListOf<LocationNode>()
    var hiddenBelow = -1 // depth of the nearest collapsed ancestor, -1 when none
    for (n in nodes) {
        if (hiddenBelow >= 0 && n.depth > hiddenBelow) continue
        hiddenBelow = if (n.location.id in collapsed) n.depth else -1
        out += n
    }
    return out
}

/** The sheet is open, to create a location at the top level or inside [parentId]. */
private data class AddSheet(val parentId: String?)

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
    var adding by remember { mutableStateOf<AddSheet?>(null) }
    val fab = rememberFabVisibility()
    TabScaffold(
        stringResource(R.string.nav_locations),
        Modifier.nestedScroll(fab.connection),
        fab = {
            ExtendedFloatingActionButton(
                onClick = { adding = AddSheet(null) },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.locations_add)) },
                expanded = fab.visible,
            )
        },
    ) { inner ->
        Box(Modifier.fillMaxSize().padding(inner)) { LocationTree(vm, onOpen, onAdd = { adding = AddSheet(null) }, onAddInside = { adding = AddSheet(it) }) }
    }
    adding?.let { NewLocationSheet(vm, it.parentId, onDismiss = { adding = null }) }
}

/**
 * Simple creation from the phone; reorganising the tree stays on the web (design §6). A bottom sheet: it has
 * two drop-downs and the keyboard, which an alert dialog squeezes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewLocationSheet(vm: LocationsViewModel, parentId: String?, onDismiss: () -> Unit) {
    val all by vm.all.collectAsState(emptyList())
    var name by remember { mutableStateOf("") }
    var parent by remember { mutableStateOf(parentId) }
    // The kind follows the parent (a shelf inside a bookcase) until the user picks one.
    var kind by remember { mutableStateOf(nextLocationKind(null)) }
    var kindChosen by remember { mutableStateOf(false) }
    LaunchedEffect(all) { if (!kindChosen) kind = nextLocationKind(all.firstOrNull { it.id == parent }?.kind) }
    val sheet = rememberBottomSheetState(SheetValue.Hidden, enabledValues = setOf(SheetValue.Hidden, SheetValue.Expanded))
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.page).padding(bottom = Spacing.page),
            verticalArrangement = Arrangement.spacedBy(Spacing.item),
        ) {
            Text(stringResource(R.string.locations_newTitle), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
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
                { kind = it; kindChosen = true },
                Modifier.fillMaxWidth(),
            )
            LocationPicker(
                all,
                parent,
                { id ->
                    parent = id
                    if (!kindChosen) kind = nextLocationKind(all.firstOrNull { it.id == id }?.kind)
                },
                Modifier.fillMaxWidth(),
                label = stringResource(R.string.locations_inside),
                noneLabel = stringResource(R.string.locations_none),
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) }
                Button(onClick = { vm.create(parent, name, kind); onDismiss() }, enabled = name.isNotBlank()) {
                    Text(stringResource(R.string.common_save))
                }
            }
        }
    }
}

/** The kind a new location most likely has: one level below its parent (home › room › bookcase › shelf › box). */
fun nextLocationKind(parentKind: String?): String =
    when (parentKind) {
        null, "home" -> "room"
        "room" -> "bookcase"
        "bookcase" -> "shelf"
        "shelf" -> "box"
        else -> "other"
    }

@Composable
private fun LocationTree(vm: LocationsViewModel, onOpen: (locationId: String) -> Unit, onAdd: () -> Unit, onAddInside: (parentId: String) -> Unit) {
    val tree by vm.tree.collectAsStateWithLifecycle()
    val nodes = tree
    if (nodes == null) {
        LoadingState()
        return
    }
    if (nodes.isEmpty()) {
        EmptyState(
            Icons.Default.Place,
            stringResource(R.string.locations_emptyTitle),
            text = stringResource(R.string.locations_subtitle) + " " + stringResource(R.string.locations_emptyText),
            action = stringResource(R.string.locations_add) to onAdd,
        )
        return
    }
    val level = stringResource(R.string.locations_level)
    // Folded branches, kept while the tab is away and across rotation.
    var collapsed by rememberSaveable { mutableStateOf(ArrayList<String>()) }
    val shown = visibleNodes(nodes, collapsed.toSet())
    // Bottom room so the floating button never covers the last location.
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Spacing.fab)) {
        items(shown, key = { it.location.id }) { n ->
            val id = n.location.id
            val folded = id in collapsed
            // Indented by depth; TalkBack hears the depth too ("Level 2"), since it cannot see the indent.
            ListItem(
                onClick = { onOpen(id) },
                modifier = Modifier.semantics { stateDescription = format(level, "n" to n.depth + 1) },
                // The chevron's room is kept on leaves too, so siblings line up.
                leadingContent = {
                    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                        if (n.children > 0) {
                            IconButton(onClick = { collapsed = ArrayList(if (folded) collapsed - id else collapsed + id) }) {
                                Icon(
                                    if (folded) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.Default.ExpandMore,
                                    contentDescription = str(if (folded) R.string.locations_expand else R.string.locations_collapse, "name" to n.location.name),
                                )
                            }
                        }
                    }
                },
                supportingContent = { Text(stringResource(locationKindLabel(n.location.kind))) },
                trailingContent = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(plural(R.string.library_copies_one, R.string.library_copies_other, n.total), style = MaterialTheme.typography.labelMedium)
                        IconButton(onClick = { onAddInside(id) }) {
                            Icon(Icons.Default.AddCircleOutline, contentDescription = str(R.string.locations_addInside, "name" to n.location.name))
                        }
                    }
                },
                colors = pageListItemColors(),
                contentPadding = PaddingValues(start = (4 + 20 * n.depth).dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            ) { Text(n.location.name) }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
