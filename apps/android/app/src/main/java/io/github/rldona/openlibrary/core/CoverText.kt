package io.github.rldona.openlibrary.core

/** A text box recognised on a cover, in image pixels, so this module stays plain-JVM testable. */
data class OcrPoint(val x: Float, val y: Float)

data class OcrLine(val text: String, val bounds: PixelRect, val corners: List<OcrPoint> = emptyList())

/** Title and optional author read from the large text on a cover. */
data class CoverQuery(val title: String, val author: String?)

private val WHITESPACE = Regex("\\s+")
private val READING_ORDER = compareBy<OcrLine>({ it.bounds.top }, { it.bounds.left })

// Product, barcode and web text that is never part of the title.
private val NOISE_MARKERS = listOf("isbn", "pvp", "€", "www.", ".com", "http")
// Promotional text printed above or below the title.
private val PROMO_PREFIXES = listOf("del autor de", "premio", "best seller", "bestseller", "nº 1", "#1")
private val AUTHOR_PREFIX = Regex("^(by|de|por)\\s+", RegexOption.IGNORE_CASE)
private const val NAME_PUNCTUATION = ".'’,&-"

private const val MIN_CHARS = 2
private const val MIN_TITLE_CHARS = 3
private const val MAX_TITLE_LINES = 3
private const val MAX_AUTHOR_CHARS = 60
private const val MAX_HEIGHT_RATIO = 1.6f
private const val MAX_VERTICAL_GAP = 0.6f
private const val TITLE_REGION_FRACTION = 0.7f

/**
 * Reads the title and author from the lines OCR found on a cover. Everything here is a plain heuristic:
 * it ignores product text, groups lines that belong to the same block, and trusts the largest text near
 * the top of the frame. [frame] is optional because the caller may already have cropped the image.
 */
fun extractCoverQuery(lines: List<OcrLine>, frame: PixelRect? = null): CoverQuery? {
    val visible = lines.filter { line ->
        (frame == null || inside(line.bounds, frame)) && usable(line.text) && !noise(line.text)
    }
    if (visible.isEmpty()) return null

    val bands = bandsOf(visible)
    // With a camera frame, ignore large text below it (promos on the table, the book's back cover).
    val titleLimit = frame?.let { it.top + it.height * TITLE_REGION_FRACTION }
    // The largest line height wins: a tall but small-area line is not a title.
    val titleBand = bands
        .filter { titleLimit == null || centerY(it.bounds) <= titleLimit }
        // Tallest wins; a wider band breaks a tie (titles usually span more of the cover than names).
        .maxWithOrNull(compareBy<Band>({ it.lineHeight }, { it.bounds.width }, { -it.bounds.top }))
        ?: return null

    val title = titleText(titleBand)
    if (title.count { it.isLetterOrDigit() } < MIN_TITLE_CHARS) return null

    return CoverQuery(title, authorOf(bands, titleBand))
}

private fun centerY(bounds: PixelRect): Float = (bounds.top + bounds.bottom) / 2

private fun centerX(bounds: PixelRect): Float = (bounds.left + bounds.right) / 2

private fun inside(bounds: PixelRect, frame: PixelRect): Boolean =
    centerX(bounds) in frame.left..frame.right && centerY(bounds) in frame.top..frame.bottom

// Numeric titles such as 1984, 1Q84 or 2666 are real: count letters and digits, not only letters.
private fun usable(text: String): Boolean = text.count { it.isLetterOrDigit() } >= MIN_CHARS

private fun noise(text: String): Boolean {
    val t = collapse(text).lowercase()
    return NOISE_MARKERS.any { t.contains(it) } || PROMO_PREFIXES.any { t.startsWith(it) }
}

private fun collapse(text: String): String = text.trim().replace(WHITESPACE, " ")

private class Band(val lines: List<OcrLine>) {
    val bounds: PixelRect = PixelRect(
        lines.minOf { it.bounds.left },
        lines.minOf { it.bounds.top },
        lines.maxOf { it.bounds.right },
        lines.maxOf { it.bounds.bottom },
    )

    /** Font size proxy, not the height of the whole block. */
    val lineHeight: Float = lines.maxOf { it.bounds.height }

    val text: String = joined(lines)

    private companion object {
        fun joined(lines: List<OcrLine>): String =
            lines.sortedWith(READING_ORDER).joinToString(" ") { collapse(it.text) }
    }
}

private fun bandsOf(lines: List<OcrLine>): List<Band> {
    val bands = mutableListOf<MutableList<OcrLine>>()
    for (line in lines.sortedWith(READING_ORDER)) {
        val band = bands.lastOrNull()
        if (band != null && sameBand(band, line)) band += line else bands += mutableListOf(line)
    }
    return bands.map { Band(it) }
}

/** Lines join a band when they are vertically close and their heights stay within a factor of 1.6. */
private fun sameBand(band: List<OcrLine>, line: OcrLine): Boolean {
    val bandMin = band.minOf { it.bounds.height }
    val bandMax = band.maxOf { it.bounds.height }
    val minHeight = minOf(bandMin, line.bounds.height)
    val maxHeight = maxOf(bandMax, line.bounds.height)
    if (maxHeight > minHeight * MAX_HEIGHT_RATIO) return false

    val last = band.maxByOrNull { it.bounds.bottom } ?: return false
    val gap = line.bounds.top - last.bounds.bottom
    return gap <= maxOf(last.bounds.height, line.bounds.height) * MAX_VERTICAL_GAP
}

private fun titleText(band: Band): String =
    band.lines.sortedWith(READING_ORDER).take(MAX_TITLE_LINES)
        .joinToString(" ") { collapse(it.text) }

private fun authorOf(bands: List<Band>, titleBand: Band): String? {
    val titleCenter = centerY(titleBand.bounds)

    // The author normally sits above the title; take the closest band that looks like a name.
    val above = bands
        .filter { it !== titleBand && centerY(it.bounds) < titleCenter }
        .sortedByDescending { centerY(it.bounds) }
    above.firstNotNullOfOrNull { authorName(it.text) }?.let { return it }

    // Below the title only an explicit "by/de/por" is trustworthy: an unprefixed line is a subtitle.
    val below = bands
        .filter { it !== titleBand && centerY(it.bounds) > titleCenter }
        .minByOrNull { centerY(it.bounds) } ?: return null
    return if (AUTHOR_PREFIX.containsMatchIn(below.text)) authorName(below.text) else null
}

private fun authorName(raw: String): String? {
    val text = AUTHOR_PREFIX.replace(collapse(raw), "")
    val words = text.split(' ').filter { it.isNotEmpty() }
    if (text.length > MAX_AUTHOR_CHARS) return null
    if (words.size !in 2..5) return null
    if (text.any { it.isDigit() }) return null
    if (words.any { word -> word.none { it.isLetter() } }) return null
    if (text.any { !it.isLetter() && !it.isWhitespace() && it !in NAME_PUNCTUATION }) return null
    return text
}
