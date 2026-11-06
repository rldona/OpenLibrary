package io.github.rldona.openlibrary.ui.capture

import androidx.compose.material.icons.automirrored.filled.LibraryBooks
import androidx.compose.material3.ListItem
import io.github.rldona.openlibrary.ui.components.BookTitle
import io.github.rldona.openlibrary.ui.components.Pill
import io.github.rldona.openlibrary.ui.components.pageListItemColors
import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.sync.BulkItem
import io.github.rldona.openlibrary.sync.BulkScan
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import io.github.rldona.openlibrary.ui.components.LocationPicker
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout

class BulkScanViewModel(c: AppContainer) : ViewModel() {
    val locations = c.db.catalog().locations()
    var locationId by mutableStateOf<String?>(null)

    private suspend fun api(c: AppContainer) = c.sessions.session.first()?.let { c.api(it.serverUrl, it.token) }

    val scan =
        BulkScan(
            c.db,
            c.writes,
            c.appScope,
            lookup = { isbn -> api(c)?.let { withTimeout(8_000) { it.lookup(isbn) } } },
            fetchCover = { url -> api(c)?.let { withTimeout(10_000) { it.fetchAsset(url).id } } },
        )

    /** False when the book is already in this list. */
    fun scanned(isbn13: String): Boolean = scan.add(isbn13, locationId)
}

/**
 * Scan a whole shelf (bulk entry): every barcode read inside the frame is added straight away, no
 * confirmation, and listed below with what was found. Tap a book to open it.
 */
@Composable
fun BulkScanScreen(vm: BulkScanViewModel, onOpen: (workId: String) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var asked by remember { mutableStateOf(false) }
    val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) askCamera.launch(Manifest.permission.CAMERA) }
    var torch by remember { mutableStateOf(false) }
    val items by vm.scan.items.collectAsStateWithLifecycle()
    val locations by vm.locations.collectAsStateWithLifecycle(emptyList())
    val added = items.count { it.state == BulkItem.State.Added || it.state == BulkItem.State.AddedProvisional }
    val snackbar = LocalSnackbar.current
    val repeated = stringResource(R.string.bulk_repeated)

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().weight(0.55f).clipToBounds().background(Color.Black)) {
            when {
                granted -> ContinuousIsbnCamera(torch) { isbn ->
                    // "Already in this list", briefly, after scanning the same book twice.
                    if (!vm.scanned(isbn)) snackbar.showMessage(format(repeated, "isbn" to formatIsbn(isbn)))
                }
                asked -> CameraDenied(Modifier.align(Alignment.Center))
            }
            // "Already in this list" shows over the camera, not over the list, and leaves with this screen.
            snackbar.ScreenHost(Modifier.align(Alignment.BottomCenter), transient = true)
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                FilledTonalIconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close)) }
                Spacer(Modifier.weight(1f))
                Pill(
                    plural(R.string.bulk_added_one, R.string.bulk_added_other, added),
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                Spacer(Modifier.weight(1f))
                FilledTonalIconButton(onClick = { torch = !torch }) {
                    Icon(if (torch) Icons.Default.FlashOff else Icons.Default.FlashOn, contentDescription = stringResource(R.string.add_torch))
                }
            }
        }

        Column(Modifier.fillMaxWidth().weight(0.45f).navigationBarsPadding()) {
            LocationPicker(
                locations,
                vm.locationId,
                { vm.locationId = it },
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp),
                label = stringResource(R.string.bulk_location),
            )
            if (items.isEmpty()) {
                Text(stringResource(R.string.bulk_hint), Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium)
            }
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.isbn13 }) { item ->
                    ItemRow(item, onOpen = { item.workId?.let(onOpen) }, onAddCopy = { vm.scan.addCopy(item, vm.locationId) })
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

@Composable
private fun ItemRow(item: BulkItem, onOpen: () -> Unit, onAddCopy: () -> Unit) {
    ListItem(
        onClick = onOpen,
        enabled = item.workId != null,
        leadingContent = {
            when (item.state) {
                BulkItem.State.LookingUp -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                BulkItem.State.Added -> Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
                BulkItem.State.AddedProvisional -> Icon(Icons.Default.EditNote, null, tint = MaterialTheme.colorScheme.tertiary)
                BulkItem.State.Owned -> Icon(Icons.AutoMirrored.Filled.LibraryBooks, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        supportingContent = {
            Text(
                stringResource(
                    when (item.state) {
                        BulkItem.State.LookingUp -> R.string.bulk_lookingUp
                        BulkItem.State.Added -> R.string.bulk_addedOne
                        BulkItem.State.AddedProvisional -> R.string.bulk_provisional
                        BulkItem.State.Owned -> R.string.bulk_owned
                    },
                ),
            )
        },
        trailingContent = if (item.state == BulkItem.State.Owned) ({ TextButton(onClick = onAddCopy) { Text(stringResource(R.string.bulk_addCopy)) } }) else null,
        colors = pageListItemColors(),
    ) { Text(item.title ?: formatIsbn(item.isbn13), style = BookTitle.compact, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}

/**
 * Continuous EAN-13 scanning: a code counts once it is read twice in a row inside the frame (filters
 * misreads), and the same code is not reported again until another one has been read.
 */
@Composable
private fun ContinuousIsbnCamera(torch: Boolean, onIsbn: (String) -> Unit) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    var frame by remember { mutableStateOf<PixelRect?>(null) }
    var last by remember { mutableStateOf<String?>(null) }
    var candidate by remember { mutableStateOf<String?>(null) }
    var flash by remember { mutableStateOf(false) }
    val controller = remember {
        LifecycleCameraController(context).apply {
            setEnabledUseCases(CameraController.IMAGE_ANALYSIS)
            imageAnalysisResolutionSelector =
                ResolutionSelector.Builder()
                    .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build()
            val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_EAN_13).build())
            setImageAnalysisAnalyzer(
                ContextCompat.getMainExecutor(context),
                MlKitAnalyzer(listOf(scanner), CameraController.COORDINATE_SYSTEM_VIEW_REFERENCED, ContextCompat.getMainExecutor(context)) { r ->
                    val box = frame ?: return@MlKitAnalyzer
                    val raw = r.getValue(scanner)?.firstOrNull { b ->
                        b.boundingBox?.let { box.contains(it.exactCenterX(), it.exactCenterY()) } == true
                    }?.rawValue
                    val isbn = (raw?.let(::normalizeIsbn) as? IsbnResult.Ok)?.isbn13
                    if (isbn == null || isbn == last) {
                        candidate = isbn
                        return@MlKitAnalyzer
                    }
                    if (candidate != isbn) {
                        candidate = isbn
                        return@MlKitAnalyzer
                    }
                    last = isbn
                    flash = true
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onIsbn(isbn)
                },
            )
        }
    }
    LaunchedEffect(flash) {
        if (flash) {
            kotlinx.coroutines.delay(600)
            flash = false
        }
    }
    Box(Modifier.fillMaxSize()) {
        CameraPreview(controller, torch)
        Viewfinder(stringResource(R.string.bulk_aim), highlight = flash, onFrame = { frame = it }) { w, h ->
            val fw = w * 0.8f
            val fh = fw * 0.45f
            val top = h * 0.5f - fh / 2
            PixelRect((w - fw) / 2, top, (w + fw) / 2, top + fh)
        }
    }
}
