package io.github.rldona.openlibrary.ui.capture

import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.selected
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.ToggleButton
import io.github.rldona.openlibrary.ui.components.Pill
import android.Manifest
import android.content.pm.PackageManager
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.CoverEditState
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.frameInImage
import io.github.rldona.openlibrary.core.initialEditState
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.network.MetadataCandidate
import io.github.rldona.openlibrary.network.MetadataSearchResult
import io.github.rldona.openlibrary.sync.CoverStore
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "OpenLibraryScanner"

enum class CaptureMode { Isbn, Cover, Identify }

/** What the capture screen hands back to the book form; any part may be missing. */
data class CaptureResult(
    val isbn: String?,
    val photoId: String?,
    val candidate: MetadataCandidate? = null,
)

/** Title/author text read on a cover, looked up by the server. */
typealias IdentifySearch = suspend (title: String, author: String?) -> MetadataSearchResult

/** A picture in the crop editor: the prepared file and how it is being cropped. */
private data class EditSession(val path: String, val state: CoverEditState)

/** Keeps the editing session across configuration changes and process death, as plain values. */
private val EditSessionSaver = listSaver<EditSession?, Any>(
    save = { e ->
        if (e == null) emptyList()
        else with(e.state) {
            listOf(e.path, imageWidth, imageHeight, crop.left, crop.top, crop.right, crop.bottom, quarterTurns, angleDeg, ratioLocked)
        }
    },
    restore = { v ->
        if (v.size < 10) null
        else EditSession(
            v[0] as String,
            CoverEditState(
                imageWidth = v[1] as Int,
                imageHeight = v[2] as Int,
                crop = PixelRect(v[3] as Float, v[4] as Float, v[5] as Float, v[6] as Float),
                quarterTurns = v[7] as Int,
                angleDeg = v[8] as Float,
                ratioLocked = v[9] as Boolean,
            ),
        )
    },
)

/**
 * Full-screen camera for adding a book, with up to three modes as tabs: ISBN (scan the barcode), Cover
 * (a photo or a picture from the gallery, then cropped in [CoverEditor]) and Identify (read the title on
 * the cover and search for it). Confirming an ISBN moves on to the cover, so a book can be captured in one
 * go; the top-left button closes and returns whatever was captured.
 */
@Composable
fun CaptureScreen(
    covers: CoverStore,
    start: CaptureMode,
    showTabs: Boolean,
    identify: IdentifySearch? = null,
    /** Open the gallery picker on entry (the form's "Choose from the gallery"); cancelling it leaves the camera. */
    startWithGallery: Boolean = false,
    onDone: (CaptureResult) -> Unit,
) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var asked by remember { mutableStateOf(false) }
    val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) askCamera.launch(Manifest.permission.CAMERA) }

    val scope = rememberCoroutineScope()
    var mode by rememberSaveable { mutableStateOf(start) }
    var isbn by rememberSaveable { mutableStateOf<String?>(null) }
    var torch by remember { mutableStateOf(false) }
    var edit by rememberSaveable(stateSaver = EditSessionSaver) { mutableStateOf<EditSession?>(null) }
    var saving by remember { mutableStateOf(false) }
    var saveFailed by remember { mutableStateOf(false) }
    val finish = { photoId: String? -> onDone(CaptureResult(isbn, photoId)) }
    val snackbar = LocalSnackbar.current
    val imageFailed = stringResource(R.string.capture_imageFailed)
    val openEditor = { image: PreparedImage?, frame: PixelRect? ->
        if (image == null) {
            snackbar.showMessage(imageFailed)
        } else {
            saveFailed = false
            edit = EditSession(image.file.path, initialEditState(image.width, image.height, frame))
        }
    }

    // Pictures left behind by earlier sessions (closed mid-edit, killed) go; a restored one stays.
    LaunchedEffect(Unit) {
        sweepEditCache(editCacheDir(context), keep = edit?.let { File(it.path) }, before = System.currentTimeMillis() - 2_000)
    }

    // A picture from the gallery starts with the largest centred 2:3 crop.
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { openEditor(prepareGalleryImage(context, uri), null) }
    }
    // Once per visit: after process death the picker's own result comes back, so it is not shown again.
    var galleryShown by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (startWithGallery && !galleryShown) {
            galleryShown = true
            pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }
    }

    val session = edit
    if (session != null) {
        // The cameras are not composed meanwhile, so they are released.
        CoverEditor(
            file = File(session.path),
            state = session.state,
            busy = saving,
            failed = saveFailed,
            onState = { state -> edit = edit?.copy(state = state) },
            onCancel = {
                scope.launch { deleteEditFile(File(session.path)) }
                edit = null
                mode = CaptureMode.Cover
            },
            onConfirm = confirm@{
                // A second tap while saving would finish (and pop the screen) twice.
                if (saving) return@confirm
                val current = edit ?: return@confirm
                saving = true
                saveFailed = false
                scope.launch {
                    val bytes = renderCrop(File(current.path), current.state)
                    if (bytes == null) {
                        saving = false
                        saveFailed = true
                        return@launch
                    }
                    val id = storeCover(covers, bytes)
                    deleteEditFile(File(current.path))
                    // Stays busy: the screen is leaving.
                    finish(id)
                }
            },
        )
        return
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            granted && mode == CaptureMode.Isbn ->
                IsbnCamera(torch, onIsbn = { isbn = it; if (showTabs) mode = CaptureMode.Cover else finish(null) })
            granted && mode == CaptureMode.Identify && identify != null ->
                IdentifyCamera(torch, search = identify, onCandidate = { onDone(CaptureResult(null, null, it)) })
            granted -> CoverCamera(torch, onPhoto = openEditor, onGallery = {
                pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            })
            asked -> CameraDenied(Modifier.align(Alignment.Center))
        }

        // Top: close (keeping what was captured) and the torch.
        Row(Modifier.fillMaxWidth().systemBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledTonalIconButton(onClick = { finish(null) }) {
                Icon(if (isbn != null) Icons.Default.Check else Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
            }
            Spacer(Modifier.weight(1f))
            isbn?.let {
                Pill("ISBN ${formatIsbn(it)} ✓")
                Spacer(Modifier.weight(1f))
            }
            FilledTonalIconButton(onClick = { torch = !torch }) {
                Icon(if (torch) Icons.Default.FlashOff else Icons.Default.FlashOn, contentDescription = stringResource(R.string.add_torch))
            }
        }

        // Messages go under the top buttons, clear of the shutter and the mode tabs.
        snackbar.ScreenHost(Modifier.align(Alignment.TopCenter).systemBarsPadding().padding(top = 64.dp), transient = true)

        if (showTabs) {
            val modes = listOfNotNull(
                CaptureMode.Isbn to R.string.capture_isbn,
                CaptureMode.Cover to R.string.capture_cover,
                (CaptureMode.Identify to R.string.capture_identify).takeIf { identify != null },
            )
            val modeLabel = stringResource(R.string.capture_mode)
            // The modes as an Expressive floating toolbar over the picture; one of them is always on.
            HorizontalFloatingToolbar(
                expanded = true,
                modifier = Modifier.align(Alignment.BottomCenter).systemBarsPadding().padding(bottom = 8.dp)
                    .semantics { contentDescription = modeLabel }
                    .selectableGroup(),
            ) {
                modes.forEach { (m, labelId) ->
                    val label = stringResource(labelId)
                    // Read as one radio button ("ISBN, selected"), not as the toggle button's checkbox inside.
                    Box(
                        Modifier.clearAndSetSemantics {
                            role = Role.RadioButton
                            selected = mode == m
                            contentDescription = label
                            onClick { mode = m; true }
                        },
                    ) {
                        ToggleButton(checked = mode == m, onCheckedChange = { mode = m }) { Text(label) }
                    }
                }
            }
        }
    }
}

/** The camera was refused: say so, and offer the app's settings page, where it can be allowed. */
@Composable
internal fun CameraDenied(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.add_cameraDenied), color = Color.White, textAlign = TextAlign.Center)
        Button(
            onClick = {
                context.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            },
        ) { Text(stringResource(R.string.add_openSettings)) }
    }
}

@Composable
internal fun CameraPreview(controller: LifecycleCameraController, torch: Boolean) {
    val owner = LocalLifecycleOwner.current
    // COMPATIBLE renders into a TextureView, which Compose clips: the default SurfaceView ignores the
    // clip, and with FILL_CENTER it spills past a preview box that does not fill the screen (bulk scan).
    // The scale type stays FILL_CENTER, which is what frameInImage assumes for the cover crop.
    AndroidView(
        factory = { ctx ->
            PreviewView(ctx).apply {
                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                scaleType = PreviewView.ScaleType.FILL_CENTER
                this.controller = controller
                controller.bindToLifecycle(owner)
            }
        },
        modifier = Modifier.fillMaxSize().clipToBounds(),
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
internal fun Viewfinder(hint: String, highlight: Boolean, onFrame: (PixelRect) -> Unit, shape: (w: Float, h: Float) -> PixelRect) {
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

internal fun PixelRect.contains(x: Float, y: Float) = x in left..right && y in top..bottom

/** The portrait 2:3 cover frame, as large as fits between the top buttons and the shutter. */
internal fun coverFrame(w: Float, h: Float): PixelRect {
    val fh = minOf(h * 0.6f, w * 0.8f * 1.5f)
    val fw = fh / 1.5f
    val top = h * 0.44f - fh / 2
    return PixelRect((w - fw) / 2, top, (w + fw) / 2, top + fh)
}

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
 * Cover photo inside a portrait frame (2:3, like a book). The picture is made upright off the main thread
 * and handed over with the frame's area in it, where the crop editor starts.
 */
@Composable
private fun CoverCamera(torch: Boolean, onPhoto: (image: PreparedImage?, frame: PixelRect?) -> Unit, onGallery: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var frame by remember { mutableStateOf<PixelRect?>(null) }
    var view by remember { mutableStateOf(0 to 0) }
    val controller = remember { LifecycleCameraController(context).apply { setEnabledUseCases(CameraController.IMAGE_CAPTURE) } }
    val shutterLabel = stringResource(R.string.add_capture)
    Box(Modifier.fillMaxSize().onSizeChanged { view = it.width to it.height }) {
        CameraPreview(controller, torch)
        Viewfinder(stringResource(R.string.capture_coverHint), highlight = false, onFrame = { frame = it }, shape = ::coverFrame)
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().systemBarsPadding().padding(bottom = 72.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedIconButton(
                onClick = onGallery,
                enabled = !busy,
                modifier = Modifier.size(56.dp),
                border = BorderStroke(2.dp, Color.White),
                colors = IconButtonDefaults.outlinedIconButtonColors(contentColor = Color.White),
            ) {
                Icon(Icons.Default.PhotoLibrary, contentDescription = stringResource(R.string.capture_gallery))
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
                                    val (viewW, viewH) = view
                                    val shown = frame
                                    // The coroutine owns the image once it starts; if it never does, close it here.
                                    val taken = AtomicBoolean(false)
                                    scope.launch {
                                        taken.set(true)
                                        val prepared = prepareCameraImage(context, image)
                                        val crop = if (prepared != null && shown != null && viewW > 0 && viewH > 0) {
                                            frameInImage(prepared.width, prepared.height, viewW, viewH, shown)
                                        } else {
                                            null
                                        }
                                        busy = false
                                        onPhoto(prepared, crop)
                                    }.invokeOnCompletion { if (!taken.get()) image.close() }
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
                    modifier = Modifier.fillMaxSize().semantics {
                        contentDescription = shutterLabel
                        role = Role.Button
                    },
                ) {}
            }
            // Keeps the shutter centred.
            Spacer(Modifier.size(56.dp))
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
