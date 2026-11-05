package io.github.rldona.openlibrary.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * The web's colours (apps/web/src/styles.css, :root and its dark variant), token for token: every colour
 * of the app is one of these, so both look the same. Material roles the web has no equivalent for reuse
 * the closest web token (noted below).
 */
private object Web {
    object L {
        val bg = Color(0xFFF6F3EE)
        val panel = Color(0xFFFFFDF9)
        val ink = Color(0xFF1D1B18)
        val muted = Color(0xFF6F685F)
        val line = Color(0xFFE6E0D6)
        val accent = Color(0xFF8A3B12)
        val accentInk = Color(0xFFFFFFFF)
        val accentSoft = Color(0xFFF5E6D8)
        val chip = Color(0xFFEFE9DF)
        val warn = Color(0xFF8A5710)
        val warnSoft = Color(0xFFF8ECD6)
        val err = Color(0xFFA83232)
        val errSoft = Color(0xFFF7E1DF)
    }

    object D {
        val bg = Color(0xFF151311)
        val panel = Color(0xFF1E1B18)
        val ink = Color(0xFFEEE8DF)
        val muted = Color(0xFFA69E93)
        val line = Color(0xFF34302B)
        val accent = Color(0xFFE2925F)
        val accentInk = Color(0xFF1A120C)
        val accentSoft = Color(0xFF3A281C)
        val chip = Color(0xFF2A2622)
        val warn = Color(0xFFE5B05C)
        val warnSoft = Color(0xFF3A2D17)
        val err = Color(0xFFEC8A83)
        val errSoft = Color(0xFF3D1F1D)
    }
}

private fun scheme(
    dark: Boolean,
    bg: Color, panel: Color, ink: Color, muted: Color, line: Color,
    accent: Color, accentInk: Color, accentSoft: Color, chip: Color,
    warn: Color, warnSoft: Color, err: Color, errSoft: Color,
) = (if (dark) darkColorScheme() else lightColorScheme()).copy(
    primary = accent,
    onPrimary = accentInk,
    primaryContainer = accentSoft,
    onPrimaryContainer = accent, // the web puts accent text on accent-soft (.nav.on, badges)
    inversePrimary = accent,
    // Secondary and tertiary: the web's chips and warnings.
    secondary = muted,
    onSecondary = panel,
    secondaryContainer = chip,
    onSecondaryContainer = ink,
    tertiary = warn,
    onTertiary = panel,
    tertiaryContainer = warnSoft,
    onTertiaryContainer = warn,
    // The page is `bg`; anything that sits on it (outlined cards, sheets, menus) is a `panel`.
    background = bg,
    onBackground = ink,
    surface = panel,
    onSurface = ink,
    surfaceVariant = chip,
    onSurfaceVariant = muted,
    surfaceTint = accent,
    // Panels, cards, menus and dialogs are all the web's panel.
    surfaceBright = panel,
    surfaceDim = bg,
    surfaceContainerLowest = panel,
    surfaceContainerLow = panel,
    surfaceContainer = panel,
    surfaceContainerHigh = panel,
    surfaceContainerHighest = panel,
    inverseSurface = ink,
    inverseOnSurface = bg,
    outline = line,
    outlineVariant = line,
    error = err,
    onError = panel,
    errorContainer = errSoft,
    onErrorContainer = err,
    scrim = Color.Black,
)

private val Light = with(Web.L) {
    scheme(false, bg, panel, ink, muted, line, accent, accentInk, accentSoft, chip, warn, warnSoft, err, errSoft)
}
private val Dark = with(Web.D) {
    scheme(true, bg, panel, ink, muted, line, accent, accentInk, accentSoft, chip, warn, warnSoft, err, errSoft)
}

/** Serif for titles and headings (the system's Noto Serif), sans for everything else, like the web. */
private val Serif = FontFamily.Serif

private fun typography(): Typography {
    val base = Typography()
    val serif = { s: androidx.compose.ui.text.TextStyle, size: Int ->
        s.copy(fontFamily = Serif, fontWeight = FontWeight.SemiBold, fontSize = size.sp, letterSpacing = (-0.2).sp)
    }
    return base.copy(
        displaySmall = serif(base.displaySmall, 32),
        headlineLarge = serif(base.headlineLarge, 30),
        headlineMedium = serif(base.headlineMedium, 26),
        headlineSmall = serif(base.headlineSmall, 23),
        titleLarge = serif(base.titleLarge, 21),
        titleMedium = serif(base.titleMedium, 17),
    )
}

private val AppShapes =
    Shapes(
        extraSmall = RoundedCornerShape(6.dp),
        small = RoundedCornerShape(8.dp),
        medium = RoundedCornerShape(14.dp), // the web's .panel radius
        large = RoundedCornerShape(16.dp),
        extraLarge = RoundedCornerShape(24.dp),
    )

@Composable
fun OpenLibraryTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        typography = typography(),
        shapes = AppShapes,
        content = content,
    )
}
