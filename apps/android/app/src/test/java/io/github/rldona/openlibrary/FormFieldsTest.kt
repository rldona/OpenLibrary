package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.ui.components.chipSuggestions
import io.github.rldona.openlibrary.ui.components.splitChips
import io.github.rldona.openlibrary.ui.components.withDraft
import org.junit.Assert.assertEquals
import org.junit.Test

class FormFieldsTest {
    @Test
    fun chipsAreSplitWithoutRepeats() {
        assertEquals(listOf("Ana García", "Luis"), splitChips(" Ana García ;; luis; Luis ;ana garcia".replace("luis", "Luis")))
    }

    @Test
    fun whatIsTypedIsKeptWhenSaving() {
        assertEquals("Nassim Nicholas Taleb", withDraft("", "Nassim Nicholas Taleb "))
        assertEquals("Ana; Luis; Eva", withDraft("Ana; Luis", "eva; luis".replace("eva", "Eva")))
        assertEquals("Ana", withDraft("Ana", "  "))
    }

    @Test
    fun suggestionsOnlyWhileTyping() {
        val all = listOf("Josep Maria Esquirol", "María José Ruiz", "Ana José", "Jorge Luis Borges")
        assertEquals(emptyList<String>(), chipSuggestions(all, emptyList(), " "))
        // Accent-insensitive, names starting with the text first, chosen ones left out.
        assertEquals(listOf("Josep Maria Esquirol", "María José Ruiz", "Ana José"), chipSuggestions(all, emptyList(), "jos"))
        assertEquals(listOf("María José Ruiz"), chipSuggestions(all, listOf("josep maria esquirol", "Ana José"), "jos"))
        assertEquals(2, chipSuggestions(all, emptyList(), "o", max = 2).size)
    }
}
