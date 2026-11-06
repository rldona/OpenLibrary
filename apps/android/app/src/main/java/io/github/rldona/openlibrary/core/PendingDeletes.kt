package io.github.rldona.openlibrary.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Deletes that wait for "Undo", one store for the whole app (AppContainer), so a pending delete outlives
 * the screen and view model that started it. Keys name the kind and the id ("wish:<id>", "quote:<id>").
 *
 * [hide] takes the item out of the lists at once; the real delete only runs on [commit] (the snackbar went
 * away, or the app's root went away with it) or never, on [undo]. Each pending delete runs at most once, in
 * [scope], which must be the app scope. A delete that fails puts the item back.
 */
class PendingDeletes(private val scope: CoroutineScope) {
    private val lock = Any()
    private val actions = mutableMapOf<String, suspend () -> Unit>()
    /** Deleted, still hidden until the list they came from no longer has them (see [settle]). */
    private val committed = mutableSetOf<String>()
    private val _hidden = MutableStateFlow<Set<String>>(emptySet())

    /** Keys to leave out of the lists: pending deletes and committed ones not yet gone from their list. */
    val hidden: StateFlow<Set<String>> = _hidden.asStateFlow()

    /** False when [key] is already waiting: the caller should not offer a second "Undo". */
    fun hide(key: String, delete: suspend () -> Unit): Boolean {
        synchronized(lock) {
            if (key in actions) return false
            actions[key] = delete
            committed.remove(key)
        }
        _hidden.update { it + key }
        return true
    }

    /** Puts the item back. False when it was already deleted (or never hidden). */
    fun undo(key: String): Boolean {
        synchronized(lock) { actions.remove(key) } ?: return false
        _hidden.update { it - key }
        return true
    }

    fun commit(key: String) {
        val delete = synchronized(lock) { actions.remove(key) } ?: return
        scope.launch {
            runCatching { delete() }
                .onSuccess { synchronized(lock) { committed += key } }
                .onFailure { _hidden.update { it - key } }
        }
    }

    /**
     * Called by a list with the keys it currently has: committed keys of that kind ([prefix]) that are no
     * longer in it stop being hidden, so the set does not grow forever.
     */
    fun settle(prefix: String, present: Set<String>) {
        val gone = synchronized(lock) {
            committed.filter { it.startsWith(prefix) && it !in present }.also { committed.removeAll(it.toSet()) }
        }
        if (gone.isNotEmpty()) _hidden.update { it - gone.toSet() }
    }

    /** Forgets everything without deleting (disconnecting: the local library is wiped anyway). */
    fun discardAll() {
        synchronized(lock) {
            actions.clear()
            committed.clear()
        }
        _hidden.value = emptySet()
    }
}
