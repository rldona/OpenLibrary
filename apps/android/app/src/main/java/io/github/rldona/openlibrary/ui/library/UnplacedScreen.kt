package io.github.rldona.openlibrary.ui.library

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.format
import io.github.rldona.openlibrary.core.ftsQuery
import io.github.rldona.openlibrary.core.plural
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.LibraryRow
import io.github.rldona.openlibrary.ui.components.BackScaffold
import io.github.rldona.openlibrary.ui.components.BookTitle
import io.github.rldona.openlibrary.ui.components.Cover
import io.github.rldona.openlibrary.ui.components.EmptyState
import io.github.rldona.openlibrary.ui.components.LoadingState
import io.github.rldona.openlibrary.ui.components.LocalSnackbar
import io.github.rldona.openlibrary.ui.components.LocationSheet
import io.github.rldona.openlibrary.ui.components.pageListItemColors
import io.github.rldona.openlibrary.ui.components.readableWidth
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A copy with nowhere to be, with the book it belongs to. */
data class UnplacedBook(val copy: CopyEntity, val row: LibraryRow?)

class UnplacedViewModel(private val c: AppContainer) : ViewModel() {
    val covers = c.covers
    val locations = c.db.catalog().locations()
    val lastLocation = c.libraryPrefs.lastLocation

    /** Null until the database answers. */
    val books: StateFlow<List<UnplacedBook>?> =
        combine(c.db.catalog().unplacedCopies(), c.db.catalog().library(ftsQuery(""), true, emptyList())) { copies, rows ->
            val byEdition = rows.associateBy { it.editionId }
            copies.map { UnplacedBook(it, byEdition[it.editionId]) }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Puts every chosen copy on [locationId]; the place is remembered for the next book. */
    fun place(copies: List<CopyEntity>, locationId: String) = viewModelScope.launch {
        copies.forEach { c.writes.editCopy(it, JsonObject(mapOf("locationId" to JsonPrimitive(locationId)))) }
        c.libraryPrefs.setLastLocation(locationId)
    }
}

/**
 * The books without a place, all chosen at first: "Place N books" opens the location sheet and puts them
 * on one shelf at once. Untick the ones that go elsewhere and place them next.
 */
@Composable
fun UnplacedScreen(vm: UnplacedViewModel, onBack: () -> Unit) {
    val books by vm.books.collectAsStateWithLifecycle()
    val locations by vm.locations.collectAsStateWithLifecycle(emptyList())
    val lastPlace by vm.lastLocation.collectAsStateWithLifecycle(null)
    val snackbar = LocalSnackbar.current
    val placedOne = stringResource(R.string.unplaced_placed_one)
    val placedOther = stringResource(R.string.unplaced_placed_other)
    /** Unticked copies: whatever arrives later starts ticked. */
    var skipped by rememberSaveable { mutableStateOf(listOf<String>()) }
    var placing by rememberSaveable { mutableStateOf(false) }
    val list = books
    val chosen = list.orEmpty().filter { it.copy.id !in skipped }
    // Placed books leave the list; forget them.
    LaunchedEffect(list) { list?.let { l -> skipped = skipped.filter { id -> l.any { it.copy.id == id } } } }

    BackScaffold(
        stringResource(R.string.unplaced_title),
        onBack = onBack,
        actions = {
            if (!list.isNullOrEmpty()) {
                val all = chosen.size == list.size
                TextButton(onClick = { skipped = if (all) list.map { it.copy.id } else emptyList() }) {
                    Text(stringResource(if (all) R.string.unplaced_none else R.string.unplaced_all))
                }
            }
        },
        bottomBar = {
            if (!list.isNullOrEmpty()) {
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Button(
                            onClick = { placing = true },
                            enabled = chosen.isNotEmpty(),
                            modifier = Modifier.fillMaxWidth().readableWidth().padding(16.dp).heightIn(min = 56.dp),
                        ) {
                            Text(
                                if (chosen.isEmpty()) stringResource(R.string.unplaced_pick)
                                else plural(R.string.unplaced_place_one, R.string.unplaced_place_other, chosen.size),
                            )
                        }
                    }
                }
            }
        },
    ) { inner ->
        when {
            list == null -> LoadingState(Modifier.padding(inner))
            list.isEmpty() -> EmptyState(
                Icons.Outlined.Place,
                stringResource(R.string.unplaced_empty),
                Modifier.padding(inner),
                text = stringResource(R.string.unplaced_emptyText),
            )
            else -> LazyColumn(Modifier.fillMaxSize().padding(inner)) {
                items(list, key = { it.copy.id }) { b ->
                    val on = b.copy.id !in skipped
                    val toggle = { skipped = if (on) skipped + b.copy.id else skipped - b.copy.id }
                    ListItem(
                        modifier = Modifier.readableWidth().toggleable(on, role = Role.Checkbox, onValueChange = { toggle() }),
                        leadingContent = {
                            Cover(vm.covers, b.row?.coverAssetId, b.row?.title ?: "?", 44.dp, authors = b.row?.authors.orEmpty())
                        },
                        supportingContent = {
                            Text(
                                b.row?.authors?.joinToString(", ")?.ifEmpty { null } ?: stringResource(R.string.book_unknownAuthor),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                        trailingContent = { Checkbox(checked = on, onCheckedChange = null) },
                        colors = pageListItemColors(),
                    ) {
                        Text(b.row?.title ?: "—", style = BookTitle.list, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
    if (placing) {
        LocationSheet(
            locations,
            lastUsedId = lastPlace,
            initial = null,
            subtitle = plural(R.string.library_books_one, R.string.library_books_other, chosen.size),
            onConfirm = { id ->
                placing = false
                if (id != null) {
                    val name = locations.firstOrNull { it.id == id }?.name.orEmpty()
                    vm.place(chosen.map { it.copy }, id)
                    snackbar.showMessage(format(if (chosen.size == 1) placedOne else placedOther, "n" to chosen.size, "name" to name))
                }
            },
            onDismiss = { placing = false },
        )
    }
}
