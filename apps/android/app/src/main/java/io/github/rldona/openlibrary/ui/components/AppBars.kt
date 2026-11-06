package io.github.rldona.openlibrary.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButtonMenu
import androidx.compose.material3.FloatingActionButtonMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleFloatingActionButton
import androidx.compose.material3.ToggleFloatingActionButtonDefaults.animateIcon
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarColors
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.animateFloatingActionButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import io.github.rldona.openlibrary.R

/*
 * Every destination with a top app bar uses these. MainActivity's `screen(topBar = true)` already pads the
 * destination for the side and bottom bars but not the status bar: the bar draws behind the status bar
 * itself ([TopBarInsets]), and the screen's own Scaffold adds no insets of its own.
 */

/** The insets a top app bar handles: only the status bar (the sides are padded by the destination). */
val TopBarInsets: WindowInsets
    @Composable get() = WindowInsets.statusBars

/** On the page background, like the web; a raised container once the content scrolls under it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun appBarColors(): TopAppBarColors =
    TopAppBarDefaults.topAppBarColors(
        containerColor = MaterialTheme.colorScheme.background,
        scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
    )

/** A title read by TalkBack as the screen's heading. */
@Composable
fun BarTitle(text: String) {
    Text(text, maxLines = 1, modifier = Modifier.semantics { heading() })
}

/**
 * A tab (library, locations, wishlist, statistics, settings): a title bar that hides as the content scrolls
 * down and comes back as soon as it scrolls up. The snackbar is placed here, above the [fab].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabScaffold(
    title: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    fab: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    val scroll = TopAppBarDefaults.enterAlwaysScrollBehavior()
    val snackbar = LocalSnackbar.current
    Scaffold(
        modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = { BarTitle(title) },
                actions = actions,
                windowInsets = TopBarInsets,
                colors = appBarColors(),
                scrollBehavior = scroll,
            )
        },
        floatingActionButton = fab,
        snackbarHost = { snackbar.ScreenHost() },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0),
        content = content,
    )
}

/** A page opened from another one (review, add or edit a book): a pinned bar with a way back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackScaffold(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    /** Close (✕) for a form you leave without saving; back arrow otherwise. */
    close: Boolean = false,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()
    Scaffold(
        modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = { BarTitle(title) },
                navigationIcon = { BackButton(onBack, close) },
                actions = actions,
                windowInsets = TopBarInsets,
                colors = appBarColors(),
                scrollBehavior = scroll,
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0),
        content = content,
    )
}

@Composable
fun BackButton(onBack: () -> Unit, close: Boolean = false) {
    IconButton(onClick = onBack) {
        Icon(
            if (close) Icons.Default.Close else Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = stringResource(if (close) R.string.common_close else R.string.detail_back),
        )
    }
}

/**
 * Hides a floating button while the content scrolls down and shows it again when it scrolls up. Attach
 * [connection] with `Modifier.nestedScroll` above the scrolling content.
 */
class FabVisibility {
    var visible by mutableStateOf(true)
        private set

    val connection =
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (available.y < -2f) visible = false else if (available.y > 2f) visible = true
                return Offset.Zero
            }
        }
}

@Composable
fun rememberFabVisibility(): FabVisibility = remember { FabVisibility() }

/** One entry of [AddFabMenu]. */
class FabItem(val label: String, val icon: ImageVector, val testTag: String? = null, val onClick: () -> Unit)

/**
 * The "+" button that opens into the ways of adding something (Expressive FAB menu). It hides while the
 * content scrolls down ([visible]); back closes it.
 */
@Composable
fun AddFabMenu(items: List<FabItem>, visible: Boolean, modifier: Modifier = Modifier) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    BackHandler(expanded) { expanded = false }
    val toggleLabel = stringResource(if (expanded) R.string.fab_close else R.string.fab_open)
    FloatingActionButtonMenu(
        expanded = expanded,
        modifier = modifier,
        button = {
            ToggleFloatingActionButton(
                checked = expanded,
                onCheckedChange = { expanded = it },
                modifier = Modifier
                    .semantics {
                        // Read before the items it opens.
                        traversalIndex = -1f
                        contentDescription = toggleLabel
                    }
                    .animateFloatingActionButton(visible = visible || expanded, alignment = Alignment.BottomEnd),
            ) {
                Icon(
                    if (checkedProgress > 0.5f) Icons.Default.Close else Icons.Default.Add,
                    contentDescription = null,
                    modifier = Modifier.animateIcon({ checkedProgress }),
                )
            }
        },
    ) {
        items.forEach { item ->
            FloatingActionButtonMenuItem(
                onClick = {
                    expanded = false
                    item.onClick()
                },
                text = { Text(item.label) },
                icon = { Icon(item.icon, contentDescription = null) },
                modifier = item.testTag?.let { Modifier.testTag(it) } ?: Modifier,
            )
        }
    }
}
