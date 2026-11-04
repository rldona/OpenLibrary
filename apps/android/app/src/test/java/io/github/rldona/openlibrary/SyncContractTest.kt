package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.network.Asset
import io.github.rldona.openlibrary.network.LookupResult
import io.github.rldona.openlibrary.network.SyncPullPage
import io.github.rldona.openlibrary.network.SyncPushResponse
import io.github.rldona.openlibrary.network.SyncSnapshot
import java.io.File
import kotlinx.serialization.json.Json
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decodes real server responses (packages/contracts/fixtures, validated against openapi.yaml by the server
 * tests) WITHOUT ignoring unknown keys: a field added on either side alone breaks this test.
 */
class SyncContractTest {
    private val strict = Json { ignoreUnknownKeys = false }
    private fun fixture(name: String) = File("../../../packages/contracts/fixtures/$name").readText()

    @Test
    fun snapshotFixtureDecodes() {
        val s = strict.decodeFromString<SyncSnapshot>(fixture("snapshot.json"))
        assertTrue(s.works.isNotEmpty() && s.editions.isNotEmpty() && s.copies.isNotEmpty() && s.locations.isNotEmpty())
        assertTrue(s.copies.any { it.status == "retired" && it.retiredReason != null })
        assertTrue(s.readings.any { it.status == "read" && it.rating == 4.5 })
        assertTrue(s.wishes.any { it.status == "acquired" && it.acquiredCopyId != null })
        assertTrue(s.quotes.any { it.page == 12 && it.copyId != null })
    }

    @Test
    fun pullFixtureDecodes() {
        val p = strict.decodeFromString<SyncPullPage>(fixture("pull.json"))
        assertTrue(p.deleted.isNotEmpty())
        assertTrue(p.cursor > 0)
    }

    @Test
    fun pushFixtureDecodes() {
        val r = strict.decodeFromString<SyncPushResponse>(fixture("push.json"))
        assertTrue(r.results.map { it.status } == listOf("applied", "duplicate", "conflict", "rejected"))
        assertTrue(r.results[2].conflicts!!.single().field == "subtitle")
    }

    @Test
    fun captureFixturesDecode() {
        val l = strict.decodeFromString<LookupResult>(fixture("lookup.json"))
        assertTrue(l.found && l.proposal!!.authors.isNotEmpty())
        assertTrue(strict.decodeFromString<Asset>(fixture("asset.json")).id.length == 64)
    }
}
