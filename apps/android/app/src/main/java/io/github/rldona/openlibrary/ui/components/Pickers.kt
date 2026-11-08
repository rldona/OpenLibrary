package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.sync.pathOf

/** Read-only dropdown over a fixed list of (value, label) options. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> Picker(label: String, value: T, options: List<Pair<T, String>>, onChange: (T) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = modifier) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == value }?.second.orEmpty(),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (v, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { onChange(v); open = false })
            }
        }
    }
}

/** Location chooser showing full paths ("Casa › Salón › Balda 3"), plus "No location". */
@Composable
fun LocationPicker(
    locations: List<LocationEntity>,
    value: String?,
    onChange: (String?) -> Unit,
    modifier: Modifier = Modifier,
    label: String = stringResource(R.string.copy_location),
    /** What choosing nothing means here: no location for a copy, the top level for a new location. */
    noneLabel: String = stringResource(R.string.copy_noLocation),
) {
    val byId = remember(locations) { locations.associateBy { it.id } }
    val options =
        listOf<Pair<String?, String>>(null to noneLabel) +
            locations.map { it.id to pathOf(byId, it.id).joinToString(" › ") }.sortedBy { it.second }
    Picker(label, value, options, onChange, modifier)
}
