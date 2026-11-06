package io.github.rldona.openlibrary.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * When the app asks for the fingerprint or screen lock (design A10, optional): on a cold start and when
 * it comes back after more than [timeoutMs] in the background. The lock is only the UI; sync keeps
 * working in the background.
 */
class LockPolicy(private val timeoutMs: Long = 60_000) {
    private val _locked = MutableStateFlow(false)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()
    private var leftAt: Long? = null
    private var started = false

    fun onStart(enabled: Boolean, now: Long) {
        val away = leftAt?.let { now - it }
        if (enabled && (!started || (away != null && away > timeoutMs))) _locked.value = true
        if (!enabled) _locked.value = false
        started = true
        leftAt = null
    }

    fun onStop(now: Long) {
        leftAt = now
    }

    fun unlocked() {
        _locked.value = false
    }
}

/** Small app preferences (one file for the whole app: DataStore allows one instance per file). */
internal val Context.prefs by preferencesDataStore("prefs")

/** The "lock the app" switch. */
class LockSettings(private val context: Context) {
    private val key = booleanPreferencesKey("app_lock")
    val enabled: Flow<Boolean> = context.prefs.data.map { it[key] == true }

    suspend fun current(): Boolean = enabled.first()

    suspend fun set(on: Boolean) {
        context.prefs.edit { it[key] = on }
    }
}
