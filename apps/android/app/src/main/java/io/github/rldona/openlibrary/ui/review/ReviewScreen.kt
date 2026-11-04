package io.github.rldona.openlibrary.ui.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.rldona.openlibrary.AppContainer
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.data.OutboxEntity
import io.github.rldona.openlibrary.network.FieldConflict
import io.github.rldona.openlibrary.sync.LocalWrites
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

class ReviewViewModel(private val c: AppContainer) : ViewModel() {
    val problems = c.db.outbox().problems().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun keepMine(p: OutboxEntity, edited: Map<String, String> = emptyMap()) = viewModelScope.launch { c.writes.keepMine(p, edited) }

    fun discard(p: OutboxEntity) = viewModelScope.launch { c.writes.discard(p) }
}

/** Conflicts (the same field changed elsewhere) and changes the server refused, one card each. */
@Composable
fun ReviewScreen(vm: ReviewViewModel) {
    val problems by vm.problems.collectAsStateWithLifecycle()
    val list = problems ?: return
    if (list.isEmpty()) {
        Text(stringResource(R.string.review_empty), Modifier.padding(24.dp))
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text(stringResource(R.string.review_title), style = MaterialTheme.typography.headlineSmall) }
        items(list, key = { it.opId }) { p -> ProblemCard(p, vm) }
    }
}

@Composable
private fun ProblemCard(p: OutboxEntity, vm: ReviewViewModel) {
    var combining by remember { mutableStateOf<FieldConflict?>(null) }
    val conflicts = LocalWrites.conflictsOf(p)
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(whatLabel(p.type)), style = MaterialTheme.typography.labelMedium)
            Text(stringResource(if (p.status == "conflict") R.string.review_conflict else R.string.review_rejected))
            // A conflict is explained by the fields below; a rejection by the server's (translated) reason.
            if (p.status != "conflict") p.message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            conflicts.forEach { f ->
                Text(stringResource(fieldLabel(f.field)), style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 4.dp))
                Text(stringResource(R.string.review_server) + ": " + show(f.current))
                Text(stringResource(R.string.review_mine) + ": " + show(f.yours))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (p.status == "conflict") {
                    OutlinedButton(onClick = { vm.keepMine(p) }) { Text(stringResource(R.string.review_keepMine)) }
                    TextButton(onClick = { vm.discard(p) }) { Text(stringResource(R.string.review_keepServer)) }
                } else {
                    TextButton(onClick = { vm.discard(p) }) { Text(stringResource(R.string.review_discard)) }
                }
            }
            conflicts.firstOrNull { it.current.isText() && it.yours.isText() }?.let { f ->
                TextButton(onClick = { combining = f }) { Text(stringResource(R.string.review_combine)) }
            }
        }
    }
    combining?.let { f ->
        val both = show(f.yours) + "\n" + show(f.current)
        var text by remember { mutableStateOf(both) }
        AlertDialog(
            onDismissRequest = { combining = null },
            title = { Text(stringResource(R.string.review_combine)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.review_combineHint), style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(value = text, onValueChange = { text = it }, minLines = 3, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = { TextButton(onClick = { vm.keepMine(p, mapOf(f.field to text.trim())); combining = null }) { Text(stringResource(R.string.common_save)) } },
            dismissButton = { TextButton(onClick = { combining = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

private fun JsonElement.isText() = this is JsonPrimitive && isString

@Composable
private fun show(v: JsonElement): String =
    when (v) {
        JsonNull -> stringResource(R.string.review_empty_value)
        is JsonPrimitive -> v.contentOrNull?.ifEmpty { null } ?: stringResource(R.string.review_empty_value)
        is JsonArray -> v.joinToString(", ") { (it as? JsonPrimitive)?.contentOrNull.orEmpty() }
        else -> v.toString()
    }

private fun whatLabel(type: String): Int =
    when (type.substringBefore('.')) {
        "work", "book" -> R.string.review_what_work
        "edition" -> R.string.review_what_edition
        "copy" -> R.string.review_what_copy
        "reading" -> R.string.reading_title
        else -> R.string.review_what_location
    }

/** Field names come from the server; labels reuse the web's keys. */
private fun fieldLabel(field: String): Int =
    when (field) {
        "title" -> R.string.book_title
        "subtitle" -> R.string.book_subtitle
        "authors" -> R.string.book_authors
        "subjects" -> R.string.book_subjects
        "description" -> R.string.book_synopsis
        "series" -> R.string.book_series
        "publisher" -> R.string.book_publisher
        "publishedYear" -> R.string.book_publishedYear
        "language" -> R.string.book_language
        "pages" -> R.string.book_pages
        "format" -> R.string.book_format
        "isbn13" -> R.string.form_isbnOptional
        "coverAssetId" -> R.string.form_cover
        "locationId", "parentId" -> R.string.copy_location
        "condition" -> R.string.copy_condition
        "acquiredOn" -> R.string.copy_acquiredOn
        "notes" -> R.string.copy_notes
        "name" -> R.string.locations_name
        "kind" -> R.string.locations_kind
        "rating" -> R.string.reading_rating
        "startedOn" -> R.string.reading_started
        "finishedOn" -> R.string.reading_finished
        "status", "retiredReason" -> R.string.copyForm_reason
        else -> R.string.drawer_dataSource
    }
