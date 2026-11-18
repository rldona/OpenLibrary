package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.roomOf
import io.github.rldona.openlibrary.core.roomShelves
import io.github.rldona.openlibrary.data.LocationEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShelvesTest {
    private fun loc(id: String, parent: String?, name: String = id, order: Int = 0) =
        LocationEntity(id, 1, parent, name, "other", order, "", "")

    private val home = listOf(
        loc("bed", null, "Bedroom", order = 1),
        loc("right", "bed", "Right shelves"),
        loc("r1", "right", "Shelf 1"),
        loc("r2", "right", "Shelf 2"),
        loc("box", "r2", "Box"),
        loc("desk", "bed", "Desk"),
        loc("living", null, "Living room", order = 2),
    )

    @Test
    fun roomsHoldTheirFurnitureAndShelves() {
        val rooms = roomShelves(home)
        assertEquals(listOf("Bedroom", "Living room"), rooms.map { it.room.name })
        val bedroom = rooms[0]
        // The desk has nothing inside: a loose place of the room, listed first.
        assertEquals(listOf(null, "Right shelves"), bedroom.groups.map { it.furniture?.name })
        assertEquals(listOf("Desk"), bedroom.groups[0].places.map { it.label })
        assertEquals(listOf("Shelf 1", "Shelf 2", "Shelf 2 › Box"), bedroom.groups[1].places.map { it.label })
    }

    @Test
    fun anEmptyRoomIsItsOwnPlace() {
        val living = roomShelves(home)[1]
        assertEquals(listOf("living"), living.places.map { it.location.id })
    }

    @Test
    fun findsTheRoomOfAPlace() {
        val rooms = roomShelves(home)
        assertEquals("bed", roomOf(rooms, "box")?.room?.id)
        assertEquals("living", roomOf(rooms, "living")?.room?.id)
        assertNull(roomOf(rooms, "nowhere"))
        assertNull(roomOf(rooms, null))
    }

    @Test
    fun theRoomsOfAHomeAreItsChildren() {
        val house = listOf(
            LocationEntity("home", 1, null, "Home", "home", 0, "", ""),
            loc("study", "home", "Study"),
            loc("ikea", "study", "Bookcase"),
            loc("low", "ikea", "Bottom shelf"),
        )
        val rooms = roomShelves(house)
        assertEquals(listOf("Study"), rooms.map { it.room.name })
        assertEquals(listOf("Bookcase"), rooms[0].groups.map { it.furniture?.name })
        assertEquals("study", roomOf(rooms, "low")?.room?.id)
    }

    @Test
    fun anOrphanIsATopLevelRoomAndACycleEnds() {
        val rooms = roomShelves(listOf(loc("a", "missing", "A"), loc("x", "y"), loc("y", "x")))
        assertEquals(listOf("A"), rooms.map { it.room.name })
    }
}
