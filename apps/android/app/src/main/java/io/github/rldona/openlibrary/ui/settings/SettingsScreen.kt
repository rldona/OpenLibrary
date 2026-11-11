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
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import io.github.rldona.openlibrary.data.THEMES
import io.github.rldona.openlibrary.ui.components.pageListItemColors
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
import androidx.compose.runtime.saveable.rememberSaveable
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
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.sync.MoveResult
import io.github.rldona.openlibrary.sync.ServerMove
import io.github.rldona.openlibrary.ui.components.BusyLabel
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
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

    val theme = c.appearance.theme

    fun setTheme(theme: String) = viewModelScope.launch { c.appearance.setTheme(theme) }

    fun syncNow() = viewModelScope.launch { c.sync.sync() }

    fun resync() = viewModelScope.launch { c.sync.sync(full = true) }

    private val mover =
        ServerMove(c.sessions, { c.db.sync().state()?.epoch }, c.api) {
            // The dialog closes at once; the sync (pushing the pending changes) runs on its own.
            c.appScope.launch { if (c.sync.sync() == SyncStatus.Offline) SyncWorker.whenOnline(c.app) }
        }

    var moving by mutableStateOf(false)
        private set
    var moveResult by mutableStateOf<MoveResult?>(null)
        private set

    fun moveServer(address: String, onMoved: () -> Unit) =
        viewModelScope.launch {
            moving = true
            moveResult = null
            val r = mover.moveTo(address)
            moving = false
            if (r == MoveResult.Moved) onMoved() else moveResult = r
        }

    fun clearMoveResult() {
        moveResult = null
    }

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
    var changeServer by remember { mutableStateOf(false) }

    TabScaffold(stringResource(R.string.nav_settings)) { inner ->
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).readableWidth().padding(Spacing.page),
            verticalArrangement = Arrangement.spacedBy(Spacing.item),
        ) {
            SectionHeader(stringResource(R.string.settings_server))
            SegmentedListItem(
                onClick = { vm.clearMoveResult(); changeServer = true },
                shapes = ListItemDefaults.segmentedShapes(0, 1),
                leadingContent = { Icon(Icons.Default.Dns, contentDescription = null) },
                trailingContent = { Icon(Icons.Default.Edit, contentDescription = null) },
                supportingContent = { Text(session?.serverUrl.orEmpty().ifEmpty { "—" }) },
                modifier = Modifier.testTag("changeServer"),
            ) { Text(stringResource(R.string.server_change)) }
            Group(
                listOf(
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
            SectionHeader(stringResource(R.string.settings_appearance))
            val theme by vm.theme.collectAsStateWithLifecycle("system")
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                THEMES.forEachIndexed { i, value ->
                    SegmentedButton(
                        selected = theme == value,
                        onClick = { vm.setTheme(value) },
                        shape = SegmentedButtonDefaults.itemShape(i, THEMES.size),
                    ) { Text(stringResource(themeLabel(value)), maxLines = 1) }
                }
            }
            SectionHeader(stringResource(R.string.security_title))
            LockSetting(vm)
            SectionHeader(stringResource(R.string.settings_about))
            Group(
                listOf(
                    Triple(Icons.Default.Info, stringResource(R.string.settings_appVersion), appVersion(context)),
                    Triple(Icons.Default.Lock, stringResource(R.string.settings_storage), stringResource(R.string.settings_storageEncrypted)),
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
    if (changeServer) {
        ChangeServerDialog(
            vm,
            current = session?.serverUrl.orEmpty(),
            onDismiss = { changeServer = false },
            onDisconnect = { changeServer = false; confirm = true },
        )
    }
    if (confirm) {
        val lost = if (pending > 0) "\n\n" + plural(R.string.device_disconnectPending_one, R.string.device_disconnectPending_other, pending) else ""
        DestructiveDialog(
            title = stringResource(R.string.device_disconnect),
            text = stringResource(R.string.device_disconnectConfirm) + lost,
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

@StringRes
private fun themeLabel(theme: String): Int =
    when (theme) {
        "light" -> R.string.theme_light
        "dark" -> R.string.theme_dark
        else -> R.string.theme_system
    }

/** Read-only facts: plain rows, label on top, value below. Only the actions get the card look. */
@Composable
private fun Group(rows: List<Triple<ImageVector, String, String>>) {
    Column {
        rows.forEach { (icon, label, value) ->
            ListItem(
                headlineContent = { Text(value.ifEmpty { "—" }) },
                // Label and value are read together.
                modifier = Modifier.semantics(mergeDescendants = true) {},
                leadingContent = { Icon(icon, contentDescription = null) },
                overlineContent = { Text(label) },
                colors = pageListItemColors(),
            )
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

/**
 * Same library, new address: checked against the server before anything changes. A different
 * library (or a server that does not know this phone) is explained, with Disconnect as the way out.
 */
@Composable
private fun ChangeServerDialog(vm: SettingsViewModel, current: String, onDismiss: () -> Unit, onDisconnect: () -> Unit) {
    var address by rememberSaveable { mutableStateOf(current) }
    val result = vm.moveResult
    val otherLibrary = result == MoveResult.DifferentLibrary || result == MoveResult.NotRecognised
    val submit = { if (!vm.moving && address.isNotBlank()) vm.moveServer(address, onDismiss) }
    AlertDialog(
        onDismissRequest = { if (!vm.moving) onDismiss() },
        title = { Text(stringResource(R.string.server_change)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.item)) {
                Text(stringResource(R.string.server_changeText))
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it; vm.clearMoveResult() },
                    label = { Text(stringResource(R.string.server_newAddress)) },
                    placeholder = { Text(stringResource(R.string.setup_serverPlaceholder)) },
                    singleLine = true,
                    isError = result != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.fillMaxWidth().testTag("newServer"),
                )
                result?.let { Text(moveMessage(it), color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            if (otherLibrary) {
                TextButton(onClick = onDisconnect) {
                    Text(stringResource(R.string.device_disconnect), color = MaterialTheme.colorScheme.error)
                }
            } else {
                TextButton(onClick = submit, enabled = !vm.moving && address.isNotBlank()) {
                    BusyLabel(vm.moving, stringResource(if (vm.moving) R.string.server_checking else R.string.server_changeAction))
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !vm.moving) { Text(stringResource(R.string.common_cancel)) } },
    )
}

@Composable
private fun moveMessage(r: MoveResult): String =
    when (r) {
        MoveResult.InvalidAddress -> stringResource(R.string.setup_invalidUrl)
        MoveResult.Unreachable -> stringResource(R.string.server_unreachable)
        MoveResult.DifferentLibrary -> stringResource(R.string.server_differentLibrary)
        MoveResult.NotRecognised -> stringResource(R.string.server_notRecognised)
        MoveResult.NotConnected, MoveResult.Moved -> stringResource(R.string.errors_network)
        is MoveResult.Failed -> r.message
    }
