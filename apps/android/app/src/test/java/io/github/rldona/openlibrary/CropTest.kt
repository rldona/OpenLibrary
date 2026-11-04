package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.frameInImage
import org.junit.Assert.assertEquals
import org.junit.Test

class CropTest {
    @Test
    fun aFrameOnTheFilledPreviewMapsToTheSameAreaOfThePhoto() {
        // 3000x4000 photo filling a 1000x2000 view: scale 0.5, the scaled photo is 1500 px wide, so 250 px
        // overflow on each side: x = (200 + 250) / 0.5 = 900.
        val c = frameInImage(3000, 4000, 1000, 2000, PixelRect(200f, 500f, 800f, 1400f))
        assertEquals(PixelRect(900f, 1000f, 2100f, 2800f), c)
        assertEquals(1.5f, c.height / c.width) // a 2:3 frame stays 2:3
    }

    @Test
    fun theCropNeverLeavesThePhoto() {
        val c = frameInImage(1000, 1000, 500, 500, PixelRect(-10f, -10f, 600f, 600f))
        assertEquals(PixelRect(0f, 0f, 1000f, 1000f), c)
    }
}
