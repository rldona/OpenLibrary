package io.github.rldona.openlibrary.sync

import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.network.normalizeServerUrl
import java.io.IOException
import kotlinx.serialization.SerializationException

/** Outcome of moving this phone to another server address. Only [Moved] changes anything. */
sealed interface MoveResult {
    data object Moved : MoveResult
    data object InvalidAddress : MoveResult
    data object NotConnected : MoveResult
    data object Unreachable : MoveResult
    /** It answers, but it holds another library (another data epoch). */
    data object DifferentLibrary : MoveResult
    /** It does not know this phone's token: another server, or this phone was disconnected there. */
    data object NotRecognised : MoveResult
    data class Failed(val message: String) : MoveResult
}

/**
 * Points a connected phone at a new address of the same library (the server moved hosts with its
 * database), keeping the token, the device id, the local copy and the pending changes. The new
 * address must hold the same data epoch as the local copy and accept the current token; otherwise
 * nothing changes and the caller offers the usual Disconnect instead.
 */
class ServerMove(
    private val sessions: SessionStore,
    /** The data epoch of the local copy, null if it never synced. */
    private val localEpoch: suspend () -> String?,
    private val apiFor: (serverUrl: String, token: String?) -> ApiClient,
    /** Runs once the address is saved (a sync). */
    private val afterMove: suspend () -> Unit,
) {
    suspend fun moveTo(input: String): MoveResult {
        val url = runCatching { normalizeServerUrl(input) }.getOrNull()
        if (url == null || input.isBlank()) return MoveResult.InvalidAddress
        val session = sessions.current() ?: return MoveResult.NotConnected
        try {
            val health = apiFor(url, null).health()
            val epoch = localEpoch()
            if (epoch != null && health.epoch != epoch) return MoveResult.DifferentLibrary
            apiFor(url, session.token).me()
        } catch (e: ApiException) {
            return if (e.status == 401) MoveResult.NotRecognised else MoveResult.Failed(e.message)
        } catch (_: IOException) {
            return MoveResult.Unreachable
        } catch (_: SerializationException) {
            // Something answers, but it is not an OpenLibrary server.
            return MoveResult.Unreachable
        }
        if (url != session.serverUrl) sessions.save(session.copy(serverUrl = url))
        afterMove()
        return MoveResult.Moved
    }
}
