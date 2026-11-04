package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.IsbnResult
import io.github.rldona.openlibrary.core.normalizeIsbn
import io.github.rldona.openlibrary.core.uuidv7
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same rules as packages/contracts/src/isbn.ts. */
class IsbnTest {
    private fun reason(s: String) = (normalizeIsbn(s) as IsbnResult.Invalid).reason

    @Test
    fun validCodesAreNormalisedToIsbn13() {
        assertEquals(IsbnResult.Ok("9788497592468", "8497592468"), normalizeIsbn("978-84-9759-246-8"))
        assertEquals(IsbnResult.Ok("9788432221477", "8432221473"), normalizeIsbn("84-322-2147-3"))
        assertEquals(IsbnResult.Ok("9780306406157", "0306406152"), normalizeIsbn("0 306 40615 2"))
        assertEquals(IsbnResult.Ok("9791032305690", null), normalizeIsbn("9791032305690"))
    }

    @Test
    fun otherBarcodesSayWhyTheyAreNotIsbns() {
        assertEquals("issn", reason("9771234567003"))
        assertEquals("ismn", reason("9790230671187"))
        assertEquals("ean", reason("8410000000001"))
        assertEquals("checksum", reason("9788497592469"))
        assertEquals("format", reason("84X2221473"))
        assertEquals("length", reason("12345"))
    }

    @Test
    fun uuidv7IsTimeOrdered() {
        val a = uuidv7(1_000)
        val b = uuidv7(2_000)
        assertTrue(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(a))
        assertTrue(a < b)
    }
}
