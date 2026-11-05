package io.github.rldona.openlibrary.sync

import androidx.room.withTransaction
import io.github.rldona.openlibrary.core.fold
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.BookFts
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.EditionEntity
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.data.SYNC_FORMAT
import io.github.rldona.openlibrary.data.SyncStateEntity
import io.github.rldona.openlibrary.data.WorkEntity
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.network.FieldConflict
import io.github.rldona.openlibrary.network.OpJson
import kotlinx.serialization.builtins.ListSerializer
import io.github.rldona.openlibrary.network.SyncCopy
import io.github.rldona.openlibrary.network.SyncEdition
import io.github.rldona.openlibrary.network.SyncLocation
import io.github.rldona.openlibrary.network.SyncReading
import io.github.rldona.openlibrary.network.SyncWish
import io.github.rldona.openlibrary.network.SyncQuote
import io.github.rldona.openlibrary.data.QuoteEntity
import io.github.rldona.openlibrary.data.WishEntity
import io.github.rldona.openlibrary.data.ReadingEntity
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
 * Sync protocol (§6 of the design). One cycle:
 *  1. snapshot if this phone has no copy yet;
 *  2. PUSH: upload pending cover photos, then the outbox in batches (resent ops are idempotent);
 *  3. PULL pages of changes from the cursor, or a snapshot after a restore or after an op was refused
 *     (that op's optimistic local effect must be replaced by the server's data);
 *  4. download new covers.
 * Each page, its cursor and the re-application of still-pending local changes are written in ONE
 * transaction, so killing the app mid-sync never leaves the cursor ahead of the data or hides a change.
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
                    // Also after an update that syncs new kinds of data: their records were skipped until now.
                    val fresh = full || state == null || state.format < SYNC_FORMAT
                    if (fresh) snapshot(api)
                    val refused = push(api)
                    when {
                        refused -> snapshot(api)
                        !fresh -> pull(api, dao.state()!!)
                    }
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
            dao.clearReadings()
            dao.clearWishes()
            dao.clearQuotes()
            dao.upsertWorks(s.works.map { it.toEntity() })
            dao.upsertEditions(s.editions.map { it.toEntity() })
            dao.upsertCopies(s.copies.map { it.toEntity() })
            dao.upsertLocations(s.locations.map { it.toEntity() })
            dao.upsertReadings(s.readings.map { it.toEntity() })
            dao.upsertWishes(s.wishes.map { it.toEntity() })
            dao.upsertQuotes(s.quotes.map { it.toEntity() })
            dao.setState(SyncStateEntity(epoch = s.epoch, cursor = s.cursor, lastSyncAt = dao.state()?.lastSyncAt, format = SYNC_FORMAT))
            reapplyPending()
            rebuildSearchIndex()
        }
    }

    /**
     * Sends the outbox. Returns true if the server refused some op (conflict or rejection), in which case
     * the caller takes a snapshot so the phone shows the server's data again for those entities.
     */
    private suspend fun push(api: ApiClient): Boolean {
        val outbox = db.outbox()
        for (u in outbox.uploads()) {
            val file = covers.file(u.assetId)
            if (file.exists()) api.uploadAsset(file.readBytes())
            outbox.uploaded(u.assetId)
        }
        var refused = false
        var retriedAfterRestore = false
        while (true) {
            val batch = outbox.pending(limit = 100)
            if (batch.isEmpty()) return refused
            val response =
                try {
                    api.push(dao.state()!!.epoch, batch.map { LocalWrites.decode(it.payload) })
                } catch (e: ApiException) {
                    // Restored server: take its data first, then push the same ops (creates still apply).
                    if (e.status == 409 && e.code in RESYNC_CODES && !retriedAfterRestore) {
                        retriedAfterRestore = true
                        snapshot(api)
                        continue
                    }
                    throw e
                }
            val byId = response.results.associateBy { it.opId }
            db.withTransaction {
                for (op in batch) {
                    val r = byId[op.opId] ?: continue
                    when (r.status) {
                        "applied", "duplicate" -> outbox.delete(op.opId)
                        "conflict", "rejected" -> {
                            refused = true
                            val conflicts = r.conflicts?.let { OpJson.encodeToString(ListSerializer(FieldConflict.serializer()), it) }
                            outbox.markFailed(op.opId, r.status, r.message, conflicts, r.currentVersion)
                        }
                    }
                }
            }
            // An op without a result (should not happen) would loop forever: stop and retry next sync.
            if (batch.all { byId[it.opId] == null }) return refused
        }
    }

    /** Pending local changes stay visible on top of whatever the server sent. */
    private suspend fun reapplyPending() {
        for (op in db.outbox().allPending()) LocalWrites.applyLocally(db, LocalWrites.decode(op.payload))
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
                dao.upsertReadings(page.readings.map { it.toEntity() })
                dao.upsertWishes(page.wishes.map { it.toEntity() })
                dao.upsertQuotes(page.quotes.map { it.toEntity() })
                val gone = page.deleted.groupBy({ it.entity }, { it.id })
                gone["work"]?.let { dao.deleteWorks(it) }
                gone["edition"]?.let { dao.deleteEditions(it) }
                gone["copy"]?.let { dao.deleteCopies(it) }
                gone["location"]?.let { dao.deleteLocations(it) }
                gone["reading"]?.let { dao.deleteReadings(it) }
                gone["wish"]?.let { dao.deleteWishes(it) }
                gone["quote"]?.let { dao.deleteQuotes(it) }
                dao.setState(start.copy(cursor = page.cursor))
                val changed = page.works.size + page.editions.size + page.copies.size + page.locations.size + page.readings.size + page.wishes.size + page.quotes.size
                if (changed + page.deleted.size > 0) {
                    reapplyPending()
                    rebuildSearchIndex()
                }
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

    private suspend fun rebuildSearchIndex() = rebuildSearchIndex(db)

    /** Forgets the local copy (used when disconnecting this phone). */
    suspend fun clearLocal() {
        mutex.withLock {
            db.withTransaction {
                dao.clearWorks()
                dao.clearEditions()
                dao.clearCopies()
                dao.clearLocations()
                dao.clearReadings()
                dao.clearWishes()
                dao.clearQuotes()
                dao.clearFts()
                dao.clearState()
                db.outbox().clear()
                db.outbox().clearUploads()
            }
            covers.clear()
            _status.value = SyncStatus.Idle
        }
    }

    companion object {
        val RESYNC_CODES = setOf("epoch-mismatch", "cursor-ahead")
    }
}

/** Rebuilt as a whole: a renamed location or work changes the text of many editions at once. */
suspend fun rebuildSearchIndex(db: AppDatabase) {
    val dao = db.sync()
    val locations = dao.allLocations().associateBy { it.id }
    val placesByEdition = dao.activePlacements().groupBy({ it.editionId }, { it.locationId })
    val rows =
        dao.searchSources().map { src ->
            val places = placesByEdition[src.editionId].orEmpty().filterNotNull().flatMap { pathOf(locations, it) }
            BookFts(editionId = src.editionId, body = fold(src.text + " " + places.joinToString(" ")))
        }
    dao.clearFts()
    dao.insertFts(rows)
}

/** Only the given editions: what a local change needs (a full rebuild costs ~0.5 s with 10,000 books). */
suspend fun reindexEditions(db: AppDatabase, editionIds: Collection<String>) {
    if (editionIds.isEmpty()) return
    val dao = db.sync()
    val ids = editionIds.distinct()
    val locations = dao.allLocations().associateBy { it.id }
    val placesByEdition = dao.activePlacementsOf(ids).groupBy({ it.editionId }, { it.locationId })
    val rows =
        dao.searchSourcesOf(ids).map { src ->
            val places = placesByEdition[src.editionId].orEmpty().filterNotNull().flatMap { pathOf(locations, it) }
            BookFts(editionId = src.editionId, body = fold(src.text + " " + places.joinToString(" ")))
        }
    dao.deleteFts(ids)
    dao.insertFts(rows)
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

private fun SyncReading.toEntity() =
    ReadingEntity(id, version, copyId, status, startedOn, finishedOn, rating, notes, createdAt, updatedAt)

private fun SyncWish.toEntity() =
    WishEntity(id, version, title, authors, isbn13, workId, priority, notes, status, acquiredCopyId, createdAt, updatedAt, coverAssetId)

private fun SyncQuote.toEntity() = QuoteEntity(id, version, workId, copyId, text, page, note, createdAt, updatedAt)

private fun SyncLocation.toEntity() =
    LocationEntity(id, version, parentId, name, kind, sortOrder, createdAt, updatedAt)
