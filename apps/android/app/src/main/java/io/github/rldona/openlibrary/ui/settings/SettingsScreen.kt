package io.github.rldona.openlibrary.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.sync.SyncStatus
import io.github.rldona.openlibrary.sync.SyncWorker
import io.github.rldona.openlibrary.ui.components.SyncBar
import kotlinx.coroutines.launch

class SettingsViewModel(private val c: AppContainer, private val onDisconnected: () -> Unit) : ViewModel() {
    val session = c.sessions.session
    val syncState = c.db.sync().stateFlow()
    val editions = c.db.catalog().editionCount()
    val status = c.sync.status

    fun syncNow() = viewModelScope.launch { c.sync.sync() }

    fun resync() = viewModelScope.launch { c.sync.sync(full = true) }

    fun disconnect(context: android.content.Context) =
        viewModelScope.launch {
            c.sessions.current()?.let { s -> runCatching { c.api(s.serverUrl, s.token).revokeDevice(s.deviceId) } }
            SyncWorker.cancel(context)
            c.sessions.clear()
            c.sync.clearLocal()
            onDisconnected()
        }
}

@Composable
fun SettingsScreen(vm: SettingsViewModel, now: Long, context: android.content.Context) {
    val session by vm.session.collectAsStateWithLifecycle(null)
    val state by vm.syncState.collectAsStateWithLifecycle(null)
    val editions by vm.editions.collectAsStateWithLifecycle(0)
    val status by vm.status.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.settings_server), style = MaterialTheme.typography.titleMedium)
        Text(session?.serverUrl.orEmpty(), style = MaterialTheme.typography.bodyMedium)
        Text(stringResource(R.string.device_thisDevice) + ": " + session?.deviceName.orEmpty(), style = MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.settings_epoch) + ": " + state?.epoch.orEmpty(), style = MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.device_books) + ": $editions", style = MaterialTheme.typography.bodySmall)
        SyncBar(status, state?.lastSyncAt, now)
        Button(onClick = { vm.syncNow() }, enabled = status !is SyncStatus.Running, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.sync_now))
        }
        OutlinedButton(onClick = { vm.resync() }, enabled = status !is SyncStatus.Running, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.sync_resync))
        }
        Text(stringResource(R.string.sync_resyncHint), style = MaterialTheme.typography.bodySmall)
        HorizontalDivider()
        OutlinedButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.device_disconnect), color = MaterialTheme.colorScheme.error)
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text(stringResource(R.string.device_disconnect)) },
            text = { Text(stringResource(R.string.device_disconnectConfirm)) },
            confirmButton = {
                TextButton(onClick = { confirm = false; vm.disconnect(context) }) { Text(stringResource(R.string.device_disconnect)) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}
