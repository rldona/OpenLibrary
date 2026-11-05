package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.data.LockPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LockPolicyTest {
    @Test
    fun locksOnColdStartOnlyWhenEnabled() {
        val off = LockPolicy()
        off.onStart(enabled = false, now = 0)
        assertFalse(off.locked.value)

        val on = LockPolicy()
        on.onStart(enabled = true, now = 0)
        assertTrue(on.locked.value)
        on.unlocked()
        assertFalse(on.locked.value)
    }

    @Test
    fun locksAgainOnlyAfterTheTimeoutAway() {
        val p = LockPolicy(timeoutMs = 60_000)
        p.onStart(true, 0)
        p.unlocked()
        // A quick trip to the camera app or a notification does not lock.
        p.onStop(1_000)
        p.onStart(true, 30_000)
        assertFalse(p.locked.value)
        p.onStop(40_000)
        p.onStart(true, 101_000)
        assertTrue(p.locked.value)
    }

    @Test
    fun turningTheLockOffUnlocks() {
        val p = LockPolicy()
        p.onStart(true, 0)
        p.onStop(1)
        p.onStart(false, 10 * 60_000)
        assertFalse(p.locked.value)
    }
}
