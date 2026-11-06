package io.github.rldona.openlibrary.ui.capture

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Rotate90DegreesCw
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberSliderState
import io.github.rldona.openlibrary.ui.components.BarTitle
import io.github.rldona.openlibrary.ui.components.BusyLabel
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.Affine
import io.github.rldona.openlibrary.core.COVER_RATIO
import io.github.rldona.openlibrary.core.CoverEditState
import io.github.rldona.openlibrary.core.CropHandle
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.hitTest
import io.github.rldona.openlibrary.core.resizeCrop
import io.github.rldona.openlibrary.core.rotateQuarter
import io.github.rldona.openlibrary.core.setRatioLocked
import io.github.rldona.openlibrary.core.sourceToWork
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.core.straighten
import java.io.File
import java.util.Locale
import kotlin.math.min

/**
 * Crops a cover out of the picture in [file] before it is stored: drag the corners and edges (2:3 by
 * default, or free), move the crop, turn the picture a quarter and straighten it up to 45° either way.
 * Back cancels. [busy] shows the crop is being saved; [failed] that it could not be.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CoverEditor(
    file: File,
    state: CoverEditState,
    busy: Boolean,
    failed: Boolean,
    onState: (CoverEditState) -> Unit,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    // Always handled: while saving, Back must not reach the navigation either.
    BackHandler { if (!busy) onCancel() }
    var preview by remember(file) { mutableStateOf<ImageBitmap?>(null) }
    var unreadable by remember(file) { mutableStateOf(false) }
    LaunchedEffect(file) {
        val loaded = loadPreview(file)
        if (loaded == null) unreadable = true else preview = loaded
    }
    // The crop before the slider started moving, so it can grow back while straightening. Any other edit
    // starts from the new state.
    var straightenFrom by remember { mutableStateOf<CoverEditState?>(null) }
    val edit = { next: CoverEditState -> straightenFrom = null; onState(next) }

    val ready = preview != null && !busy
    // The slider's own state, kept in step with the edit (rotating or resetting moves the thumb too).
    val angle = rememberSliderState(value = state.angleDeg, trackRange = -45f..45f)
    angle.value = state.angleDeg
    val onDark = SegmentedButtonDefaults.colors(
        activeContainerColor = MaterialTheme.colorScheme.primaryContainer,
        activeContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        inactiveContainerColor = Color.Transparent,
        inactiveContentColor = Color.White,
        inactiveBorderColor = Color.White.copy(alpha = 0.6f),
        activeBorderColor = Color.White.copy(alpha = 0.6f),
    )

    CompositionLocalProvider(LocalContentColor provides Color.White) {
        Column(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding()) {
            // ✕ cancels, "Use photo" keeps the crop: the usual place for a photo editor's two ways out.
            TopAppBar(
                title = { BarTitle(stringResource(R.string.capture_cropTitle)) },
                navigationIcon = {
                    IconButton(onClick = onCancel, enabled = !busy) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_cancel))
                    }
                },
                actions = {
                    Button(onClick = onConfirm, enabled = ready, modifier = Modifier.padding(end = 8.dp)) {
                        BusyLabel(busy, stringResource(if (busy) R.string.common_saving else R.string.capture_usePhoto))
                    }
                },
                windowInsets = WindowInsets(0),
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Black,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
            )
            // Inner margin: drags near the screen edges would be taken by the system gestures.
            Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().padding(horizontal = 32.dp, vertical = 16.dp), contentAlignment = Alignment.Center) {
                val image = preview
                when {
                    image != null -> CropCanvas(image, state, enabled = !busy, onState = edit)
                    unreadable -> Text(stringResource(R.string.capture_imageFailed), color = Color.White)
                    else -> CircularProgressIndicator()
                }
            }
            if (failed) {
                Text(
                    stringResource(R.string.capture_cropFailed),
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { edit(rotateQuarter(state)) }, enabled = ready) {
                    Icon(Icons.Default.Rotate90DegreesCw, contentDescription = stringResource(R.string.capture_rotate))
                }
                Text(stringResource(R.string.capture_straighten), style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.size(8.dp))
                Text(str(R.string.capture_angle, "deg" to String.format(Locale.getDefault(), "%.1f", state.angleDeg)))
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { edit(straighten(state, 0f)) }, enabled = ready && state.angleDeg != 0f) {
                    Text(stringResource(R.string.capture_resetAngle))
                }
            }
            val straightenLabel = stringResource(R.string.capture_straighten)
            Slider(
                state = angle,
                onValueChange = { value ->
                    val from = straightenFrom ?: state.also { straightenFrom = it }
                    onState(straighten(from, value))
                },
                onValueChangeFinished = { straightenFrom = null },
                enabled = ready,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).semantics { contentDescription = straightenLabel },
            )
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(16.dp)) {
                listOf(true to R.string.capture_ratioCover, false to R.string.capture_ratioFree).forEachIndexed { i, (locked, label) ->
                    SegmentedButton(
                        selected = state.ratioLocked == locked,
                        onClick = { edit(setRatioLocked(state, locked)) },
                        shape = SegmentedButtonDefaults.itemShape(i, 2),
                        enabled = ready,
                        colors = onDark,
                    ) { Text(stringResource(label)) }
                }
            }
        }
    }
}

private fun Affine.toCompose() = Matrix().apply {
    values[Matrix.ScaleX] = a
    values[Matrix.SkewX] = b
    values[Matrix.TranslateX] = c
    values[Matrix.SkewY] = d
    values[Matrix.ScaleY] = e
    values[Matrix.TranslateY] = f
}

/** The picture fitted to the area, turned and straightened, with the crop drawn and dragged over it. */
@Composable
private fun CropCanvas(preview: ImageBitmap, state: CoverEditState, enabled: Boolean, onState: (CoverEditState) -> Unit) {
    val areaLabel = stringResource(R.string.capture_cropArea)
    val density = LocalDensity.current
    val slop = with(density) { 24.dp.toPx() }
    val stroke = with(density) { 3.dp.toPx() }
    val hairline = with(density) { 1.dp.toPx() }
    var area by remember { mutableStateOf(IntSize.Zero) }
    var dragging by remember { mutableStateOf(false) }
    val workW = state.workWidth.toFloat()
    val workH = state.workHeight.toFloat()
    val scale = if (area.width == 0 || area.height == 0) 1f else min(area.width / workW, area.height / workH)
    val toScreen = Affine.scale(scale) then Affine.translate((area.width - workW * scale) / 2, (area.height - workH * scale) / 2)
    val current by rememberUpdatedState(state)
    val view by rememberUpdatedState(toScreen)
    val viewScale by rememberUpdatedState(scale)
    val update by rememberUpdatedState(onState)
    val active by rememberUpdatedState(enabled)

    Canvas(
        Modifier
            .fillMaxSize()
            .onSizeChanged { area = it }
            .semantics { contentDescription = areaLabel }
            .pointerInput(Unit) {
                var handle: CropHandle? = null
                var start = current.crop
                var total = Offset.Zero
                detectDragGestures(
                    onDragStart = { pos ->
                        if (!active) {
                            handle = null
                            return@detectDragGestures
                        }
                        val x = (pos.x - view.c) / viewScale
                        val y = (pos.y - view.f) / viewScale
                        handle = hitTest(current.crop, x, y, slop / viewScale)
                        start = current.crop
                        total = Offset.Zero
                        dragging = handle != null
                    },
                    onDragEnd = { handle = null; dragging = false },
                    onDragCancel = { handle = null; dragging = false },
                ) { change, amount ->
                    val h = handle
                    if (h != null && active) {
                        change.consume()
                        total += amount
                        val s = current
                        val minSize = min(slop * 2 / viewScale, min(s.workWidth, s.workHeight) / 4f)
                        val ratio = if (s.ratioLocked) COVER_RATIO else null
                        val crop = resizeCrop(start, h, total.x / viewScale, total.y / viewScale, ratio, minSize, s.workWidth, s.workHeight, s.angleDeg)
                        update(s.copy(crop = crop))
                    }
                }
            },
    ) {
        if (area == IntSize.Zero) return@Canvas
        withTransform({ transform((sourceToWork(state) then toScreen).toCompose()) }) {
            drawImage(preview, dstSize = IntSize(state.imageWidth, state.imageHeight), filterQuality = FilterQuality.Low)
        }
        val crop: PixelRect = state.crop
        val (left, top) = toScreen.map(crop.left, crop.top)
        val (right, bottom) = toScreen.map(crop.right, crop.bottom)
        val rect = Rect(left, top, right, bottom)
        val outside = Path().apply {
            fillType = PathFillType.EvenOdd
            addRect(Rect(-size.width, -size.height, size.width * 2, size.height * 2))
            addRect(rect)
        }
        drawPath(outside, Color.Black.copy(alpha = 0.6f))
        if (dragging) {
            for (i in 1..2) {
                val x = rect.left + rect.width * i / 3
                val y = rect.top + rect.height * i / 3
                drawLine(Color.White.copy(alpha = 0.6f), Offset(x, rect.top), Offset(x, rect.bottom), hairline)
                drawLine(Color.White.copy(alpha = 0.6f), Offset(rect.left, y), Offset(rect.right, y), hairline)
            }
        }
        drawRect(Color.White, rect.topLeft, rect.size, style = Stroke(hairline))
        val arm = min(with(density) { 20.dp.toPx() }, min(rect.width, rect.height) / 3)
        for ((corner, dx, dy) in listOf(
            Triple(rect.topLeft, 1f, 1f), Triple(rect.topRight, -1f, 1f),
            Triple(rect.bottomLeft, 1f, -1f), Triple(rect.bottomRight, -1f, -1f),
        )) {
            drawLine(Color.White, corner, Offset(corner.x + dx * arm, corner.y), stroke, StrokeCap.Square)
            drawLine(Color.White, corner, Offset(corner.x, corner.y + dy * arm), stroke, StrokeCap.Square)
        }
    }
}
