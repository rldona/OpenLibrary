package io.github.rldona.openlibrary.core

/** A rectangle in pixels (kept free of Android types so the mapping is plain-JVM testable). */
data class PixelRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
}

/**
 * Where a frame drawn on the preview falls in the captured (upright) image. The preview shows the camera
 * image scaled to FILL the view and centred (PreviewView's default), so the image overflows the view on
 * one axis; undo that scale and offset, and clamp to the image.
 */
fun frameInImage(imageW: Int, imageH: Int, viewW: Int, viewH: Int, frame: PixelRect): PixelRect {
    val scale = maxOf(viewW.toFloat() / imageW, viewH.toFloat() / imageH)
    val offX = (imageW * scale - viewW) / 2
    val offY = (imageH * scale - viewH) / 2
    return PixelRect(
        ((frame.left + offX) / scale).coerceIn(0f, imageW.toFloat()),
        ((frame.top + offY) / scale).coerceIn(0f, imageH.toFloat()),
        ((frame.right + offX) / scale).coerceIn(0f, imageW.toFloat()),
        ((frame.bottom + offY) / scale).coerceIn(0f, imageH.toFloat()),
    )
}
