package io.github.rldona.openlibrary.core

/** Ratings go from 1 to [MAX_RATING] stars (the server also accepts halves, which are shown but not set here). */
const val MAX_RATING = 5

/**
 * The rating after tapping star [star] (1-based): that many stars, or none when it was already exactly that
 * (tapping the same star again clears it).
 */
fun toggledRating(current: Double?, star: Int): Double? {
    require(star in 1..MAX_RATING) { "star $star out of 1..$MAX_RATING" }
    return if (current == star.toDouble()) null else star.toDouble()
}

/** How star [star] looks for [rating]: full, half or empty. */
enum class StarFill { Full, Half, Empty }

fun starFill(rating: Double?, star: Int): StarFill {
    val r = rating ?: 0.0
    return when {
        r >= star -> StarFill.Full
        r >= star - 0.5 -> StarFill.Half
        else -> StarFill.Empty
    }
}
