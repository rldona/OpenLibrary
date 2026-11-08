package io.github.rldona.openlibrary.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.ui.text.style.TextOverflow
import io.github.rldona.openlibrary.ui.components.RatingBar
import io.github.rldona.openlibrary.ui.components.Spacing
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.fmtDate
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.ReadingEntity
import io.github.rldona.openlibrary.data.workReadingStatus
import io.github.rldona.openlibrary.ui.components.Picker

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
    data class Reset(val readings: List<ReadingEntity>) : ReadingAction
}

/**
 * The session in progress: the latest one still "reading", even if a later one was abandoned (the same
 * rule that makes the work's status "reading", see [workReadingStatus]).
 */
fun currentReading(readings: List<ReadingEntity>): ReadingEntity? = readings.lastOrNull { it.status == "reading" }

/** The reading the card edits: the latest one, unless "Not read yet" reset it (then there is nothing to show). */
fun editableReading(readings: List<ReadingEntity>): ReadingEntity? = readings.lastOrNull()?.takeIf { it.status != "pending" }

/**
 * Earlier readings worth listing, newest first: every finished, abandoned or in-progress one, and the reset
 * ones that still carry a rating or notes. A reset reading with nothing else would be an empty row.
 */
fun historyReadings(readings: List<ReadingEntity>): List<ReadingEntity> {
    val editable = editableReading(readings)
    return readings.filter { it.id != editable?.id && (it.status != "pending" || it.rating != null || it.notes.isNotBlank()) }.reversed()
}

/** The statuses the card offers, in order; "abandoned" is a session outcome, shown in the history only. */
private val STATUSES = listOf("pending", "reading", "read")

/**
 * What choosing [target] in the status row does, given the work's [status] and the session in progress
 * ([current]): start (or read again), finish, mark as read, or reset the work to "not read yet". Null
 * when there is nothing to do, or when the change would not produce the chosen status.
 *
 * Reset (design §4) is a work-level undo: every live reading of the work (finished and in progress) goes
 * back to pending and its dates are cleared, so a book with a finished read and a re-read becomes "not
 * read yet". Ratings and notes are kept.
 */
fun statusChange(
    status: String,
    current: ReadingEntity?,
    target: String,
    copyId: String?,
    readings: List<ReadingEntity>,
): ReadingAction? =
    when {
        target == status -> null
        target == "pending" -> {
            val toReset = readings.filter { it.status == "reading" || it.status == "read" }
            if (toReset.isEmpty()) null else ReadingAction.Reset(toReset)
        }
        target == "reading" -> copyId?.let { ReadingAction.Start(it, "reading") }
        target == "read" && current != null -> ReadingAction.Edit(current, mapOf("status" to "read"))
        target == "read" -> copyId?.let { ReadingAction.Start(it, "read") }
        else -> null
    }

/**
 * Reading of the work (BR11–BR13): the derived status as a segmented choice (choosing one starts, finishes
 * or marks the reading), "Abandon" for the one in progress, its rating as stars and its notes, and earlier
 * readings.
 */
@Composable
fun ReadingCard(
    readings: List<ReadingEntity>,
    copies: List<CopyEntity>,
    onAction: (ReadingAction) -> Unit,
    /** A change is being written: the status row waits, so a second tap cannot start a second reading. */
    busy: Boolean = false,
) {
    val status = workReadingStatus(readings)
    val latest = editableReading(readings)
    val current = currentReading(readings)
    var copyId by remember(copies) { mutableStateOf(copies.firstOrNull { it.status == "active" }?.id ?: copies.firstOrNull()?.id) }
    var editingNotes by remember { mutableStateOf(false) }
    val codeOf = { id: String -> copies.firstOrNull { it.id == id }?.code?.ifEmpty { null } ?: "—" }

    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Spacing.item), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.reading_title), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
            if (current == null && copies.size > 1) {
                Picker(stringResource(R.string.reading_copy), copyId, copies.map { it.id to codeOf(it.id) }, { copyId = it }, Modifier.fillMaxWidth())
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                STATUSES.forEachIndexed { i, target ->
                    val change = statusChange(status, current, target, copyId, readings)
                    SegmentedButton(
                        selected = status == target,
                        onClick = { change?.let(onAction) },
                        shape = SegmentedButtonDefaults.itemShape(i, STATUSES.size),
                        // The current one stays highlighted; the others only when choosing them does something.
                        enabled = !busy && (status == target || change != null),
                    ) { Text(stringResource(readingStatusLabel(target)), maxLines = 1) }
                }
            }
            if (current != null) {
                TextButton(onClick = { onAction(ReadingAction.Edit(current, mapOf("status" to "abandoned"))) }) {
                    Text(stringResource(R.string.reading_abandon))
                }
            }
            latest?.let { r ->
                Text(
                    listOfNotNull(
                        // The copy only matters when there is more than one.
                        stringResource(readingStatusLabel(r.status)) + if (copies.size > 1) " · " + codeOf(r.copyId) else "",
                        r.startedOn?.let { stringResource(R.string.reading_started) + " " + fmtDate(it) },
                        r.finishedOn?.let { stringResource(R.string.reading_finished) + " " + fmtDate(it) },
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                )
                RatingBar(r.rating, onRate = { onAction(ReadingAction.Edit(r, mapOf("rating" to it))) })
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        r.notes.ifBlank { stringResource(R.string.reading_notes) },
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (r.notes.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = { editingNotes = true }) {
                        Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.reading_editNotes))
                    }
                }
                if (editingNotes) NotesDialog(r.notes, onDismiss = { editingNotes = false }) {
                    editingNotes = false
                    if (it != r.notes) onAction(ReadingAction.Edit(r, mapOf("notes" to it)))
                }
            }
            val earlier = historyReadings(readings)
            if (earlier.isNotEmpty()) {
                Text(str(R.string.reading_history, "n" to earlier.size), style = MaterialTheme.typography.labelMedium)
                earlier.forEach { r ->
                    Text(historyLine(r), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** "Read · 1 Nov 2026 → 2 Nov 2026 · ★★★★ 4.0"; a reset reading keeps only what it was kept for. */
@Composable
private fun historyLine(r: ReadingEntity): String {
    val status = stringResource(if (r.status == "pending") R.string.reading_wasReset else readingStatusLabel(r.status))
    val dates =
        when {
            r.startedOn != null && r.finishedOn != null -> fmtDate(r.startedOn) + " → " + fmtDate(r.finishedOn)
            r.startedOn != null -> stringResource(R.string.reading_started) + " " + fmtDate(r.startedOn)
            r.finishedOn != null -> stringResource(R.string.reading_finished) + " " + fmtDate(r.finishedOn)
            else -> null
        }
    return listOfNotNull(status, dates, r.rating?.let { stars(it) + " $it" }).joinToString(" · ")
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
