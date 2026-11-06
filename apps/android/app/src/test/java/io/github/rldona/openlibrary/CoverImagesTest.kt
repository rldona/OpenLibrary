package io.github.rldona.openlibrary

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.initialEditState
import io.github.rldona.openlibrary.core.rotateQuarter
import io.github.rldona.openlibrary.core.setRatioLocked
import io.github.rldona.openlibrary.core.straighten
import io.github.rldona.openlibrary.ui.capture.loadPreview
import io.github.rldona.openlibrary.ui.capture.renderCrop
import io.github.rldona.openlibrary.ui.capture.sweepEditCache
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.io.path.createTempDirectory

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CoverImagesTest {
    /** A 400x200 picture: red on the left half, blue on the right. */
    private fun picture(): File {
        val bmp = Bitmap.createBitmap(400, 200, Bitmap.Config.ARGB_8888)
        Canvas(bmp).apply {
            drawRect(0f, 0f, 200f, 200f, Paint().apply { color = Color.RED })
            drawRect(200f, 0f, 400f, 200f, Paint().apply { color = Color.BLUE })
        }
        return File.createTempFile("cover", ".jpg").also { f -> f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 100, it) } }
    }

    private fun decode(bytes: ByteArray) = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

    private fun isRed(c: Int) = Color.red(c) > 200 && Color.blue(c) < 60
    private fun isBlue(c: Int) = Color.blue(c) > 200 && Color.red(c) < 60

    @Test
    fun aStraightCropKeepsJustThatPartOfThePicture() = runTest {
        val state = setRatioLocked(initialEditState(400, 200), false).copy(crop = PixelRect(150f, 50f, 350f, 150f))
        val out = decode(renderCrop(picture(), state)!!)
        assertEquals(200, out.width)
        assertEquals(100, out.height)
        assertTrue(isRed(out.getPixel(20, 50)))
        assertTrue(isBlue(out.getPixel(180, 50)))
    }

    @Test
    fun aQuarterTurnPutsTheLeftOfThePictureOnTop() = runTest {
        val state = rotateQuarter(setRatioLocked(initialEditState(400, 200), false)).copy(crop = PixelRect(0f, 0f, 200f, 400f))
        val out = decode(renderCrop(picture(), state)!!)
        assertEquals(200, out.width)
        assertEquals(400, out.height)
        assertTrue(isRed(out.getPixel(100, 50)))
        assertTrue(isBlue(out.getPixel(100, 350)))
    }

    @Test
    fun aTurnedAndStraightenedCropHasNoBackgroundInItsCorners() = runTest {
        // The largest free crop that fits after a quarter turn and 12° of straightening touches the edges.
        val turned = rotateQuarter(setRatioLocked(initialEditState(400, 200), false)).copy(crop = PixelRect(0f, 0f, 200f, 400f))
        val state = straighten(turned, 12f)
        val out = decode(renderCrop(picture(), state)!!)
        for ((x, y) in listOf(0 to 0, out.width - 1 to 0, 0 to out.height - 1, out.width - 1 to out.height - 1)) {
            val c = out.getPixel(x, y)
            // Red or blue, never the white background nor a light seam.
            assertTrue("($x, $y) is #${Integer.toHexString(c)}", Color.green(c) < 90 && maxOf(Color.red(c), Color.blue(c)) > 150)
        }
    }

    @Test
    fun thePreviewIsScaledDown() = runTest {
        val preview = loadPreview(picture(), maxSide = 100)!!
        assertTrue(preview.width in 100..200)
        assertEquals(2f, preview.width.toFloat() / preview.height, 0.01f)
    }

    @Test
    fun theSweepKeepsTheRestoredPicture() = runTest {
        val dir = createTempDirectory("cover-edit").toFile()
        val old = File(dir, "old.jpg").apply { writeText("x"); setLastModified(1_000) }
        val kept = File(dir, "kept.jpg").apply { writeText("x"); setLastModified(1_000) }
        val fresh = File(dir, "fresh.jpg").apply { writeText("x") }
        sweepEditCache(dir, keep = kept, before = 10_000)
        assertFalse(old.exists())
        assertTrue(kept.exists())
        assertTrue(fresh.exists())
    }
}
