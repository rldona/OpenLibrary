package io.github.rldona.openlibrary.core

/** Port of packages/contracts/src/isbn.ts (same rules; IsbnTest uses the same vectors). */
sealed interface IsbnResult {
    data class Ok(val isbn13: String, val isbn10: String?) : IsbnResult
    /** `reason` is the suffix of the `isbn.<reason>` message key. */
    data class Invalid(val reason: String) : IsbnResult
}

private fun check13(p12: String): Char {
    var s = 0
    for (i in 0 until 12) s += (p12[i] - '0') * (if (i % 2 == 1) 3 else 1)
    return '0' + (10 - s % 10) % 10
}

fun isbn13to10(isbn13: String): String? {
    if (!isbn13.startsWith("978")) return null
    val body = isbn13.substring(3, 12)
    var s = 0
    for (i in 0 until 9) s += (body[i] - '0') * (10 - i)
    val d = (11 - s % 11) % 11
    return body + if (d == 10) "X" else d.toString()
}

/** Accepts ISBN-10/13 with or without hyphens/spaces. Rejects ISSN (977), ISMN (9790) and product EANs. */
fun normalizeIsbn(raw: String): IsbnResult {
    val c = raw.uppercase().filter { it.isDigit() || it == 'X' }
    if (c.length == 13) {
        if (c.startsWith("977")) return IsbnResult.Invalid("issn")
        if (c.startsWith("9790")) return IsbnResult.Invalid("ismn")
        if (!Regex("^97[89]\\d{10}$").matches(c)) return IsbnResult.Invalid("ean")
        if (check13(c.substring(0, 12)) != c[12]) return IsbnResult.Invalid("checksum")
        return IsbnResult.Ok(c, isbn13to10(c))
    }
    if (c.length == 10) {
        if (!Regex("^\\d{9}[\\dX]$").matches(c)) return IsbnResult.Invalid("format")
        var s = 0
        for (i in 0 until 10) s += (if (c[i] == 'X') 10 else c[i] - '0') * (10 - i)
        if (s % 11 != 0) return IsbnResult.Invalid("checksum")
        val p12 = "978" + c.substring(0, 9)
        return IsbnResult.Ok(p12 + check13(p12), c)
    }
    return IsbnResult.Invalid("length")
}

/** 978-84-9759-246-8 (approximate grouping; display only), like formatIsbn in the contracts. */
fun formatIsbn(isbn13: String): String =
    if (isbn13.length == 13) "${isbn13.substring(0, 3)}-${isbn13.substring(3, 5)}-${isbn13.substring(5, 9)}-${isbn13.substring(9, 12)}-${isbn13[12]}"
    else isbn13
