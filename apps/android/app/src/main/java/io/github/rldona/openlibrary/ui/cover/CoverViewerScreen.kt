package io.github.rldona.openlibrary.ui.cover

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.str
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** Shows the cover on the phone at once and swaps in the full-size one from the server when it arrives. */
class CoverViewModel(c: AppContainer, id: String) : ViewModel() {
    var file by mutableStateOf<File?>(c.covers.fullFile(id).takeIf { it.exists() } ?: c.covers.file(id).takeIf { it.exists() })
        private set

    init {
        if (!c.covers.fullFile(id).exists()) viewModelScope.launch {
            val s = c.sessions.session.first() ?: return@launch
            // Offline or not uploaded yet: the copy on the phone is all there is.
            runCatching { c.covers.putFull(id, c.api(s.serverUrl, s.token).asset(id, size = "full")) }
                .onSuccess { file = c.covers.fullFile(id) }
        }
    }
}

/** Full-screen cover: pinch to zoom, drag to move, double tap to zoom in or back out. */
@Composable
fun CoverViewerScreen(vm: CoverViewModel, title: String, onClose: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AsyncImage(
            model = vm.file,
            contentDescription = str(R.string.cover_alt, "title" to title),
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        scale = (scale * zoom).coerceIn(1f, 6f)
                        offset = if (scale == 1f) Offset.Zero else offset + pan
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = {
                        if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f
                    })
                }
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                },
        )
        FilledTonalIconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopStart).systemBarsPadding().padding(12.dp)) {
            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
        }
    }
}
