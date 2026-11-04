package io.github.rldona.openlibrary.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val Light = lightColorScheme(primary = Color(0xFF8B3A2B), secondary = Color(0xFF2F5D50))
private val Dark = darkColorScheme(primary = Color(0xFFE8A594), secondary = Color(0xFF9CCFBE))

@Composable
fun OpenLibraryTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors =
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
                val ctx = LocalContext.current
                if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
            }
            dark -> Dark
            else -> Light
        }
    MaterialTheme(colorScheme = colors, content = content)
}
