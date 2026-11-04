package io.github.rldona.openlibrary.data

import kotlinx.serialization.Serializable

/*
 * Statistics computed on the phone's copy (works offline), with the definitions of
 * packages/contracts/src/stats.ts. StatsParityTest checks the result against the server's on the same data.
 */

@Serializable data class CountBy(val key: String, val count: Int)

@Serializable data class Money(val currency: String, val cents: Long)

@Serializable
data class CollectionStats(
    val works: Int,
    val editions: Int,
    val copies: Int,
    val retiredCopies: Int,
    val copiesWithoutLocation: Int,
    val provisionalEditions: Int,
    val locations: Int,
    val value: List<Money>,
)

@Serializable data class YearReading(val year: Int, val works: Int, val pages: Int)

@Serializable
data class ReadingStats(
    val read: Int,
    val reading: Int,
    val pending: Int,
    val finishedSessions: Int,
    val abandonedSessions: Int,
    val averageRating: Double?,
    val byYear: List<YearReading>,
)

@Serializable data class YearCopies(val year: Int, val copies: Int)

@Serializable
data class Stats(
    val collection: CollectionStats,
    val reading: ReadingStats,
    val acquiredByYear: List<YearCopies>,
    val authors: List<CountBy>,
    val subjects: List<CountBy>,
    val languages: List<CountBy>,
    val wishlistOpen: Int,
)

private const val TOP = 10

private fun rank(counts: Map<String, Int>, top: Int = TOP): List<CountBy> =
    counts.map { CountBy(it.key, it.value) }.sortedWith(compareByDescending<CountBy> { it.count }.thenBy { it.key }).take(top)

private fun yearOf(iso: String?): Int? = iso?.takeIf { it.length >= 4 && it.take(4).all(Char::isDigit) }?.take(4)?.toInt()

suspend fun computeStats(db: AppDatabase): Stats {
    val d = db.sync()
    val allCopies = d.allCopies()
    val active = allCopies.filter { it.status == "active" }
    val eds = d.allEditions().associateBy { it.id }
    val wks = d.allWorks().associateBy { it.id }
    val sessions = d.allReadings()
    val copyById = allCopies.associateBy { it.id }

    // Collection: editions and works with at least one active copy.
    val edsIn = active.map { it.editionId }.filter { it in eds }.toSet()
    val worksIn = edsIn.mapNotNull { eds[it]?.workId }.filter { it in wks }.toSet()
    val value = active.filter { it.priceCents != null }.groupBy { it.priceCurrency }
        .map { (cur, cs) -> Money(cur, cs.sumOf { it.priceCents!! }) }.sortedBy { it.currency }

    val workOf = { copyId: String -> copyById[copyId]?.let { eds[it.editionId]?.workId } }
    val byWork = sessions.groupBy { workOf(it.copyId) }
    val statuses = worksIn.map { workReadingStatus(byWork[it].orEmpty()) }
    val finished = sessions.filter { it.status == "read" }
    val rated = finished.mapNotNull { it.rating }
    val years = mutableMapOf<Int, Pair<MutableSet<String>, Int>>()
    for (s in finished) {
        val y = yearOf(s.finishedOn) ?: continue
        val e = copyById[s.copyId]?.let { eds[it.editionId] } ?: continue
        val (set, pages) = years.getOrPut(y) { mutableSetOf<String>() to 0 }
        set += e.workId
        years[y] = set to pages + (e.pages ?: 0)
    }

    val authors = mutableMapOf<String, Int>()
    val subjects = mutableMapOf<String, Int>()
    for (id in worksIn) {
        val w = wks.getValue(id)
        w.authors.toSet().forEach { authors.merge(it, 1, Int::plus) }
        w.subjects.toSet().forEach { subjects.merge(it, 1, Int::plus) }
    }
    val languages = edsIn.groupingBy { eds.getValue(it).language ?: "" }.eachCount()

    return Stats(
        collection = CollectionStats(
            works = worksIn.size,
            editions = edsIn.size,
            copies = active.size,
            retiredCopies = allCopies.size - active.size,
            copiesWithoutLocation = active.count { it.locationId == null },
            provisionalEditions = edsIn.count { eds.getValue(it).metadataStatus == "provisional" },
            locations = d.allLocations().size,
            value = value,
        ),
        reading = ReadingStats(
            read = statuses.count { it == "read" },
            reading = statuses.count { it == "reading" },
            pending = statuses.count { it == "pending" },
            finishedSessions = finished.size,
            abandonedSessions = sessions.count { it.status == "abandoned" },
            averageRating = if (rated.isEmpty()) null else Math.round(rated.average() * 100) / 100.0,
            byYear = years.map { (y, e) -> YearReading(y, e.first.size, e.second) }.sortedByDescending { it.year },
        ),
        acquiredByYear = allCopies.mapNotNull { yearOf(it.acquiredOn) }.groupingBy { it }.eachCount()
            .map { YearCopies(it.key, it.value) }.sortedByDescending { it.year },
        authors = rank(authors),
        subjects = rank(subjects),
        languages = rank(languages, Int.MAX_VALUE),
        wishlistOpen = d.allWishes().count { it.status == "open" },
    )
}
