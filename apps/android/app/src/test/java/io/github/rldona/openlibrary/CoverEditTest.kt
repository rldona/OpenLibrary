package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.Affine
import io.github.rldona.openlibrary.core.COVER_RATIO
import io.github.rldona.openlibrary.core.CropHandle
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.centeredCrop
import io.github.rldona.openlibrary.core.cropFits
import io.github.rldona.openlibrary.core.fitAfterRotation
import io.github.rldona.openlibrary.core.hitTest
import io.github.rldona.openlibrary.core.initialEditState
import io.github.rldona.openlibrary.core.moveCrop
import io.github.rldona.openlibrary.core.outputTransform
import io.github.rldona.openlibrary.core.resizeCrop
import io.github.rldona.openlibrary.core.rotateQuarter
import io.github.rldona.openlibrary.core.setRatioLocked
import io.github.rldona.openlibrary.core.sourceToWork
import io.github.rldona.openlibrary.core.straighten
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class CoverEditTest {
    private fun assertRect(expected: PixelRect, actual: PixelRect, delta: Float = 0.01f) {
        assertEquals(expected.left, actual.left, delta)
        assertEquals(expected.top, actual.top, delta)
        assertEquals(expected.right, actual.right, delta)
        assertEquals(expected.bottom, actual.bottom, delta)
    }

    private fun assertPoint(x: Float, y: Float, actual: Pair<Float, Float>) {
        assertEquals(x, actual.first, 0.01f)
        assertEquals(y, actual.second, 0.01f)
    }

    @Test
    fun theInitialCropIsTheLargestCentredCoverOnPortraitAndLandscapePictures() {
        // Portrait 1000x2000: the width limits it, 1000x1500 centred vertically.
        assertRect(PixelRect(0f, 250f, 1000f, 1750f), centeredCrop(1000f, 2000f, COVER_RATIO))
        // Landscape 3000x1500: the height limits it, 1000x1500 centred horizontally.
        assertRect(PixelRect(1000f, 0f, 2000f, 1500f), centeredCrop(3000f, 1500f, COVER_RATIO))
    }

    @Test
    fun theCameraFrameBecomesTheInitialCropAndIsKeptInsideThePicture() {
        val s = initialEditState(3000, 4000, PixelRect(900f, 1000f, 2100f, 2800f))
        assertRect(PixelRect(900f, 1000f, 2100f, 2800f), s.crop)
        assertTrue(s.ratioLocked)
        // A frame spilling over the picture is clipped and still 2:3.
        val clipped = initialEditState(1000, 1000, PixelRect(-100f, -100f, 500f, 800f)).crop
        assertEquals(COVER_RATIO, clipped.width / clipped.height, 0.001f)
        assertTrue(cropFits(clipped, 1000, 1000, 0f))
        // No frame: centred on the whole picture.
        assertRect(centeredCrop(1000f, 2000f, COVER_RATIO), initialEditState(1000, 2000).crop)
    }

    @Test
    fun theWholePictureFitsStraightButNotTiltedBy30Degrees() {
        val whole = PixelRect(0f, 0f, 1000f, 1500f)
        assertTrue(cropFits(whole, 1000, 1500, 0f))
        assertFalse(cropFits(whole, 1000, 1500, 30f))
        assertFalse(cropFits(PixelRect(-1f, 0f, 10f, 10f), 1000, 1500, 0f))
    }

    @Test
    fun aCropFittedAfterStraighteningAlwaysFitsAndKeepsItsProportion() {
        val random = Random(7)
        repeat(200) {
            val w = random.nextInt(200, 4000)
            val h = random.nextInt(200, 4000)
            val angle = random.nextFloat() * 90f - 45f
            val start = centeredCrop(w.toFloat(), h.toFloat(), if (random.nextBoolean()) COVER_RATIO else random.nextFloat() + 0.3f)
                .let { c -> moveCrop(c, random.nextFloat() * w - w / 2f, random.nextFloat() * h - h / 2f, w, h, 0f) }
            val fitted = fitAfterRotation(start, w, h, angle)
            assertTrue("$start at $angle° in ${w}x$h → $fitted", cropFits(fitted, w, h, angle))
            assertEquals(start.width / start.height, fitted.width / fitted.height, 0.01f)
            assertTrue(fitted.width > 0f)
        }
    }

    @Test
    fun aCropThatAlreadyFitsIsLeftAlone() {
        val small = PixelRect(400f, 600f, 600f, 900f)
        assertEquals(small, fitAfterRotation(small, 1000, 1500, 20f))
    }

    @Test
    fun movingAndResizingNeverLeaveThePictureNorGoBelowTheMinimum() {
        val random = Random(11)
        val handles = CropHandle.entries
        repeat(300) {
            val w = random.nextInt(300, 3000)
            val h = random.nextInt(300, 3000)
            val angle = random.nextFloat() * 90f - 45f
            val locked = random.nextBoolean()
            val minSize = 50f
            var crop = fitAfterRotation(centeredCrop(w.toFloat(), h.toFloat(), COVER_RATIO), w, h, angle)
            if (crop.width < minSize * 2) return@repeat
            repeat(10) {
                val handle = handles[random.nextInt(handles.size)]
                val dx = (random.nextFloat() - 0.5f) * w * 2
                val dy = (random.nextFloat() - 0.5f) * h * 2
                val next = resizeCrop(crop, handle, dx, dy, if (locked) COVER_RATIO else null, minSize, w, h, angle)
                assertTrue("$handle by ($dx, $dy) from $crop → $next", cropFits(next, w, h, angle))
                assertTrue(next.width >= minSize - 0.01f && next.height >= minSize - 0.01f)
                if (locked) assertEquals(COVER_RATIO, next.width / next.height, 0.001f)
                crop = next
            }
        }
    }

    @Test
    fun moveSlidesAlongTheEdgeItMeets() {
        val crop = PixelRect(100f, 100f, 300f, 400f)
        // Far to the left and down a little: stops at the left edge but still moves down.
        assertRect(PixelRect(0f, 150f, 200f, 450f), moveCrop(crop, -500f, 50f, 1000, 1500, 0f), 0.05f)
    }

    @Test
    fun everyHandleKeepsTheCoverProportionWhenLocked() {
        val crop = PixelRect(300f, 300f, 500f, 600f)
        for (handle in CropHandle.entries) {
            for ((dx, dy) in listOf(30f to 10f, -30f to -10f, 5f to -40f)) {
                val r = resizeCrop(crop, handle, dx, dy, COVER_RATIO, 20f, 1000, 1500, 0f)
                assertEquals("$handle", COVER_RATIO, r.width / r.height, 0.0001f)
            }
        }
        // The opposite corner stays put, and small drags give small changes (no jumps).
        val r = resizeCrop(crop, CropHandle.TopLeft, -3f, -2f, COVER_RATIO, 20f, 1000, 1500, 0f)
        assertEquals(500f, r.right, 0.001f)
        assertEquals(600f, r.bottom, 0.001f)
        assertTrue(r.width - crop.width in 0f..4f)
    }

    @Test
    fun aFreeEdgeMovesOnlyItsSide() {
        val crop = PixelRect(300f, 300f, 500f, 600f)
        assertRect(PixelRect(250f, 300f, 500f, 600f), resizeCrop(crop, CropHandle.Left, -50f, 99f, null, 20f, 1000, 1500, 0f))
        assertRect(PixelRect(300f, 300f, 500f, 320f), resizeCrop(crop, CropHandle.Bottom, 0f, -1000f, null, 20f, 1000, 1500, 0f))
    }

    @Test
    fun touchesGrabCornersEdgesOrTheWholeCrop() {
        val crop = PixelRect(100f, 100f, 300f, 400f)
        assertEquals(CropHandle.TopLeft, hitTest(crop, 105f, 95f, 20f))
        assertEquals(CropHandle.BottomRight, hitTest(crop, 310f, 410f, 20f))
        assertEquals(CropHandle.Right, hitTest(crop, 290f, 250f, 20f))
        assertEquals(CropHandle.Top, hitTest(crop, 200f, 110f, 20f))
        assertEquals(CropHandle.Move, hitTest(crop, 200f, 250f, 20f))
        assertNull(hitTest(crop, 500f, 250f, 20f))
    }

    @Test
    fun fourQuarterTurnsAreTheIdentity() {
        val start = initialEditState(1200, 900).let { setRatioLocked(it, false) }.copy(crop = PixelRect(100f, 50f, 700f, 800f))
        var s = start
        repeat(4) { s = rotateQuarter(s) }
        assertEquals(0, s.quarterTurns)
        assertRect(start.crop, s.crop)
        val m = sourceToWork(s)
        assertPoint(123f, 456f, m.map(123f, 456f))
    }

    @Test
    fun aQuarterTurnRestartsALockedCropAndTurnsAFreeOne() {
        val locked = rotateQuarter(initialEditState(1200, 900))
        assertEquals(900, locked.workWidth)
        assertEquals(1200, locked.workHeight)
        assertRect(centeredCrop(900f, 1200f, COVER_RATIO), locked.crop)

        val free = setRatioLocked(initialEditState(1200, 900), false).copy(crop = PixelRect(0f, 0f, 100f, 200f))
        // The top-left corner of the picture ends at the top right.
        assertRect(PixelRect(700f, 0f, 900f, 100f), rotateQuarter(free).crop)
    }

    @Test
    fun straighteningKeepsTheCropInside() {
        val s = straighten(initialEditState(1000, 1500), 30f)
        assertEquals(30f, s.angleDeg)
        assertTrue(cropFits(s.crop, 1000, 1500, 30f))
        assertEquals(COVER_RATIO, s.crop.width / s.crop.height, 0.001f)
    }

    @Test
    fun lockingTheRatioTakesTheLargestCoverInsideTheCrop() {
        val free = setRatioLocked(initialEditState(1000, 1000), false).copy(crop = PixelRect(0f, 0f, 900f, 300f))
        assertRect(PixelRect(350f, 0f, 550f, 300f), setRatioLocked(free, true).crop)
    }

    @Test
    fun theOutputOfAStraightCropIsAPureTranslation() {
        val s = initialEditState(1000, 1500).copy(crop = PixelRect(100f, 200f, 500f, 800f))
        val out = outputTransform(s, 1600)
        assertEquals(400, out.width)
        assertEquals(600, out.height)
        assertEquals(Affine(1f, 0f, -100f, 0f, 1f, -200f), out.transform)
    }

    @Test
    fun anInsetKeepsTheOutputSizeAndShowsTheCropShrunk() {
        val s = initialEditState(1000, 1500).copy(crop = PixelRect(100f, 200f, 500f, 800f))
        val out = outputTransform(s, 1600, inset = 1f)
        assertEquals(400, out.width)
        assertEquals(600, out.height)
        assertPoint(0f, 0f, out.transform.map(101f, 201f))
        assertPoint(400f, 600f, out.transform.map(499f, 799f))
    }

    @Test
    fun theOutputIsScaledDownToTheMaximumSide() {
        val out = outputTransform(initialEditState(2000, 3000), 1500)
        assertEquals(1000, out.width)
        assertEquals(1500, out.height)
        assertPoint(1000f, 1500f, out.transform.map(2000f, 3000f))
    }

    @Test
    fun quarterTurnsMapTheSourceCornersOntoTheOutput() {
        // 90°: a 400x200 source becomes 200x400; its top-left corner goes to the top right.
        val quarter = rotateQuarter(setRatioLocked(initialEditState(400, 200), false)).let { it.copy(crop = PixelRect(0f, 0f, 200f, 400f)) }
        val q = outputTransform(quarter, 1600)
        assertEquals(200, q.width)
        assertEquals(400, q.height)
        assertPoint(200f, 0f, q.transform.map(0f, 0f))
        assertPoint(200f, 400f, q.transform.map(400f, 0f))
        assertPoint(0f, 0f, q.transform.map(0f, 200f))

        // 180°: corners swap diagonally.
        val half = rotateQuarter(quarter).copy(crop = PixelRect(0f, 0f, 400f, 200f))
        val hT = outputTransform(half, 1600).transform
        assertPoint(400f, 200f, hT.map(0f, 0f))
        assertPoint(0f, 0f, hT.map(400f, 200f))
    }
}
