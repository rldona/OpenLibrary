package io.github.rldona.openlibrary.core

import java.util.Locale

/** Lower case, single spaces, plain apostrophes: the dictionary's key form (as on the server). */
private fun subjectKey(s: String) = s.trim().replace(Regex("\\s+"), " ").replace('’', '\'').lowercase(Locale.ROOT)

/**
 * A genre as it is shown: in Spanish on a Spanish phone when the dictionary knows it ("Philosophy" →
 * "Filosofía"; "Fiction / Science Fiction" part by part), as stored otherwise. Only for display: what is
 * saved never changes.
 */
fun subjectLabel(subject: String, language: String = Locale.getDefault().language): String =
    translated(subject.trim(), language).replaceFirstChar { it.titlecase(Locale.getDefault()) }

/** Unknown genres keep their words; only their first letter is raised ("censorship" → "Censorship"). */
private fun translated(subject: String, language: String): String {
    if (language != "es") return subject
    SUBJECTS_ES[subjectKey(subject)]?.let { return it }
    if (!subject.contains('/')) return subject
    val parts = subject.split('/').map { it.trim() }
    val out = parts.map { SUBJECTS_ES[subjectKey(it)] ?: it }
    return if (out != parts) out.joinToString(" / ") else subject
}
