package io.github.rldona.openlibrary.ui.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Short messages at the bottom of the screen, from one app-wide [SnackbarHostState]: above the
 * navigation bar on the tabs, above the system bars on full-screen pages (the camera).
 *
 * The root Scaffold shows them, unless a screen with its own Scaffold places them with [ScreenHost] (so its
 * floating action button moves up instead of being covered). [scope] belongs to the root of the app, so a
 * message (and its "Undo") outlives the screen that showed it.
 */
class AppSnackbar(
    private val host: SnackbarHostState,
    private val scope: CoroutineScope,
    private val undoLabel: String,
) {
    /** Screens placing the snackbar themselves; the newest one wins (the one coming in during a transition). */
    private val owners = mutableStateListOf<Any>()

    /** For the root Scaffold: shown only while no screen places it. */
    @Composable
    fun RootHost() {
        if (owners.isEmpty()) SnackbarHost(host)
    }

    /**
     * For a screen's own Scaffold (`snackbarHost = { snackbar.ScreenHost() }`), or placed by hand where it does
     * not cover the screen's controls (the camera). With [transient], plain messages shown there go away when
     * the screen does, instead of reappearing on the page you return to.
     */
    @Composable
    fun ScreenHost(modifier: Modifier = Modifier, transient: Boolean = false) {
        val key = remember { Any() }
        DisposableEffect(key) {
            owners.add(key)
            onDispose {
                owners.remove(key)
                if (transient) dismissMessages()
            }
        }
        if (owners.lastOrNull() === key) SnackbarHost(host, modifier)
    }

    /** Dismisses the plain message on screen; an "Undo" stays (dismissing it would delete at once). */
    fun dismissMessages() {
        host.currentSnackbarData?.takeIf { it.visuals.actionLabel == null }?.dismiss()
    }

    /** Replaces a message on screen (news is newer), but waits behind an "Undo". */
    fun showMessage(message: String) {
        dismissMessages()
        scope.launch { host.showSnackbar(message, withDismissAction = true) }
    }

    /**
     * A message with "Undo". Exactly one of [onUndo] and [onDismiss] runs: [onDismiss] when it times out, is
     * swiped away, is replaced by another undo, or the app's root goes away before (rotation, finishing).
     */
    fun showUndo(message: String, onUndo: () -> Unit, onDismiss: () -> Unit) {
        // A new undo settles the previous one (its delete goes ahead) instead of queueing behind it.
        host.currentSnackbarData?.dismiss()
        var settled = false
        scope.launch {
            val result = host.showSnackbar(message, actionLabel = undoLabel, duration = SnackbarDuration.Long)
            settled = true
            if (result == SnackbarResult.ActionPerformed) onUndo() else onDismiss()
        }.invokeOnCompletion { if (!settled) onDismiss() }
    }
}

/** Provided by MainActivity around the whole app. */
val LocalSnackbar = staticCompositionLocalOf<AppSnackbar> { error("No AppSnackbar provided") }
