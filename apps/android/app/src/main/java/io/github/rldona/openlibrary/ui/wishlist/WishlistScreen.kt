package io.github.rldona.openlibrary.ui.wishlist

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.formatIsbn
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.WishEntity
import io.github.rldona.openlibrary.ui.components.Picker
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

val PRIORITIES = listOf("low", "normal", "high")

fun priorityLabel(p: String): Int =
    when (p) {
        "high" -> R.string.wish_priority_high
        "low" -> R.string.wish_priority_low
        else -> R.string.wish_priority_normal
    }

fun wishStatusLabel(s: String): Int =
    when (s) {
        "acquired" -> R.string.wish_status_acquired
        "discarded" -> R.string.wish_status_discarded
        else -> R.string.wish_status_open
    }

data class WishDraft(val title: String, val authors: String, val isbn: String, val priority: String, val notes: String) {
    val authorList get() = authors.split(';').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    val isbn13 get() = (normalizeIsbn(isbn) as? IsbnResult.Ok)?.isbn13
}

class WishlistViewModel(private val c: AppContainer) : ViewModel() {
    val wishes = c.db.catalog().wishes().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun save(existing: WishEntity?, d: WishDraft) =
        viewModelScope.launch {
            if (existing == null) {
                c.writes.addWish(d.title, d.authorList, d.isbn13, d.priority, d.notes)
                return@launch
            }
            // Only what changed, so another device's edits to other fields are merged.
            val f = mutableMapOf<String, JsonElement>()
            if (d.title.trim() != existing.title) f["title"] = JsonPrimitive(d.title.trim())
            if (d.authorList != existing.authors) f["authors"] = JsonArray(d.authorList.map(::JsonPrimitive))
            if (d.isbn13 != existing.isbn13) f["isbn13"] = d.isbn13?.let(::JsonPrimitive) ?: JsonNull
            if (d.priority != existing.priority) f["priority"] = JsonPrimitive(d.priority)
            if (d.notes.trim() != existing.notes) f["notes"] = JsonPrimitive(d.notes.trim())
            if (f.isNotEmpty()) c.writes.editWish(existing, JsonObject(f))
        }

    fun setStatus(w: WishEntity, status: String) =
        viewModelScope.launch { c.writes.editWish(w, JsonObject(mapOf("status" to JsonPrimitive(status)))) }
}

/** Books you want (BR14). "I bought it" opens the add-book form pre-filled from the wish. */
@Composable
fun WishlistScreen(vm: WishlistViewModel, onBought: (wishId: String) -> Unit) {
    val all by vm.wishes.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<WishEntity?>(null) }
    var adding by remember { mutableStateOf(false) }
    val list = all ?: return
    val open = list.filter { it.status == "open" }
    val done = list.filter { it.status != "open" }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 96.dp)) {
            item { Text(stringResource(R.string.wish_subtitle), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp)) }
            if (open.isEmpty()) {
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text(stringResource(R.string.wish_emptyTitle), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.wish_emptyText), modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
            items(open, key = { it.id }) { w ->
                Column(Modifier.fillMaxWidth().clickable { editing = w }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(w.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        if (w.priority != "normal") AssistChip(onClick = {}, label = { Text(stringResource(priorityLabel(w.priority))) })
                    }
                    val meta = listOfNotNull(w.authors.joinToString(", ").ifEmpty { null }, w.isbn13?.let { "ISBN " + formatIsbn(it) })
                    if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                    if (w.notes.isNotBlank()) Text(w.notes, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { onBought(w.id) }) { Text(stringResource(R.string.wish_bought)) }
                        TextButton(onClick = { vm.setStatus(w, "discarded") }) { Text(stringResource(R.string.wish_discard)) }
                    }
                }
                HorizontalDivider()
            }
            if (done.isNotEmpty()) {
                item {
                    Text(
                        str(R.string.wish_history, "n" to done.size),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(16.dp),
                    )
                }
                items(done, key = { it.id }) { w ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(w.title + " · " + stringResource(wishStatusLabel(w.status)), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        if (w.status == "discarded") TextButton(onClick = { vm.setStatus(w, "open") }) { Text(stringResource(R.string.drawer_restore)) }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { adding = true },
            icon = { Icon(Icons.Default.Add, contentDescription = null) },
            text = { Text(stringResource(R.string.wish_add)) },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        )
    }
    if (adding || editing != null) {
        WishDialog(editing, onDismiss = { adding = false; editing = null }) { d ->
            vm.save(editing, d)
            adding = false
            editing = null
        }
    }
}

@Composable
private fun WishDialog(wish: WishEntity?, onDismiss: () -> Unit, onSave: (WishDraft) -> Unit) {
    var d by remember {
        mutableStateOf(WishDraft(wish?.title.orEmpty(), wish?.authors?.joinToString("; ").orEmpty(), wish?.isbn13.orEmpty(), wish?.priority ?: "normal", wish?.notes.orEmpty()))
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (wish == null) R.string.wish_add else R.string.wish_editTitle)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(d.title, { d = d.copy(title = it) }, label = { Text(stringResource(R.string.book_title)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    d.authors,
                    { d = d.copy(authors = it) },
                    label = { Text(stringResource(R.string.book_authors)) },
                    supportingText = { Text(stringResource(R.string.form_separateWithSemicolon)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    d.isbn,
                    { d = d.copy(isbn = it) },
                    label = { Text(stringResource(R.string.form_isbnOptional)) },
                    isError = d.isbn.isNotBlank() && d.isbn13 == null,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Picker(stringResource(R.string.wish_priority), d.priority, PRIORITIES.map { it to stringResource(priorityLabel(it)) }, { d = d.copy(priority = it) }, Modifier.fillMaxWidth())
                OutlinedTextField(d.notes, { d = d.copy(notes = it) }, label = { Text(stringResource(R.string.wish_notes)) }, minLines = 2, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(d) }, enabled = d.title.isNotBlank() && (d.isbn.isBlank() || d.isbn13 != null)) {
                Text(stringResource(R.string.common_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}
