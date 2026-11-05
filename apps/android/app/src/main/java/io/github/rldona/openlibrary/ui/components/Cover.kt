package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.CoverStore

/** Background, accent and ink of the generated covers: the same list as the web (components/ui.tsx). */
private val PALETTES =
    listOf(
        Triple(0xFF7A2E2E, 0xFFE8C07D, 0xFFFDF6E9),
        Triple(0xFF1F3A5F, 0xFFE9B44C, 0xFFF4EFE6),
        Triple(0xFF2F4F3A, 0xFFD9A441, 0xFFF3EEE2),
        Triple(0xFF3B2A4F, 0xFFF0A04B, 0xFFF6F0FF),
        Triple(0xFF0F4C5C, 0xFFE36414, 0xFFFBF5EC),
        Triple(0xFF5C3D2E, 0xFFC9A227, 0xFFF7EFE1),
        Triple(0xFF264653, 0xFFE9C46A, 0xFFF1FAEE),
        Triple(0xFF283618, 0xFFDDA15E, 0xFFFEFAE0),
        Triple(0xFF3D405B, 0xFFF2CC8F, 0xFFF4F1DE),
        Triple(0xFF6D2E46, 0xFFD5B9B2, 0xFFFBF0EC),
        Triple(0xFF14213D, 0xFFFCA311, 0xFFE5E5E5),
    )

/** FNV-1a over UTF-16 units, as the web does, so a book gets the same generated cover on both. */
private fun hash(s: String): Int {
    var h = -2128831035 // 2166136261 as a signed 32-bit int
    for (ch in s) h = (h xor ch.code) * 16777619
    return if (h == Int.MIN_VALUE) h else kotlin.math.abs(h)
}

private val PROVISIONAL = Color(0xFFC48A2C)

/**
 * The downloaded cover, or one generated from the title and authors in the web's four designs. Both get
 * the web's book look: a slightly rounded fore-edge, a shaded spine and a soft shadow.
 */
@Composable
fun Cover(
    covers: CoverStore,
    assetId: String?,
    title: String,
    width: Dp,
    modifier: Modifier = Modifier,
    authors: List<String> = emptyList(),
    provisional: Boolean = false,
) {
    val shape = RoundedCornerShape(topStart = 2.dp, bottomStart = 2.dp, topEnd = 5.dp, bottomEnd = 5.dp)
    BookShape(modifier.width(width), shape) {
        if (assetId != null && covers.has(assetId)) {
            AsyncImage(
                model = covers.file(assetId),
                contentDescription = str(R.string.cover_alt, "title" to title),
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Generated(title, authors, provisional)
        }
    }
}

/** A cover filling the width it is given (grids). */
@Composable
fun FillCover(
    covers: CoverStore,
    assetId: String?,
    title: String,
    authors: List<String>,
    provisional: Boolean,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(topStart = 2.dp, bottomStart = 2.dp, topEnd = 5.dp, bottomEnd = 5.dp)
    BookShape(modifier.fillMaxWidth(), shape) {
        if (assetId != null && covers.has(assetId)) {
            AsyncImage(
                model = covers.file(assetId),
                contentDescription = str(R.string.cover_alt, "title" to title),
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Generated(title, authors, provisional)
        }
    }
}

@Composable
private fun BookShape(modifier: Modifier, shape: RoundedCornerShape, content: @Composable () -> Unit) {
    Box(
        modifier
            .aspectRatio(2f / 3f)
            .shadow(6.dp, shape, ambientColor = Color.Black.copy(alpha = 0.25f), spotColor = Color.Black.copy(alpha = 0.45f))
            .clip(shape)
            .drawWithContent {
                drawContent()
                // The spine: a darker strip, a highlight, then nothing (styles.css .cover::after).
                drawRect(
                    Brush.horizontalGradient(
                        0f to Color.Black.copy(alpha = 0.25f),
                        0.025f to Color.White.copy(alpha = 0.12f),
                        0.06f to Color.Black.copy(alpha = 0.05f),
                        0.09f to Color.Transparent,
                    ),
                )
            },
    ) { content() }
}

@Composable
private fun Generated(title: String, authors: List<String>, provisional: Boolean) {
    val h = hash(title)
    val (bg, accent, inkL) = PALETTES[h % PALETTES.size]
    val ac = Color(accent)
    val ink = Color(inkL)
    val design = (h shr 4) % 4
    val author = authors.joinToString(", ")
    BoxWithConstraints(Modifier.fillMaxSize().background(Color(bg)).semantics { contentDescription = title }) {
        val cq = maxWidth / 100 // the web's container-query unit
        val titleSize = (cq.value * 12.5f).sp
        val authorSize = (cq.value * 6.4f).sp
        val titleText = @Composable { align: TextAlign, mod: Modifier ->
            Text(
                title,
                color = ink,
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                fontSize = titleSize,
                lineHeight = titleSize * 1.04f,
                textAlign = align,
                maxLines = 5,
                overflow = TextOverflow.Ellipsis,
                modifier = mod,
            )
        }
        val authorText = @Composable { align: TextAlign, mod: Modifier ->
            Text(
                author.uppercase(),
                color = ink.copy(alpha = 0.85f),
                fontSize = authorSize,
                lineHeight = authorSize * 1.2f,
                letterSpacing = (cq.value * 0.45f).sp,
                textAlign = align,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = mod,
            )
        }
        val side = Modifier.padding(start = cq * 11, end = cq * 10)
        when (design) {
            0 -> {
                Box(Modifier.fillMaxWidth().aspectRatio(100f / 9f).offset(y = maxHeight * 0.6f).background(ac))
                titleText(TextAlign.Start, side.padding(top = cq * 13))
                authorText(TextAlign.Start, side.align(Alignment.BottomStart).padding(bottom = cq * 11))
            }
            1 -> {
                Box(Modifier.fillMaxSize().padding(cq * 6).border(cq * 1.3f, ac))
                titleText(TextAlign.Center, side.fillMaxWidth().align(Alignment.Center))
                authorText(TextAlign.Center, side.fillMaxWidth().align(Alignment.BottomCenter).padding(bottom = cq * 15))
            }
            2 -> {
                Box(
                    Modifier.size(cq * 95).align(Alignment.BottomEnd).offset(x = cq * 35, y = cq * 28)
                        .clip(CircleShape).background(ac.copy(alpha = 0.92f)),
                )
                authorText(TextAlign.Start, side.padding(top = cq * 11))
                titleText(TextAlign.Start, side.padding(top = cq * 24))
            }
            else -> {
                Box(Modifier.fillMaxHeight().width(cq * 8).offset(x = cq * 14).background(ac))
                titleText(TextAlign.Start, Modifier.padding(start = cq * 31, end = cq * 10, top = cq * 14))
                authorText(TextAlign.Start, Modifier.align(Alignment.BottomStart).padding(start = cq * 31, end = cq * 10, bottom = cq * 11))
            }
        }
        if (provisional) {
            Box(Modifier.fillMaxSize().padding(cq * 3.5f).border(cq * 1.6f, PROVISIONAL))
        }
    }
}
