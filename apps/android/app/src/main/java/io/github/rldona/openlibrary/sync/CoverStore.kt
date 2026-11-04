package io.github.rldona.openlibrary.sync

import java.io.File

/**
 * Cover thumbnails kept as plain files (not an LRU cache) so the whole library stays browsable with the
 * server off. Covers are content addressed: a file never changes once downloaded.
 */
class CoverStore(private val dir: File) {
    fun file(id: String): File = File(dir, "$id.jpg")

    fun has(id: String): Boolean = file(id).exists()

    /** Full-size version for the zoomable viewer, downloaded on demand. */
    fun fullFile(id: String): File = File(dir, "$id.full.jpg")

    fun putFull(id: String, bytes: ByteArray) {
        dir.mkdirs()
        val tmp = File(dir, "$id.full.part")
        tmp.writeBytes(bytes)
        tmp.renameTo(fullFile(id))
    }

    fun put(id: String, bytes: ByteArray) {
        dir.mkdirs()
        val tmp = File(dir, "$id.part")
        tmp.writeBytes(bytes)
        tmp.renameTo(file(id))
    }

    /** Deletes covers no edition uses any more. */
    fun retainOnly(ids: Set<String>) {
        dir.listFiles()?.forEach { f -> if (f.name.substringBefore('.') !in ids) f.delete() }
    }

    fun clear() {
        dir.deleteRecursively()
    }
}
