package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.core.sha256Hex
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiJson
import io.github.rldona.openlibrary.network.NewBook
import io.github.rldona.openlibrary.network.NewCopy
import io.github.rldona.openlibrary.network.NewEdition
import io.github.rldona.openlibrary.network.NewLocation
import io.github.rldona.openlibrary.network.NewWork
import io.github.rldona.openlibrary.network.Op
import io.github.rldona.openlibrary.network.OpJson
import io.github.rldona.openlibrary.network.Patch
import io.github.rldona.openlibrary.network.SyncPullPage
import io.github.rldona.openlibrary.network.SyncSnapshot
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.LocalWrites
import io.github.rldona.openlibrary.sync.SyncRepository
import io.github.rldona.openlibrary.sync.SyncStatus
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** F3: changes made on the phone, the outbox and push. */
@RunWith(AndroidJUnit4::class)
class OfflineWritesTest {
    private lateinit var server: MockWebServer
    private lateinit var db: AppDatabase
    private lateinit var covers: CoverStore
    private lateinit var repo: SyncRepository
    private lateinit var writes: LocalWrites

    private val snapshot =
        SyncSnapshot(
            epoch = "epoch-1",
            cursor = 10,
            serverTime = T,
            works = listOf(work("w1", "Fortunata y Jacinta", listOf("Benito Pérez Galdós"))),
            editions = listOf(edition("e1", "w1")),
            copies = listOf(copy("c1", "e1", "l1")),
            locations = listOf(location("l1", "Casa")),
        )

    private fun json(text: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("content-type", "application/json").body(text).build()

    private fun json(s: SyncSnapshot) = json(ApiJson.encodeToString(SyncSnapshot.serializer(), s))

    private fun emptyPage(epoch: String = "epoch-1", cursor: Long = 10) =
        json(ApiJson.encodeToString(SyncPullPage.serializer(), SyncPullPage(epoch, cursor, false, T, emptyList(), emptyList(), emptyList(), emptyList(), emptyList())))

    /** The push response, echoing every op id of the request with the given status. */
    private fun pushed(vararg results: String) =
        json("""{"epoch":"epoch-1","serverTime":"$T","results":[${results.joinToString(",")}]}""")

    private fun RecordedRequest.json() = ApiJson.parseToJsonElement(body!!.utf8()).jsonObject

    private fun RecordedRequest.opIds() = json()["ops"]!!.jsonArray.map { it.jsonObject["opId"]!!.jsonPrimitive.content }

    @Before
    fun setUp(): Unit = runBlocking {
        server = MockWebServer()
        server.start()
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java).allowMainThreadQueries().build()
        covers = CoverStore(File(ctx.cacheDir, "covers-f3").apply { deleteRecursively() })
        val sessions = MemorySessions(DeviceSession(server.url("/").toString(), "dev-1", "Pixel", "secret-token"))
        repo = SyncRepository(db, sessions, covers, apiFor = { u, t -> ApiClient(u, t) }, now = { 1_000L })
        writes = LocalWrites(db)
        server.enqueue(json(snapshot))
        assertEquals(SyncStatus.Idle, repo.sync())
        server.takeRequest()
        Unit
    }

    @After
    fun tearDown() {
        db.close()
        server.close()
    }

    private suspend fun copyC1() = db.catalog().copyById("c1")!!

    @Test
    fun anOfflineEditIsVisibleAtOnceAndPushedOnSync() = runBlocking {
        writes.editCopy(copyC1(), buildJsonObject { put("notes", "En la mesilla") })
        assertEquals("En la mesilla", copyC1().notes)
        val op = db.outbox().allPending().single()

        server.enqueue(pushed("""{"opId":"${op.opId}","status":"applied"}"""))
        server.enqueue(emptyPage(cursor = 11))
        assertEquals(SyncStatus.Idle, repo.sync())

        val push = server.takeRequest()
        assertEquals("/api/v1/sync/push", push.url.encodedPath)
        val sent = push.json()["ops"]!!.jsonArray.single().jsonObject
        assertEquals("copy.update", sent["type"]!!.jsonPrimitive.content)
        assertEquals(1, sent["patch"]!!.jsonObject["baseVersion"]!!.jsonPrimitive.content.toInt())
        assertEquals("/api/v1/sync/pull", server.takeRequest().url.encodedPath)
        assertTrue(db.outbox().allPending().isEmpty())
    }

    @Test
    fun aLostResponseIsResentWithTheSameOpId() = runBlocking {
        writes.retireCopy(copyC1(), "gifted")
        assertEquals("retired", copyC1().status)
        val opId = db.outbox().allPending().single().opId

        // The server got the batch but the answer never arrived.
        server.enqueue(MockResponse.Builder().onResponseStart(mockwebserver3.SocketEffect.ShutdownConnection).build())
        assertEquals(SyncStatus.Offline, repo.sync())
        assertEquals(listOf(opId), server.takeRequest().opIds())
        assertEquals(1, db.outbox().allPending().size)

        server.enqueue(pushed("""{"opId":"$opId","status":"duplicate"}"""))
        server.enqueue(emptyPage())
        assertEquals(SyncStatus.Idle, repo.sync())
        assertEquals(listOf(opId), server.takeRequest().opIds())
        assertTrue(db.outbox().allPending().isEmpty())
    }

    @Test
    fun pendingChangesSurviveARestoreAndAreAppliedOnTop() = runBlocking {
        writes.editCopy(copyC1(), buildJsonObject { put("notes", "Dedicado") })
        val opId = db.outbox().allPending().single().opId
        server.enqueue(json("""{"type":"x","title":"Conflict","status":409,"code":"epoch-mismatch"}""", 409))
        server.enqueue(json(snapshot.copy(epoch = "epoch-2", cursor = 3)))
        server.enqueue(pushed("""{"opId":"$opId","status":"applied"}"""))
        server.enqueue(emptyPage("epoch-2", 4))
        assertEquals(SyncStatus.Idle, repo.sync())

        assertEquals("/api/v1/sync/push", server.takeRequest().url.encodedPath)
        assertEquals("/api/v1/sync/snapshot", server.takeRequest().url.encodedPath)
        val retry = server.takeRequest()
        assertEquals("epoch-2", retry.json()["epoch"]!!.jsonPrimitive.content)
        assertEquals(listOf(opId), retry.opIds())
        // The restored snapshot had no notes; the pending change was applied again on top.
        assertEquals("Dedicado", copyC1().notes)
    }

    @Test
    fun aConflictIsKeptForReviewAndKeepMineResendsOnTheServerVersion() = runBlocking {
        writes.editCopy(copyC1(), buildJsonObject { put("notes", "Mine") })
        val opId = db.outbox().allPending().single().opId
        server.enqueue(
            pushed(
                """{"opId":"$opId","status":"conflict","code":"conflict","message":"Otro dispositivo…","currentVersion":2,""" +
                    """"conflicts":[{"field":"notes","current":"Prestado","yours":"Mine"}]}""",
            ),
        )
        val serverCopy = copy("c1", "e1", "l1").copy(version = 2, notes = "Prestado")
        server.enqueue(json(snapshot.copy(copies = listOf(serverCopy))))
        assertEquals(SyncStatus.Idle, repo.sync())

        // The phone shows the server's value again and keeps the conflict for the user.
        assertEquals("Prestado", copyC1().notes)
        val problem = db.outbox().problems().first().single()
        assertEquals("conflict", problem.status)
        assertEquals("Prestado", LocalWrites.conflictsOf(problem).single().current.jsonPrimitive.content)
        assertEquals(1, db.outbox().problemCount().first())

        writes.keepMine(problem)
        assertEquals("Mine", copyC1().notes)
        val resend = LocalWrites.decode(db.outbox().allPending().single().payload) as Op.CopyUpdate
        assertEquals(2, resend.patch.baseVersion)
        assertEquals(0, db.outbox().problemCount().first())
    }

    @Test
    fun aBookAddedOfflineIsSearchableAndItsPhotoIsUploadedFirst() = runBlocking {
        val photo = byteArrayOf(1, 2, 3, 4)
        val photoId = sha256Hex(photo)
        covers.put(photoId, photo)
        writes.addBook(
            NewBook(
                work = NewWork("w2", "Misericordia", authors = listOf("Benito Pérez Galdós")),
                edition = NewEdition("e2", isbn13 = "9788437604800", coverAssetId = photoId, metadataStatus = "provisional"),
                copy = NewCopy("c2", locationId = "l1"),
            ),
            coverPhoto = photoId,
        )
        val local = db.catalog().library(ftsQuery("misericordia"), true, emptyList()).first().single()
        assertEquals("e2", local.editionId)
        assertEquals("", db.catalog().copyById("c2")!!.code) // assigned by the server later
        val opId = db.outbox().allPending().single().opId

        server.enqueue(json("""{"id":"$photoId","mime":"image/jpeg","width":300,"height":450,"bytes":4}""", 201))
        server.enqueue(pushed("""{"opId":"$opId","status":"applied"}"""))
        server.enqueue(emptyPage())
        assertEquals(SyncStatus.Idle, repo.sync())

        val upload = server.takeRequest()
        assertEquals("/api/v1/assets", upload.url.encodedPath)
        assertEquals(sha256Hex(upload.body!!.toByteArray()), photoId)
        val book = server.takeRequest().json()["ops"]!!.jsonArray.single().jsonObject["book"]!!.jsonObject
        assertFalse("workId" in book) // absent, not null: the server's schema makes it optional
        assertEquals(photoId, book["edition"]!!.jsonObject["coverAssetId"]!!.jsonPrimitive.content)
        assertTrue(db.outbox().uploads().isEmpty())
    }

    @Test
    fun opsKeepTheShapeTheServerExpects() {
        val loc = OpJson.encodeToJsonElement(Op.serializer(), Op.LocationCreate("op1", NewLocation("l9", name = "Mesilla"))).jsonObject
        assertEquals("location.create", loc["type"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, loc["location"]!!.jsonObject["parentId"])
        val move = Op.CopyUpdate("op2", "c1", Patch(3, JsonObject(mapOf("locationId" to JsonNull))))
        val fields = OpJson.encodeToJsonElement(Op.serializer(), move).jsonObject["patch"]!!.jsonObject["fields"]!!.jsonObject
        assertEquals(JsonNull, fields["locationId"]) // "no location" is sent explicitly
        assertEquals(JsonPrimitive("op2"), OpJson.encodeToJsonElement(Op.serializer(), move).jsonObject["opId"])
    }
}
