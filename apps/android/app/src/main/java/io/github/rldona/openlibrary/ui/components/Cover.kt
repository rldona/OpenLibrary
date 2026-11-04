package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.CoverStore

private val PALETTE = listOf(0xFF8B3A2B, 0xFF2F5D50, 0xFF4A4E8C, 0xFF7A5C2E, 0xFF5B3A5E, 0xFF35606F)

/** Downloaded thumbnail, or a generated cover with the title (like the web) when there is none. */
@Composable
fun Cover(covers: CoverStore, assetId: String?, title: String, width: Dp, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(4.dp)
    val box = modifier.size(width, width * 1.5f).clip(shape)
    if (assetId != null && covers.has(assetId)) {
        AsyncImage(
            model = covers.file(assetId),
            contentDescription = str(R.string.cover_alt, "title" to title),
            contentScale = ContentScale.Crop,
            modifier = box,
        )
    } else {
        val color = Color(PALETTE[(title.hashCode() and 0x7fffffff) % PALETTE.size])
        Box(box.background(color), contentAlignment = Alignment.Center) {
            Text(
                title,
                color = Color.White,
                fontSize = (width.value / 6).coerceIn(8f, 18f).sp,
                textAlign = TextAlign.Center,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(4.dp),
            )
        }
    }
}
