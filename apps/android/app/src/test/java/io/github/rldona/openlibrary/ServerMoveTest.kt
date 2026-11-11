package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiJson
import io.github.rldona.openlibrary.network.SyncPullPage
import io.github.rldona.openlibrary.network.SyncSnapshot
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.LocalWrites
import io.github.rldona.openlibrary.sync.MoveResult
import io.github.rldona.openlibrary.sync.ServerMove
import io.github.rldona.openlibrary.sync.SyncRepository
import io.github.rldona.openlibrary.sync.SyncStatus
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Settings → "Change server address": the same library at a new address keeps the phone's data. */
@RunWith(AndroidJUnit4::class)
class ServerMoveTest {
    private lateinit var old: MockWebServer
    private lateinit var new: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var sessions: MemorySessions
    private lateinit var repo: SyncRepository
    private lateinit var move: ServerMove
    private var syncs = 0

    private val snapshot =
        SyncSnapshot(
            epoch = "epoch-1",
            cursor = 10,
            serverTime = T,
            works = listOf(work("w1", "Fortunata y Jacinta", listOf("Benito Pérez Galdós"))),
            editions = listOf(edition("e1", "w1")),
            copies = listOf(copy("c1", "e1", "l1")),
            locations = listOf(location("l1", "Casa")),
            readings = emptyList(),
            wishes = emptyList(),
            quotes = emptyList(),
        )

    private fun json(text: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("content-type", "application/json").body(text).build()

    private fun health(epoch: String) = json("""{"status":"ok","version":"0.1.0","epoch":"$epoch","time":"$T"}""")

    private val me = json("""{"authenticated":true,"kind":"device","sessionId":"dev-1","expiresAt":null}""")

    private val unauthorized =
        json("""{"type":"about:blank","title":"Unauthorized","status":401,"code":"unauthorized","detail":"No"}""", 401)

    private fun emptyPage(cursor: Long) =
        json(ApiJson.encodeToString(SyncPullPage.serializer(), SyncPullPage("epoch-1", cursor, false, T, emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList())))

    private val oldUrl get() = old.url("/").toString().trimEnd('/')
    private val newUrl get() = new.url("/").toString().trimEnd('/')

    @Before
    fun setUp(): Unit = runBlocking {
        old = MockWebServer().apply { start() }
        new = MockWebServer().apply { start() }
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java).allowMainThreadQueries().build()
        val covers = CoverStore(File(ctx.cacheDir, "covers-move").apply { deleteRecursively() })
        sessions = MemorySessions(DeviceSession(oldUrl, "dev-1", "Pixel", "secret-token"))
        repo = SyncRepository(db, sessions, covers, apiFor = { u, t -> ApiClient(u, t) }, now = { 1_000L })
        move = ServerMove(sessions, { db.sync().state()?.epoch }, { u, t -> ApiClient(u, t) }, { syncs++; repo.sync() })
        old.enqueue(json(ApiJson.encodeToString(SyncSnapshot.serializer(), snapshot)))
        assertEquals(SyncStatus.Idle, repo.sync())
        old.takeRequest()
        // A change made offline, still waiting in the outbox.
        LocalWrites(db).editCopy(db.catalog().copyById("c1")!!, buildJsonObject { put("notes", "En la mesilla") })
        assertEquals(1, db.outbox().allPending().size)
    }

    @After
    fun tearDown() {
        db.close()
        old.close()
        runCatching { new.close() }
    }

    @Test
    fun sameLibraryAndValidTokenMovesAndKeepsEverything() = runBlocking {
        val op = db.outbox().allPending().single()
        new.enqueue(health("epoch-1"))
        new.enqueue(me)
        new.enqueue(json("""{"epoch":"epoch-1","serverTime":"$T","results":[{"opId":"${op.opId}","status":"applied"}]}"""))
        new.enqueue(emptyPage(11))

        assertEquals(MoveResult.Moved, move.moveTo("$newUrl/api/v1/"))

        val s = sessions.current()!!
        assertEquals(newUrl, s.serverUrl)
        assertEquals("dev-1", s.deviceId)
        assertEquals("secret-token", s.token)
        assertEquals("/api/v1/health", new.takeRequest().url.encodedPath)
        val check = new.takeRequest()
        assertEquals("/api/v1/auth/me", check.url.encodedPath)
        assertEquals("Bearer secret-token", check.headers["Authorization"])
        // The sync runs against the new address and pushes the pending change: nothing was lost.
        assertEquals(1, syncs)
        val push = new.takeRequest()
        assertEquals("/api/v1/sync/push", push.url.encodedPath)
        val sent = ApiJson.parseToJsonElement(push.body!!.utf8()).jsonObject["ops"]!!.jsonArray.single().jsonObject
        assertEquals(op.opId, sent["opId"]!!.jsonPrimitive.content)
        assertEquals("epoch-1", db.sync().state()!!.epoch)
        assertEquals("En la mesilla", db.catalog().copyById("c1")!!.notes)
        // The old address is not contacted at all.
        assertNull(old.takeRequest(100, TimeUnit.MILLISECONDS))
    }

    @Test
    fun anotherLibraryChangesNothing() = runBlocking {
        new.enqueue(health("epoch-2"))
        assertEquals(MoveResult.DifferentLibrary, move.moveTo(newUrl))
        assertUnchanged()
        assertEquals(1, new.requestCount)
    }

    @Test
    fun aTokenTheServerDoesNotKnowChangesNothing() = runBlocking {
        new.enqueue(health("epoch-1"))
        new.enqueue(unauthorized)
        assertEquals(MoveResult.NotRecognised, move.moveTo(newUrl))
        assertUnchanged()
    }

    @Test
    fun anUnreachableAddressChangesNothing() = runBlocking {
        val url = newUrl
        new.close()
        assertEquals(MoveResult.Unreachable, move.moveTo(url))
        assertUnchanged()
    }

    @Test
    fun somethingThatIsNotOpenLibraryChangesNothing() = runBlocking {
        new.enqueue(MockResponse.Builder().code(200).addHeader("content-type", "text/html").body("<html></html>").build())
        assertEquals(MoveResult.Unreachable, move.moveTo(newUrl))
        assertUnchanged()
    }

    @Test
    fun anInvalidAddressChangesNothing() = runBlocking {
        assertEquals(MoveResult.InvalidAddress, move.moveTo("  "))
        assertEquals(MoveResult.InvalidAddress, move.moveTo("https://exa mple.com"))
        assertUnchanged()
    }

    private suspend fun assertUnchanged() {
        assertEquals(oldUrl, sessions.current()!!.serverUrl)
        assertEquals(1, db.outbox().allPending().size)
        assertEquals("epoch-1", db.sync().state()!!.epoch)
        assertEquals(0, syncs)
    }
}
