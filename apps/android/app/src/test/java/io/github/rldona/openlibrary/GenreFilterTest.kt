package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.data.LibraryRow
import io.github.rldona.openlibrary.ui.library.filterByGenre
import io.github.rldona.openlibrary.ui.library.genreCounts
import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class GenreFilterTest {
    private val saved = Locale.getDefault()

    @Before
    fun spanish() = Locale.setDefault(Locale.forLanguageTag("es-ES"))

    @After
    fun restore() = Locale.setDefault(saved)

    private fun row(id: String, vararg subjects: String) =
        LibraryRow(id, "w-$id", "Title $id", null, emptyList(), null, null, null, "complete", 1, "", subjects = subjects.toList())

    private val rows = listOf(row("a", "Philosophy"), row("b", "Filosofía", "Ensayo"), row("c", "Feminism"), row("d"))

    @Test
    fun genresAreCountedAsShownWhateverLanguageTheyAreStoredIn() {
        assertEquals(listOf("Ensayo" to 1, "Feminismo" to 1, "Filosofía" to 2), genreCounts(rows))
    }

    @Test
    fun filteringByAShownGenreFindsBothSpellings() {
        assertEquals(listOf("a", "b"), filterByGenre(rows, "Filosofía").map { it.editionId })
        assertEquals(rows, filterByGenre(rows, null))
    }
}
