package io.github.rldona.openlibrary.ui.capture

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.sha256Hex
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.CoverStore
import java.io.ByteArrayOutputStream

/** Asks for the camera once; shows a hint instead of the content if it is refused. */
@Composable
private fun WithCamera(content: @Composable () -> Unit) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var asked by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }
    if (granted) content()
    else if (asked) Text(stringResource(R.string.add_cameraDenied), Modifier.padding(24.dp))
}

@Composable
private fun CameraPreview(controller: LifecycleCameraController) {
    val owner = LocalLifecycleOwner.current
    AndroidView(
        factory = { ctx -> PreviewView(ctx).apply { this.controller = controller; controller.bindToLifecycle(owner) } },
        modifier = Modifier.fillMaxSize(),
    )
}

/**
 * Scans EAN-13 barcodes on the device (ML Kit, bundled model: works offline). Codes that are not ISBNs
 * (ISSN of magazines, product EANs) show why and scanning goes on.
 */
@Composable
fun ScannerScreen(onIsbn: (String) -> Unit) = WithCamera {
    val context = LocalContext.current
    var notIsbn by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }
    val controller = remember {
        LifecycleCameraController(context).apply {
            val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_EAN_13).build())
            setImageAnalysisAnalyzer(
                ContextCompat.getMainExecutor(context),
                MlKitAnalyzer(listOf(scanner), CameraController.COORDINATE_SYSTEM_VIEW_REFERENCED, ContextCompat.getMainExecutor(context)) { r ->
                    val raw = r.getValue(scanner)?.firstOrNull()?.rawValue ?: return@MlKitAnalyzer
                    if (done) return@MlKitAnalyzer
                    when (val isbn = normalizeIsbn(raw)) {
                        is IsbnResult.Ok -> { done = true; onIsbn(isbn.isbn13) }
                        is IsbnResult.Invalid -> notIsbn = isbn.reason
                    }
                },
            )
        }
    }
    Box(Modifier.fillMaxSize()) {
        CameraPreview(controller)
        Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.add_scanHint))
                notIsbn?.let { reason ->
                    Text(str(R.string.add_notIsbn, "reason" to stringResource(isbnReasonLabel(reason))), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
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

/**
 * Cover photo. Stored on the phone (resized to 1600 px, upright) under its SHA-256, which is the id the
 * server will give it, so the book can reference it before it is uploaded.
 */
@Composable
fun PhotoScreen(covers: CoverStore, onPhoto: (assetId: String) -> Unit) = WithCamera {
    val context = LocalContext.current
    var busy by remember { mutableStateOf(false) }
    val controller = remember { LifecycleCameraController(context).apply { setEnabledUseCases(CameraController.IMAGE_CAPTURE) } }
    Box(Modifier.fillMaxSize()) {
        CameraPreview(controller)
        Button(
            onClick = {
                busy = true
                controller.takePicture(
                    ContextCompat.getMainExecutor(context),
                    object : ImageCapture.OnImageCapturedCallback() {
                        override fun onCaptureSuccess(image: ImageProxy) {
                            val bytes = image.use { toJpeg(it) }
                            val id = sha256Hex(bytes)
                            covers.put(id, bytes)
                            onPhoto(id)
                        }

                        override fun onError(exception: ImageCaptureException) {
                            busy = false
                        }
                    },
                )
            },
            enabled = !busy,
            modifier = Modifier.align(Alignment.BottomCenter).padding(32.dp),
        ) { Text(stringResource(R.string.add_capture)) }
    }
}

private fun toJpeg(image: ImageProxy): ByteArray {
    var bmp = image.toBitmap()
    val rotation = image.imageInfo.rotationDegrees
    val scale = minOf(1f, 1600f / maxOf(bmp.width, bmp.height))
    if (rotation != 0 || scale < 1f) {
        val m = Matrix().apply { postScale(scale, scale); postRotate(rotation.toFloat()) }
        bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    }
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
}
