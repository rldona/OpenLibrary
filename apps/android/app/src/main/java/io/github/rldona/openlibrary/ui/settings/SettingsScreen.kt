package io.github.rldona.openlibrary.ui.settings

import io.github.rldona.openlibrary.ui.components.readableWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.LibraryBooks
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.SegmentedListItem
import androidx.compose.ui.graphics.vector.ImageVector
import io.github.rldona.openlibrary.ui.components.DestructiveDialog
import io.github.rldona.openlibrary.ui.components.Spacing
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import androidx.fragment.app.FragmentActivity
import io.github.rldona.openlibrary.sync.SyncStatus
import io.github.rldona.openlibrary.ui.lock.authenticate
import io.github.rldona.openlibrary.ui.lock.canLock
import io.github.rldona.openlibrary.sync.SyncWorker
import io.github.rldona.openlibrary.ui.components.SyncBar
import io.github.rldona.openlibrary.ui.components.TabScaffold
import kotlinx.coroutines.launch

class SettingsViewModel(private val c: AppContainer, private val onDisconnected: () -> Unit) : ViewModel() {
    val session = c.sessions.session
    val syncState = c.db.sync().stateFlow()
    val editions = c.db.catalog().editionCount()
    val status = c.sync.status
    val pending = c.db.outbox().pendingCount()
    val problems = c.db.outbox().problemCount()

    val lockEnabled = c.lockSettings.enabled

    fun setLock(on: Boolean) = viewModelScope.launch { c.lockSettings.set(on) }

    fun syncNow() = viewModelScope.launch { c.sync.sync() }

    fun resync() = viewModelScope.launch { c.sync.sync(full = true) }

    fun disconnect(context: android.content.Context) =
        viewModelScope.launch {
            c.sessions.current()?.let { s -> runCatching { c.api(s.serverUrl, s.token).revokeDevice(s.deviceId) } }
            SyncWorker.cancel(context)
            c.sessions.clear()
            // Deletes still waiting for "Undo" must not run against the next library.
            c.deletes.discardAll()
            c.sync.clearLocal()
            onDisconnected()
        }
}

@Composable
fun SettingsScreen(vm: SettingsViewModel, now: Long, context: android.content.Context, onReview: () -> Unit) {
    val session by vm.session.collectAsStateWithLifecycle(null)
    val state by vm.syncState.collectAsStateWithLifecycle(null)
    val editions by vm.editions.collectAsStateWithLifecycle(0)
    val status by vm.status.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle(0)
    val problems by vm.problems.collectAsStateWithLifecycle(0)
    var confirm by remember { mutableStateOf(false) }

    TabScaffold(stringResource(R.string.nav_settings)) { inner ->
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).readableWidth().padding(Spacing.page),
            verticalArrangement = Arrangement.spacedBy(Spacing.item),
        ) {
            SectionHeader(stringResource(R.string.settings_server))
            Group(
                listOf(
                    Triple(Icons.Default.Dns, stringResource(R.string.settings_server), session?.serverUrl.orEmpty()),
                    Triple(Icons.Default.PhoneAndroid, stringResource(R.string.device_thisDevice), session?.deviceName.orEmpty()),
                    Triple(Icons.AutoMirrored.Filled.LibraryBooks, stringResource(R.string.device_books), editions.toString()),
                ),
            )
            SectionHeader(stringResource(R.string.settings_sync))
            SyncBar(status, state?.lastSyncAt, now, pending = pending, problems = problems, onReview = onReview)
            val idle = status !is SyncStatus.Running
            Column(verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                SegmentedListItem(
                    onClick = { vm.syncNow() },
                    shapes = ListItemDefaults.segmentedShapes(0, 2),
                    enabled = idle,
                    leadingContent = { Icon(Icons.Default.Sync, contentDescription = null) },
                ) { Text(stringResource(R.string.sync_now)) }
                SegmentedListItem(
                    onClick = { vm.resync() },
                    shapes = ListItemDefaults.segmentedShapes(1, 2),
                    enabled = idle,
                    leadingContent = { Icon(Icons.Default.CloudDownload, contentDescription = null) },
                    supportingContent = { Text(stringResource(R.string.sync_resyncHint)) },
                ) { Text(stringResource(R.string.sync_resync)) }
            }
            SectionHeader(stringResource(R.string.security_title))
            LockSetting(vm)
            SectionHeader(stringResource(R.string.settings_about))
            Group(
                listOf(
                    Triple(Icons.Default.Info, stringResource(R.string.settings_appVersion), appVersion(context)),
                    // Diagnostics: the first characters identify the server's data set, as the web shows it.
                    Triple(Icons.Default.Tag, stringResource(R.string.settings_epoch), state?.epoch.orEmpty().take(8)),
                ),
            )
            Spacer(Modifier.height(Spacing.item))
            SegmentedListItem(
                onClick = { confirm = true },
                shapes = ListItemDefaults.segmentedShapes(0, 1),
                leadingContent = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
            ) { Text(stringResource(R.string.device_disconnect), color = MaterialTheme.colorScheme.error) }
        }
    }
    if (confirm) {
        DestructiveDialog(
            title = stringResource(R.string.device_disconnect),
            text = stringResource(R.string.device_disconnectConfirm),
            confirm = stringResource(R.string.device_disconnect),
            onConfirm = { confirm = false; vm.disconnect(context) },
            onDismiss = { confirm = false },
        )
    }
}

private fun appVersion(context: android.content.Context): String =
    runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty() }.getOrDefault("")

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp).semantics { heading() },
    )
}

/** Read-only facts as one block of rows: label on top, value below. */
@Composable
private fun Group(rows: List<Triple<ImageVector, String, String>>) {
    Column(verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
        rows.forEachIndexed { i, (icon, label, value) ->
            SegmentedListItem(
                shapes = ListItemDefaults.segmentedShapes(i, rows.size),
                // Label and value are read together.
                modifier = Modifier.semantics(mergeDescendants = true) {},
                leadingContent = { Icon(icon, contentDescription = null) },
                overlineContent = { Text(label) },
            ) { Text(value.ifEmpty { "—" }) }
        }
    }
}

/** Turning the lock on asks for the fingerprint/PIN once, so it is never enabled on a phone that cannot unlock. */
@Composable
private fun LockSetting(vm: SettingsViewModel) {
    val enabled by vm.lockEnabled.collectAsStateWithLifecycle(false)
    val activity = LocalContext.current as FragmentActivity
    val title = stringResource(R.string.lock_prompt)
    var unavailable by remember { mutableStateOf(false) }
    val toggle: (Boolean) -> Unit = { on ->
        when {
            !on -> vm.setLock(false)
            !canLock(activity) -> unavailable = true
            else -> authenticate(activity, title) { vm.setLock(true) }
        }
    }
    // The whole row is the switch, for touch and for TalkBack.
    SegmentedListItem(
        checked = enabled,
        onCheckedChange = toggle,
        shapes = ListItemDefaults.segmentedShapes(0, 1),
        leadingContent = { Icon(Icons.Default.Lock, contentDescription = null) },
        trailingContent = { Switch(checked = enabled, onCheckedChange = null) },
        supportingContent = {
            Text(
                stringResource(if (unavailable) R.string.lock_unavailable else R.string.lock_settingHint),
                color = if (unavailable) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    ) { Text(stringResource(R.string.lock_setting)) }
}
