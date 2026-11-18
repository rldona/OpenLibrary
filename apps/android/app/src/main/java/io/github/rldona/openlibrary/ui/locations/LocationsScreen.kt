package io.github.rldona.openlibrary.ui.locations

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.ui.components.Spacing
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import io.github.rldona.openlibrary.ui.components.DestructiveDialog
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import kotlinx.coroutines.flow.map
import io.github.rldona.openlibrary.core.roomShelves
import io.github.rldona.openlibrary.core.RoomShelves
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.draw.clip
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.animation.AnimatedVisibility

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

/** Why a location cannot be deleted: the same rules as the server (409 `location-not-empty`). */
sealed interface DeleteBlocker {
    data object Children : DeleteBlocker
    data class Copies(val n: Int) : DeleteBlocker
}

/**
 * Null when [n] can be deleted: no sub-locations and no active copies (retired ones do not count, as on the
 * server). Without sub-locations, the cumulative count is the location's own.
 */
fun deleteBlocker(n: LocationNode): DeleteBlocker? =
    when {
        n.children > 0 -> DeleteBlocker.Children
        n.total > 0 -> DeleteBlocker.Copies(n.total)
        else -> null
    }

/** The sheet is open, to create a location at the top level or inside [parentId]. */
private data class AddSheet(val parentId: String?)

class LocationsViewModel(private val c: AppContainer) : ViewModel() {
    val all = c.db.catalog().locations()

    fun create(parentId: String?, name: String, kind: String) =
        viewModelScope.launch { c.writes.createLocation(parentId, name, kind) }

    fun delete(location: LocationEntity) = viewModelScope.launch { c.writes.deleteLocation(location) }

    /** Books with a copy not placed anywhere. */
    val unplaced = c.db.catalog().unplacedCopies().map { copies -> copies.distinctBy { it.editionId }.size }

    val tree: StateFlow<List<LocationNode>?> =
        combine(c.db.catalog().locations(), c.db.catalog().placements()) { locs, places ->
            flattenTree(locs, places.groupingBy { it.locationId }.eachCount())
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

@Composable
fun LocationsScreen(vm: LocationsViewModel, onOpen: (locationId: String) -> Unit, onPlace: () -> Unit = {}) {
    var adding by remember { mutableStateOf<AddSheet?>(null) }
    val all by vm.all.collectAsState(emptyList())
    val fab = rememberFabVisibility()
    // New rooms go inside the home when the places hang from one ("Home › Study").
    val home = all.filter { it.parentId == null && it.kind == "home" }.singleOrNull()?.id
    TabScaffold(
        stringResource(R.string.nav_locations),
        Modifier.nestedScroll(fab.connection),
        fab = {
            ExtendedFloatingActionButton(
                onClick = { adding = AddSheet(home) },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.locations_newRoom)) },
                expanded = fab.visible,
            )
        },
    ) { inner ->
        Box(Modifier.fillMaxSize().padding(inner)) {
            Rooms(vm, onOpen, onPlace, onAdd = { adding = AddSheet(home) }, onAddInside = { adding = AddSheet(it) })
        }
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
private fun Rooms(
    vm: LocationsViewModel,
    onOpen: (locationId: String) -> Unit,
    onPlace: () -> Unit,
    onAdd: () -> Unit,
    onAddInside: (parentId: String) -> Unit,
) {
    val tree by vm.tree.collectAsStateWithLifecycle()
    val all by vm.all.collectAsState(emptyList())
    val unplaced by vm.unplaced.collectAsStateWithLifecycle(0)
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
            action = stringResource(R.string.locations_newRoom) to onAdd,
        )
        return
    }
    val snackbar = LocalSnackbar.current
    val deleteLabel = stringResource(R.string.common_delete)
    val hasChildren = stringResource(R.string.errors_locationHasChildren)
    val hasCopy = stringResource(R.string.errors_locationHasCopies_one)
    val hasCopies = stringResource(R.string.errors_locationHasCopies_other)
    val deletedText = stringResource(R.string.locations_deleted)
    // Asked for with a destructive dialog, as on the web, rather than undone from the snackbar: the location
    // shows in every picker and filter, and the server refuses it once something is in it.
    var deleting by remember { mutableStateOf<LocationEntity?>(null) }
    val byId = remember(nodes) { nodes.associateBy { it.location.id } }
    val askDelete = { id: String ->
        val n = byId[id]
        when (val b = n?.let(::deleteBlocker)) {
            DeleteBlocker.Children -> snackbar.showMessage(hasChildren)
            is DeleteBlocker.Copies -> snackbar.showMessage(format(if (b.n == 1) hasCopy else hasCopies, "n" to b.n))
            null -> deleting = n?.location
        }
    }
    deleting?.let { l ->
        DestructiveDialog(
            title = str(R.string.locations_deleteConfirm, "name" to l.name),
            text = stringResource(R.string.locations_deleteText),
            confirm = deleteLabel,
            onConfirm = {
                deleting = null
                vm.delete(l)
                snackbar.showMessage(deletedText)
            },
            onDismiss = { deleting = null },
        )
    }
    val rooms = remember(all) { roomShelves(all) }
    val count = { id: String -> byId[id]?.total ?: 0 }
    // Open rooms, kept while the tab is away and across rotation; the first one starts open.
    var open by rememberSaveable { mutableStateOf(ArrayList(listOfNotNull(rooms.firstOrNull()?.room?.id))) }
    val total = nodes.filter { it.depth == 0 }.sumOf { it.total }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = Spacing.fab),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                plural(R.string.locations_rooms_one, R.string.locations_rooms_other, rooms.size) + " · " +
                    plural(R.string.locations_totalBooks_one, R.string.locations_totalBooks_other, total),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        if (unplaced > 0) {
            item { UnplacedCard(unplaced, onPlace) }
        }
        items(rooms, key = { it.room.id }) { r ->
            val id = r.room.id
            val expanded = id in open
            RoomCard(
                r,
                expanded = expanded,
                count = count,
                onToggle = { open = ArrayList(if (expanded) open - id else open + id) },
                onOpen = onOpen,
                onAddInside = onAddInside,
                onDelete = askDelete,
            )
        }
    }
}

/** "Not placed · 11 books wait for a shelf · Place". */
@Composable
private fun UnplacedCard(count: Int, onPlace: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.unplaced_title),
                    style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize),
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Text(
                    plural(R.string.locations_waiting_one, R.string.locations_waiting_other, count),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Button(onClick = onPlace, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.library_place)) }
        }
    }
}

/**
 * A room: its name and books, folded or open. Open, each piece of furniture with its shelves as buttons
 * (name and books, or "empty"); a shelf opens its books, a long press shows what can be done with it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RoomCard(
    r: RoomShelves,
    expanded: Boolean,
    count: (String) -> Int,
    onToggle: () -> Unit,
    onOpen: (String) -> Unit,
    onAddInside: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    val name = r.room.name
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(onClickLabel = str(if (expanded) R.string.locations_collapse else R.string.locations_expand, "name" to name), onClick = onToggle)
                    .padding(start = 20.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(name, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize))
                Text(
                    plural(R.string.library_books_one, R.string.library_books_other, count(r.room.id)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (expanded) {
                    PlaceMenu(name, onAdd = { onAddInside(r.room.id) }, addLabel = R.string.locations_addFurniture, onDelete = { onDelete(r.room.id) })
                } else {
                    Icon(Icons.Default.ExpandMore, contentDescription = null, modifier = Modifier.padding(12.dp))
                }
            }
            AnimatedVisibility(expanded) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    r.groups.forEach { g ->
                        val furniture = g.furniture
                        if (furniture != null) {
                            var menu by remember { mutableStateOf(false) }
                            Box {
                                Text(
                                    furniture.name,
                                    Modifier.fillMaxWidth()
                                        .combinedClickable(onLongClickLabel = str(R.string.locations_actions, "name" to furniture.name), onLongClick = { menu = true }, onClick = { onOpen(furniture.id) })
                                        .padding(horizontal = 4.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                PlaceActions(menu, { menu = false }, onAdd = { onAddInside(furniture.id) }, addLabel = R.string.locations_addShelf, onDelete = { onDelete(furniture.id) })
                            }
                        }
                        // The room itself when it has nothing inside: its books are opened like a shelf's.
                        val places = g.places.filter { it.location.id != r.room.id || g.places.size == 1 }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
                            places.forEach { p ->
                                ShelfTile(p.label, count(p.location.id), Modifier.weight(1f), onOpen = { onOpen(p.location.id) }, onAddInside = { onAddInside(p.location.id) }, onDelete = { onDelete(p.location.id) })
                            }
                        }
                    }
                    TextButton(onClick = { onAddInside(r.room.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text(stringResource(R.string.locations_addFurniture), Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
    }
}

/** A shelf as a button: its name and its books ("empty"). Long press: add inside or delete. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ShelfTile(label: String, books: Int, modifier: Modifier, onOpen: () -> Unit, onAddInside: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val addLabel = stringResource(R.string.locations_addInside, label).let { format(it, "name" to label) }
    val deleteLabel = stringResource(R.string.common_delete)
    Box(modifier) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)
                .clip(MaterialTheme.shapes.large)
                .combinedClickable(onLongClickLabel = str(R.string.locations_actions, "name" to label), onLongClick = { menu = true }, onClick = onOpen)
                .semantics {
                    customActions = listOf(
                        CustomAccessibilityAction(addLabel) { onAddInside(); true },
                        CustomAccessibilityAction(deleteLabel) { onDelete(); true },
                    )
                },
        ) {
            Column(Modifier.padding(horizontal = 8.dp, vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(label, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                Text(
                    if (books == 0) stringResource(R.string.locations_emptyShelf) else plural(R.string.library_books_one, R.string.library_books_other, books),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
        PlaceActions(menu, { menu = false }, onAdd = onAddInside, addLabel = null, addText = addLabel, onDelete = onDelete)
    }
}

/** The ⋮ of a room: add furniture, delete. */
@Composable
private fun PlaceMenu(name: String, onAdd: () -> Unit, addLabel: Int, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { menu = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = str(R.string.locations_actions, "name" to name))
        }
        PlaceActions(menu, { menu = false }, onAdd = onAdd, addLabel = addLabel, onDelete = onDelete)
    }
}

@Composable
private fun PlaceActions(open: Boolean, onClose: () -> Unit, onAdd: () -> Unit, addLabel: Int?, onDelete: () -> Unit, addText: String? = null) {
    DropdownMenu(expanded = open, onDismissRequest = onClose) {
        DropdownMenuItem(
            text = { Text(addText ?: stringResource(addLabel!!)) },
            leadingIcon = { Icon(Icons.Default.AddCircleOutline, contentDescription = null) },
            onClick = { onClose(); onAdd() },
        )
        DropdownMenuItem(
            text = { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) },
            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
            onClick = { onClose(); onDelete() },
        )
    }
}
