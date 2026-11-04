package io.github.rldona.openlibrary.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** This phone's access to the server: address, device id and the long-lived token. */
data class DeviceSession(val serverUrl: String, val deviceId: String, val deviceName: String, val token: String)

interface SessionStore {
    val session: Flow<DeviceSession?>
    suspend fun current(): DeviceSession? = session.first()
    suspend fun save(session: DeviceSession)
    suspend fun clear()
}

/** Encrypts and decrypts small secrets. The Android implementation keeps the key in the Keystore. */
interface SecretCipher {
    fun encrypt(plain: String): String
    fun decrypt(sealed: String): String
}

private val Context.dataStore by preferencesDataStore("session")

/** DataStore-backed session; the token is stored encrypted with a non-exportable Keystore key. */
class DataStoreSessionStore(
    private val context: Context,
    private val cipher: SecretCipher = KeystoreCipher(),
) : SessionStore {
    private object Keys {
        val server = stringPreferencesKey("server_url")
        val deviceId = stringPreferencesKey("device_id")
        val deviceName = stringPreferencesKey("device_name")
        val token = stringPreferencesKey("token")
    }

    override val session: Flow<DeviceSession?> =
        context.dataStore.data.map { p: Preferences ->
            val server = p[Keys.server] ?: return@map null
            val sealed = p[Keys.token] ?: return@map null
            val token = runCatching { cipher.decrypt(sealed) }.getOrNull() ?: return@map null
            DeviceSession(server, p[Keys.deviceId].orEmpty(), p[Keys.deviceName].orEmpty(), token)
        }

    override suspend fun save(session: DeviceSession) {
        context.dataStore.edit {
            it[Keys.server] = session.serverUrl
            it[Keys.deviceId] = session.deviceId
            it[Keys.deviceName] = session.deviceName
            it[Keys.token] = cipher.encrypt(session.token)
        }
    }

    override suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}

class KeystoreCipher(private val alias: String = "openlibrary-device-token") : SecretCipher {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    override fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val out = c.iv + c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    override fun decrypt(sealed: String): String {
        val bytes = Base64.decode(sealed, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
        return String(c.doFinal(bytes, 12, bytes.size - 12))
    }
}
