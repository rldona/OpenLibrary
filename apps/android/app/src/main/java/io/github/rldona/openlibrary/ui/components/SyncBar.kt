package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.SyncStatus
import java.text.DateFormat
import java.util.Date

/** "Synced · 2 min ago", "Server unavailable — data from 4 Nov 09:12", "3 changes waiting"… */
@Composable
fun SyncBar(
    status: SyncStatus,
    lastSyncAt: Long?,
    now: Long,
    modifier: Modifier = Modifier,
    pending: Int = 0,
    problems: Int = 0,
    onReview: () -> Unit = {},
    /** Say nothing while all is well (the library home); Settings always shows the full state. */
    onlyProblems: Boolean = false,
) {
    if (onlyProblems) {
        val fine = status == SyncStatus.Idle && pending == 0 && problems == 0
        // Only the very first download is worth a progress bar; later syncs show in pull-to-refresh.
        if (fine || (status is SyncStatus.Running && !status.firstSync)) return
    }
    if (status is SyncStatus.Running) {
        LinearProgressIndicator(modifier.fillMaxWidth())
        return
    }
    val text =
        when (status) {
            SyncStatus.Offline ->
                str(
                    R.string.sync_offline,
                    "date" to (lastSyncAt?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)) } ?: "—"),
                )
            SyncStatus.Revoked -> str(R.string.device_revoked)
            is SyncStatus.Failed -> str(R.string.sync_failed, "error" to status.message)
            else -> if (lastSyncAt == null) str(R.string.sync_never) else str(R.string.sync_synced, "ago" to ago(lastSyncAt, now))
        }
    val warn = status is SyncStatus.Offline || status is SyncStatus.Revoked || status is SyncStatus.Failed || problems > 0
    Surface(color = if (warn) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant) {
        Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
            Text(text, style = MaterialTheme.typography.labelMedium)
            if (pending > 0) Text(plural(R.string.sync_pending_one, R.string.sync_pending_other, pending), style = MaterialTheme.typography.labelMedium)
            if (problems > 0) {
                Row(Modifier.clickable(onClick = onReview)) {
                    Text(
                        plural(R.string.sync_problems_one, R.string.sync_problems_other, problems) + " ›",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
fun ago(then: Long, now: Long): String {
    val min = ((now - then) / 60_000).coerceAtLeast(0)
    return when {
        min < 1 -> str(R.string.time_justNow)
        min < 60 -> str(R.string.time_minutes, "n" to min)
        min < 60 * 24 -> str(R.string.time_hours, "n" to min / 60)
        else -> str(R.string.time_days, "n" to min / (60 * 24))
    }
}
