package io.github.rldona.openlibrary.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.RoomShelves
import io.github.rldona.openlibrary.core.roomOf
import io.github.rldona.openlibrary.core.roomShelves
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.sync.pathOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

/** "Room › Furniture › Shelf", or null when [id] is not a known location. */
fun placePath(locations: List<LocationEntity>, id: String?): String? {
    if (id == null) return null
    val byId = locations.associateBy { it.id }
    if (id !in byId) return null
    return pathOf(byId, id).joinToString(" › ")
}

/**
 * Where a book goes, in one sheet: the last place used on top, then every room with its furniture and
 * the shelves as buttons. One shelf is selected at a time and the button below puts the book there.
 * Used on the book's detail, when adding books and for the books not placed yet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationSheet(
    locations: List<LocationEntity>,
    /** The place proposed first (the last one used); ignored if it no longer exists. */
    lastUsedId: String?,
    /** What is selected when the sheet opens (the current place). */
    initial: String?,
    onConfirm: (locationId: String?) -> Unit,
    onDismiss: () -> Unit,
    /** Under the title: the book being placed, or how many. */
    subtitle: String? = null,
    /** Offer "leave it unplaced" (adding a book), which confirms with null. */
    allowNone: Boolean = false,
    /** The button's text for the selected place's name; "Put on {name}" by default. */
    confirmLabel: @Composable (name: String) -> String = { str(R.string.place_confirm, "name" to it) },
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val rooms = remember(locations) { roomShelves(locations) }
    val byId = remember(locations) { locations.associateBy { it.id } }
    val lastUsed = lastUsedId?.takeIf { it in byId && roomOf(rooms, it) != null }
    // The current place, or else the last one used: one tap on the button puts the book there.
    var selected by rememberSaveable { mutableStateOf(initial?.takeIf { it in byId } ?: lastUsed) }
    // The room of the selection (or of the last place) opens; with a single room, that one.
    val openFirst = (roomOf(rooms, selected) ?: roomOf(rooms, lastUsed) ?: rooms.singleOrNull() ?: rooms.firstOrNull())?.room?.id
    var open by rememberSaveable { mutableStateOf(setOfNotNull(openFirst).toList()) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 16.dp)) {
            Column(Modifier.padding(horizontal = 8.dp)) {
                Text(
                    stringResource(R.string.place_title),
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() },
                )
                subtitle?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Column(
                Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(top = 12.dp).selectableGroup(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (rooms.isEmpty()) {
                    Text(
                        stringResource(R.string.place_empty),
                        Modifier.padding(8.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (lastUsed != null) {
                    SmallLabel(stringResource(R.string.place_lastUsed))
                    val isSelected = selected == lastUsed
                    Surface(
                        shape = MaterialTheme.shapes.large,
                        color = if (isSelected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
                            .selectable(isSelected, role = Role.RadioButton) { selected = lastUsed },
                    ) {
                        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Schedule, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Text(
                                pathOf(byId, lastUsed).joinToString(" › "),
                                Modifier.padding(start = 16.dp),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                    }
                }
                rooms.forEach { room ->
                    val expanded = room.room.id in open || rooms.size == 1
                    RoomBlock(
                        room,
                        expanded = expanded,
                        collapsible = rooms.size > 1,
                        selected = selected,
                        onToggle = { open = if (expanded) open - room.room.id else open + room.room.id },
                        onSelect = { selected = it },
                    )
                }
                if (allowNone) {
                    TextButton(onClick = { onConfirm(null) }, Modifier.align(Alignment.CenterHorizontally).heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.place_none))
                    }
                }
            }
            val name = selected?.let { byId[it]?.name }
            Button(
                onClick = { onConfirm(selected) },
                enabled = name != null,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp).heightIn(min = 56.dp),
            ) {
                Text(if (name != null) confirmLabel(name) else stringResource(R.string.place_pick), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun SmallLabel(text: String) {
    Text(
        text,
        Modifier.padding(start = 8.dp, top = 8.dp).semantics { heading() },
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RoomBlock(
    room: RoomShelves,
    expanded: Boolean,
    collapsible: Boolean,
    selected: String?,
    onToggle: () -> Unit,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!expanded) {
            // A folded room is one row that opens it.
            Surface(
                onClick = onToggle,
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            ) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(room.room.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    Icon(Icons.Default.ExpandMore, contentDescription = str(R.string.place_show, "name" to room.room.name))
                }
            }
            return@Column
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SmallLabel(room.room.name)
            if (collapsible) {
                Row(Modifier.weight(1f)) {}
                TextButton(onClick = onToggle, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Default.ExpandLess, contentDescription = str(R.string.place_hide, "name" to room.room.name))
                }
            }
        }
        AnimatedVisibility(expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                room.groups.forEach { group ->
                    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            group.furniture?.let { Text(it.name, style = MaterialTheme.typography.titleSmall) }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                group.places.forEach { place ->
                                    PlaceButton(place.label, selected == place.location.id) { onSelect(place.location.id) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaceButton(label: String, isSelected: Boolean, onClick: () -> Unit) {
    val modifier = Modifier.widthIn(min = 96.dp).heightIn(min = 48.dp).semantics {
        selected = isSelected
        role = Role.RadioButton
    }
    val shape = MaterialTheme.shapes.medium
    if (isSelected) {
        Button(onClick = onClick, modifier = modifier, shape = shape, contentPadding = ButtonDefaults.ContentPadding) {
            Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    } else {
        OutlinedButton(onClick = onClick, modifier = modifier, shape = shape) {
            Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}
