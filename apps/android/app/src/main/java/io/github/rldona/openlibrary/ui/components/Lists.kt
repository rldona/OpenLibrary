package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.grid.LazyGridItemScope
import androidx.compose.material3.ListItemColors
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp

/** Rows straight on the page: no container of their own, the page background shows through. */
@Composable
fun pageListItemColors(): ListItemColors = ListItemDefaults.colors(containerColor = Color.Transparent)

/** One style for a book's title in each context, so it reads the same everywhere. */
object BookTitle {
    /** Under a cover in the grid. */
    val grid: TextStyle @Composable get() = MaterialTheme.typography.labelLarge

    /** A row of a list (library, wishlist). */
    val list: TextStyle @Composable get() = MaterialTheme.typography.titleMedium

    /** Small rows in dialogs and sheets (candidates, search results, bulk scan). */
    val compact: TextStyle @Composable get() = MaterialTheme.typography.titleSmall
}

/** Spacing used across the screens. */
object Spacing {
    /** Between a page's edge and its content. */
    val page = 16.dp

    /** Between items of a form or card. */
    val item = 12.dp

    /** Room at the bottom of a list so the floating button never covers its last row. */
    val fab = 96.dp

    /** Width of a cover at the start of a list row. */
    val rowCover = 52.dp
}

/** List rows appear, move and leave with the theme's motion when the list changes (filters, sort, deletes). */
@Composable
fun LazyItemScope.animateListItem(): Modifier {
    val motion = MaterialTheme.motionScheme
    return Modifier.animateItem(motion.defaultEffectsSpec(), motion.defaultSpatialSpec(), motion.fastEffectsSpec())
}

/** [animateListItem] for grid cells. */
@Composable
fun LazyGridItemScope.animateGridItem(): Modifier {
    val motion = MaterialTheme.motionScheme
    return Modifier.animateItem(motion.defaultEffectsSpec(), motion.defaultSpatialSpec(), motion.fastEffectsSpec())
}
