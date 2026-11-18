package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.ui.detail.joinWithAnd
import org.junit.Assert.assertEquals
import org.junit.Test

class DetailLogicTest {
    @Test
    fun missingFieldsReadAsASentence() {
        assertEquals("", joinWithAnd(emptyList(), " y "))
        assertEquals("año", joinWithAnd(listOf("año"), " y "))
        assertEquals("editorial y año", joinWithAnd(listOf("editorial", "año"), " y "))
        assertEquals("autor, editorial y año", joinWithAnd(listOf("autor", "editorial", "año"), " y "))
    }
}

class SubjectLabelTest {
    @Test
    fun genresAreShownInSpanish() {
        assertEquals("Filosofía", io.github.rldona.openlibrary.core.subjectLabel("Philosophy", "es"))
        assertEquals("Feminismo", io.github.rldona.openlibrary.core.subjectLabel("  feminism ", "es"))
        assertEquals("Ficción / Science Fictionish", io.github.rldona.openlibrary.core.subjectLabel("Fiction / Science Fictionish", "es"))
        assertEquals("Long Now Manual", io.github.rldona.openlibrary.core.subjectLabel("Long Now Manual", "es"))
        assertEquals("Philosophy", io.github.rldona.openlibrary.core.subjectLabel("Philosophy", "en"))
        assertEquals("Ecology", io.github.rldona.openlibrary.core.subjectLabel("ecology", "es"))
    }
}
