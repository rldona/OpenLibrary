package io.github.rldona.openlibrary.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
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
 * The web's colours (apps/web/src/styles.css, :root and its dark variant), token for token, plus the roles
 * the web has no equivalent for: a stronger outline, a ladder of surface containers and the inverse colours,
 * all derived from the same warm palette so the identity stays the web's.
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

/** Roles with no web token, one set per theme. */
private class Extra(
    /** Borders of fields, outlined cards and buttons: at least 3:1 against every surface (WCAG 1.4.11). */
    val outline: Color,
    /** Secondary text: at least 4.5:1 on every surface, the highest container (search bar, fields) included. */
    val onSurfaceVariant: Color,
    val inverseSurface: Color,
    val inverseOnSurface: Color,
    /** The other theme's accent, as Material defines it (snackbar actions on the inverse surface). */
    val inversePrimary: Color,
    // From the page (`bg`) towards the most raised surface: sheets, cards, menus, dialogs, fields.
    val lowest: Color,
    val low: Color,
    val container: Color,
    val high: Color,
    val highest: Color,
    val dim: Color,
    val bright: Color,
)

// Contrast of `outline` (WCAG ratio): 3.97 on bg, 4.33 on panel, 3.64 on high, 3.41 on highest.
private val LightExtra = Extra(
    outline = Color(0xFF80776D),
    // The web's muted (#6F685F) is 4.27:1 on surfaceContainerHighest; this one is 4.60 there, 5.35 on bg.
    onSurfaceVariant = Color(0xFF6A635A),
    inverseSurface = Color(0xFF33302C),
    inverseOnSurface = Color(0xFFF7F1E9),
    inversePrimary = Web.D.accent,
    lowest = Color(0xFFFFFFFF),
    low = Color(0xFFFAF7F2),
    container = Color(0xFFF4F0EA),
    high = Color(0xFFEEE9E2),
    highest = Color(0xFFE8E2D9),
    dim = Color(0xFFE1DAD0),
    bright = Web.L.panel,
)

// Contrast of `outline` (WCAG ratio): 5.23 on bg, 4.84 on panel, 4.18 on high, 3.59 on highest.
private val DarkExtra = Extra(
    outline = Color(0xFF8F877C),
    // The web's muted: 4.81:1 on surfaceContainerHighest, 7.0 on bg.
    onSurfaceVariant = Web.D.muted,
    inverseSurface = Web.D.ink,
    inverseOnSurface = Color(0xFF33302C),
    inversePrimary = Web.L.accent,
    lowest = Color(0xFF100E0C),
    low = Color(0xFF1A1815),
    container = Color(0xFF221F1B),
    high = Color(0xFF2B2723),
    highest = Color(0xFF36322D),
    dim = Web.D.bg,
    bright = Color(0xFF3A3631),
)

private fun scheme(
    dark: Boolean,
    x: Extra,
    bg: Color, panel: Color, ink: Color, muted: Color, line: Color,
    accent: Color, accentInk: Color, accentSoft: Color, chip: Color,
    warn: Color, warnSoft: Color, err: Color, errSoft: Color,
) = (if (dark) darkColorScheme() else lightColorScheme()).copy(
    primary = accent,
    onPrimary = accentInk,
    primaryContainer = accentSoft,
    onPrimaryContainer = accent, // the web puts accent text on accent-soft (.nav.on, badges)
    inversePrimary = x.inversePrimary,
    // Secondary and tertiary: the web's chips and warnings.
    secondary = muted,
    onSecondary = panel,
    secondaryContainer = chip,
    onSecondaryContainer = ink,
    tertiary = warn,
    onTertiary = panel,
    tertiaryContainer = warnSoft,
    onTertiaryContainer = warn,
    // The page is `bg`; anything that sits on it (outlined cards) is a `panel`.
    background = bg,
    onBackground = ink,
    surface = panel,
    onSurface = ink,
    surfaceVariant = chip,
    onSurfaceVariant = x.onSurfaceVariant,
    surfaceTint = accent,
    // Raised surfaces step away from the page, so dialogs, menus and sheets stand out from it.
    surfaceBright = x.bright,
    surfaceDim = x.dim,
    surfaceContainerLowest = x.lowest,
    surfaceContainerLow = x.low,
    surfaceContainer = x.container,
    surfaceContainerHigh = x.high,
    surfaceContainerHighest = x.highest,
    inverseSurface = x.inverseSurface,
    inverseOnSurface = x.inverseOnSurface,
    outline = x.outline,
    // Dividers keep the web's soft `line`.
    outlineVariant = line,
    error = err,
    onError = panel,
    errorContainer = errSoft,
    onErrorContainer = err,
    scrim = Color.Black,
    // Fixed roles are the same in both themes: the light theme's soft tints and the dark theme's accents.
    primaryFixed = Web.L.accentSoft,
    primaryFixedDim = Web.D.accent,
    onPrimaryFixed = Web.D.accentInk,
    // A deeper accent: 4.98:1 on primaryFixedDim (the dark accent), 10.05 on primaryFixed.
    onPrimaryFixedVariant = Color(0xFF5C2406),
    secondaryFixed = Web.L.chip,
    secondaryFixedDim = Color(0xFFD9D1C5),
    onSecondaryFixed = Web.L.ink,
    onSecondaryFixedVariant = Web.L.muted,
    tertiaryFixed = Web.L.warnSoft,
    tertiaryFixedDim = Web.D.warn,
    onTertiaryFixed = Web.L.ink,
    onTertiaryFixedVariant = Web.L.warn,
)

internal val LightColors = with(Web.L) {
    scheme(false, LightExtra, bg, panel, ink, muted, line, accent, accentInk, accentSoft, chip, warn, warnSoft, err, errSoft)
}
internal val DarkColors = with(Web.D) {
    scheme(true, DarkExtra, bg, panel, ink, muted, line, accent, accentInk, accentSoft, chip, warn, warnSoft, err, errSoft)
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

/**
 * Material 3 Expressive with the web's identity: its colours, the serif headings and its corner radii, plus
 * the expressive motion scheme (springy components: FAB menu, button groups, toggles, lists). Whole-page
 * transitions use the standard scheme instead (see MainActivity).
 */
@Composable
fun OpenLibraryTheme(theme: String = "system", content: @Composable () -> Unit) {
    val dark = when (theme) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    MaterialExpressiveTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        motionScheme = MotionScheme.expressive(),
        typography = typography(),
        shapes = AppShapes,
        content = content,
    )
}
