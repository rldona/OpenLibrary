package io.github.rldona.openlibrary.ui.capture

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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.LibraryBooks
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.BulkItem
import io.github.rldona.openlibrary.sync.BulkScan
import io.github.rldona.openlibrary.sync.pathOf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout

class BulkScanViewModel(c: AppContainer) : ViewModel() {
    val locations = c.db.catalog().locations()
    var locationId by mutableStateOf<String?>(null)
    /** "Already in this list": shown briefly after scanning the same book twice. */
    var repeated by mutableStateOf<String?>(null)

    private suspend fun api(c: AppContainer) = c.sessions.session.first()?.let { c.api(it.serverUrl, it.token) }

    val scan =
        BulkScan(
            c.db,
            c.writes,
            c.appScope,
            lookup = { isbn -> api(c)?.let { withTimeout(8_000) { it.lookup(isbn) } } },
            fetchCover = { url -> api(c)?.let { withTimeout(10_000) { it.fetchAsset(url).id } } },
        )

    fun scanned(isbn13: String) {
        repeated = if (scan.add(isbn13, locationId)) null else isbn13
    }
}

/**
 * Scan a whole shelf (bulk entry): every barcode read inside the frame is added straight away, no
 * confirmation, and listed below with what was found. Tap a book to open it.
 */
@OptIn(ExperimentalMaterial3Api::class)
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

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().weight(0.55f).background(Color.Black)) {
            when {
                granted -> ContinuousIsbnCamera(torch, vm::scanned)
                asked -> Text(stringResource(R.string.add_cameraDenied), Modifier.align(Alignment.Center).padding(32.dp), color = Color.White)
            }
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                FilledTonalIconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close)) }
                Spacer(Modifier.weight(1f))
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primaryContainer) {
                    Text(
                        plural(R.string.bulk_added_one, R.string.bulk_added_other, added),
                        Modifier.padding(horizontal = 12.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite },
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                Spacer(Modifier.weight(1f))
                FilledTonalIconButton(onClick = { torch = !torch }) {
                    Icon(if (torch) Icons.Default.FlashOff else Icons.Default.FlashOn, contentDescription = stringResource(R.string.add_torch))
                }
            }
            vm.repeated?.let {
                Surface(
                    Modifier.align(Alignment.BottomCenter).padding(12.dp),
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Text(str(R.string.bulk_repeated, "isbn" to formatIsbn(it)), Modifier.padding(10.dp))
                }
            }
        }

        Column(Modifier.fillMaxWidth().weight(0.45f).navigationBarsPadding()) {
            LocationPicker(locations.associateBy { it.id }, vm.locationId) { vm.locationId = it }
            if (items.isEmpty()) {
                Text(stringResource(R.string.bulk_hint), Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium)
            }
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.isbn13 }) { item ->
                    ItemRow(item, onOpen = { item.workId?.let(onOpen) }, onAddCopy = { vm.scan.addCopy(item, vm.locationId) })
                    HorizontalDivider()
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LocationPicker(
    byId: Map<String, io.github.rldona.openlibrary.data.LocationEntity>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val name = { id: String? -> id?.let { pathOf(byId, it).joinToString(" › ") } }
    val none = stringResource(R.string.copy_noLocation)
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp)) {
        OutlinedTextField(
            value = name(selected) ?: none,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.bulk_location)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(none) }, onClick = { onSelect(null); open = false })
            byId.keys.map { it to name(it).orEmpty() }.sortedBy { it.second }.forEach { (id, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { onSelect(id); open = false })
            }
        }
    }
}

@Composable
private fun ItemRow(item: BulkItem, onOpen: () -> Unit, onAddCopy: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = item.workId != null, onClick = onOpen).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (item.state) {
            BulkItem.State.LookingUp -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            BulkItem.State.Added -> Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
            BulkItem.State.AddedProvisional -> Icon(Icons.Default.EditNote, null, tint = MaterialTheme.colorScheme.tertiary)
            BulkItem.State.Owned -> Icon(Icons.Default.LibraryBooks, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.weight(1f)) {
            Text(item.title ?: formatIsbn(item.isbn13), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                stringResource(
                    when (item.state) {
                        BulkItem.State.LookingUp -> R.string.bulk_lookingUp
                        BulkItem.State.Added -> R.string.bulk_addedOne
                        BulkItem.State.AddedProvisional -> R.string.bulk_provisional
                        BulkItem.State.Owned -> R.string.bulk_owned
                    },
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (item.state == BulkItem.State.Owned) TextButton(onClick = onAddCopy) { Text(stringResource(R.string.bulk_addCopy)) }
    }
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
