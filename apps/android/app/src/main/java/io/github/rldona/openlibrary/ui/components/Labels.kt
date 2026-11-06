package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** How a [Pill] stands out: the accent's soft tint, or the quieter secondary one. */
enum class PillTone { Accent, Neutral }

/**
 * A short status in a rounded capsule ("ISBN … ✓", "3 books added", "In your library"). Not a button: it
 * is read as plain text.
 */
@Composable
fun Pill(text: String, modifier: Modifier = Modifier, tone: PillTone = PillTone.Accent, small: Boolean = false) {
    val (container, content) =
        when (tone) {
            PillTone.Accent -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
            PillTone.Neutral -> MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
        }
    Surface(modifier, shape = MaterialTheme.shapes.extraLarge, color = container, contentColor = content) {
        Text(
            text,
            Modifier.padding(horizontal = if (small) 8.dp else 12.dp, vertical = if (small) 2.dp else 6.dp),
            style = if (small) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** A label that looks like a chip but does nothing (a wish's priority): no button role for TalkBack. */
@Composable
fun Tag(text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier,
        shape = MaterialTheme.shapes.small,
        color = Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Text(text, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelMedium, maxLines = 1)
    }
}
