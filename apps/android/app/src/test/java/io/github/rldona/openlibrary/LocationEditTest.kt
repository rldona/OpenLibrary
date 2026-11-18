package io.github.rldona.openlibrary

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.core.deletionOrder
import io.github.rldona.openlibrary.core.uuidv7
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.network.NewBook
import io.github.rldona.openlibrary.network.NewCopy
import io.github.rldona.openlibrary.network.NewEdition
import io.github.rldona.openlibrary.network.NewWork
import io.github.rldona.openlibrary.network.Op
import io.github.rldona.openlibrary.sync.LocalWrites
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Editing locations and deleting one with everything inside it, books included. */
@RunWith(AndroidJUnit4::class)
class LocationEditTest {
    private lateinit var db: AppDatabase
    private lateinit var writes: LocalWrites

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, AppDatabase::class.java).allowMainThreadQueries().build()
        writes = LocalWrites(db)
    }

    @After
    fun tearDown() = db.close()

    private suspend fun ops() = db.outbox().allPending().map { LocalWrites.decode(it.payload) }

    private suspend fun bookOn(locationId: String): String {
        val copyId = uuidv7()
        writes.addBook(
            NewBook(
                work = NewWork(uuidv7(), "Niebla", null, emptyList()),
                edition = NewEdition(id = uuidv7()),
                copy = NewCopy(copyId, locationId = locationId),
            ),
        )
        return copyId
    }

    @Test
    fun aPlaceIsRenamedAndMovedWithOnlyWhatChanged() = runBlocking {
        val room = writes.createLocation(null, "Salón", "room")
        val other = writes.createLocation(null, "Cuarto", "room")
        val shelf = writes.createLocation(room, "Balda 1", "shelf")
        val before = db.catalog().locationById(shelf)!!
        writes.editLocation(before, JsonObject(mapOf("name" to JsonPrimitive("Balda alta"), "parentId" to JsonPrimitive(other))))
        val after = db.catalog().locationById(shelf)!!
        assertEquals("Balda alta", after.name)
        assertEquals(other, after.parentId)
        val update = ops().filterIsInstance<Op.LocationUpdate>().single()
        assertEquals(setOf("name", "parentId"), update.patch.fields.keys)
    }

    @Test
    fun deletingAPieceOfFurnitureMovesItsBooksFirstThenDeletesFromTheInsideOut() = runBlocking {
        val room = writes.createLocation(null, "Salón", "room")
        val bookcase = writes.createLocation(room, "Estantería", "bookcase")
        val s1 = writes.createLocation(bookcase, "Balda 1", "shelf")
        val s2 = writes.createLocation(bookcase, "Balda 2", "shelf")
        val elsewhere = writes.createLocation(room, "Mesilla", "other")
        val c1 = bookOn(s1)
        val c2 = bookOn(s2)
        val all = db.catalog().locations().first()
        val places = deletionOrder(all, bookcase)
        assertEquals(bookcase, places.last().id)
        assertEquals(setOf(s1, s2), places.dropLast(1).map { it.id }.toSet())
        val copies = db.catalog().activeCopiesIn(places.map { it.id })
        assertEquals(setOf(c1, c2), copies.map { it.id }.toSet())
        val before = ops().size

        writes.deleteLocations(places, copies, elsewhere)

        val sent = ops().drop(before)
        // The copies are moved before any place goes, and the bookcase after its shelves.
        assertTrue(sent.take(2).all { it is Op.CopyUpdate })
        assertEquals(setOf(s1, s2), sent.drop(2).take(2).map { (it as Op.LocationDelete).id }.toSet())
        assertEquals(bookcase, (sent.last() as Op.LocationDelete).id)
        assertTrue(sent.filterIsInstance<Op.CopyUpdate>().all { it.patch.fields["locationId"] == JsonPrimitive(elsewhere) })
        assertEquals(listOf(room, elsewhere).toSet(), db.catalog().locations().first().map { it.id }.toSet())
    }

    @Test
    fun booksCanBeLeftUnplaced() = runBlocking {
        val room = writes.createLocation(null, "Salón", "room")
        val copy = bookOn(room)
        val places = deletionOrder(db.catalog().locations().first(), room)
        writes.deleteLocations(places, db.catalog().activeCopiesIn(listOf(room)), null)
        val move = ops().filterIsInstance<Op.CopyUpdate>().single { it.id == copy }
        assertEquals(JsonNull, move.patch.fields["locationId"])
        assertEquals(1, db.catalog().unplacedCopies().first().size)
    }
}
