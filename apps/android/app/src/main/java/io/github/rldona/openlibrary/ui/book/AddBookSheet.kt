package io.github.rldona.openlibrary.ui.book

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.ui.components.LocationSheet
import io.github.rldona.openlibrary.ui.components.placePath
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

/** The three ways to add a book, chosen in [AddBookSheet]. */
enum class AddWay { Scan, Cover, Type }

/**
 * "Add book": scan barcodes (one or many), identify a cover, or type the details; below, where the books
 * will go, which can be changed here and is remembered for next time.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddBookSheet(
    locations: List<LocationEntity>,
    locationId: String?,
    onLocation: (String?) -> Unit,
    onChoose: (AddWay) -> Unit,
    onDismiss: () -> Unit,
    /** The wishlist's version: its own title and texts, no cover photo and no place (wishes are not placed). */
    forWish: Boolean = false,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var placing by rememberSaveable { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                stringResource(if (forWish) R.string.wish_add else R.string.book_add),
                Modifier.padding(start = 8.dp, bottom = 4.dp).semantics { heading() },
                style = MaterialTheme.typography.headlineSmall,
            )
            Way(Icons.Default.QrCodeScanner, R.string.add_scanTitle, if (forWish) R.string.wish_scanText else R.string.add_scanText, primary = true) { onChoose(AddWay.Scan) }
            if (!forWish) Way(Icons.Outlined.PhotoCamera, R.string.add_coverTitle, R.string.add_coverText) { onChoose(AddWay.Cover) }
            Way(Icons.Outlined.Edit, R.string.add_typeTitle, if (forWish) R.string.wish_typeText else R.string.add_typeText) { onChoose(AddWay.Type) }
            if (!forWish) PlaceRow(
                label = stringResource(R.string.add_willGo),
                path = placePath(locations, locationId),
                onChange = { placing = true },
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
    if (placing) {
        LocationSheet(
            locations,
            lastUsedId = locationId,
            initial = locationId,
            allowNone = true,
            onConfirm = { onLocation(it); placing = false },
            onDismiss = { placing = false },
        )
    }
}

@Composable
private fun Way(icon: ImageVector, title: Int, text: Int, primary: Boolean = false, onClick: () -> Unit) {
    val container = if (primary) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh
    val content = if (primary) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Surface(onClick = onClick, shape = MaterialTheme.shapes.extraLarge, color = container, contentColor = content, modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp)) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = if (primary) content else MaterialTheme.colorScheme.primary)
            Column(Modifier.padding(start = 20.dp)) {
                Text(stringResource(title), style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize))
                Text(stringResource(text), style = MaterialTheme.typography.bodyMedium, color = if (primary) content else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** "It will go to / Saved to <path>" with "Change"; "Not placed" when there is no place. */
@Composable
fun PlaceRow(label: String, path: String?, onChange: () -> Unit, modifier: Modifier = Modifier, outlined: Boolean = true) {
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = Color.Transparent,
        border = if (outlined) BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Place, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f).padding(start = 16.dp)) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(path ?: stringResource(R.string.place_unplaced), style = MaterialTheme.typography.bodyLarge)
            }
            TextButton(onClick = onChange, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.add_change)) }
        }
    }
}
