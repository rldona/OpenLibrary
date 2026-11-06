package io.github.rldona.openlibrary.ui.cover

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animate
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.str
import java.io.File
import kotlin.math.abs
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** Shows the cover on the phone at once and lays the full-size one from the server over it when it arrives. */
class CoverViewModel(c: AppContainer, id: String) : ViewModel() {
    val thumb: File? = c.covers.file(id).takeIf { it.exists() }
    var full by mutableStateOf<File?>(c.covers.fullFile(id).takeIf { it.exists() })
        private set

    init {
        if (full == null) viewModelScope.launch {
            val s = c.sessions.session.first() ?: return@launch
            // Offline or not uploaded yet: the copy on the phone is all there is.
            runCatching { c.covers.putFull(id, c.api(s.serverUrl, s.token).asset(id, size = "full")) }
                .onSuccess { full = c.covers.fullFile(id) }
        }
    }
}

/**
 * Full-screen cover: pinch to zoom, drag to move, double tap to zoom in or back out. At normal size,
 * dragging the cover down closes the viewer, like a photo gallery.
 */
@Composable
fun CoverViewerScreen(vm: CoverViewModel, title: String, onClose: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val dismiss = remember { Animatable(0f) }
    var closing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val distance = with(density) { DISMISS_DISTANCE.toPx() }
    val flingSpeed = with(density) { DISMISS_SPEED.toPx() }
    val progress = (dismiss.value / (distance * 2)).coerceIn(0f, 1f)
    val settle = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 1f - 0.8f * progress))) {
        // Both layers share the zoom: the full-size one covers the thumbnail once it has loaded,
        // instead of replacing it and leaving the screen empty while it decodes.
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        val velocity = VelocityTracker()
                        var dragging = false
                        do {
                            val event = awaitPointerEvent()
                            val pressed = event.changes.count { it.pressed }
                            val pan = event.calculatePan()
                            val zoom = event.calculateZoom()
                            // A single finger moving mostly down at normal size starts the dismiss drag.
                            if (!dragging && !closing && scale == 1f && pressed == 1 && zoom == 1f &&
                                pan.y > 0f && pan.y > abs(pan.x)
                            ) {
                                dragging = true
                            }
                            if (dragging && pressed == 1) {
                                event.changes.forEach { velocity.addPosition(it.uptimeMillis, it.position) }
                                val y = (dismiss.value + pan.y).coerceAtLeast(0f)
                                scope.launch { dismiss.snapTo(y) }
                                event.changes.forEach { it.consume() }
                            } else if (!dragging && (zoom != 1f || pan != Offset.Zero)) {
                                scale = (scale * zoom).coerceIn(1f, 6f)
                                offset = if (scale == 1f) Offset.Zero else offset + pan
                                event.changes.forEach { it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                        if (dragging) {
                            val speed = velocity.calculateVelocity().y
                            if (dismiss.value > distance || speed > flingSpeed) {
                                closing = true
                                onClose()
                            } else {
                                scope.launch { dismiss.animateTo(0f, settle) }
                            }
                        }
                    }
                }
                .pointerInput(Unit) {
                    // Double tap zooms in or back out with the theme's spring instead of jumping.
                    detectTapGestures(onDoubleTap = {
                        val from = scale
                        val start = offset
                        val to = if (from > 1f) 1f else 2.5f
                        scope.launch {
                            animate(from, to, animationSpec = settle) { value, _ ->
                                scale = value
                                if (to == 1f) offset = start * ((value - 1f) / (from - 1f)).coerceIn(0f, 1f)
                            }
                        }
                    })
                }
                .graphicsLayer {
                    // While being dragged away the cover also shrinks a little, like a photo gallery.
                    val shrink = 1f - 0.25f * progress
                    scaleX = scale * shrink
                    scaleY = scale * shrink
                    translationX = offset.x
                    translationY = offset.y + dismiss.value
                },
        ) {
            val alt = str(R.string.cover_alt, "title" to title)
            if (vm.full == null || vm.thumb != null) {
                AsyncImage(model = vm.thumb, contentDescription = alt.takeIf { vm.full == null }, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
            vm.full?.let { AsyncImage(model = it, contentDescription = alt, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
        }
        // A minimal bar on a dark fade: the way out and what you are looking at. It fades out with the drag.
        Row(
            Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .graphicsLayer { alpha = 1f - progress }
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent)))
                .systemBarsPadding()
                .padding(horizontal = 4.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose, colors = IconButtonDefaults.iconButtonColors(contentColor = Color.White)) {
                Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
            }
            Text(
                title,
                color = Color.White,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(end = 16.dp).semantics { heading() },
            )
        }
    }
}

/** How far down (or how fast) the cover has to be dragged for the viewer to close. */
private val DISMISS_DISTANCE = 120.dp
private val DISMISS_SPEED = 1200.dp
