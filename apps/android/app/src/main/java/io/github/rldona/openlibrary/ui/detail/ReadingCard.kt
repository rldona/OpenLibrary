package io.github.rldona.openlibrary.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.ReadingEntity
import io.github.rldona.openlibrary.data.workReadingStatus
import io.github.rldona.openlibrary.ui.components.Picker

private val RATINGS = listOf(0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0)

fun stars(r: Double): String = "★".repeat(r.toInt()) + if (r % 1 != 0.0) "½" else ""

@androidx.annotation.StringRes
fun readingStatusLabel(status: String): Int =
    when (status) {
        "reading" -> R.string.reading_status_reading
        "read" -> R.string.reading_status_read
        "abandoned" -> R.string.reading_status_abandoned
        else -> R.string.reading_status_pending
    }

/** What the card asks the screen to do; the view model turns it into queued ops. */
sealed interface ReadingAction {
    data class Start(val copyId: String, val status: String) : ReadingAction
    data class Edit(val reading: ReadingEntity, val fields: Map<String, Any?>) : ReadingAction
}

/**
 * Reading of the work (BR11–BR13): derived status, actions on the latest session (finish, abandon) or a
 * new one (start, read again, mark as read), its rating and notes, and earlier readings.
 */
@Composable
fun ReadingCard(readings: List<ReadingEntity>, copies: List<CopyEntity>, onAction: (ReadingAction) -> Unit) {
    val status = workReadingStatus(readings)
    val latest = readings.lastOrNull()
    val current = latest?.takeIf { it.status == "reading" }
    var copyId by remember(copies) { mutableStateOf(copies.firstOrNull { it.status == "active" }?.id ?: copies.firstOrNull()?.id) }
    var editingNotes by remember { mutableStateOf(false) }
    val codeOf = { id: String -> copies.firstOrNull { it.id == id }?.code?.ifEmpty { null } ?: "—" }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.reading_title), style = MaterialTheme.typography.titleSmall)
                AssistChip(onClick = {}, label = { Text(stringResource(readingStatusLabel(status))) })
            }
            if (current != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onAction(ReadingAction.Edit(current, mapOf("status" to "read"))) }) { Text(stringResource(R.string.reading_finish)) }
                    OutlinedButton(onClick = { onAction(ReadingAction.Edit(current, mapOf("status" to "abandoned"))) }) {
                        Text(stringResource(R.string.reading_abandon))
                    }
                }
            } else {
                if (copies.size > 1) {
                    Picker(stringResource(R.string.reading_copy), copyId, copies.map { it.id to codeOf(it.id) }, { copyId = it }, Modifier.fillMaxWidth())
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { copyId?.let { onAction(ReadingAction.Start(it, "reading")) } }, enabled = copyId != null) {
                        Text(stringResource(if (status == "read") R.string.reading_reread else R.string.reading_start))
                    }
                    OutlinedButton(onClick = { copyId?.let { onAction(ReadingAction.Start(it, "read")) } }, enabled = copyId != null) {
                        Text(stringResource(R.string.reading_markRead))
                    }
                }
            }
            latest?.let { r ->
                Text(
                    listOfNotNull(
                        stringResource(readingStatusLabel(r.status)) + " · " + codeOf(r.copyId),
                        r.startedOn?.let { stringResource(R.string.reading_started) + " " + it },
                        r.finishedOn?.let { stringResource(R.string.reading_finished) + " " + it },
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                )
                Picker(
                    stringResource(R.string.reading_rating),
                    r.rating,
                    listOf<Pair<Double?, String>>(null to stringResource(R.string.reading_noRating)) + RATINGS.map { it to "${stars(it)} $it" },
                    { onAction(ReadingAction.Edit(r, mapOf("rating" to it))) },
                    Modifier.fillMaxWidth(),
                )
                TextButton(onClick = { editingNotes = true }) {
                    Text(r.notes.ifBlank { stringResource(R.string.reading_notes) }, maxLines = 3)
                }
                if (editingNotes) NotesDialog(r.notes, onDismiss = { editingNotes = false }) {
                    editingNotes = false
                    if (it != r.notes) onAction(ReadingAction.Edit(r, mapOf("notes" to it)))
                }
            }
            val earlier = readings.dropLast(1).reversed()
            if (earlier.isNotEmpty()) {
                Text(str(R.string.reading_history, "n" to earlier.size), style = MaterialTheme.typography.labelMedium)
                earlier.forEach { r ->
                    Text(
                        stringResource(readingStatusLabel(r.status)) + " · ${r.startedOn ?: "—"} → ${r.finishedOn ?: "—"}" +
                            (r.rating?.let { " · " + stars(it) + " $it" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun NotesDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.reading_notes)) },
        text = { OutlinedTextField(value = text, onValueChange = { text = it }, minLines = 3, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(onClick = { onSave(text.trim()) }) { Text(stringResource(R.string.common_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}
