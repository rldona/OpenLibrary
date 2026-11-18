package io.github.rldona.openlibrary.ui.capture

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.languageName
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.network.MetadataCandidate
import io.github.rldona.openlibrary.sync.BulkItem
import io.github.rldona.openlibrary.sync.BulkScan
import io.github.rldona.openlibrary.ui.book.PlaceRow
import io.github.rldona.openlibrary.ui.components.BookTitle
import io.github.rldona.openlibrary.ui.components.Cover
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import io.github.rldona.openlibrary.ui.components.LocationSheet
import io.github.rldona.openlibrary.ui.components.Pill
import io.github.rldona.openlibrary.ui.components.PillTone
import io.github.rldona.openlibrary.ui.components.placePath
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import androidx.compose.runtime.setValue

/** How long a book shown as saved can still be undone before it is written. */
private const val UNDO_MS = 8_000L

class ScanViewModel(private val c: AppContainer) : ViewModel() {
    val locations = c.db.catalog().locations()
    val covers = c.covers
    var locationId by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch { locationId = c.libraryPrefs.lastLocation.first() }
    }

    private suspend fun api() = c.sessions.session.first()?.let { c.api(it.serverUrl, it.token) }

    val scan =
        BulkScan(
            c.db,
            c.writes,
            c.appScope,
            lookup = { isbn -> api()?.let { withTimeout(8_000) { it.lookup(isbn) } } },
            fetchCover = { url -> api()?.let { withTimeout(10_000) { it.fetchAsset(url).id } } },
            downloadCover = { id -> if (!c.covers.has(id)) api()?.let { c.covers.put(id, withTimeout(10_000) { it.asset(id) }) } },
            graceMs = UNDO_MS,
        )

    /** The cover search, through the server. */
    val identify: IdentifySearch = { title, author ->
        api()?.search(title, author) ?: throw IOException("Not connected")
    }

    /** Pages of a candidate with an ISBN (the cover search does not carry them), for the confirmation. */
    suspend fun pagesOf(isbn13: String): Int? =
        runCatching { api()?.let { withTimeout(8_000) { it.lookup(isbn13) } }?.proposal?.pages }.getOrNull()

    fun setLocation(id: String?) {
        locationId = id
        viewModelScope.launch { c.libraryPrefs.setLastLocation(id) }
    }

    /** False when the book is already in this list. */
    fun scanned(isbn13: String): Boolean = scan.add(isbn13, locationId)

    /** Saves the identified book here; the cover photo is kept only if it is needed. */
    fun saveCandidate(candidate: MetadataCandidate, snapshot: ByteArray?) {
        viewModelScope.launch {
            val photo = if (candidate.coverUrl == null && snapshot != null) storeCover(c.covers, snapshot) else null
            scan.addCandidate(candidate, photo, locationId)
        }
    }

    /** The photo kept for "Type it by hand" (when no provider has a cover). */
    suspend fun keepSnapshot(candidate: MetadataCandidate?, snapshot: ByteArray?): String? =
        if (candidate?.coverUrl == null && snapshot != null) storeCover(c.covers, snapshot) else null

    /** The item waiting for a photo while the camera for it is open. */
    var photoFor by mutableStateOf<String?>(null)

    fun photoTaken(photoId: String) {
        photoFor?.let { scan.setPhoto(it, photoId) }
        photoFor = null
    }

    override fun onCleared() {
        // Leaving the screen any way writes what is still pending.
        scan.commitAll()
    }
}

enum class ScanMode { Code, Cover }

/**
 * One camera to add books (2a, 2b): in Code mode every barcode read is saved at once in the place shown and
 * the camera keeps going; in Cover mode the title on a cover is read and the book found is confirmed in a
 * sheet. The panel below says where books go, shows the last ones (undo, add a photo) and finishes.
 */
@Composable
fun ScanScreen(
    vm: ScanViewModel,
    start: ScanMode,
    onOpen: (workId: String) -> Unit,
    onPhoto: () -> Unit,
    onByHand: (MetadataCandidate?, photoId: String?) -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var asked by remember { mutableStateOf(false) }
    val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) askCamera.launch(Manifest.permission.CAMERA) }
    var mode by rememberSaveable { mutableStateOf(start) }
    var torch by remember { mutableStateOf(false) }
    val items by vm.scan.items.collectAsStateWithLifecycle()
    val locations by vm.locations.collectAsStateWithLifecycle(emptyList())
    val snackbar = LocalSnackbar.current
    val repeated = stringResource(R.string.bulk_repeated)
    var placing by rememberSaveable { mutableStateOf(false) }
    var result by remember { mutableStateOf<IdentifyResult?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val finish = {
        vm.scan.commitAll()
        onClose()
    }
    BackHandler(onBack = finish)

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        // The controls sit above the picture, so the frame is centred in what the camera really shows.
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledTonalIconButton(onClick = finish, Modifier.size(56.dp)) {
                Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
            }
            Spacer(Modifier.weight(1f))
            ModeSwitch(mode) { mode = it; result = null }
            Spacer(Modifier.weight(1f))
            FilledTonalIconButton(onClick = { torch = !torch }, Modifier.size(56.dp)) {
                Icon(if (torch) Icons.Default.FlashOff else Icons.Default.FlashOn, contentDescription = stringResource(R.string.add_torch))
            }
        }
        Box(Modifier.fillMaxWidth().weight(1f).clipToBounds()) {
            when {
                granted && mode == ScanMode.Code -> ContinuousIsbnCamera(torch) { isbn ->
                    if (!vm.scanned(isbn)) snackbar.showMessage(format(repeated, "isbn" to formatIsbn(isbn)))
                }
                granted -> IdentifyCamera(torch, vm.identify, paused = result != null, retry = retry) { result = it }
                asked -> CameraDenied(Modifier.align(Alignment.Center))
            }
            snackbar.ScreenHost(Modifier.align(Alignment.BottomCenter), transient = true)
        }
        Panel(
            vm,
            items = items,
            path = placePath(locations, vm.locationId),
            hint = stringResource(if (mode == ScanMode.Code) R.string.bulk_hint else R.string.scan_coverHint),
            onChangePlace = { placing = true },
            onOpen = onOpen,
            onPhoto = { key -> vm.photoFor = key; onPhoto() },
            onFinish = finish,
        )
    }

    result?.let { r ->
        CandidateSheet(
            vm,
            r,
            placeName = locations.firstOrNull { it.id == vm.locationId }?.name,
            onSave = { candidate ->
                vm.saveCandidate(candidate, r.snapshot)
                result = null
            },
            onRetake = { result = null; retry++ },
            onByHand = { candidate ->
                scope.launch {
                    val photo = vm.keepSnapshot(candidate, r.snapshot)
                    result = null
                    onByHand(candidate, photo)
                }
            },
        )
    }
    if (placing) {
        LocationSheet(
            locations,
            lastUsedId = vm.locationId,
            initial = vm.locationId,
            allowNone = true,
            onConfirm = { vm.setLocation(it); placing = false },
            onDismiss = { placing = false },
        )
    }
}

@Composable
private fun ModeSwitch(mode: ScanMode, onMode: (ScanMode) -> Unit) {
    Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.padding(4.dp).selectableGroup()) {
            listOf(ScanMode.Code to R.string.scan_code, ScanMode.Cover to R.string.scan_cover).forEach { (m, label) ->
                val on = m == mode
                Surface(
                    shape = RoundedCornerShape(50),
                    color = if (on) MaterialTheme.colorScheme.primary else Color.Transparent,
                    contentColor = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.heightIn(min = 48.dp).selectable(on, role = Role.Tab) { onMode(m) },
                ) {
                    Box(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), contentAlignment = Alignment.Center) {
                        Text(stringResource(label), style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
    }
}

@Composable
private fun Panel(
    vm: ScanViewModel,
    items: List<BulkItem>,
    path: String?,
    hint: String,
    onChangePlace: () -> Unit,
    onOpen: (String) -> Unit,
    onPhoto: (key: String) -> Unit,
    onFinish: () -> Unit,
) {
    val added = items.count { it.state == BulkItem.State.Added || it.state == BulkItem.State.AddedProvisional }
    Surface(
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PlaceRow(stringResource(R.string.scan_savedIn), path, onChangePlace, outlined = false)
            if (items.isEmpty()) {
                Text(
                    hint,
                    Modifier.padding(horizontal = 8.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items.take(2).forEach { item ->
                    ItemCard(
                        vm,
                        item,
                        onOpen = { item.workId?.takeIf { item.saved }?.let(onOpen) },
                        onUndo = { vm.scan.undo(item.key) },
                        onPhoto = { onPhoto(item.key) },
                        onAddCopy = { vm.scan.addCopy(item, vm.locationId) },
                    )
                }
            }
            Button(onClick = onFinish, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                Text(if (added == 0) stringResource(R.string.scan_finish) else plural(R.string.scan_finish_one, R.string.scan_finish_other, added))
            }
        }
    }
}

@Composable
private fun ItemCard(
    vm: ScanViewModel,
    item: BulkItem,
    onOpen: () -> Unit,
    onUndo: () -> Unit,
    onPhoto: () -> Unit,
    onAddCopy: () -> Unit,
) {
    val added = item.state == BulkItem.State.Added || item.state == BulkItem.State.AddedProvisional
    val noCover = added && item.coverId == null
    Surface(
        onClick = onOpen,
        enabled = item.saved && item.workId != null,
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(48.dp)) {
                if (noCover) PhotoSlot() else Cover(vm.covers, item.coverId, item.title ?: "", 48.dp, authors = item.authors)
            }
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                Text(item.title ?: item.isbn13?.let(::formatIsbn).orEmpty(), style = BookTitle.compact, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (item.authors.isNotEmpty()) {
                    Text(item.authors.joinToString(", "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Status(item, noCover)
            }
            Column(horizontalAlignment = Alignment.End) {
                when {
                    noCover -> FilledTonalButton(onClick = onPhoto, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.scan_addPhoto)) }
                    item.state == BulkItem.State.Owned -> TextButton(onClick = onAddCopy, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.bulk_addCopy))
                    }
                }
                if (added && !item.saved) {
                    TextButton(onClick = onUndo, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.common_undo)) }
                }
            }
        }
    }
}

@Composable
private fun Status(item: BulkItem, noCover: Boolean) {
    val accent = MaterialTheme.colorScheme.primary
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    when (item.state) {
        BulkItem.State.LookingUp -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
            Text(stringResource(R.string.bulk_lookingUp), style = MaterialTheme.typography.bodyMedium, color = muted)
        }
        BulkItem.State.AddedProvisional -> Text(stringResource(R.string.bulk_provisional), style = MaterialTheme.typography.bodyMedium, color = accent)
        BulkItem.State.Added ->
            if (noCover) {
                Text(stringResource(R.string.scan_savedNoCover), style = MaterialTheme.typography.bodyMedium, color = accent)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Default.Check, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
                    Text(stringResource(R.string.scan_saved), style = MaterialTheme.typography.bodyMedium, color = accent)
                }
            }
        BulkItem.State.Owned -> Text(stringResource(R.string.bulk_owned), style = MaterialTheme.typography.bodyMedium, color = muted)
        BulkItem.State.Undone -> Text(stringResource(R.string.scan_undone), style = MaterialTheme.typography.bodyMedium, color = muted)
    }
}

/** The dashed space of a cover still to be photographed. */
@Composable
private fun PhotoSlot() {
    val color = MaterialTheme.colorScheme.primary
    Box(
        Modifier.width(48.dp).aspectRatio(2f / 3f).drawBehind {
            val r = 6.dp.toPx()
            drawRoundRect(color, cornerRadius = CornerRadius(r, r), style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))))
        },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.PhotoCamera, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
    }
}

/** "Is this the book?" after reading a cover: save it, take the photo again or type it by hand. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CandidateSheet(
    vm: ScanViewModel,
    result: IdentifyResult,
    placeName: String?,
    onSave: (MetadataCandidate) -> Unit,
    onRetake: () -> Unit,
    onByHand: (MetadataCandidate?) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var index by remember(result) { mutableIntStateOf(0) }
    var showOthers by remember(result) { mutableStateOf(false) }
    val candidate = result.candidates.getOrNull(index)
    ModalBottomSheet(onDismissRequest = onRetake, sheetState = state, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val title = when {
                candidate != null -> R.string.identify_isThis
                result.failed -> R.string.identify_failedTitle
                else -> R.string.identify_noneTitle
            }
            Text(stringResource(title), Modifier.padding(horizontal = 8.dp).semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
            if (candidate == null) {
                Text(
                    stringResource(if (result.failed) R.string.identify_failed else R.string.identify_none),
                    Modifier.padding(horizontal = 8.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                CandidateCard(vm, candidate, result.snapshot)
                val others = result.candidates.size - 1
                if (others > 0) {
                    TextButton(onClick = { showOthers = !showOthers }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(str(R.string.identify_others, "n" to others))
                    }
                    if (showOthers) {
                        Column(Modifier.heightIn(max = 280.dp).verticalScroll(rememberScrollState())) {
                            result.candidates.forEachIndexed { i, other ->
                                if (i != index) CandidateRow(other) { index = i; showOthers = false }
                            }
                        }
                    }
                }
                Button(onClick = { onSave(candidate) }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Text(
                        if (placeName != null) str(R.string.identify_saveIn, "name" to placeName) else stringResource(R.string.identify_save),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onRetake, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text(stringResource(R.string.identify_retake)) }
                OutlinedButton(onClick = { onByHand(candidate) }, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
                    Text(stringResource(R.string.identify_byHand))
                }
            }
        }
    }
}

@Composable
private fun CandidateCard(vm: ScanViewModel, candidate: MetadataCandidate, snapshot: ByteArray?) {
    var pages by remember(candidate) { mutableStateOf<Int?>(null) }
    LaunchedEffect(candidate) { candidate.isbn13?.let { pages = vm.pagesOf(it) } }
    val photo = remember(snapshot) { snapshot?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            val cover = Modifier.width(72.dp).aspectRatio(2f / 3f).clip(MaterialTheme.shapes.small).background(MaterialTheme.colorScheme.surfaceVariant)
            when {
                candidate.coverUrl != null -> AsyncImage(model = candidate.coverUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = cover)
                photo != null -> Image(photo, contentDescription = null, contentScale = ContentScale.Crop, modifier = cover)
                else -> Box(cover)
            }
            Column(Modifier.weight(1f).padding(start = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(candidate.title, style = BookTitle.list, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (candidate.authors.isNotEmpty()) {
                    Text(candidate.authors.joinToString(", "), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val facts = listOfNotNull(
                    pages?.let { "$it p." },
                    candidate.language?.let(::languageName),
                    candidate.publishedYear?.toString(),
                ).joinToString(" · ")
                if (facts.isNotEmpty()) Text(facts, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (candidate.owned) Pill(stringResource(R.string.identify_owned), tone = PillTone.Neutral, small = true)
            }
        }
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
        Viewfinder(stringResource(R.string.scan_aim), highlight = flash, onFrame = { frame = it }) { w, h ->
            val fw = w * 0.8f
            val fh = fw * 0.45f
            val top = h * 0.5f - fh / 2
            PixelRect((w - fw) / 2, top, (w + fw) / 2, top + fh)
        }
    }
}
