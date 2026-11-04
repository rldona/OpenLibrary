package io.github.rldona.openlibrary.ui.components

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
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.SyncStatus
import java.text.DateFormat
import java.util.Date

/** "Synced · 2 min ago", "Server unavailable — data from 4 Nov 09:12"… */
@Composable
fun SyncBar(status: SyncStatus, lastSyncAt: Long?, now: Long, modifier: Modifier = Modifier) {
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
    val warn = status is SyncStatus.Offline || status is SyncStatus.Revoked || status is SyncStatus.Failed
    Surface(color = if (warn) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant) {
        Row(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
            Text(text, style = MaterialTheme.typography.labelMedium)
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
