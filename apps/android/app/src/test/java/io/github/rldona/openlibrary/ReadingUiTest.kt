package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.StarFill
import io.github.rldona.openlibrary.core.starFill
import io.github.rldona.openlibrary.core.toggledRating
import io.github.rldona.openlibrary.data.ReadingEntity
import io.github.rldona.openlibrary.data.workReadingStatus
import io.github.rldona.openlibrary.ui.detail.ReadingAction
import io.github.rldona.openlibrary.ui.detail.currentReading
import io.github.rldona.openlibrary.ui.detail.statusChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The star rating and the reading-status row of the book detail. */
class ReadingUiTest {
    @Test
    fun tappingAStarSetsItAndTappingItAgainClearsIt() {
        assertEquals(3.0, toggledRating(null, 3))
        assertEquals(5.0, toggledRating(3.0, 5))
        assertNull(toggledRating(3.0, 3))
        // A half rating from the web is replaced, not cleared, by its nearest star.
        assertEquals(4.0, toggledRating(3.5, 4))
        assertEquals(3.0, toggledRating(3.5, 3))
    }

    @Test
    fun starsShowFullHalfAndEmpty() {
        assertEquals(listOf(StarFill.Full, StarFill.Full, StarFill.Full, StarFill.Half, StarFill.Empty), (1..5).map { starFill(3.5, it) })
        assertEquals(List(5) { StarFill.Empty }, (1..5).map { starFill(null, it) })
    }

    private val reading = ReadingEntity("r1", 1, "c1", "reading", "2026-11-01", null, null, "", T, T)
    private val finished = ReadingEntity("r2", 1, "c2", "read", "2026-11-01", "2026-11-02", null, "", T, T)

    @Test
    fun choosingAStatusStartsFinishesMarksOrResetsTheReading() {
        // Nothing to do for the status it already has.
        assertNull(statusChange("pending", null, "pending", "c1", emptyList()))
        assertNull(statusChange("reading", reading, "reading", "c1", listOf(reading)))
        // Not read yet → start, or straight to read.
        assertEquals(ReadingAction.Start("c1", "reading"), statusChange("pending", null, "reading", "c1", emptyList()))
        assertEquals(ReadingAction.Start("c1", "read"), statusChange("pending", null, "read", "c1", emptyList()))
        // Reading → finish the session in progress.
        assertEquals(ReadingAction.Edit(reading, mapOf("status" to "read")), statusChange("reading", reading, "read", "c1", listOf(reading)))
        // Read → read again.
        assertEquals(ReadingAction.Start("c1", "reading"), statusChange("read", null, "reading", "c1", listOf(finished)))
        // Not read yet: reset every finished or in-progress reading and clear its dates.
        assertEquals(
            ReadingAction.Reset(listOf(reading)),
            statusChange("reading", reading, "pending", "c1", listOf(reading)),
        )
        // Including a finished reading before a re-read, and undoing a finished reading from "read".
        assertEquals(
            ReadingAction.Reset(listOf(finished, reading)),
            statusChange("reading", reading, "pending", "c1", listOf(finished, reading)),
        )
        assertEquals(
            ReadingAction.Reset(listOf(finished)),
            statusChange("read", null, "pending", "c1", listOf(finished)),
        )
        // Nothing starts without a copy.
        assertNull(statusChange("pending", null, "reading", null, emptyList()))
    }

    @Test
    fun aReadingInProgressBeforeAnAbandonedOneIsStillTheCurrentOne() {
        val abandoned = ReadingEntity("r2", 1, "c2", "abandoned", "2026-11-03", "2026-11-04", null, "", T, T)
        val readings = listOf(reading, abandoned)
        val status = workReadingStatus(readings)
        assertEquals("reading", status)
        assertEquals(reading, currentReading(readings))
        // "Read" finishes that one instead of creating another; "Reading" does nothing.
        assertEquals(
            ReadingAction.Edit(reading, mapOf("status" to "read")),
            statusChange(status, currentReading(readings), "read", "c1", readings),
        )
        assertNull(statusChange(status, currentReading(readings), "reading", "c1", readings))
    }
}
