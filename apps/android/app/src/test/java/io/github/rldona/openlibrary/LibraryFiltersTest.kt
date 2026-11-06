package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.EditionEntity
import io.github.rldona.openlibrary.data.LibraryRow
import io.github.rldona.openlibrary.data.LibrarySort
import io.github.rldona.openlibrary.data.ReadingEntity
import io.github.rldona.openlibrary.data.WorkEntity
import io.github.rldona.openlibrary.data.withRecent
import io.github.rldona.openlibrary.ui.library.shapeLibrary
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/** The library's filters, sort orders and recent searches. */
@RunWith(AndroidJUnit4::class)
class LibraryFiltersTest {
    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java)
        .allowMainThreadQueries()
        .build()

    @After
    fun tearDown() = db.close()

    private fun row(id: String, authors: List<String>, addedAt: String, provisional: Boolean = false) =
        LibraryRow(id, "w-$id", "Title $id", null, authors, null, null, null, if (provisional) "provisional" else "complete", 1, addedAt)

    @Test
    fun recentSearchesKeepTheNewestEightWithoutRepeats() {
        val eight = (1..8).map { "q$it" }
        assertEquals(listOf("galdós") + eight.take(7), withRecent(eight, " galdós "))
        assertEquals(listOf("Galdós", "q1"), withRecent(listOf("q1", "galdos"), "Galdós"))
        assertEquals(listOf("q1"), withRecent(listOf("q1"), "   "))
    }

    @Test
    fun rowsAreFilteredByReadingStatusAndSorted() {
        val rows = listOf(
            row("a", listOf("Zola"), "2026-01-03T00:00:00Z"),
            row("b", emptyList(), "2026-01-01T00:00:00Z", provisional = true),
            row("c", listOf("Álvarez"), "2026-01-02T00:00:00Z"),
        )
        val statuses = mapOf("w-a" to "read", "w-c" to "reading")
        assertEquals(listOf("a", "b", "c"), shapeLibrary(rows, statuses, null, false, LibrarySort.Title).map { it.editionId })
        // Accents do not count; books without an author go last.
        assertEquals(listOf("c", "a", "b"), shapeLibrary(rows, statuses, null, false, LibrarySort.Author).map { it.editionId })
        assertEquals(listOf("a", "c", "b"), shapeLibrary(rows, statuses, null, false, LibrarySort.Added).map { it.editionId })
        assertEquals(listOf("b"), shapeLibrary(rows, statuses, "pending", false, LibrarySort.Title).map { it.editionId })
        assertEquals(listOf("c"), shapeLibrary(rows, statuses, "reading", false, LibrarySort.Title).map { it.editionId })
        assertEquals(listOf("b"), shapeLibrary(rows, statuses, null, true, LibrarySort.Title).map { it.editionId })
        assertEquals(emptyList<String>(), shapeLibrary(rows, statuses, "read", true, LibrarySort.Title).map { it.editionId })
    }

    @Test
    fun readingStatusesFollowTheWorkRule(): Unit = runBlocking {
        val d = db.sync()
        d.upsertWorks(listOf("w1", "w2", "w3").map { WorkEntity(it, 1, it, null, emptyList(), emptyList(), null, null, null, null, null, T, T, it) })
        d.upsertEditions(
            listOf("w1", "w2", "w3").map {
                EditionEntity("e-$it", 1, it, null, null, null, null, null, null, null, null, null, "complete", null, "2026-0${it.last()}-01", T)
            },
        )
        d.upsertCopies(
            listOf("w1", "w2", "w3").map { CopyEntity("c-$it", 1, "e-$it", "", null, "good", null, null, "EUR", "", "active", null, null, T, T) },
        )
        fun reading(id: String, work: String, status: String) = ReadingEntity(id, 1, "c-$work", status, null, null, null, "", T, T)
        // w1: read once and reading again → reading; w2: read, then abandoned → read; w3: no readings → pending.
        d.upsertReadings(listOf(reading("r1", "w1", "read"), reading("r2", "w1", "reading"), reading("r3", "w2", "read"), reading("r4", "w2", "abandoned")))

        val statuses = db.catalog().readingStatuses().first().associate { it.workId to it.status }
        assertEquals(mapOf("w1" to "reading", "w2" to "read"), statuses)
        val added = db.catalog().library("", true, emptyList()).first().associate { it.editionId to it.addedAt }
        assertEquals("2026-03-01", added["e-w3"])
    }
}
