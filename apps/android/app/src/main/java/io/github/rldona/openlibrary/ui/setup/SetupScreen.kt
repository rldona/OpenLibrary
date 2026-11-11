package io.github.rldona.openlibrary.ui.setup

import io.github.rldona.openlibrary.ui.components.readableWidth
import androidx.compose.material3.ButtonDefaults
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import io.github.rldona.openlibrary.ui.components.BusyLabel
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.auth.CredentialManagerPasskeys
import io.github.rldona.openlibrary.auth.DeviceSetup
import io.github.rldona.openlibrary.auth.PasskeyProvider
import io.github.rldona.openlibrary.auth.PasskeyUnavailable
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.filled.Key
import androidx.compose.runtime.remember
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.BuildConfig
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.network.normalizeServerUrl
import io.github.rldona.openlibrary.sync.SyncStatus
import java.io.IOException
import kotlinx.coroutines.launch

/**
 * Which server the setup connects to. With a build-time default (the owner's own server) the
 * address field stays hidden until "Use another server"; without one it is shown, as always.
 */
data class ServerChoice(val default: String?, val useOther: Boolean = false, val typed: String = "") {
    val showField: Boolean get() = default == null || useOther

    /** The address to connect to: the typed one when the field is shown, else the default. */
    val address: String get() = if (showField) typed else default.orEmpty()
}

sealed interface SetupError {
    data object InvalidUrl : SetupError
    data object Network : SetupError
    data class Server(val message: String) : SetupError
    /** The library has passkeys: the password needs a recovery code (or use the passkey). */
    data object RecoveryCodeNeeded : SetupError
    data object PasskeyCancelled : SetupError
    data object NoPasskey : SetupError
    data object PasskeyFailed : SetupError
}

class SetupViewModel(
    private val c: AppContainer,
    defaultServer: String? = BuildConfig.DEFAULT_SERVER_URL.ifBlank { null },
    private val onConnected: () -> Unit,
) : ViewModel() {
    var choice by mutableStateOf(ServerChoice(defaultServer))
        private set
    var server: String
        get() = choice.typed
        set(v) {
            choice = choice.copy(typed = v)
        }

    fun useAnotherServer() {
        choice = choice.copy(useOther = true)
        error = null
    }

    // The name the owner gave the phone ("Raúl's Galaxy"), which the web's device list shows; the model as a fallback.
    var deviceName by mutableStateOf(
        Settings.Global.getString(c.app.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL ?: "Android",
    )
    var password by mutableStateOf("")
    var busy by mutableStateOf(false)
        private set
    var downloading by mutableStateOf(false)
        private set
    var error by mutableStateOf<SetupError?>(null)
        private set

    var recoveryCode by mutableStateOf("")
    /** Shown once the server says the library has passkeys. */
    var needsCode by mutableStateOf(false)
        private set

    private val setup = DeviceSetup(c.api, c.sessions)

    /** The build-time default, or the typed address once "Use another server" shows the field. */
    private fun address(): String? {
        val address = choice.address
        val url = runCatching { normalizeServerUrl(address) }.getOrNull()
        if (url == null || address.isBlank()) {
            error = SetupError.InvalidUrl
            return null
        }
        return url
    }

    private fun name() = deviceName.trim().ifEmpty { "Android" }

    fun connect() {
        val url = address() ?: return
        register { setup.withPassword(url, name(), password, recoveryCode.takeIf { needsCode }) }
    }

    fun connectWithPasskey(provider: PasskeyProvider) {
        val url = address() ?: return
        register { setup.withPasskey(url, name(), provider) }
    }

    private fun register(block: suspend () -> Unit) {
        busy = true
        error = null
        viewModelScope.launch {
            try {
                block()
                password = ""
                recoveryCode = ""
                downloading = true
                // An unreachable server right after registering is unusual; the next sync will retry.
                if (c.sync.sync() !is SyncStatus.Revoked) onConnected()
            } catch (e: ApiException) {
                if (e.code == DeviceSetup.PASSKEY_REQUIRED) {
                    needsCode = true
                    error = SetupError.RecoveryCodeNeeded
                } else {
                    error = SetupError.Server(e.message)
                }
            } catch (_: PasskeyUnavailable.Cancelled) {
                error = SetupError.PasskeyCancelled
            } catch (_: PasskeyUnavailable.NoCredential) {
                error = SetupError.NoPasskey
            } catch (_: PasskeyUnavailable) {
                error = SetupError.PasskeyFailed
            } catch (_: IOException) {
                error = SetupError.Network
            } finally {
                busy = false
                downloading = false
            }
        }
    }
}

@Composable
fun SetupScreen(vm: SetupViewModel) {
    var showPassword by rememberSaveable { mutableStateOf(false) }
    val canConnect = !vm.busy && vm.password.isNotEmpty() && (!vm.needsCode || vm.recoveryCode.isNotBlank())
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).readableWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        val choice = vm.choice
        Text(
            stringResource(if (choice.showField) R.string.setup_text else R.string.setup_textDefaultServer),
            style = MaterialTheme.typography.bodyMedium,
        )
        if (choice.showField) {
            OutlinedTextField(
                value = vm.server,
                onValueChange = { vm.server = it },
                label = { Text(stringResource(R.string.setup_server)) },
                placeholder = { Text(stringResource(R.string.setup_serverPlaceholder)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth().testTag("server"),
            )
        }
        OutlinedTextField(
            value = vm.deviceName,
            onValueChange = { vm.deviceName = it },
            label = { Text(stringResource(R.string.setup_deviceName)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().testTag("deviceName"),
        )
        // A passkey first (Credential Manager); the password stays for bootstrap and recovery.
        val activity = LocalActivity.current
        if (activity != null) {
            val provider = remember(activity) { CredentialManagerPasskeys(activity) }
            Button(
                onClick = { vm.connectWithPasskey(provider) },
                shapes = ButtonDefaults.shapes(),
                enabled = !vm.busy,
                modifier = Modifier.fillMaxWidth().testTag("connectPasskey"),
            ) {
                Icon(Icons.Default.Key, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.setup_withPasskey))
            }
            Text(stringResource(R.string.setup_orPassword), style = MaterialTheme.typography.labelLarge)
        }
        OutlinedTextField(
            value = vm.password,
            onValueChange = { vm.password = it },
            label = { Text(stringResource(R.string.login_password)) },
            singleLine = true,
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { showPassword = !showPassword }) {
                    Icon(
                        if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = stringResource(if (showPassword) R.string.setup_hidePassword else R.string.setup_showPassword),
                    )
                }
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            // "Done" connects, as the button would.
            keyboardActions = KeyboardActions(onDone = { if (canConnect) vm.connect() }),
            modifier = Modifier.fillMaxWidth().testTag("password"),
        )
        if (vm.needsCode) {
            OutlinedTextField(
                value = vm.recoveryCode,
                onValueChange = { vm.recoveryCode = it },
                label = { Text(stringResource(R.string.login_recoveryCode)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (canConnect) vm.connect() }),
                modifier = Modifier.fillMaxWidth().testTag("recoveryCode"),
            )
        }
        vm.error?.let {
            val text =
                when (it) {
                    SetupError.InvalidUrl -> stringResource(R.string.setup_invalidUrl)
                    SetupError.Network -> stringResource(R.string.errors_network)
                    is SetupError.Server -> it.message
                    SetupError.RecoveryCodeNeeded -> stringResource(R.string.setup_recoveryHint)
                    SetupError.PasskeyCancelled -> stringResource(R.string.passkeys_cancelled)
                    SetupError.NoPasskey -> stringResource(R.string.setup_noPasskey)
                    SetupError.PasskeyFailed -> stringResource(R.string.setup_passkeyFailed)
                }
            Text(text, color = MaterialTheme.colorScheme.error)
        }
        OutlinedButton(
            onClick = vm::connect,
            shapes = ButtonDefaults.shapes(),
            enabled = canConnect,
            modifier = Modifier.fillMaxWidth().testTag("connect"),
        ) {
            BusyLabel(
                vm.busy,
                stringResource(
                    when {
                        vm.downloading -> R.string.sync_downloadingLibrary
                        vm.busy -> R.string.setup_connecting
                        else -> R.string.setup_connect
                    },
                ),
            )
        }
        // Self-hosters and forks: the default is only a suggestion.
        if (!choice.showField) {
            TextButton(
                onClick = vm::useAnotherServer,
                enabled = !vm.busy,
                modifier = Modifier.fillMaxWidth().testTag("useAnotherServer"),
            ) { Text(stringResource(R.string.setup_useAnotherServer)) }
        }
    }
}
