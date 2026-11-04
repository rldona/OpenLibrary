package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.DeviceSession
import io.github.rldona.openlibrary.data.Stats
import io.github.rldona.openlibrary.data.computeStats
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.sync.SyncRepository
import io.github.rldona.openlibrary.sync.SyncStatus
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The phone's statistics (computed on its local copy) must equal the server's on the same data. Each pair of
 * fixtures is a snapshot and GET /stats for it, both produced by the server tests.
 */
@RunWith(AndroidJUnit4::class)
class StatsParityTest {
    private val strict = Json { ignoreUnknownKeys = false }
    private fun fixture(name: String) = File("../../../packages/contracts/fixtures/$name").readText()

    private fun localStats(snapshot: String): Stats = runBlocking {
        val server = MockWebServer().apply { start() }
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java).allowMainThreadQueries().build()
        try {
            server.enqueue(MockResponse.Builder().code(200).addHeader("content-type", "application/json").body(snapshot).build())
            val repo = SyncRepository(
                db,
                MemorySessions(DeviceSession(server.url("/").toString(), "d", "Pixel", "t")),
                CoverStore(File(ctx.cacheDir, "parity").apply { deleteRecursively() }),
                apiFor = { u, t -> ApiClient(u, t) },
            )
            assertEquals(SyncStatus.Idle, repo.sync())
            computeStats(db)
        } finally {
            db.close()
            server.close()
        }
    }

    @Test
    fun richLibraryMatchesTheServer() {
        assertEquals(strict.decodeFromString<Stats>(fixture("stats-library.json")), localStats(fixture("stats-library-snapshot.json")))
    }

    @Test
    fun contractFixtureMatchesTheServer() {
        assertEquals(strict.decodeFromString<Stats>(fixture("stats.json")), localStats(fixture("snapshot.json")))
    }
}
