package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.fold
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.network.normalizeServerUrl
import io.github.rldona.openlibrary.sync.pathOf
import io.github.rldona.openlibrary.ui.library.subtree
import io.github.rldona.openlibrary.ui.locations.flattenTree
import org.junit.Assert.assertEquals
import org.junit.Test

class LogicTest {
    private fun loc(id: String, parent: String?, name: String = id) = LocationEntity(id, 1, parent, name, "other", 0, "", "")
    private val tree = listOf(loc("casa", null, "Casa"), loc("salon", "casa", "Salón"), loc("balda", "salon", "Balda 3"), loc("despacho", "casa", "Despacho"))

    @Test
    fun foldingAndFtsQueries() {
        assertEquals("benito perez galdos", fold("Benito Pérez Galdós"))
        assertEquals("gal* per*", ftsQuery("  Gal, PÉR "))
        assertEquals("", ftsQuery(" - "))
    }

    @Test
    fun placeholdersLikeTheTypeScriptSide() {
        assertEquals("3 copies", format("{n} copies", "n" to 3))
        assertEquals("{missing} stays", format("{missing} stays"))
    }

    @Test
    fun locationPathsSubtreesAndCumulativeCounts() {
        val byId = tree.associateBy { it.id }
        assertEquals(listOf("Casa", "Salón", "Balda 3"), pathOf(byId, "balda"))
        assertEquals(setOf("salon", "balda"), subtree(tree, "salon").toSet())
        val nodes = flattenTree(tree, mapOf("balda" to 2, "despacho" to 1, null to 5))
        assertEquals(listOf("casa" to 0, "despacho" to 1, "salon" to 1, "balda" to 2), nodes.map { it.location.id to it.depth })
        assertEquals(3, nodes.first { it.location.id == "casa" }.total)
        assertEquals(2, nodes.first { it.location.id == "salon" }.total)
    }

    @Test
    fun serverAddressesAreNormalised() {
        assertEquals("https://openlibrary.tail.ts.net", normalizeServerUrl(" openlibrary.tail.ts.net/ "))
        assertEquals("http://10.0.2.2:8080", normalizeServerUrl("http://10.0.2.2:8080/api/v1/"))
    }
}
