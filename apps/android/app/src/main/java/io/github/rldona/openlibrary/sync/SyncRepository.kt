package io.github.rldona.openlibrary.sync

import androidx.room.withTransaction
import io.github.rldona.openlibrary.core.fold
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.BookFts
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.EditionEntity
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.data.SyncStateEntity
import io.github.rldona.openlibrary.data.WorkEntity
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.network.SyncCopy
import io.github.rldona.openlibrary.network.SyncEdition
import io.github.rldona.openlibrary.network.SyncLocation
import io.github.rldona.openlibrary.network.SyncWork
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed interface SyncStatus {
    data object Idle : SyncStatus
    data class Running(val firstSync: Boolean) : SyncStatus
    /** The server could not be reached: the local copy keeps working. */
    data object Offline : SyncStatus
    /** The device token was revoked (or the password changed): the user must connect again. */
    data object Revoked : SyncStatus
    data class Failed(val message: String) : SyncStatus
}

/**
 * Pull side of the sync protocol (§6 of the design): snapshot on first use or after a restore, then pages
 * of changes from the cursor. Each page and its new cursor are written in ONE transaction, so killing
 * the app mid-sync never leaves the cursor ahead of the data.
 */
class SyncRepository(
    private val db: AppDatabase,
    private val sessions: SessionStore,
    private val covers: CoverStore,
    private val apiFor: (serverUrl: String, token: String) -> ApiClient,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()
    private val _status = MutableStateFlow<SyncStatus>(SyncStatus.Idle)
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    private val dao get() = db.sync()

    /** Syncs now. `full` discards the local copy and downloads everything again. */
    suspend fun sync(full: Boolean = false): SyncStatus =
        mutex.withLock {
            val session = sessions.current() ?: return SyncStatus.Idle
            val api = apiFor(session.serverUrl, session.token)
            val state = dao.state()
            _status.value = SyncStatus.Running(firstSync = state == null || full)
            val result =
                try {
                    if (full || state == null) snapshot(api) else pull(api, state)
                    downloadCovers(api)
                    dao.markSynced(now())
                    SyncStatus.Idle
                } catch (e: ApiException) {
                    if (e.status == 401) SyncStatus.Revoked else SyncStatus.Failed(e.message)
                } catch (_: IOException) {
                    SyncStatus.Offline
                }
            _status.value = result
            result
        }

    private suspend fun snapshot(api: ApiClient) {
        val s = api.snapshot()
        db.withTransaction {
            dao.clearWorks()
            dao.clearEditions()
            dao.clearCopies()
            dao.clearLocations()
            dao.upsertWorks(s.works.map { it.toEntity() })
            dao.upsertEditions(s.editions.map { it.toEntity() })
            dao.upsertCopies(s.copies.map { it.toEntity() })
            dao.upsertLocations(s.locations.map { it.toEntity() })
            dao.setState(SyncStateEntity(epoch = s.epoch, cursor = s.cursor, lastSyncAt = dao.state()?.lastSyncAt))
            rebuildSearchIndex()
        }
    }

    private suspend fun pull(api: ApiClient, start: SyncStateEntity) {
        var cursor = start.cursor
        while (true) {
            val page =
                try {
                    api.pull(cursor, start.epoch)
                } catch (e: ApiException) {
                    // The server was restored from a backup (or lost its log): start over from a snapshot.
                    if (e.status == 409 && e.code in RESYNC_CODES) return snapshot(api)
                    throw e
                }
            db.withTransaction {
                dao.upsertWorks(page.works.map { it.toEntity() })
                dao.upsertEditions(page.editions.map { it.toEntity() })
                dao.upsertCopies(page.copies.map { it.toEntity() })
                dao.upsertLocations(page.locations.map { it.toEntity() })
                val gone = page.deleted.groupBy({ it.entity }, { it.id })
                gone["work"]?.let { dao.deleteWorks(it) }
                gone["edition"]?.let { dao.deleteEditions(it) }
                gone["copy"]?.let { dao.deleteCopies(it) }
                gone["location"]?.let { dao.deleteLocations(it) }
                dao.setState(start.copy(cursor = page.cursor))
                val changed = page.works.size + page.editions.size + page.copies.size + page.locations.size
                if (changed + page.deleted.size > 0) rebuildSearchIndex()
            }
            cursor = page.cursor
            if (!page.hasMore) return
        }
    }

    /** Thumbnails for every cover not on the phone yet; a failed one is retried on the next sync. */
    private suspend fun downloadCovers(api: ApiClient) {
        val ids = db.catalog().coverIds()
        for (id in ids) {
            if (covers.has(id)) continue
            try {
                covers.put(id, api.asset(id))
            } catch (e: ApiException) {
                if (e.status == 401) throw e
            }
        }
        covers.retainOnly(ids.toSet())
    }

    /** Rebuilt as a whole: a renamed location or work changes the text of many editions at once. */
    private suspend fun rebuildSearchIndex() {
        val locations = dao.allLocations().associateBy { it.id }
        val placesByEdition = dao.activePlacements().groupBy({ it.editionId }, { it.locationId })
        val rows =
            dao.searchSources().map { src ->
                val places =
                    placesByEdition[src.editionId].orEmpty().filterNotNull().flatMap { pathOf(locations, it) }
                BookFts(editionId = src.editionId, body = fold(src.text + " " + places.joinToString(" ")))
            }
        dao.clearFts()
        dao.insertFts(rows)
    }

    /** Forgets the local copy (used when disconnecting this phone). */
    suspend fun clearLocal() {
        mutex.withLock {
            db.withTransaction {
                dao.clearWorks()
                dao.clearEditions()
                dao.clearCopies()
                dao.clearLocations()
                dao.clearFts()
                dao.clearState()
            }
            covers.clear()
            _status.value = SyncStatus.Idle
        }
    }

    companion object {
        val RESYNC_CODES = setOf("epoch-mismatch", "cursor-ahead")
    }
}

/** Names from the root down to the given location ("Casa", "Salón", "Balda 3"). */
fun pathOf(locations: Map<String, LocationEntity>, id: String?): List<String> {
    val out = ArrayDeque<String>()
    var cur = id?.let(locations::get)
    var guard = 0
    while (cur != null && guard++ < 50) {
        out.addFirst(cur.name)
        cur = cur.parentId?.let(locations::get)
    }
    return out.toList()
}

private fun SyncWork.toEntity() =
    WorkEntity(
        id, version, title, subtitle, authors, subjects, description, originalTitle, originalLanguage,
        series, seriesIndex, createdAt, updatedAt, sortTitle = fold(title),
    )

private fun SyncEdition.toEntity() =
    EditionEntity(
        id, version, workId, title, subtitle, publisher, publishedYear, language, pages, format, isbn13,
        coverAssetId, metadataStatus, metadataSource, createdAt, updatedAt,
    )

private fun SyncCopy.toEntity() =
    CopyEntity(
        id, version, editionId, code, locationId, condition, acquiredOn, priceCents, priceCurrency, notes,
        status, retiredReason, retiredOn, createdAt, updatedAt,
    )

private fun SyncLocation.toEntity() =
    LocationEntity(id, version, parentId, name, kind, sortOrder, createdAt, updatedAt)
