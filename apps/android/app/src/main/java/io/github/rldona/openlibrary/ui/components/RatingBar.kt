package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.StarHalf
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.MAX_RATING
import io.github.rldona.openlibrary.core.StarFill
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.core.starFill
import io.github.rldona.openlibrary.core.toggledRating

/**
 * Tappable stars (48 dp each). Tapping a star sets that many; tapping the current one clears the rating.
 * TalkBack reads the group as "Rating, 3 of 5" and each star as what tapping it does.
 */
@Composable
fun RatingBar(rating: Double?, onRate: (Double?) -> Unit, modifier: Modifier = Modifier) {
    val label = stringResource(R.string.reading_rating)
    val value = stringResource(R.string.rating_value)
    val none = stringResource(R.string.reading_noRating)
    val rate = stringResource(R.string.rating_set)
    val clear = stringResource(R.string.rating_clear)
    val shown = rating?.let { r -> format(value, "n" to (if (r % 1.0 == 0.0) r.toInt() else r), "max" to MAX_RATING) } ?: none
    Row(
        modifier.semantics {
            contentDescription = label
            stateDescription = shown
        },
    ) {
        for (star in 1..MAX_RATING) {
            val fill = starFill(rating, star)
            val action = if (rating == star.toDouble()) clear else format(rate, "n" to star, "max" to MAX_RATING)
            IconButton(
                onClick = { onRate(toggledRating(rating, star)) },
                modifier = Modifier.size(48.dp).semantics { onClick(label = action) { onRate(toggledRating(rating, star)); true } },
            ) {
                Icon(
                    when (fill) {
                        StarFill.Full -> Icons.Default.Star
                        StarFill.Half -> Icons.AutoMirrored.Filled.StarHalf
                        StarFill.Empty -> Icons.Default.StarBorder
                    },
                    contentDescription = action,
                    tint = if (fill == StarFill.Empty) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}
