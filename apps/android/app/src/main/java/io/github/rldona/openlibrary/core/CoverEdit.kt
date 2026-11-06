package io.github.rldona.openlibrary.core

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** Width / height of a book cover. */
const val COVER_RATIO = 2f / 3f

/** What a drag on the crop editor moves: the whole crop, one edge or one corner. */
enum class CropHandle { Move, Left, Top, Right, Bottom, TopLeft, TopRight, BottomLeft, BottomRight }

/**
 * The cover crop editor's state, free of Android types so the geometry is plain-JVM testable.
 *
 * The source image ([imageWidth] x [imageHeight], already upright) is turned clockwise [quarterTurns]
 * times, which gives the "work" image of [workWidth] x [workHeight]. That image is then straightened by
 * [angleDeg] (clockwise, around its centre). [crop] is a rectangle aligned with the screen, in work-image
 * pixels, and always lies inside the straightened image.
 */
data class CoverEditState(
    val imageWidth: Int,
    val imageHeight: Int,
    val crop: PixelRect,
    val quarterTurns: Int = 0,
    val angleDeg: Float = 0f,
    val ratioLocked: Boolean = true,
) {
    val workWidth get() = workSize(imageWidth, imageHeight, quarterTurns).first
    val workHeight get() = workSize(imageWidth, imageHeight, quarterTurns).second
}

/** A 2D affine transform: x' = a·x + b·y + c, y' = d·x + e·y + f (Android's `Matrix.setValues` order). */
data class Affine(val a: Float, val b: Float, val c: Float, val d: Float, val e: Float, val f: Float) {
    fun map(x: Float, y: Float): Pair<Float, Float> = (a * x + b * y + c) to (d * x + e * y + f)

    /** This transform followed by [next]. */
    infix fun then(next: Affine) = Affine(
        next.a * a + next.b * d, next.a * b + next.b * e, next.a * c + next.b * f + next.c,
        next.d * a + next.e * d, next.d * b + next.e * e, next.d * c + next.e * f + next.f,
    )

    companion object {
        val Identity = Affine(1f, 0f, 0f, 0f, 1f, 0f)
        fun translate(x: Float, y: Float) = Affine(1f, 0f, x, 0f, 1f, y)
        fun scale(s: Float) = Affine(s, 0f, 0f, 0f, s, 0f)

        /** Clockwise (on a y-down screen) rotation by [deg] around ([cx], [cy]). */
        fun rotate(deg: Float, cx: Float, cy: Float): Affine {
            val r = Math.toRadians(deg.toDouble())
            val cos = cos(r).toFloat()
            val sin = sin(r).toFloat()
            return translate(-cx, -cy) then Affine(cos, -sin, 0f, sin, cos, 0f) then translate(cx, cy)
        }
    }
}

/** Where a crop ends up: source pixels → output pixels, and the output size. */
data class CropOutput(val transform: Affine, val width: Int, val height: Int)

fun workSize(width: Int, height: Int, quarterTurns: Int): Pair<Int, Int> =
    if (quarterTurns.mod(4) % 2 == 0) width to height else height to width

private val PixelRect.centerX get() = (left + right) / 2
private val PixelRect.centerY get() = (top + bottom) / 2

private fun PixelRect.offset(dx: Float, dy: Float) = PixelRect(left + dx, top + dy, right + dx, bottom + dy)

private fun rectAround(cx: Float, cy: Float, w: Float, h: Float) = PixelRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

/** The largest rectangle of [ratio] (width / height) centred in [w] x [h]. */
fun centeredCrop(w: Float, h: Float, ratio: Float): PixelRect {
    val cw = min(w, h * ratio)
    return rectAround(w / 2, h / 2, cw, cw / ratio)
}

/** The largest rectangle of [ratio] centred inside [rect]. */
private fun ratioInside(rect: PixelRect, ratio: Float): PixelRect =
    centeredCrop(rect.width, rect.height, ratio).offset(rect.left, rect.top)

private const val EPS = 0.05f

/** Whether [crop] lies inside a [w] x [h] image straightened by [angleDeg] around its centre. */
fun cropFits(crop: PixelRect, w: Int, h: Int, angleDeg: Float): Boolean {
    // Take the crop's corners back into the unrotated image and check they land inside it.
    val back = Affine.rotate(-angleDeg, w / 2f, h / 2f)
    return listOf(crop.left to crop.top, crop.right to crop.top, crop.left to crop.bottom, crop.right to crop.bottom).all { (x, y) ->
        val (u, v) = back.map(x, y)
        u >= -EPS && v >= -EPS && u <= w + EPS && v <= h + EPS
    }
}

/** The largest t in 0..1 for which [fits] holds, assuming the valid values form an interval from 0. */
private fun furthest(fits: (Float) -> Boolean): Float {
    if (fits(1f)) return 1f
    var lo = 0f
    var hi = 1f
    repeat(24) {
        val mid = (lo + hi) / 2
        if (fits(mid)) lo = mid else hi = mid
    }
    return lo
}

/**
 * Makes [crop] fit after the image is straightened to [angleDeg]: it shrinks around its centre keeping its
 * proportion, and its centre slides towards the image centre when that leaves a larger crop (or when the
 * centre itself fell outside the image).
 */
fun fitAfterRotation(crop: PixelRect, w: Int, h: Int, angleDeg: Float): PixelRect {
    if (cropFits(crop, w, h, angleDeg)) return crop
    var best: PixelRect? = null
    for (t in listOf(0f, 0.25f, 0.5f, 0.75f, 1f)) {
        val cx = crop.centerX + (w / 2f - crop.centerX) * t
        val cy = crop.centerY + (h / 2f - crop.centerY) * t
        if (!cropFits(PixelRect(cx, cy, cx, cy), w, h, angleDeg)) continue
        val k = furthest { k -> cropFits(rectAround(cx, cy, crop.width * k, crop.height * k), w, h, angleDeg) }
        val candidate = rectAround(cx, cy, crop.width * k, crop.height * k)
        if (best == null || candidate.width > best.width * 1.001f) best = candidate
    }
    return best ?: rectAround(w / 2f, h / 2f, 0f, 0f)
}

/** Moves [crop] by ([dx], [dy]) as far as it stays inside the image, sliding along the edges it meets. */
fun moveCrop(crop: PixelRect, dx: Float, dy: Float, w: Int, h: Int, angleDeg: Float): PixelRect {
    val alongX = crop.offset(dx * furthest { t -> cropFits(crop.offset(dx * t, 0f), w, h, angleDeg) }, 0f)
    return alongX.offset(0f, dy * furthest { t -> cropFits(alongX.offset(0f, dy * t), w, h, angleDeg) })
}

private fun horizontalSign(handle: CropHandle) = when (handle) {
    CropHandle.Left, CropHandle.TopLeft, CropHandle.BottomLeft -> -1
    CropHandle.Right, CropHandle.TopRight, CropHandle.BottomRight -> 1
    else -> 0
}

private fun verticalSign(handle: CropHandle) = when (handle) {
    CropHandle.Top, CropHandle.TopLeft, CropHandle.TopRight -> -1
    CropHandle.Bottom, CropHandle.BottomLeft, CropHandle.BottomRight -> 1
    else -> 0
}

/** [handle] dragged by ([dx], [dy]) without regard for the image bounds; sides never go below [minSize]. */
private fun dragHandle(crop: PixelRect, handle: CropHandle, dx: Float, dy: Float, ratio: Float?, minSize: Float): PixelRect {
    val sx = horizontalSign(handle)
    val sy = verticalSign(handle)
    if (ratio == null) {
        val left = if (sx < 0) min(crop.left + dx, crop.right - minSize) else crop.left
        val right = if (sx > 0) max(crop.right + dx, crop.left + minSize) else crop.right
        val top = if (sy < 0) min(crop.top + dy, crop.bottom - minSize) else crop.top
        val bottom = if (sy > 0) max(crop.bottom + dy, crop.top + minSize) else crop.bottom
        return PixelRect(left, top, right, bottom)
    }
    val width = when {
        // A corner follows the drag projected on its diagonal, so the size changes smoothly.
        sx != 0 && sy != 0 -> crop.width + (sx * dx * ratio + sy * dy) * ratio / (ratio * ratio + 1)
        sx != 0 -> crop.width + sx * dx
        else -> (crop.height + sy * dy) * ratio
    }.let { max(it, max(minSize, minSize * ratio)) }
    val height = width / ratio
    val left = when {
        sx < 0 -> crop.right - width
        sx > 0 -> crop.left
        else -> crop.centerX - width / 2
    }
    val top = when {
        sy < 0 -> crop.bottom - height
        sy > 0 -> crop.top
        else -> crop.centerY - height / 2
    }
    return PixelRect(left, top, left + width, top + height)
}

/**
 * Drags [handle] by ([dx], [dy]) in work-image pixels, as far as the crop stays inside the straightened
 * image. With a [ratio] every handle keeps it; without one, corners move each axis on its own so they
 * slide along the edges.
 */
fun resizeCrop(
    crop: PixelRect,
    handle: CropHandle,
    dx: Float,
    dy: Float,
    ratio: Float?,
    minSize: Float,
    w: Int,
    h: Int,
    angleDeg: Float,
): PixelRect {
    if (handle == CropHandle.Move) return moveCrop(crop, dx, dy, w, h, angleDeg)
    fun along(from: PixelRect, ddx: Float, ddy: Float): PixelRect {
        if (!cropFits(dragHandle(from, handle, 0f, 0f, ratio, minSize), w, h, angleDeg)) return from
        val t = furthest { t -> cropFits(dragHandle(from, handle, ddx * t, ddy * t, ratio, minSize), w, h, angleDeg) }
        return dragHandle(from, handle, ddx * t, ddy * t, ratio, minSize)
    }
    return if (ratio == null) along(along(crop, dx, 0f), 0f, dy) else along(crop, dx, dy)
}

/** Which part of [crop] a touch at ([x], [y]) grabs, within [slop] pixels of an edge, or null if none. */
fun hitTest(crop: PixelRect, x: Float, y: Float, slop: Float): CropHandle? {
    if (x < crop.left - slop || x > crop.right + slop || y < crop.top - slop || y > crop.bottom + slop) return null
    val toLeft = abs(x - crop.left)
    val toRight = abs(x - crop.right)
    val toTop = abs(y - crop.top)
    val toBottom = abs(y - crop.bottom)
    val sx = when {
        min(toLeft, toRight) > slop -> 0
        toLeft <= toRight -> -1
        else -> 1
    }
    val sy = when {
        min(toTop, toBottom) > slop -> 0
        toTop <= toBottom -> -1
        else -> 1
    }
    return when {
        sx < 0 && sy < 0 -> CropHandle.TopLeft
        sx > 0 && sy < 0 -> CropHandle.TopRight
        sx < 0 && sy > 0 -> CropHandle.BottomLeft
        sx > 0 && sy > 0 -> CropHandle.BottomRight
        sx < 0 -> CropHandle.Left
        sx > 0 -> CropHandle.Right
        sy < 0 -> CropHandle.Top
        sy > 0 -> CropHandle.Bottom
        else -> CropHandle.Move
    }
}

/**
 * The editor's starting point for a [width] x [height] picture: the largest 2:3 crop inside [frame] (the
 * camera viewfinder, in image pixels), or centred on the whole picture when there is no usable frame.
 */
fun initialEditState(width: Int, height: Int, frame: PixelRect? = null): CoverEditState {
    val whole = centeredCrop(width.toFloat(), height.toFloat(), COVER_RATIO)
    val inFrame = frame?.let {
        PixelRect(max(it.left, 0f), max(it.top, 0f), min(it.right, width.toFloat()), min(it.bottom, height.toFloat()))
    }?.takeIf { it.width >= 20f && it.height >= 20f }?.let { ratioInside(it, COVER_RATIO) }
    return CoverEditState(width, height, inFrame ?: whole)
}

/** Straightens the picture to [angleDeg], shrinking the crop as needed. */
fun straighten(state: CoverEditState, angleDeg: Float): CoverEditState =
    state.copy(angleDeg = angleDeg, crop = fitAfterRotation(state.crop, state.workWidth, state.workHeight, angleDeg))

/**
 * Turns the picture a quarter clockwise, keeping the straightening. A 2:3 crop starts again centred (the
 * turned one would be 3:2); a free crop turns with the picture.
 */
fun rotateQuarter(state: CoverEditState): CoverEditState {
    val turns = (state.quarterTurns + 1).mod(4)
    val (w, h) = workSize(state.imageWidth, state.imageHeight, turns)
    val crop = if (state.ratioLocked) {
        centeredCrop(w.toFloat(), h.toFloat(), COVER_RATIO)
    } else {
        // (x, y) in the old work image goes to (oldHeight - y, x); the old height is the new width.
        val c = state.crop
        PixelRect(w - c.bottom, c.left, w - c.top, c.right)
    }
    return state.copy(quarterTurns = turns, crop = fitAfterRotation(crop, w, h, state.angleDeg))
}

/** Locks the crop to 2:3 (the largest 2:3 inside the current crop) or frees it. */
fun setRatioLocked(state: CoverEditState, locked: Boolean): CoverEditState =
    state.copy(ratioLocked = locked, crop = if (locked) ratioInside(state.crop, COVER_RATIO) else state.crop)

/** Source pixels → the straightened work image (the space [CoverEditState.crop] lives in). */
fun sourceToWork(state: CoverEditState): Affine {
    var w = state.imageWidth.toFloat()
    var h = state.imageHeight.toFloat()
    var m = Affine.Identity
    repeat(state.quarterTurns.mod(4)) {
        // A quarter turn clockwise: (x, y) → (h - y, x), and the sides swap.
        m = m then Affine(0f, -1f, h, 1f, 0f, 0f)
        w = h.also { h = w }
    }
    return m then Affine.rotate(state.angleDeg, w / 2, h / 2)
}

/**
 * Source pixels → output pixels of the cropped cover, whose longer side is at most [maxSide]. With an
 * [inset] (work-image pixels), the output keeps its size but shows the crop shrunk by that much on each
 * side, so filtering never reaches past the picture's edge.
 */
fun outputTransform(state: CoverEditState, maxSide: Int, inset: Float = 0f): CropOutput {
    val crop = state.crop
    val scale = min(1f, maxSide / max(crop.width, crop.height))
    val width = max(1, (crop.width * scale).roundToInt())
    val height = max(1, (crop.height * scale).roundToInt())
    val i = inset.coerceIn(0f, min(crop.width, crop.height) / 4)
    val shown = Affine(width / (crop.width - 2 * i), 0f, 0f, 0f, height / (crop.height - 2 * i), 0f)
    return CropOutput(sourceToWork(state) then Affine.translate(-crop.left - i, -crop.top - i) then shown, width, height)
}
