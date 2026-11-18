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
