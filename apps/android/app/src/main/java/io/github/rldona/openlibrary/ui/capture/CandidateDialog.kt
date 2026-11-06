package io.github.rldona.openlibrary.ui.capture

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.ui.graphics.Color
import io.github.rldona.openlibrary.ui.components.BookTitle
import io.github.rldona.openlibrary.ui.components.Pill
import io.github.rldona.openlibrary.ui.components.PillTone
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.network.MetadataCandidate

/**
 * Goodreads-style list of books found from the text read on a cover. A row fills the form; "Keep
 * scanning" returns to the camera without searching again for the same title.
 */
@Composable
internal fun CandidateDialog(
    candidates: List<MetadataCandidate>,
    failed: Boolean,
    onPick: (MetadataCandidate) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    val title =
        when {
            candidates.isNotEmpty() -> R.string.identify_title
            failed -> R.string.identify_failedTitle
            else -> R.string.identify_noneTitle
        }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(title)) },
        text = {
            if (candidates.isEmpty()) {
                Text(stringResource(if (failed) R.string.identify_failed else R.string.identify_none))
            } else {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    candidates.forEach { candidate -> CandidateRow(candidate, onPick) }
                }
            }
        },
        confirmButton = {
            // An empty result can be retried: the next frame may read the title differently.
            if (candidates.isEmpty()) TextButton(onClick = onRetry) { Text(stringResource(R.string.identify_retry)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.identify_keepScanning)) }
        },
    )
}

@Composable
private fun CandidateRow(candidate: MetadataCandidate, onPick: (MetadataCandidate) -> Unit) {
    // One element for TalkBack: the title is read once, the cover adds nothing.
    ListItem(
        onClick = { onPick(candidate) },
        leadingContent = {
            val cover = Modifier.width(44.dp).height(66.dp).background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.small)
            if (candidate.coverUrl != null) {
                AsyncImage(model = candidate.coverUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = cover)
            } else {
                Box(cover, contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Book, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        },
        supportingContent = { CandidateDetails(candidate) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        Text(candidate.title, style = BookTitle.compact, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun CandidateDetails(candidate: MetadataCandidate) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (candidate.authors.isNotEmpty()) {
            Text(
                candidate.authors.joinToString(", "),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        val imprint = listOfNotNull(candidate.publisher, candidate.publishedYear?.toString()).joinToString(" · ")
        if (imprint.isNotEmpty()) {
            Text(
                imprint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (candidate.sources.isNotEmpty()) {
            Text(
                candidate.sources.joinToString(", "),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (candidate.owned) Pill(stringResource(R.string.identify_owned), tone = PillTone.Neutral, small = true)
    }
}
