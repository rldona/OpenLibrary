package io.github.rldona.openlibrary.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.conditionLabel
import io.github.rldona.openlibrary.core.retireLabel
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.ui.components.LocationPicker
import io.github.rldona.openlibrary.ui.components.Picker

val CONDITIONS = listOf("new", "fine", "good", "used", "fair", "poor")
val RETIRE_REASONS = listOf("gifted", "sold", "lost", "damaged", "other")

data class CopyForm(val locationId: String?, val condition: String, val notes: String)

/** Add a copy or move/edit one: location, condition and notes. */
@Composable
fun CopyDialog(
    title: String,
    confirm: String,
    initial: CopyForm,
    locations: List<LocationEntity>,
    onDismiss: () -> Unit,
    onSave: (CopyForm) -> Unit,
) {
    var form by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                LocationPicker(locations, form.locationId, { form = form.copy(locationId = it) }, Modifier.fillMaxWidth())
                Picker(
                    stringResource(R.string.copy_condition),
                    form.condition,
                    CONDITIONS.map { it to stringResource(conditionLabel(it)) },
                    { form = form.copy(condition = it) },
                    Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = form.notes,
                    onValueChange = { form = form.copy(notes = it) },
                    label = { Text(stringResource(R.string.copy_notes)) },
                    placeholder = { Text(stringResource(R.string.copy_notesPlaceholder)) },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onSave(form) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}

@Composable
fun RetireDialog(code: String, onDismiss: () -> Unit, onRetire: (reason: String) -> Unit) {
    var reason by remember { mutableStateOf("gifted") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(str(R.string.copyForm_retireTitle, "code" to code)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.copyForm_retireInfo))
                Picker(
                    stringResource(R.string.copyForm_reason),
                    reason,
                    RETIRE_REASONS.map { it to stringResource(retireLabel(it)) },
                    { reason = it },
                    Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onRetire(reason) }) { Text(stringResource(R.string.copyForm_retireButton)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}
