package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.network.LookupResult
import io.github.rldona.openlibrary.network.MetadataProposal
import io.github.rldona.openlibrary.network.Op
import io.github.rldona.openlibrary.sync.BulkItem
import io.github.rldona.openlibrary.sync.BulkScan
import io.github.rldona.openlibrary.sync.LocalWrites
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** F5 bulk entry: every scanned ISBN becomes a book, with or without a connection, never twice. */
@RunWith(AndroidJUnit4::class)
class BulkScanTest {
    private lateinit var db: AppDatabase
    private lateinit var writes: LocalWrites
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val known = "9788437604947"
    private val unknown = "9780306406157"
    private val offline = "9788497592208"

    private fun lookup(isbn: String): LookupResult? =
        when (isbn) {
            known -> LookupResult(
                known, null, true, listOf("Open Library"),
                MetadataProposal("Niebla", null, listOf("Miguel de Unamuno"), "Cátedra", 1914, "es", 300, emptyList(), null, null),
                null, emptyList(),
            )
            offline -> throw IOException("no connection")
            else -> LookupResult(isbn, null, false, emptyList(), null, null, emptyList())
        }

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java).allowMainThreadQueries().build()
        writes = LocalWrites(db)
    }

    @After
    fun tearDown() = db.close()

    private fun scan() = BulkScan(db, writes, scope, lookup = { lookup(it) }, fetchCover = { null })

    private suspend fun settled(s: BulkScan, n: Int) =
        withTimeout(5_000) { s.items.first { l -> l.size == n && l.none { it.state == BulkItem.State.LookingUp } } }

    @Test
    fun foundUnknownAndOfflineBooksAreAllSavedInTheLocation() = runBlocking {
        val s = scan()
        listOf(known, unknown, offline).forEach { s.add(it, "loc-1") }
        val items = settled(s, 3).associateBy { it.isbn13 }
        assertEquals(BulkItem.State.Added, items[known]!!.state)
        assertEquals("Niebla", items[known]!!.title)
        assertEquals(BulkItem.State.AddedProvisional, items[unknown]!!.state)
        assertEquals(BulkItem.State.AddedProvisional, items[offline]!!.state)
        assertEquals(BulkScan.provisionalTitle(offline), items[offline]!!.title)

        val ops = db.outbox().allPending().map { LocalWrites.decode(it.payload) }.filterIsInstance<Op.BookCreate>()
        assertEquals(3, ops.size)
        assertTrue(ops.all { it.book.copy.locationId == "loc-1" })
        val niebla = ops.first { it.book.edition.isbn13 == known }.book
        assertEquals("complete", niebla.edition.metadataStatus)
        assertEquals(listOf("Miguel de Unamuno"), niebla.work!!.authors)
        assertEquals("provisional", ops.first { it.book.edition.isbn13 == offline }.book.edition.metadataStatus)
        // Shown in the library right away (offline), the provisional ones counted for "to complete".
        assertEquals(3, db.catalog().library("", true, emptyList()).first().size)
    }

    @Test
    fun theSameBookIsNeverAddedTwice() = runBlocking {
        val s = scan()
        assertTrue(s.add(known, null))
        assertFalse(s.add(known, null))
        settled(s, 1)
        // A new session (screen opened again) finds it in the library.
        val again = scan()
        again.add(known, null)
        assertEquals(BulkItem.State.Owned, settled(again, 1).single().state)
        assertEquals(1, db.outbox().allPending().size)

        // "Add another copy" on purpose.
        again.addCopy(again.items.value.single(), null)
        withTimeout(5_000) { again.items.first { it.single().state == BulkItem.State.Added } }
        assertTrue(LocalWrites.decode(db.outbox().allPending().last().payload) is Op.CopyCreate)
    }
}
