package io.github.rldona.openlibrary

import androidx.compose.material3.SnackbarHostState
import io.github.rldona.openlibrary.ui.components.AppSnackbar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** "Undo" snackbars: exactly one of onUndo / onDismiss runs, whatever ends them. */
@OptIn(ExperimentalCoroutinesApi::class)
class AppSnackbarTest {
    private val host = SnackbarHostState()
    private val events = mutableListOf<String>()

    private fun show(snackbar: AppSnackbar, name: String) =
        snackbar.showUndo(name, onUndo = { events += "undo:$name" }, onDismiss = { events += "dismiss:$name" })

    @Test
    fun undoRunsOnlyOnUndo() = runTest(UnconfinedTestDispatcher()) {
        val root = CoroutineScope(coroutineContext + Job())
        val snackbar = AppSnackbar(host, root, "Undo")
        show(snackbar, "a")
        host.currentSnackbarData!!.performAction()
        assertEquals(listOf("undo:a"), events)
        root.cancel()
        assertEquals(listOf("undo:a"), events)
    }

    @Test
    fun timingOutDismisses() = runTest(UnconfinedTestDispatcher()) {
        val root = CoroutineScope(coroutineContext + Job())
        val snackbar = AppSnackbar(host, root, "Undo")
        show(snackbar, "a")
        // What the host does when the time is up (or the snackbar is swiped away).
        host.currentSnackbarData!!.dismiss()
        assertEquals(listOf("dismiss:a"), events)
        root.cancel()
    }

    @Test
    fun aSecondUndoSettlesTheFirst() = runTest(UnconfinedTestDispatcher()) {
        val root = CoroutineScope(coroutineContext + Job())
        val snackbar = AppSnackbar(host, root, "Undo")
        show(snackbar, "a")
        show(snackbar, "b")
        assertEquals(listOf("dismiss:a"), events)
        assertEquals("b", host.currentSnackbarData!!.visuals.message)
        host.currentSnackbarData!!.performAction()
        assertEquals(listOf("dismiss:a", "undo:b"), events)
        root.cancel()
    }

    @Test
    fun theRootGoingAwayDismisses() = runTest(UnconfinedTestDispatcher()) {
        val root = CoroutineScope(coroutineContext + Job())
        val snackbar = AppSnackbar(host, root, "Undo")
        show(snackbar, "a")
        root.cancel()
        assertEquals(listOf("dismiss:a"), events)
    }
}
