package io.github.rldona.openlibrary.core

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** An ISO date ("2026-11-05") the way the phone's locale writes it ("5 nov 2026"); anything else comes back as is. */
fun fmtDate(iso: String, locale: Locale = Locale.getDefault()): String =
    runCatching { LocalDate.parse(iso).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) }
        .getOrDefault(iso)

/**
 * The name of a language code in the phone's language ("es" → "Español"), as the web's `langName`; a code
 * the platform does not know comes back as typed.
 */
fun languageName(code: String, locale: Locale = Locale.getDefault()): String {
    val tag = code.trim()
    if (tag.isEmpty()) return tag
    val name = Locale.forLanguageTag(tag).getDisplayLanguage(locale)
    return if (name.isEmpty() || name.equals(tag, ignoreCase = true)) tag else name.replaceFirstChar { it.titlecase(locale) }
}
