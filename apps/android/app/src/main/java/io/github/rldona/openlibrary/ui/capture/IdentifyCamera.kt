package io.github.rldona.openlibrary.ui.capture

import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.CoverQuery
import io.github.rldona.openlibrary.core.OcrLine
import io.github.rldona.openlibrary.core.OcrPoint
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.extractCoverQuery
import io.github.rldona.openlibrary.network.MetadataCandidate
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

private const val TAG = "OpenLibraryScanner"
private const val DOTS_INTERVAL_MS = 90L
private const val SEARCH_TIMEOUT_MS = 10_000L
private const val MAX_CANDIDATES = 8
private const val MAX_QUERY_CHARS = 200

/**
 * Reads the title on a cover with bundled on-device OCR and searches for it on the server. The text is
 * never uploaded: only the title and author the heuristic picks leave the phone. Recognised lines get a
 * dot at each corner so the reader can see what was understood.
 */
@Composable
internal fun IdentifyCamera(torch: Boolean, search: IdentifySearch, onCandidate: (MetadataCandidate) -> Unit) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val currentSearch by rememberUpdatedState(search)

    var frame by remember { mutableStateOf<PixelRect?>(null) }
    var dots by remember { mutableStateOf<List<OcrPoint>>(emptyList()) }
    var lastDotsAt by remember { mutableLongStateOf(0L) }
    var lastTextAt by remember { mutableLongStateOf(0L) }
    var detected by remember { mutableStateOf(false) }

    // Stability and the "already searched" guard (normalised titles): a title is searched once until it changes.
    var previousTitle by remember { mutableStateOf<String?>(null) }
    var searchedTitle by remember { mutableStateOf<String?>(null) }
    var lastQuery by remember { mutableStateOf<CoverQuery?>(null) }
    var searching by remember { mutableStateOf(false) }
    var candidates by remember { mutableStateOf<List<MetadataCandidate>>(emptyList()) }
    // Providers that answered: with no candidates and no sources, every provider failed.
    var sources by remember { mutableStateOf<List<String>>(emptyList()) }
    var open by remember { mutableStateOf(false) }

    fun runSearch(q: CoverQuery) {
        if (searching) return
        lastQuery = q
        searching = true
        open = false
        candidates = emptyList()
        sources = emptyList()
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        scope.launch {
            try {
                val result = withTimeout(SEARCH_TIMEOUT_MS) {
                    currentSearch(q.title.take(MAX_QUERY_CHARS), q.author?.take(MAX_QUERY_CHARS))
                }
                candidates = result.candidates
                sources = result.sources
            } catch (_: Exception) {
                sources = emptyList()
            } finally {
                searching = false
                open = true
            }
        }
    }

    val recognizer = remember { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    val controller = remember {
        LifecycleCameraController(context).apply {
            // Preview + analysis only, like the ISBN tab: some phones refuse all three use cases at once.
            setEnabledUseCases(CameraController.IMAGE_ANALYSIS)
            imageAnalysisResolutionSelector =
                ResolutionSelector.Builder()
                    .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build()
            setImageAnalysisAnalyzer(
                ContextCompat.getMainExecutor(context),
                MlKitAnalyzer(listOf(recognizer), CameraController.COORDINATE_SYSTEM_VIEW_REFERENCED, ContextCompat.getMainExecutor(context)) { r ->
                    r.getThrowable(recognizer)?.let { Log.w(TAG, "text analysis failed", it) }
                    val text = r.getValue(recognizer) ?: return@MlKitAnalyzer
                    // Coordinates are the preview's, the same space the frame and dots are drawn in.
                    val bound = frame ?: return@MlKitAnalyzer
                    val lines = toOcrLines(text)
                    val inside = lines.filter { line ->
                        bound.contains((line.bounds.left + line.bounds.right) / 2, (line.bounds.top + line.bounds.bottom) / 2)
                    }
                    val now = SystemClock.elapsedRealtime()
                    if (inside.isNotEmpty()) lastTextAt = now
                    if (now - lastDotsAt >= DOTS_INTERVAL_MS) {
                        lastDotsAt = now
                        // Keep the previous dots on frames without text so they do not flicker, but clear
                        // them when the camera has not seen text for half a second (moved away, covered…).
                        if (inside.isNotEmpty()) dots = inside.flatMap { it.corners }
                    }
                    if (inside.isEmpty() && now - lastTextAt > 500L) dots = emptyList()
                    val query = extractCoverQuery(lines, bound)
                    if (query == null) {
                        previousTitle = null
                        detected = false
                        return@MlKitAnalyzer
                    }
                    val key = stableKey(query.title)
                    if (key != previousTitle) {
                        // First sighting: wait for the same title on the next result.
                        previousTitle = key
                        detected = false
                        return@MlKitAnalyzer
                    }
                    detected = true
                    if (open || searching) return@MlKitAnalyzer
                    if (key == searchedTitle) return@MlKitAnalyzer
                    searchedTitle = key
                    runSearch(query)
                },
            )
        }
    }
    DisposableEffect(recognizer) { onDispose { recognizer.close() } }

    Box(Modifier.fillMaxSize()) {
        CameraPreview(controller, torch)
        Viewfinder(stringResource(R.string.capture_identifyHint), highlight = detected, onFrame = { frame = it }, shape = ::coverFrame)
        val accent = MaterialTheme.colorScheme.primary
        Canvas(Modifier.fillMaxSize()) {
            dots.forEach { point ->
                val center = Offset(point.x, point.y)
                drawCircle(accent.copy(alpha = 0.35f), radius = 8.dp.toPx(), center = center)
                drawCircle(Color.White, radius = 3.dp.toPx(), center = center)
            }
        }
        if (searching) {
            Surface(
                Modifier.align(Alignment.BottomCenter).systemBarsPadding().padding(bottom = 72.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
            ) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.identify_searching), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (open) {
            CandidateDialog(
                candidates = candidates.take(MAX_CANDIDATES),
                failed = candidates.isEmpty() && sources.isEmpty(),
                onPick = onCandidate,
                onRetry = { lastQuery?.let(::runSearch) },
                onDismiss = { open = false },
            )
        }
    }
}

/** OCR jitter in case or punctuation must not restart the two-frame stability count. */
private fun stableKey(title: String): String = title.lowercase().filter { it.isLetterOrDigit() }

private fun toOcrLines(text: Text): List<OcrLine> =
    text.textBlocks.flatMap { it.lines }.mapNotNull { line ->
        val box = line.boundingBox ?: return@mapNotNull null
        OcrLine(
            line.text,
            PixelRect(box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.bottom.toFloat()),
            line.cornerPoints?.map { OcrPoint(it.x.toFloat(), it.y.toFloat()) } ?: emptyList(),
        )
    }
