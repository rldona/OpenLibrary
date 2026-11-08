package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.fmtDate
import io.github.rldona.openlibrary.core.fold
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.core.languageName
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.network.normalizeServerUrl
import io.github.rldona.openlibrary.sync.pathOf
import io.github.rldona.openlibrary.ui.library.subtree
import io.github.rldona.openlibrary.ui.locations.flattenTree
import io.github.rldona.openlibrary.ui.locations.nextLocationKind
import io.github.rldona.openlibrary.ui.locations.visibleNodes
import java.util.Locale
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
    fun datesAndLanguagesAreShownInThePhonesLanguage() {
        assertEquals("5 nov 2026", fmtDate("2026-11-05", Locale("es", "ES")))
        assertEquals("5 Nov 2026", fmtDate("2026-11-05", Locale.UK))
        // Not a date: shown as stored rather than hidden.
        assertEquals("2026-11", fmtDate("2026-11", Locale.UK))
        assertEquals("Español", languageName("es", Locale("es", "ES")))
        assertEquals("Spanish", languageName("es", Locale.UK))
        assertEquals("English", languageName(" en ", Locale.UK))
        // An unknown code is kept as typed, so the form can show it has no name.
        assertEquals("zz", languageName("zz", Locale.UK))
        assertEquals("", languageName("", Locale.UK))
    }

    @Test
    fun aNewLocationIsOneLevelBelowItsParent() {
        assertEquals("room", nextLocationKind(null))
        assertEquals("room", nextLocationKind("home"))
        assertEquals("bookcase", nextLocationKind("room"))
        assertEquals("shelf", nextLocationKind("bookcase"))
        assertEquals("box", nextLocationKind("shelf"))
        assertEquals("other", nextLocationKind("box"))
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
        // Direct children, for the fold chevron.
        assertEquals(listOf("casa" to 2, "despacho" to 0, "salon" to 1, "balda" to 0), nodes.map { it.location.id to it.children })
    }

    @Test
    fun foldingALocationHidesEverythingUnderIt() {
        val nodes = flattenTree(tree, emptyMap())
        assertEquals(listOf("casa", "despacho", "salon"), visibleNodes(nodes, setOf("salon")).map { it.location.id })
        assertEquals(listOf("casa"), visibleNodes(nodes, setOf("casa", "salon")).map { it.location.id })
        assertEquals(nodes, visibleNodes(nodes, emptySet()))
    }

    @Test
    fun serverAddressesAreNormalised() {
        assertEquals("https://openlibrary.tail.ts.net", normalizeServerUrl(" openlibrary.tail.ts.net/ "))
        assertEquals("http://10.0.2.2:8080", normalizeServerUrl("http://10.0.2.2:8080/api/v1/"))
    }
}
