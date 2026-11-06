package io.github.rldona.openlibrary.ui.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.util.Log
import androidx.camera.core.ImageProxy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import io.github.rldona.openlibrary.core.CoverEditState
import io.github.rldona.openlibrary.core.outputTransform
import io.github.rldona.openlibrary.core.sha256Hex
import io.github.rldona.openlibrary.sync.CoverStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

private const val TAG = "OpenLibraryCover"

/** Longest side kept for the picture being edited: enough detail to crop a small part of it. */
private const val EDIT_MAX_SIDE = 3200

/** Longest side of a stored cover. */
private const val COVER_MAX_SIDE = 1600

/** An upright picture waiting in the crop editor. */
data class PreparedImage(val file: File, val width: Int, val height: Int)

/** Where pictures wait while they are being cropped; anything left there is temporary. */
fun editCacheDir(context: Context) = File(context.cacheDir, "cover-edit")

private fun newEditFile(context: Context) = File(editCacheDir(context).apply { mkdirs() }, "${UUID.randomUUID()}.jpg")

private fun writeJpeg(bmp: Bitmap, file: File, quality: Int) {
    file.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, quality, it) }
}

/** A camera capture made upright and no larger than [EDIT_MAX_SIDE], saved for the editor. Closes [image]. */
suspend fun prepareCameraImage(context: Context, image: ImageProxy): PreparedImage? =
    image.use {
        withContext(Dispatchers.Default) {
            runCatching {
                val source = image.toBitmap()
                val rotation = image.imageInfo.rotationDegrees
                val scale = minOf(1f, EDIT_MAX_SIDE.toFloat() / max(source.width, source.height))
                val upright = if (rotation != 0 || scale < 1f) {
                    val m = Matrix().apply { postScale(scale, scale); postRotate(rotation.toFloat()) }
                    Bitmap.createBitmap(source, 0, 0, source.width, source.height, m, true).also { if (it !== source) source.recycle() }
                } else {
                    source
                }
                val file = newEditFile(context)
                writeJpeg(upright, file, 95)
                PreparedImage(file, upright.width, upright.height).also { upright.recycle() }
            }.onFailure { Log.w(TAG, "could not prepare the photo", it) }.getOrNull()
        }
    }

/** A picture from the gallery, upright (ImageDecoder applies EXIF) and no larger than [EDIT_MAX_SIDE]. */
suspend fun prepareGalleryImage(context: Context, uri: Uri): PreparedImage? =
    withContext(Dispatchers.IO) {
        runCatching {
            val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val longest = max(info.size.width, info.size.height)
                if (longest > EDIT_MAX_SIDE) {
                    val scale = EDIT_MAX_SIDE.toFloat() / longest
                    decoder.setTargetSize(
                        max(1, (info.size.width * scale).roundToInt()),
                        max(1, (info.size.height * scale).roundToInt()),
                    )
                }
            }
            val file = newEditFile(context)
            writeJpeg(bmp, file, 95)
            PreparedImage(file, bmp.width, bmp.height).also { bmp.recycle() }
        }.onFailure { Log.w(TAG, "could not read the picked image", it) }.getOrNull()
    }

/** A screen-sized copy of [file] for the editor, its longest side at most about [maxSide]. */
suspend fun loadPreview(file: File, maxSide: Int = 1440): ImageBitmap? =
    withContext(Dispatchers.IO) {
        runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, bounds)
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
            BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })!!.asImageBitmap()
        }.onFailure { Log.w(TAG, "could not load the preview", it) }.getOrNull()
    }

/** The cover cut out of [file] as [state] says: turned, straightened, cropped and resized, as JPEG. */
suspend fun renderCrop(file: File, state: CoverEditState): ByteArray? =
    withContext(Dispatchers.Default) {
        runCatching {
            val source = BitmapFactory.decodeFile(file.path)!!
            // About a pixel in from each side: with straightening, the bilinear filter would blend the
            // picture's edge with the background into a light seam.
            val out = outputTransform(state, COVER_MAX_SIDE, inset = 1f)
            val t = out.transform
            val matrix = Matrix().apply {
                setValues(floatArrayOf(t.a, t.b, t.c, t.d, t.e, t.f, 0f, 0f, 1f))
                // The state is in the prepared picture's pixels; cope with a decoder returning another size.
                preScale(state.imageWidth.toFloat() / source.width, state.imageHeight.toFloat() / source.height)
            }
            val result = Bitmap.createBitmap(out.width, out.height, Bitmap.Config.ARGB_8888)
            Canvas(result).apply {
                drawColor(android.graphics.Color.WHITE)
                drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG))
            }
            source.recycle()
            compress(result).also { result.recycle() }
        }.onFailure { Log.w(TAG, "could not crop the cover", it) }.getOrNull()
    }

/** Deletes the leftovers of earlier editing sessions, except [keep], created before [before]. */
suspend fun sweepEditCache(dir: File, keep: File?, before: Long) {
    withContext(Dispatchers.IO) {
        dir.listFiles()?.filter { it != keep && it.lastModified() < before }?.forEach { it.delete() }
    }
}

suspend fun deleteEditFile(file: File) {
    withContext(Dispatchers.IO) { file.delete() }
}

/**
 * Stores a cover under its SHA-256, which is the id the server will give it, so the book can reference it
 * before it is uploaded.
 */
suspend fun storeCover(covers: CoverStore, bytes: ByteArray): String =
    withContext(Dispatchers.IO) { sha256Hex(bytes).also { covers.put(it, bytes) } }

internal fun compress(source: Bitmap): ByteArray {
    val scale = minOf(1f, COVER_MAX_SIDE.toFloat() / max(source.width, source.height))
    val bmp = if (scale < 1f) Bitmap.createScaledBitmap(source, (source.width * scale).toInt(), (source.height * scale).toInt(), true) else source
    val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
    if (bmp !== source) bmp.recycle()
    return bytes
}
