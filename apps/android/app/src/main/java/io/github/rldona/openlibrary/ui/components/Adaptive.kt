package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Where the tabs go: a bottom bar on a phone held upright, a rail at the side when there is width to spare. */
enum class NavLayout { Bar, Rail }

/**
 * Material's window size classes: below 600 dp wide is compact (bottom bar); medium and expanded windows
 * (a phone on its side, a tablet, an unfolded foldable) get a navigation rail.
 */
fun navLayoutFor(widthDp: Float): NavLayout = if (widthDp >= COMPACT_MAX_WIDTH) NavLayout.Rail else NavLayout.Bar

private const val COMPACT_MAX_WIDTH = 600f

/** The widest a column of text and fields should get: wider lines are hard to read. */
val ReadableWidth: Dp = 720.dp

/**
 * Centres the content and keeps it at most [max] wide; on a phone it simply fills the width. Put it after
 * the scroll modifier, so the scrolling area still spans the whole page.
 */
fun Modifier.readableWidth(max: Dp = ReadableWidth): Modifier =
    this.fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = max).fillMaxWidth()
