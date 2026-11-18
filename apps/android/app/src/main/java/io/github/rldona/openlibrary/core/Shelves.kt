package io.github.rldona.openlibrary.core

import io.github.rldona.openlibrary.data.LocationEntity

/**
 * The places a book can go, as the location sheet and the locations screen show them: one room per
 * top-level location, each piece of furniture inside it with its shelves as buttons.
 *
 * - A child of the room with children of its own is a piece of furniture: its group lists every place
 *   below it (a box on a shelf reads "Shelf 2 › Box").
 * - A child of the room without children is a place on its own: it goes to the room's loose group
 *   ([ShelfGroup.furniture] null).
 * - A room without children is itself the only place in it.
 *
 * A top-level home (kind "home") is not a room: the rooms are its children.
 */
data class RoomShelves(val room: LocationEntity, val groups: List<ShelfGroup>) {
    val places: List<Place> get() = groups.flatMap { it.places }
}

data class ShelfGroup(val furniture: LocationEntity?, val places: List<Place>)

/** A place to put a book; [label] is its name, or its path below the furniture when deeper. */
data class Place(val location: LocationEntity, val label: String)

private val order = compareBy<LocationEntity>({ it.sortOrder }, { fold(it.name) })

fun roomShelves(locations: List<LocationEntity>): List<RoomShelves> {
    val ids = locations.mapTo(HashSet()) { it.id }
    val children = locations.groupBy { it.parentId?.takeIf(ids::contains) }
    fun kids(id: String?) = children[id].orEmpty().sortedWith(order)

    /** Every place below [parent], depth first, labelled by its path below it. */
    fun below(parent: LocationEntity, prefix: List<String>, seen: Set<String>): List<Place> =
        kids(parent.id).filter { it.id !in seen }.flatMap { child ->
            val path = prefix + child.name
            listOf(Place(child, path.joinToString(" › "))) + below(child, path, seen + child.id)
        }

    val rooms = kids(null).flatMap { top -> if (top.kind == "home" && kids(top.id).isNotEmpty()) kids(top.id) else listOf(top) }
    return rooms.map { room ->
        val inside = kids(room.id)
        if (inside.isEmpty()) {
            RoomShelves(room, listOf(ShelfGroup(null, listOf(Place(room, room.name)))))
        } else {
            val (furniture, loose) = inside.partition { children[it.id].orEmpty().isNotEmpty() }
            val groups = buildList {
                if (loose.isNotEmpty()) add(ShelfGroup(null, loose.map { Place(it, it.name) }))
                furniture.forEach { add(ShelfGroup(it, below(it, emptyList(), setOf(room.id, it.id)))) }
            }
            RoomShelves(room, groups)
        }
    }
}

/** The room that holds [locationId] (itself when it is a room), or null if it is not a place of [rooms]. */
fun roomOf(rooms: List<RoomShelves>, locationId: String?): RoomShelves? =
    locationId?.let { id -> rooms.firstOrNull { r -> r.room.id == id || r.places.any { it.location.id == id } } }
