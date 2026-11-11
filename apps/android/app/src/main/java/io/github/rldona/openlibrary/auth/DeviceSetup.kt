package io.github.rldona.openlibrary.auth

import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiJson
import io.github.rldona.openlibrary.network.DeviceRegisterResponse
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * Registers this phone with the server and saves its session. With a passkey (Credential Manager),
 * or with the password, which needs a recovery code too once the library has passkeys (the server
 * answers `passkey-required`, [PASSKEY_REQUIRED]). Device tokens already issued are not affected.
 */
class DeviceSetup(
    private val apiFor: (serverUrl: String, token: String?) -> ApiClient,
    private val sessions: SessionStore,
) {
    suspend fun withPassword(url: String, name: String, password: String, recoveryCode: String?): DeviceSession =
        save(url, name, apiFor(url, null).registerDevice(password, name, recoveryCode?.trim()?.ifEmpty { null }))

    /** Throws [PasskeyUnavailable] when the phone gives no passkey, ApiException when the server refuses it. */
    suspend fun withPasskey(url: String, name: String, provider: PasskeyProvider): DeviceSession {
        val api = apiFor(url, null)
        val ceremony = api.passkeyOptions()
        val answer = provider.signIn(ApiJson.encodeToString(JsonObject.serializer(), ceremony.options))
        val response = runCatching { ApiJson.parseToJsonElement(answer).jsonObject }
            .getOrElse { throw PasskeyUnavailable.Failed("unreadable answer") }
        return save(url, name, api.registerDeviceWithPasskey(ceremony.ceremonyId, response, name))
    }

    private suspend fun save(url: String, name: String, reg: DeviceRegisterResponse): DeviceSession {
        val session = DeviceSession(url, reg.deviceId, name, reg.token)
        sessions.save(session)
        return session
    }

    companion object {
        const val PASSKEY_REQUIRED = "passkey-required"
    }
}
