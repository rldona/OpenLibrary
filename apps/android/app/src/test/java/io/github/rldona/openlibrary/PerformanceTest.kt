package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.data.computeStats
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiJson
import io.github.rldona.openlibrary.network.SyncSnapshot
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.LocalWrites
import io.github.rldona.openlibrary.sync.SyncRepository
import io.github.rldona.openlibrary.sync.SyncStatus
import java.io.File
import kotlin.time.measureTimedValue
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * F5 performance: a 10,000-copy library on the phone. Robolectric runs SQLite on the JVM, so the limits are
 * generous; they catch accidental O(n²) work, and the timings are printed to compare runs.
 */
@RunWith(AndroidJUnit4::class)
class PerformanceTest {
    private val n = 10_000
    private val words = listOf("niebla", "sombra", "viento", "mar", "ciudad", "noche", "jardín", "río", "tiempo", "casa")
    private val authors = listOf("Unamuno", "Galdós", "Pardo Bazán", "Baroja", "Machado", "Clarín", "Valle-Inclán", "Azorín")

    private fun library(): SyncSnapshot {
        val rooms = (0 until 20).map { location("l$it", "Balda $it", parentId = if (it == 0) null else "l0") }
        val works = (0 until n).map { i -> work("w$i", "${words[i % 10]} ${words[(i / 10) % 10]} $i", listOf(authors[i % authors.size])) }
        val editions = (0 until n).map { i -> edition("e$i", "w$i") }
        val copies = (0 until n).map { i -> copy("c$i", "e$i", "l${i % 20}") }
        return SyncSnapshot("epoch-1", 1, T, works, editions, copies, rooms, emptyList(), emptyList(), emptyList())
    }

    @Test
    fun tenThousandCopies() = runBlocking {
        val server = MockWebServer().apply { start() }
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java).allowMainThreadQueries().build()
        try {
            server.enqueue(
                MockResponse.Builder().code(200).addHeader("content-type", "application/json")
                    .body(ApiJson.encodeToString(SyncSnapshot.serializer(), library())).build(),
            )
            val repo = SyncRepository(
                db,
                MemorySessions(DeviceSession(server.url("/").toString(), "d", "Pixel", "t")),
                CoverStore(File(ctx.cacheDir, "perf").apply { deleteRecursively() }),
                apiFor = { u, t -> ApiClient(u, t) },
            )
            val (status, firstSync) = measureTimedValue { repo.sync() }
            assertEquals(SyncStatus.Idle, status)

            val lib = { q: String -> db.catalog().library(ftsQuery(q), true, emptyList()) }
            val (all, list) = measureTimedValue { lib("").first() }
            assertEquals(n, all.size)
            val (hits, search) = measureTimedValue { lib("niebla galdos").first() }
            assertTrue(hits.isNotEmpty())
            val (_, byIsbn) = measureTimedValue { repeat(100) { db.catalog().byIsbn("9788437604947") } }
            val (_, stats) = measureTimedValue { computeStats(db) }
            // Every local change (one per scanned book in bulk entry) rebuilds the search index.
            val writes = LocalWrites(db)
            val w = db.catalog().workById("w1")!!
            val (_, oneEdit) = measureTimedValue { writes.editWork(w, buildJsonObject { put("title", "Otro título") }) }

            // Only that book was reindexed, and search sees the change.
            assertEquals(listOf("e1"), lib("otro titulo").first().map { it.editionId })
            assertEquals(n, lib("").first().size)

            println(
                "PERF 10k copies: first sync $firstSync, list $list, search $search, 100 ISBN checks $byIsbn, " +
                    "stats $stats, one local edit $oneEdit",
            )
            assertTrue("first sync $firstSync", firstSync.inWholeSeconds < 60)
            assertTrue("search $search", search.inWholeMilliseconds < 2_000)
            assertTrue("one local edit $oneEdit", oneEdit.inWholeMilliseconds < 300)
        } finally {
            db.close()
            server.close()
        }
    }
}
