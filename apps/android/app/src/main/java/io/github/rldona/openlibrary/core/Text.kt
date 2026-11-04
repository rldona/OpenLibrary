package io.github.rldona.openlibrary.core

import java.text.Normalizer

private val MARKS = Regex("\\p{M}+")
private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")

/** Lower case without diacritics ("Galdós" → "galdos"), as the server's search does. */
fun fold(s: String): String = MARKS.replace(Normalizer.normalize(s, Normalizer.Form.NFD), "").lowercase()

/** FTS4 query: every word must match as a prefix ("gal per" finds "Benito Pérez Galdós"). */
fun ftsQuery(input: String): String =
    NON_WORD.split(fold(input)).filter { it.isNotBlank() }.joinToString(" ") { "$it*" }
