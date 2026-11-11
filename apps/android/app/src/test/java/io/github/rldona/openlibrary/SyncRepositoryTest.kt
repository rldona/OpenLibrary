package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.data.SessionStore
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiJson
import io.github.rldona.openlibrary.network.SyncCopy
import io.github.rldona.openlibrary.network.SyncEdition
import io.github.rldona.openlibrary.network.SyncLocation
import io.github.rldona.openlibrary.network.SyncPullPage
import io.github.rldona.openlibrary.network.SyncSnapshot
import io.github.rldona.openlibrary.network.SyncTombstone
import io.github.rldona.openlibrary.network.SyncWork
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.SyncRepository
import io.github.rldona.openlibrary.sync.SyncStatus
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var covers: CoverStore
    private lateinit var repo: SyncRepository

    private val snapshot =
        SyncSnapshot(
            epoch = "epoch-1",
            cursor = 10,
            serverTime = T,
            works = listOf(work("w1", "Fortunata y Jacinta", listOf("Benito Pérez Galdós")), work("w2", "Niebla", listOf("Unamuno"))),
            editions = listOf(edition("e1", "w1", COVER), edition("e2", "w2")),
            copies = listOf(copy("c1", "e1", "l2"), copy("c2", "e2", null, status = "retired")),
            locations = listOf(location("l1", "Casa"), location("l2", "Salón", parentId = "l1")),
            readings = emptyList(),
            wishes = emptyList(),
            quotes = emptyList(),
        )

    private fun json(body: Any, code: Int = 200): MockResponse {
        val text =
            when (body) {
                is SyncSnapshot -> ApiJson.encodeToString(SyncSnapshot.serializer(), body)
                is SyncPullPage -> ApiJson.encodeToString(SyncPullPage.serializer(), body)
                else -> body.toString()
            }
        return MockResponse.Builder().code(code).addHeader("content-type", "application/json").body(text).build()
    }

    private fun image() = MockResponse.Builder().code(200).body(Buffer().write(byteArrayOf(1, 2, 3))).build()

    private fun page(cursor: Long, hasMore: Boolean, works: List<SyncWork> = emptyList(), deleted: List<SyncTombstone> = emptyList()) =
        SyncPullPage("epoch-1", cursor, hasMore, T, works, emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), deleted)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java).allowMainThreadQueries().build()
        covers = CoverStore(File(ctx.cacheDir, "covers-test").apply { deleteRecursively() })
        val url = server.url("/").toString()
        val sessions = MemorySessions(DeviceSession(url, "dev-1", "Pixel", "secret-token"))
        repo = SyncRepository(db, sessions, covers, apiFor = { u, t -> ApiClient(u, t, language = { "es" }) }, now = { 1_000L })
    }

    @After
    fun tearDown() {
        db.close()
        server.close()
    }

    private suspend fun firstSync() {
        server.enqueue(json(snapshot))
        server.enqueue(image())
        assertEquals(SyncStatus.Idle, repo.sync())
    }

    @Test
    fun firstSyncDownloadsSnapshotAndCovers() = runBlocking {
        firstSync()
        val snap = server.takeRequest()
        assertEquals("/api/v1/sync/snapshot", snap.url.encodedPath)
        assertEquals("Bearer secret-token", snap.headers["Authorization"])
        assertEquals("es", snap.headers["Accept-Language"])
        assertEquals("/api/v1/assets/$COVER", server.takeRequest().url.encodedPath)

        val state = db.sync().state()!!
        assertEquals("epoch-1", state.epoch)
        assertEquals(10L, state.cursor)
        assertEquals(1_000L, state.lastSyncAt)
        assertTrue(covers.has(COVER))
        // Only editions with an active copy are in the library (the retired one is not).
        val rows = db.catalog().library("", true, emptyList()).first()
        assertEquals(listOf("Fortunata y Jacinta"), rows.map { it.title })
    }

    @Test
    fun somethingElseAnsweringAtTheAddressIsOfflineNotACrash() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).addHeader("content-type", "text/html").body("<!doctype html>").build())
        assertEquals(SyncStatus.Offline, repo.sync())
        assertNull(db.sync().state())
    }

    @Test
    fun searchIgnoresAccentsAndIncludesLocations() = runBlocking {
        firstSync()
        val search = suspend { q: String -> db.catalog().library(ftsQuery(q), true, emptyList()).first().map { it.editionId } }
        assertEquals(listOf("e1"), search("galdos"))
        assertEquals(listOf("e1"), search("PÉREZ fortu"))
        assertEquals(listOf("e1"), search("salon"))
        assertEquals(emptyList<String>(), search("niebla")) // retired copy only
    }

    @Test
    fun pullAppliesPagesAndTombstones() = runBlocking {
        firstSync()
        server.takeRequest(); server.takeRequest()
        server.enqueue(json(page(15, hasMore = true, works = listOf(work("w1", "Fortunata y Jacinta (2 tomos)", listOf("Galdós"), version = 2)))))
        server.enqueue(json(page(18, hasMore = false, deleted = listOf(SyncTombstone("copy", "c1", 2, T)))))
        assertEquals(SyncStatus.Idle, repo.sync())

        val first = server.takeRequest().url
        assertEquals("10", first.queryParameter("since"))
        assertEquals("epoch-1", first.queryParameter("epoch"))
        assertEquals("15", server.takeRequest().url.queryParameter("since"))
        assertEquals(18L, db.sync().state()!!.cursor)
        assertEquals("Fortunata y Jacinta (2 tomos)", db.catalog().work("w1").first()!!.title)
        // Its only active copy was deleted: the edition leaves the library.
        assertTrue(db.catalog().library("", true, emptyList()).first().isEmpty())
    }

    @Test
    fun restoredServerTriggersAFullResync() = runBlocking {
        firstSync()
        server.enqueue(json("""{"type":"x","title":"Conflict","status":409,"code":"epoch-mismatch","detail":"…"}""", 409))
        server.enqueue(json(snapshot.copy(epoch = "epoch-2", cursor = 3, works = snapshot.works.take(1), editions = snapshot.editions.take(1))))
        assertEquals(SyncStatus.Idle, repo.sync())
        val state = db.sync().state()!!
        assertEquals("epoch-2", state.epoch)
        assertEquals(3L, state.cursor)
        assertNull(db.catalog().work("w2").first())
    }

    @Test
    fun serverDownKeepsTheLocalCopy() = runBlocking {
        firstSync()
        server.close()
        assertEquals(SyncStatus.Offline, repo.sync())
        assertEquals(1, db.catalog().library("", true, emptyList()).first().size)
        assertEquals(10L, db.sync().state()!!.cursor)
    }

    @Test
    fun revokedDeviceIsReported() = runBlocking {
        server.enqueue(json("""{"type":"x","title":"Not authenticated","status":401,"code":"unauthorized"}""", 401))
        assertEquals(SyncStatus.Revoked, repo.sync())
        assertNull(db.sync().state())
    }

    @Test
    fun anAppThatSyncsNewKindsOfDataStartsWithASnapshot() = runBlocking {
        firstSync()
        server.takeRequest(); server.takeRequest()
        // A copy downloaded by an older app (before readings and wishes existed).
        db.sync().setState(db.sync().state()!!.copy(format = 1))
        server.enqueue(json(snapshot.copy(cursor = 12)))
        assertEquals(SyncStatus.Idle, repo.sync())
        assertEquals("/api/v1/sync/snapshot", server.takeRequest().url.encodedPath)
        val state = db.sync().state()!!
        assertEquals(12L, state.cursor)
        assertEquals(io.github.rldona.openlibrary.data.SYNC_FORMAT, state.format)
    }

    @Test
    fun clearLocalForgetsEverything() = runBlocking {
        firstSync()
        repo.clearLocal()
        assertNull(db.sync().state())
        assertFalse(covers.has(COVER))
        assertTrue(db.catalog().library("", true, emptyList()).first().isEmpty())
    }
}
