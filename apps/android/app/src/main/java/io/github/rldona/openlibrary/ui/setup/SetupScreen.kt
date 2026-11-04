package io.github.rldona.openlibrary.ui.setup

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.network.normalizeServerUrl
import io.github.rldona.openlibrary.sync.SyncStatus
import java.io.IOException
import kotlinx.coroutines.launch

sealed interface SetupError {
    data object InvalidUrl : SetupError
    data object Network : SetupError
    data class Server(val message: String) : SetupError
}

class SetupViewModel(private val c: AppContainer, private val onConnected: () -> Unit) : ViewModel() {
    var server by mutableStateOf("")
    var deviceName by mutableStateOf(Build.MODEL ?: "Android")
    var password by mutableStateOf("")
    var busy by mutableStateOf(false)
        private set
    var downloading by mutableStateOf(false)
        private set
    var error by mutableStateOf<SetupError?>(null)
        private set

    fun connect() {
        val url = runCatching { normalizeServerUrl(server) }.getOrNull()
        if (url == null || server.isBlank()) {
            error = SetupError.InvalidUrl
            return
        }
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val reg = c.api(url, null).registerDevice(password, deviceName.trim().ifEmpty { "Android" })
                password = ""
                c.sessions.save(DeviceSession(url, reg.deviceId, deviceName.trim(), reg.token))
                downloading = true
                // An unreachable server right after registering is unusual; the next sync will retry.
                if (c.sync.sync() !is SyncStatus.Revoked) onConnected()
            } catch (e: ApiException) {
                error = SetupError.Server(e.message)
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
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.setup_text), style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
            value = vm.server,
            onValueChange = { vm.server = it },
            label = { Text(stringResource(R.string.setup_server)) },
            placeholder = { Text(stringResource(R.string.setup_serverPlaceholder)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().testTag("server"),
        )
        OutlinedTextField(
            value = vm.deviceName,
            onValueChange = { vm.deviceName = it },
            label = { Text(stringResource(R.string.setup_deviceName)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("deviceName"),
        )
        OutlinedTextField(
            value = vm.password,
            onValueChange = { vm.password = it },
            label = { Text(stringResource(R.string.login_password)) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth().testTag("password"),
        )
        vm.error?.let {
            val text =
                when (it) {
                    SetupError.InvalidUrl -> stringResource(R.string.setup_invalidUrl)
                    SetupError.Network -> stringResource(R.string.errors_network)
                    is SetupError.Server -> it.message
                }
            Text(text, color = MaterialTheme.colorScheme.error)
        }
        Button(
            onClick = vm::connect,
            enabled = !vm.busy && vm.password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().testTag("connect"),
        ) {
            Text(
                stringResource(
                    when {
                        vm.downloading -> R.string.sync_downloadingLibrary
                        vm.busy -> R.string.setup_connecting
                        else -> R.string.setup_connect
                    },
                ),
            )
        }
    }
}
