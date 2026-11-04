package io.github.rldona.openlibrary.core

import java.security.MessageDigest
import java.security.SecureRandom

private val random = SecureRandom()

/** UUIDv7 like packages/contracts/src/ids.ts: entities created offline keep their id on the server. */
fun uuidv7(now: Long = System.currentTimeMillis()): String {
    val b = ByteArray(16)
    random.nextBytes(b)
    for (i in 0 until 6) b[i] = (now shr (8 * (5 - i))).toByte()
    b[6] = ((b[6].toInt() and 0x0f) or 0x70).toByte()
    b[8] = ((b[8].toInt() and 0x3f) or 0x80).toByte()
    val h = b.joinToString("") { "%02x".format(it) }
    return "${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}"
}

/** Asset ids are the SHA-256 of the file, as the server computes them. */
fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
