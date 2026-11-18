package io.github.rldona.openlibrary.ui.book

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.HideImage
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.conditionLabel
import io.github.rldona.openlibrary.ui.components.BackScaffold
import io.github.rldona.openlibrary.ui.components.BookHeader
import io.github.rldona.openlibrary.ui.components.BusyLabel
import io.github.rldona.openlibrary.ui.components.ChipsField
import io.github.rldona.openlibrary.ui.components.CoverSlot
import io.github.rldona.openlibrary.ui.components.DestructiveDialog
import io.github.rldona.openlibrary.ui.components.FieldLabel
import io.github.rldona.openlibrary.ui.components.LabeledField
import io.github.rldona.openlibrary.ui.components.LocationSheet
import io.github.rldona.openlibrary.ui.components.Picker
import io.github.rldona.openlibrary.ui.components.placePath
import io.github.rldona.openlibrary.ui.components.readableWidth
import io.github.rldona.openlibrary.ui.components.splitChips
import io.github.rldona.openlibrary.ui.detail.CONDITIONS
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import io.github.rldona.openlibrary.core.subjectLabel

/**
 * Add a book by hand (2c), also used for "I bought it": cover, title (the only required field) and author
 * on top, where it goes, and the rest folded under "More details". Saving is at the bottom, with keeping it
 * in the wishlist instead as the other way out.
 */
@Composable
fun AddBookScreen(
    vm: BookFormViewModel,
    onScanIsbn: () -> Unit,
    onPhoto: () -> Unit,
    onGallery: () -> Unit,
    onOpenWork: (String) -> Unit,
    onSaved: (String) -> Unit,
    onWishAdded: () -> Unit,
    onClose: () -> Unit,
) {
    val locations by vm.locations.collectAsState(emptyList())
    var confirmDiscard by rememberSaveable { mutableStateOf(false) }
    var placing by rememberSaveable { mutableStateOf(false) }
    var more by rememberSaveable { mutableStateOf(false) }
    val close = { if (vm.dirty) confirmDiscard = true else onClose() }
    BackHandler(enabled = vm.dirty) { confirmDiscard = true }
    // A lookup's answer (found, not found, owned…) is read next to the ISBN, so the details open for it.
    LaunchedEffect(vm.notice) { if (vm.notice != null) more = true }

    BackScaffold(
        stringResource(if (vm.fromWish) R.string.book_add else R.string.manual_title),
        onBack = close,
        close = true,
        bottomBar = {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding()) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Column(
                        Modifier.fillMaxWidth().readableWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Button(
                            onClick = { vm.save(onSaved) },
                            enabled = !vm.busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("save"),
                        ) { BusyLabel(vm.saving, stringResource(R.string.manual_save)) }
                        if (!vm.fromWish) {
                            TextButton(onClick = { vm.addToWishlist(onWishAdded) }, enabled = !vm.busy, modifier = Modifier.heightIn(min = 48.dp)) {
                                Text(stringResource(R.string.manual_toWishlist))
                            }
                        }
                    }
                }
            }
        },
    ) { inner ->
        Column(
            Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).readableWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            BookHeader(
                cover = { CoverMenu(vm, onPhoto, onGallery) },
            ) {
                LabeledField(
                    stringResource(R.string.book_title),
                    vm.title,
                    { vm.title = it },
                    error = vm.titleMissing && vm.title.isBlank(),
                )
                ChipsField(
                    stringResource(R.string.manual_author),
                    vm.authors,
                    vm.authorDraft,
                    { vm.authorDraft = it },
                    vm.authorSuggestions,
                    "",
                    { vm.authors = it },
                )
            }

            vm.wish?.let { WishNotice(it) }
            vm.notice?.let { n -> LookupNoticeCard(n, onOpenWork, onAddCopy = { vm.addOwnedCopy(it, onSaved) }) }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FieldLabel(stringResource(R.string.manual_where))
                Surface(
                    onClick = { placing = true },
                    shape = MaterialTheme.shapes.large,
                    color = Color.Transparent,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                ) {
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Place, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Text(
                            placePath(locations, vm.locationId) ?: stringResource(R.string.place_unplaced),
                            Modifier.weight(1f).padding(horizontal = 16.dp),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
                    }
                }
            }

            MoreDetails(vm, open = more, onToggle = { more = !more }, onScanIsbn = onScanIsbn)

            Text(
                stringResource(R.string.manual_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    if (placing) {
        LocationSheet(
            locations,
            lastUsedId = vm.locationId,
            initial = vm.locationId,
            subtitle = vm.title.ifBlank { null },
            allowNone = true,
            onConfirm = { vm.locationId = it; placing = false },
            onDismiss = { placing = false },
        )
    }
    if (confirmDiscard) {
        DestructiveDialog(
            title = stringResource(R.string.form_discardTitle),
            text = stringResource(R.string.form_discardText),
            confirm = stringResource(R.string.form_discard),
            onConfirm = { confirmDiscard = false; onClose() },
            onDismiss = { confirmDiscard = false },
            dismiss = stringResource(R.string.form_keepEditing),
        )
    }
}

/** The cover slot, with its menu: camera, gallery, or no cover. */
@Composable
internal fun CoverMenu(vm: BookFormViewModel, onPhoto: () -> Unit, onGallery: () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    Box {
        CoverSlot(vm.covers, vm.coverId, vm.title, splitChips(vm.authors), onClick = { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.form_coverCamera)) },
                leadingIcon = { Icon(Icons.Default.PhotoCamera, contentDescription = null) },
                onClick = { open = false; onPhoto() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.capture_gallery)) },
                leadingIcon = { Icon(Icons.Default.PhotoLibrary, contentDescription = null) },
                onClick = { open = false; onGallery() },
            )
            if (vm.photoId != null && !vm.editing) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.add_removePhoto)) },
                    leadingIcon = { Icon(Icons.Default.HideImage, contentDescription = null) },
                    onClick = { open = false; vm.photoId = null },
                )
            }
            if (vm.photoId == null && vm.providerCoverId != null) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.form_removeCover)) },
                    leadingIcon = { Icon(Icons.Default.HideImage, contentDescription = null) },
                    onClick = { open = false; vm.dropProviderCover() },
                )
            }
        }
    }
}

/** "More details", folded: ISBN (with its lookup), publisher, year, pages, language, genre, condition and notes. */
@Composable
private fun MoreDetails(vm: BookFormViewModel, open: Boolean, onToggle: () -> Unit, onScanIsbn: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column {
            Surface(onClick = onToggle, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                Row(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.manual_more), style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize), modifier = Modifier.semantics { heading() })
                        if (!open) {
                            Text(stringResource(R.string.manual_moreText), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Icon(if (open) Icons.Default.ExpandLess else Icons.Default.ExpandMore, contentDescription = null)
                }
            }
            AnimatedVisibility(open) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LabeledField(
                            stringResource(R.string.capture_isbn),
                            vm.isbn,
                            { vm.isbn = it },
                            Modifier.weight(1f).testTag("isbn"),
                            placeholder = stringResource(R.string.form_isbnPlaceholder),
                            number = true,
                            trailing = {
                                IconButton(onClick = onScanIsbn) { Icon(Icons.Default.QrCodeScanner, contentDescription = stringResource(R.string.add_scan)) }
                            },
                        )
                        OutlinedButton(onClick = vm::lookup, enabled = !vm.busy && vm.isbn.isNotBlank(), modifier = Modifier.heightIn(min = 56.dp)) {
                            BusyLabel(vm.busy && !vm.saving, stringResource(if (vm.busy && !vm.saving) R.string.form_searching else R.string.form_lookup))
                        }
                    }
                    LabeledField(stringResource(R.string.book_publisher), vm.publisher, { vm.publisher = it })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LabeledField(stringResource(R.string.book_year), vm.year, { vm.year = it.filter(Char::isDigit).take(4) }, Modifier.weight(1f), number = true)
                        LabeledField(stringResource(R.string.book_pages), vm.pages, { vm.pages = it.filter(Char::isDigit).take(5) }, Modifier.weight(1f), number = true)
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FieldLabel(stringResource(R.string.book_language))
                        LanguageField(vm.language, { vm.language = it }, Modifier.fillMaxWidth(), floatingLabel = false)
                    }
                    ChipsField(
                        stringResource(R.string.book_subjects),
                        vm.subjects,
                        vm.subjectDraft,
                        { vm.subjectDraft = it },
                        vm.suggestions,
                        stringResource(R.string.form_subjectsPlaceholder),
                        { vm.subjects = it },
                        display = { subjectLabel(it) },
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FieldLabel(stringResource(R.string.copy_condition))
                        Picker(
                            stringResource(R.string.copy_condition),
                            vm.condition,
                            CONDITIONS.map { it to stringResource(conditionLabel(it)) },
                            { vm.condition = it },
                            Modifier.fillMaxWidth(),
                            floatingLabel = false,
                        )
                    }
                    LabeledField(stringResource(R.string.copy_notes), vm.notes, { vm.notes = it }, placeholder = stringResource(R.string.copy_notesPlaceholder))
                }
            }
        }
    }
}
