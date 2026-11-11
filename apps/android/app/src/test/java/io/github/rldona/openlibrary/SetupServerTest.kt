package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.ui.setup.ServerChoice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The setup screen with and without a build-time default server address. */
class SetupServerTest {
    @Test
    fun withADefaultTheAddressFieldIsHiddenUntilUseAnotherServer() {
        val choice = ServerChoice(default = "https://library.example.com")
        assertFalse(choice.showField)
        assertEquals("https://library.example.com", choice.address)

        val other = choice.copy(useOther = true)
        assertTrue(other.showField)
        // The field starts empty: the default is not silently used once the owner asked for another server.
        assertEquals("", other.address)
        assertEquals("https://mine.example.org", other.copy(typed = "https://mine.example.org").address)
    }

    @Test
    fun withoutADefaultTheFieldIsShownAsBefore() {
        val choice = ServerChoice(default = null)
        assertTrue(choice.showField)
        assertEquals("", choice.address)
        assertEquals("library.example.com", choice.copy(typed = "library.example.com").address)
    }

    @Test
    fun thisBuildHasAValidOrEmptyDefault() {
        val value = BuildConfig.DEFAULT_SERVER_URL
        assertTrue(value.isEmpty() || (value.startsWith("https://") && !value.endsWith("/")))
    }
}
