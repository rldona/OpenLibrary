package io.github.rldona.openlibrary.core

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import io.github.rldona.openlibrary.R

/** Fills `{name}` placeholders, like `interpolate` in packages/contracts/src/i18n.ts. */
fun format(template: String, vararg params: Pair<String, Any?>): String {
    val map = params.toMap()
    return Regex("\\{(\\w+)\\}").replace(template) { m -> map[m.groupValues[1]]?.toString() ?: m.value }
}

@Composable
fun str(@StringRes id: Int, vararg params: Pair<String, Any?>): String = format(stringResource(id), *params)

/** `.one` / `.other` pairs of the shared catalogs (English and Spanish only need these two forms). */
@Composable
fun plural(@StringRes one: Int, @StringRes other: Int, n: Int): String = str(if (n == 1) one else other, "n" to n)

@StringRes
fun conditionLabel(value: String): Int =
    when (value) {
        "new" -> R.string.condition_new
        "fine" -> R.string.condition_fine
        "good" -> R.string.condition_good
        "used" -> R.string.condition_used
        "fair" -> R.string.condition_fair
        else -> R.string.condition_poor
    }

@StringRes
fun locationKindLabel(value: String): Int =
    when (value) {
        "home" -> R.string.locationKind_home
        "room" -> R.string.locationKind_room
        "bookcase" -> R.string.locationKind_bookcase
        "shelf" -> R.string.locationKind_shelf
        "box" -> R.string.locationKind_box
        else -> R.string.locationKind_other
    }

@StringRes
fun retireLabel(value: String?): Int =
    when (value) {
        "gifted" -> R.string.retire_gifted
        "sold" -> R.string.retire_sold
        "lost" -> R.string.retire_lost
        "damaged" -> R.string.retire_damaged
        else -> R.string.retire_other
    }
