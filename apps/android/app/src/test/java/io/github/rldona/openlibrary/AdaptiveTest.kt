package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.ui.components.NavLayout
import io.github.rldona.openlibrary.ui.components.navLayoutFor
import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptiveTest {
    @Test
    fun compactWindowsGetTheBottomBarWiderOnesTheRail() {
        assertEquals(NavLayout.Bar, navLayoutFor(411f)) // a phone held upright
        assertEquals(NavLayout.Bar, navLayoutFor(599.9f))
        assertEquals(NavLayout.Rail, navLayoutFor(600f))
        assertEquals(NavLayout.Rail, navLayoutFor(891f)) // the same phone on its side
        assertEquals(NavLayout.Rail, navLayoutFor(1280f)) // a tablet
    }
}
