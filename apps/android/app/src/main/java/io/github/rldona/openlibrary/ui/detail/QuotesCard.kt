package io.github.rldona.openlibrary.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedCard
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
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.QuoteEntity
import io.github.rldona.openlibrary.ui.components.Picker

data class QuoteDraft(val text: String, val page: Int?, val note: String, val copyId: String?)

/** What the card asks the screen to do; the view model turns it into queued ops. */
sealed interface QuoteAction {
    data class Add(val draft: QuoteDraft) : QuoteAction
    data class Edit(val quote: QuoteEntity, val draft: QuoteDraft) : QuoteAction
    data class Delete(val quote: QuoteEntity) : QuoteAction
}

@Composable
fun QuotesCard(quotes: List<QuoteEntity>, copies: List<CopyEntity>, onAction: (QuoteAction) -> Unit) {
    var editing by remember { mutableStateOf<QuoteEntity?>(null) }
    var adding by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<QuoteEntity?>(null) }
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.quotes_title), style = MaterialTheme.typography.titleSmall)
            quotes.forEach { q ->
                Column {
                    Text("“${q.text}”", style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic)
                    val meta = listOfNotNull(
                        q.page?.let { str(R.string.quotes_pageN, "n" to it) },
                        q.copyId?.let { id -> copies.firstOrNull { it.id == id }?.code?.ifEmpty { null } },
                        q.note.ifBlank { null },
                    )
                    if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row {
                        TextButton(onClick = { editing = q }) { Text(stringResource(R.string.common_edit)) }
                        TextButton(onClick = { deleting = q }) { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
            OutlinedButton(onClick = { adding = true }) { Text(stringResource(R.string.quotes_add)) }
        }
    }
    if (adding || editing != null) {
        val q = editing
        QuoteDialog(q, copies, onDismiss = { adding = false; editing = null }) { d ->
            onAction(if (q == null) QuoteAction.Add(d) else QuoteAction.Edit(q, d))
            adding = false
            editing = null
        }
    }
    deleting?.let { q ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            text = { Text(stringResource(R.string.quotes_deleteConfirm)) },
            confirmButton = { TextButton(onClick = { onAction(QuoteAction.Delete(q)); deleting = null }) { Text(stringResource(R.string.common_delete)) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

@Composable
private fun QuoteDialog(quote: QuoteEntity?, copies: List<CopyEntity>, onDismiss: () -> Unit, onSave: (QuoteDraft) -> Unit) {
    var text by remember { mutableStateOf(quote?.text.orEmpty()) }
    var page by remember { mutableStateOf(quote?.page?.toString().orEmpty()) }
    var note by remember { mutableStateOf(quote?.note.orEmpty()) }
    var copyId by remember { mutableStateOf(quote?.copyId) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.quotes_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(text, { text = it }, label = { Text(stringResource(R.string.quotes_text)) }, minLines = 3, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(page, { page = it.filter(Char::isDigit).take(5) }, label = { Text(stringResource(R.string.quotes_page)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (copies.size > 1) {
                    Picker(
                        stringResource(R.string.reading_copy),
                        copyId,
                        listOf<Pair<String?, String>>(null to "—") + copies.map { it.id to it.code.ifEmpty { "—" } },
                        { copyId = it },
                        Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(note, { note = it }, label = { Text(stringResource(R.string.quotes_note)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(QuoteDraft(text.trim(), page.toIntOrNull()?.takeIf { it > 0 }, note.trim(), copyId)) }, enabled = text.isNotBlank()) {
                Text(stringResource(R.string.common_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}
