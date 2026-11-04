package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.network.SyncPullPage
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
    }

    @Test
    fun pullFixtureDecodes() {
        val p = strict.decodeFromString<SyncPullPage>(fixture("pull.json"))
        assertTrue(p.deleted.isNotEmpty())
        assertTrue(p.cursor > 0)
    }
}
