package io.github.rldona.openlibrary

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import io.github.rldona.openlibrary.ui.theme.DarkColors
import io.github.rldona.openlibrary.ui.theme.LightColors
import org.junit.Assert.assertTrue
import org.junit.Test

/** WCAG contrast of the app's colour schemes (1.4.3 text, 1.4.11 component borders). */
class ThemeContrastTest {
    private fun contrast(a: Color, b: Color): Double {
        val (hi, lo) = listOf(a.luminance().toDouble(), b.luminance().toDouble()).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun assertContrast(what: String, fg: Color, bg: Color, min: Double) {
        val ratio = contrast(fg, bg)
        assertTrue("$what: %.2f < $min".format(ratio), ratio >= min)
    }

    private fun check(name: String, s: ColorScheme) {
        val surfaces = mapOf(
            "background" to s.background,
            "surface" to s.surface,
            "surfaceContainerHigh" to s.surfaceContainerHigh,
            "surfaceContainerHighest" to s.surfaceContainerHighest,
        )
        surfaces.forEach { (bgName, bg) ->
            assertContrast("$name outline on $bgName", s.outline, bg, 3.0)
            assertContrast("$name onSurface on $bgName", s.onSurface, bg, 4.5)
        }
        surfaces.forEach { (bgName, bg) -> assertContrast("$name onSurfaceVariant on $bgName", s.onSurfaceVariant, bg, 4.5) }
        listOf("background" to s.background, "surface" to s.surface, "surfaceContainerHigh" to s.surfaceContainerHigh).forEach { (bgName, bg) ->
            assertContrast("$name primary on $bgName", s.primary, bg, 4.5)
            assertContrast("$name error on $bgName", s.error, bg, 4.5)
        }
        assertContrast("$name onPrimary", s.onPrimary, s.primary, 4.5)
        assertContrast("$name onPrimaryContainer", s.onPrimaryContainer, s.primaryContainer, 4.5)
        assertContrast("$name onErrorContainer", s.onErrorContainer, s.errorContainer, 4.5)
        assertContrast("$name onPrimaryFixedVariant on primaryFixed", s.onPrimaryFixedVariant, s.primaryFixed, 4.5)
        assertContrast("$name onPrimaryFixedVariant on primaryFixedDim", s.onPrimaryFixedVariant, s.primaryFixedDim, 4.5)
        // The snackbar: text and its action on the inverse surface.
        assertContrast("$name inverseOnSurface", s.inverseOnSurface, s.inverseSurface, 4.5)
        assertContrast("$name inversePrimary", s.inversePrimary, s.inverseSurface, 4.5)
    }

    /** Containers step away from the page: darker in the light theme, lighter in the dark one. */
    private fun assertLadder(name: String, s: ColorScheme, dark: Boolean) {
        val ladder = listOf(s.surfaceContainerLowest, s.surfaceContainerLow, s.surfaceContainer, s.surfaceContainerHigh, s.surfaceContainerHighest)
            .map { it.luminance() }
        val ordered = ladder.zipWithNext().all { (a, b) -> if (dark) b > a else b < a }
        assertTrue("$name surface containers are not ordered: $ladder", ordered)
    }

    @Test
    fun lightSchemeIsReadable() {
        check("light", LightColors)
        assertLadder("light", LightColors, dark = false)
    }

    @Test
    fun darkSchemeIsReadable() {
        check("dark", DarkColors)
        assertLadder("dark", DarkColors, dark = true)
    }
}
