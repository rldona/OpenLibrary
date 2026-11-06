package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.PendingDeletes
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PendingDeletesTest {
    private val scope = TestScope(UnconfinedTestDispatcher())
    private val deleted = mutableListOf<String>()
    private val deletes = PendingDeletes(scope)

    private fun hide(key: String) = deletes.hide(key) { deleted += key }

    @Test
    fun hidingTakesTheItemOutWithoutDeletingIt() {
        assertTrue(hide("wish:a"))
        assertEquals(setOf("wish:a"), deletes.hidden.value)
        assertEquals(emptyList<String>(), deleted)
    }

    @Test
    fun hidingTwiceIsRefusedSoNoSecondUndoIsOffered() {
        assertTrue(hide("wish:a"))
        assertFalse(hide("wish:a"))
        deletes.commit("wish:a")
        assertEquals(listOf("wish:a"), deleted)
    }

    @Test
    fun undoWorksAfterTheScreenThatHidItIsGone() {
        // The store is app-wide: the view model that called hide() can be cleared meanwhile, and nothing
        // runs the delete until the snackbar settles.
        hide("wish:a")
        assertTrue(deletes.undo("wish:a"))
        assertEquals(emptySet<String>(), deletes.hidden.value)
        deletes.commit("wish:a")
        assertEquals(emptyList<String>(), deleted)
    }

    @Test
    fun commitDeletesOnceAndStaysHiddenUntilTheListDropsIt() {
        hide("wish:a")
        deletes.commit("wish:a")
        deletes.commit("wish:a")
        assertEquals(listOf("wish:a"), deleted)
        assertFalse("too late to undo", deletes.undo("wish:a"))
        // The list still had it (not re-read yet): it stays hidden.
        deletes.settle("wish:", setOf("wish:a"))
        assertEquals(setOf("wish:a"), deletes.hidden.value)
        // Another kind's list does not touch it.
        deletes.settle("quote:", emptySet())
        assertEquals(setOf("wish:a"), deletes.hidden.value)
        deletes.settle("wish:", emptySet())
        assertEquals(emptySet<String>(), deletes.hidden.value)
    }

    @Test
    fun aFailedDeleteBringsTheItemBack() {
        deletes.hide("quote:q") { error("disk full") }
        deletes.commit("quote:q")
        assertEquals(emptySet<String>(), deletes.hidden.value)
    }

    @Test
    fun discardAllForgetsWithoutDeleting() {
        hide("wish:a")
        hide("quote:b")
        deletes.discardAll()
        deletes.commit("wish:a")
        assertEquals(emptySet<String>(), deletes.hidden.value)
        assertEquals(emptyList<String>(), deleted)
    }

    @Test
    fun unknownKeysAreANoOp() {
        assertFalse(deletes.undo("wish:x"))
        deletes.commit("wish:x")
        assertEquals(emptyList<String>(), deleted)
    }
}
