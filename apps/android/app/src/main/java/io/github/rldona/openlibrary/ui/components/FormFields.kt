package io.github.rldona.openlibrary.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.rldona.openlibrary.R
import io.github.rldona.openlibrary.core.fold
import io.github.rldona.openlibrary.core.str
import io.github.rldona.openlibrary.sync.CoverStore
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

/** "a; b; c" as a list, trimmed, without blanks or repeats (case- and accent-insensitive). */
fun splitChips(value: String): List<String> =
    value.split(';').map { it.trim() }.filter { it.isNotEmpty() }.distinctBy(::fold)

/** [value] plus what is typed in [draft] (also split on ";"), as the field would hold it after confirming. */
fun withDraft(value: String, draft: String): String = (splitChips(value) + splitChips(draft)).distinctBy(::fold).joinToString("; ")

/**
 * Up to [max] of [suggestions] that match what is being typed, leaving out those already chosen. Nothing
 * while the field is empty: the whole list of authors is never shown.
 */
fun chipSuggestions(suggestions: List<String>, chosen: List<String>, typed: String, max: Int = 4): List<String> {
    val q = fold(typed.trim())
    if (q.isEmpty()) return emptyList()
    val taken = chosen.mapTo(HashSet(), ::fold)
    val matches = suggestions.filter { fold(it) !in taken && fold(it).contains(q) }
    // Names that start with the text first ("Jos" → "José…" before "María José…").
    return matches.sortedBy { if (fold(it).startsWith(q)) 0 else 1 }.take(max)
}

/** A label above the field (not floating), as in the book forms. */
@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * Text field with its label above. [missing] marks a field the book still lacks: an accent border and
 * "Missing" as the placeholder.
 */
@Composable
fun LabeledField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    missing: Boolean = false,
    error: Boolean = false,
    number: Boolean = false,
    words: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FieldLabel(label)
        val accent = MaterialTheme.colorScheme.primary
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            isError = error,
            placeholder = (if (missing && value.isEmpty()) stringResource(R.string.form_missing) else placeholder)?.let { { Text(it) } },
            trailingIcon = trailing,
            shape = MaterialTheme.shapes.large,
            colors = if (missing && value.isEmpty()) OutlinedTextFieldDefaults.colors(unfocusedBorderColor = accent) else OutlinedTextFieldDefaults.colors(),
            keyboardOptions = KeyboardOptions(
                keyboardType = if (number) KeyboardType.Number else KeyboardType.Text,
                capitalization = if (words) KeyboardCapitalization.Words else KeyboardCapitalization.Sentences,
            ),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        )
    }
}

/**
 * Chips field for authors and genres: the chosen ones are filled chips with ×, new ones are typed in the
 * same box and suggestions from [suggestions] appear only while typing. [draft] is what is typed and not
 * confirmed yet; the form keeps it, so saving never loses it ([withDraft]).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipsField(
    label: String,
    value: String,
    draft: String,
    onDraft: (String) -> Unit,
    suggestions: List<String>,
    placeholder: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    missing: Boolean = false,
) {
    val chosen = splitChips(value)
    fun commit(raw: String) {
        if (splitChips(raw).isEmpty()) return
        onChange(withDraft(value, raw))
        onDraft("")
    }
    var focused by remember { mutableStateOf(false) }
    val outline = when {
        focused -> MaterialTheme.colorScheme.primary
        missing && chosen.isEmpty() -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.outline
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FieldLabel(label)
        FlowRow(
            Modifier.fillMaxWidth().heightIn(min = 56.dp)
                .border(BorderStroke(if (focused) 2.dp else 1.dp, outline), MaterialTheme.shapes.large)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            chosen.forEach { name ->
                InputChip(
                    selected = true,
                    onClick = { onChange(chosen.filter { it != name }.joinToString("; ")) },
                    label = { Text(name) },
                    trailingIcon = {
                        Icon(Icons.Default.Close, contentDescription = str(R.string.common_remove) + " " + name, Modifier.size(18.dp))
                    },
                    shape = RoundedCornerShape(50),
                    colors = InputChipDefaults.inputChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primary,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                        selectedTrailingIconColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    border = null,
                    modifier = Modifier.heightIn(min = 40.dp),
                )
            }
            val hint = if (chosen.isEmpty()) placeholder else stringResource(R.string.chips_addAnother)
            BasicTextField(
                value = draft,
                onValueChange = { text ->
                    // A ";" typed (or pasted) confirms what comes before it.
                    if (text.contains(';')) commit(text) else onDraft(text)
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, capitalization = KeyboardCapitalization.Words),
                keyboardActions = KeyboardActions(onDone = { commit(draft) }),
                modifier = Modifier.weight(1f).widthIn(min = 140.dp).heightIn(min = 40.dp)
                    .onFocusChanged { focused = it.isFocused }
                    .semantics { contentDescription = label },
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart, modifier = Modifier.heightIn(min = 40.dp)) {
                        if (draft.isEmpty()) Text(hint, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        inner()
                    }
                },
            )
        }
        val matches = chipSuggestions(suggestions, chosen, draft)
        if (matches.isNotEmpty()) {
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                matches.forEach { name -> SuggestionPill(name) { commit(name) } }
            }
        }
    }
}

/** "+ Name" in a dashed pill: adds a suggested name. */
@Composable
private fun SuggestionPill(name: String, onClick: () -> Unit) {
    val color = MaterialTheme.colorScheme.outline
    val description = str(R.string.chips_add, "name" to name)
    Box(
        Modifier.heightIn(min = 48.dp)
            .drawBehind {
                val r = size.height / 2
                drawRoundRect(color, cornerRadius = CornerRadius(r, r), style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))))
            }
            .clickable(onClickLabel = description, onClick = onClick)
            .semantics { contentDescription = description }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("+ $name", style = MaterialTheme.typography.bodyLarge)
    }
}

/**
 * The top of a book form: the cover on the left (or a dashed slot to add it) and the main fields on the
 * right. Shared by "Add by hand" and "Edit book".
 */
@Composable
fun BookHeader(cover: @Composable () -> Unit, fields: @Composable ColumnScope.() -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        Box(Modifier.width(112.dp)) { cover() }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) { fields() }
    }
}

/**
 * The cover in a [BookHeader]: the picture with "Change cover" under it, or a dashed "Cover photo" slot.
 * [onClick] opens whatever lets the user choose (camera, gallery…).
 */
@Composable
fun CoverSlot(covers: CoverStore, coverId: String?, title: String, authors: List<String>, onClick: () -> Unit, width: Dp = 112.dp) {
    if (coverId == null) {
        val color = MaterialTheme.colorScheme.outline
        val label = stringResource(R.string.form_coverSlot)
        Surface(
            onClick = onClick,
            color = androidx.compose.ui.graphics.Color.Transparent,
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.width(width).aspectRatio(2f / 3f).drawBehind {
                val r = 14.dp.toPx()
                drawRoundRect(color, cornerRadius = CornerRadius(r, r), style = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))))
            },
        ) {
            Column(Modifier.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)) {
                Icon(Icons.Outlined.PhotoCamera, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center)
            }
        }
    } else {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.clickable(onClick = onClick)) { Cover(covers, coverId, title.ifBlank { "?" }, width, authors = authors) }
            TextButton(onClick = onClick, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.form_changeCover), maxLines = 1) }
        }
    }
}
