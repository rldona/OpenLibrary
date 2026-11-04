package io.github.rldona.openlibrary.ui.capture

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.util.Log
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.frameInImage
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.sha256Hex
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.CoverStore
import java.io.ByteArrayOutputStream

private const val TAG = "OpenLibraryScanner"

enum class CaptureMode { Isbn, Cover }

/** What the capture screen hands back to the book form; either part may be missing. */
data class CaptureResult(val isbn: String?, val photoId: String?)

/**
 * Full-screen camera for adding a book, with two modes as tabs: ISBN (scan the barcode) and Cover (photo
 * cropped to a 2:3 frame, or a picture from the gallery). Confirming an ISBN moves on to the cover, so a
 * book can be captured in one go; the top-left button closes and returns whatever was captured.
 */
@Composable
fun CaptureScreen(covers: CoverStore, start: CaptureMode, showTabs: Boolean, onDone: (CaptureResult) -> Unit) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var asked by remember { mutableStateOf(false) }
    val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) askCamera.launch(Manifest.permission.CAMERA) }

    var mode by remember { mutableStateOf(start) }
    var isbn by remember { mutableStateOf<String?>(null) }
    var torch by remember { mutableStateOf(false) }
    val finish = { photoId: String? -> onDone(CaptureResult(isbn, photoId)) }

    // A picture from the gallery is used whole (it is usually a cover already), resized like a photo.
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) finish(storeGalleryImage(context, covers, uri))
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            granted && mode == CaptureMode.Isbn ->
                IsbnCamera(torch, onIsbn = { isbn = it; if (showTabs) mode = CaptureMode.Cover else finish(null) })
            granted -> CoverCamera(covers, torch, onPhoto = { finish(it) }, onGallery = {
                pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            })
            asked -> Text(stringResource(R.string.add_cameraDenied), Modifier.align(Alignment.Center).padding(32.dp), color = Color.White)
        }

        // Top: close (keeping what was captured) and the torch.
        Row(Modifier.fillMaxWidth().systemBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledTonalIconButton(onClick = { finish(null) }) {
                Icon(if (isbn != null) Icons.Default.Check else Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
            }
            Spacer(Modifier.weight(1f))
            isbn?.let {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                    Text("ISBN ${formatIsbn(it)} ✓", Modifier.padding(horizontal = 12.dp, vertical = 6.dp), style = MaterialTheme.typography.labelLarge)
                }
                Spacer(Modifier.weight(1f))
            }
            FilledTonalIconButton(onClick = { torch = !torch }) {
                Icon(if (torch) Icons.Default.FlashOff else Icons.Default.FlashOn, contentDescription = stringResource(R.string.add_torch))
            }
        }

        if (showTabs) {
            Row(
                Modifier.align(Alignment.BottomCenter).systemBarsPadding().padding(bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ModeTab(stringResource(R.string.capture_isbn), mode == CaptureMode.Isbn) { mode = CaptureMode.Isbn }
                ModeTab(stringResource(R.string.capture_cover), mode == CaptureMode.Cover) { mode = CaptureMode.Cover }
            }
        }
    }
}

@Composable
private fun ModeTab(label: String, selected: Boolean, onClick: () -> Unit) {
    if (selected) Button(onClick = onClick) { Text(label) }
    else TextButton(onClick = onClick) { Text(label, color = Color.White) }
}

@Composable
private fun CameraPreview(controller: LifecycleCameraController, torch: Boolean) {
    val owner = LocalLifecycleOwner.current
    AndroidView(
        factory = { ctx -> PreviewView(ctx).apply { this.controller = controller; controller.bindToLifecycle(owner) } },
        modifier = Modifier.fillMaxSize(),
    )
    LaunchedEffect(torch) { controller.enableTorch(torch) }
    // Switching between the ISBN and cover tabs swaps controllers: release the camera for the next one.
    DisposableEffect(controller) { onDispose { controller.unbind() } }
}

/**
 * Corner brackets around the frame, a light dimming outside it and an instruction centred inside.
 * The frame is computed from the view size by [shape] and reported with [onFrame].
 */
@Composable
private fun Viewfinder(hint: String, highlight: Boolean, onFrame: (PixelRect) -> Unit, shape: (w: Float, h: Float) -> PixelRect) {
    val accent = MaterialTheme.colorScheme.primary
    var frame by remember { mutableStateOf<PixelRect?>(null) }
    val density = LocalDensity.current
    Box(Modifier.fillMaxSize()) {
        Canvas(
            Modifier.fillMaxSize().onSizeChanged { size ->
                shape(size.width.toFloat(), size.height.toFloat()).also { frame = it; onFrame(it) }
            },
        ) {
            val f = frame ?: return@Canvas
            val rect = Rect(f.left, f.top, f.right, f.bottom)
            val outside = Path().apply {
                fillType = PathFillType.EvenOdd
                addRect(Rect(0f, 0f, size.width, size.height))
                addRoundRect(RoundRect(rect, CornerRadius(32f)))
            }
            drawPath(outside, Color.Black.copy(alpha = 0.35f))
            val color = if (highlight) accent else Color.White
            val arm = minOf(rect.width, rect.height) * 0.18f
            val stroke = with(density) { 4.dp.toPx() }
            for ((corner, dx, dy) in listOf(
                Triple(rect.topLeft, 1f, 1f), Triple(rect.topRight, -1f, 1f),
                Triple(rect.bottomLeft, 1f, -1f), Triple(rect.bottomRight, -1f, -1f),
            )) {
                drawLine(color, corner, Offset(corner.x + dx * arm, corner.y), stroke, StrokeCap.Round)
                drawLine(color, corner, Offset(corner.x, corner.y + dy * arm), stroke, StrokeCap.Round)
            }
        }
        frame?.let { f ->
            with(density) {
                Box(
                    Modifier.padding(start = f.left.toDp(), top = f.top.toDp()).size(f.width.toDp(), f.height.toDp()),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(hint, color = Color.White, textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(16.dp))
                }
            }
        }
    }
}

private fun PixelRect.contains(x: Float, y: Float) = x in left..right && y in top..bottom

/**
 * EAN-13 scanning on the device (ML Kit, bundled model: works offline). Only codes inside the frame count,
 * and a valid ISBN waits for confirmation. Codes that are not ISBNs (magazines, products) say why.
 */
@Composable
private fun IsbnCamera(torch: Boolean, onIsbn: (String) -> Unit) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    var notIsbn by remember { mutableStateOf<String?>(null) }
    var detected by remember { mutableStateOf<String?>(null) }
    var frame by remember { mutableStateOf<PixelRect?>(null) }
    val controller = remember {
        LifecycleCameraController(context).apply {
            // Preview + analysis only: some phones refuse preview + capture + analysis at once and keep
            // reopening the camera. A 720p+ frame keeps a book's small barcode readable from ~20 cm.
            setEnabledUseCases(CameraController.IMAGE_ANALYSIS)
            imageAnalysisResolutionSelector =
                ResolutionSelector.Builder()
                    .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build()
            val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_EAN_13).build())
            setImageAnalysisAnalyzer(
                ContextCompat.getMainExecutor(context),
                MlKitAnalyzer(listOf(scanner), CameraController.COORDINATE_SYSTEM_VIEW_REFERENCED, ContextCompat.getMainExecutor(context)) { r ->
                    r.getThrowable(scanner)?.let { Log.w(TAG, "barcode analysis failed", it) }
                    if (detected != null) return@MlKitAnalyzer
                    val box = frame ?: return@MlKitAnalyzer
                    // Coordinates are the preview's, the same space the frame is drawn in.
                    val code = r.getValue(scanner)?.firstOrNull { b ->
                        b.boundingBox?.let { box.contains(it.exactCenterX(), it.exactCenterY()) } == true
                    } ?: return@MlKitAnalyzer
                    val raw = code.rawValue ?: return@MlKitAnalyzer
                    when (val isbn = normalizeIsbn(raw)) {
                        is IsbnResult.Ok -> {
                            detected = isbn.isbn13
                            notIsbn = null
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        }
                        is IsbnResult.Invalid -> notIsbn = isbn.reason
                    }
                },
            )
        }
    }
    Box(Modifier.fillMaxSize()) {
        CameraPreview(controller, torch)
        // A wide rectangle, the shape of a book's barcode.
        Viewfinder(stringResource(R.string.capture_isbnHint), highlight = detected != null, onFrame = { frame = it }) { w, h ->
            val fw = w * 0.8f
            val fh = fw * 0.45f
            val top = h * 0.4f - fh / 2
            PixelRect((w - fw) / 2, top, (w + fw) / 2, top + fh)
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().systemBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 72.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val isbn = detected
            if (isbn != null) {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(str(R.string.add_detected, "isbn" to formatIsbn(isbn)), style = MaterialTheme.typography.titleMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { onIsbn(isbn) }) { Text(stringResource(R.string.add_useIsbn)) }
                            OutlinedButton(onClick = { detected = null }) { Text(stringResource(R.string.add_scanAgain)) }
                        }
                    }
                }
            } else {
                notIsbn?.let { reason ->
                    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.errorContainer) {
                        Text(
                            str(R.string.add_notIsbn, "reason" to stringResource(isbnReasonLabel(reason))),
                            Modifier.padding(12.dp),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Cover photo inside a portrait frame (2:3, like a book). The picture is cropped to the frame, made
 * upright and resized to 1600 px, then stored under its SHA-256, which is the id the server will give it,
 * so the book can reference it before it is uploaded.
 */
@Composable
private fun CoverCamera(covers: CoverStore, torch: Boolean, onPhoto: (assetId: String) -> Unit, onGallery: () -> Unit) {
    val context = LocalContext.current
    var busy by remember { mutableStateOf(false) }
    var frame by remember { mutableStateOf<PixelRect?>(null) }
    var view by remember { mutableStateOf(0 to 0) }
    val controller = remember { LifecycleCameraController(context).apply { setEnabledUseCases(CameraController.IMAGE_CAPTURE) } }
    Box(Modifier.fillMaxSize().onSizeChanged { view = it.width to it.height }) {
        CameraPreview(controller, torch)
        Viewfinder(stringResource(R.string.capture_coverHint), highlight = false, onFrame = { frame = it }) { w, h ->
            // As large as fits between the top buttons and the shutter.
            val fh = minOf(h * 0.6f, w * 0.8f * 1.5f)
            val fw = fh / 1.5f
            val top = h * 0.44f - fh / 2
            PixelRect((w - fw) / 2, top, (w + fw) / 2, top + fh)
        }
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().systemBarsPadding().padding(bottom = 72.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onGallery, modifier = Modifier.size(56.dp).border(BorderStroke(2.dp, Color.White), CircleShape)) {
                Icon(Icons.Default.PhotoLibrary, contentDescription = stringResource(R.string.capture_gallery), tint = Color.White)
            }
            // Shutter: a white disc inside a ring.
            Box(Modifier.size(80.dp).border(BorderStroke(4.dp, Color.White), CircleShape).padding(8.dp)) {
                Surface(
                    onClick = {
                        busy = true
                        controller.takePicture(
                            ContextCompat.getMainExecutor(context),
                            object : ImageCapture.OnImageCapturedCallback() {
                                override fun onCaptureSuccess(image: ImageProxy) {
                                    onPhoto(store(covers, image.use { toJpeg(it, view.first, view.second, frame) }))
                                }

                                override fun onError(exception: ImageCaptureException) {
                                    busy = false
                                }
                            },
                        )
                    },
                    enabled = !busy && frame != null,
                    shape = CircleShape,
                    color = if (busy) Color.Gray else Color.White,
                    modifier = Modifier.fillMaxSize(),
                ) {}
            }
            // Keeps the shutter centred.
            Spacer(Modifier.size(56.dp))
        }
    }
}

private fun store(covers: CoverStore, bytes: ByteArray): String = sha256Hex(bytes).also { covers.put(it, bytes) }

private fun storeGalleryImage(context: Context, covers: CoverStore, uri: Uri): String? =
    runCatching {
        val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { d, _, _ ->
            d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        store(covers, compress(bmp))
    }.onFailure { Log.w(TAG, "could not read the picked image", it) }.getOrNull()

private fun toJpeg(image: ImageProxy, viewW: Int, viewH: Int, frame: PixelRect?): ByteArray {
    var bmp = image.toBitmap()
    val rotation = image.imageInfo.rotationDegrees
    if (rotation != 0) {
        bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
    }
    if (frame != null && viewW > 0 && viewH > 0) {
        val c = frameInImage(bmp.width, bmp.height, viewW, viewH, frame)
        if (c.width >= 20 && c.height >= 20) {
            bmp = Bitmap.createBitmap(bmp, c.left.toInt(), c.top.toInt(), c.width.toInt(), c.height.toInt())
        }
    }
    return compress(bmp)
}

private fun compress(source: Bitmap): ByteArray {
    val scale = minOf(1f, 1600f / maxOf(source.width, source.height))
    val bmp = if (scale < 1f) Bitmap.createScaledBitmap(source, (source.width * scale).toInt(), (source.height * scale).toInt(), true) else source
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
}

fun isbnReasonLabel(reason: String): Int =
    when (reason) {
        "issn" -> R.string.isbn_issn
        "ismn" -> R.string.isbn_ismn
        "ean" -> R.string.isbn_ean
        "checksum" -> R.string.isbn_checksum
        "format" -> R.string.isbn_format
        else -> R.string.isbn_length
    }
