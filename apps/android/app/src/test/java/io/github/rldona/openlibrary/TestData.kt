package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.network.SyncCopy
import io.github.rldona.openlibrary.network.SyncEdition
import io.github.rldona.openlibrary.network.SyncLocation
import io.github.rldona.openlibrary.network.SyncWork
import kotlinx.coroutines.flow.MutableStateFlow

/* Builders shared by the sync tests. */

internal const val T = "2026-11-04T10:00:00.000Z"
internal val COVER = "ab".repeat(32)

internal fun work(id: String, title: String, authors: List<String>, version: Int = 1) =
    SyncWork(id, version, T, T, title, null, authors, listOf("Novela"), null, null, null, null, null, favorite = false)

internal fun edition(id: String, workId: String, cover: String? = null) =
    SyncEdition(id, 1, T, T, workId, null, null, "Cátedra", 1887, "es", 500, null, null, cover, "complete", null)

internal fun copy(id: String, editionId: String, locationId: String?, status: String = "active") =
    SyncCopy(id, 1, T, T, editionId, "EJ-$id", locationId, "good", null, null, "EUR", "", status, if (status == "retired") "gifted" else null, null)

internal fun location(id: String, name: String, parentId: String? = null) = SyncLocation(id, 1, T, T, parentId, name, "room", 0)

internal class MemorySessions(s: DeviceSession?) : SessionStore {
    override val session = MutableStateFlow(s)
    override suspend fun save(session: DeviceSession) { this.session.value = session }
    override suspend fun clear() { session.value = null }
}

