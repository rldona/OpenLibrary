package io.github.rldona.openlibrary.data

import android.content.Context
import java.io.File
import java.security.SecureRandom
import net.zetetic.database.sqlcipher.SQLiteDatabase

/**
 * The local database is encrypted with SQLCipher (design A10). Its key is 32 random bytes, generated once
 * and kept sealed by a non-exportable Android Keystore key, so a copy of the app's files is useless
 * without this phone's Keystore.
 */
object EncryptedDb {
    private const val KEY_FILE = "db.key"
    private val SQLITE_HEADER = "SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)

    fun loadLibrary() = System.loadLibrary("sqlcipher")

    /**
     * The raw key in SQLCipher's `x'…'` form (no key derivation: opening stays instant).
     * If the sealed key cannot be opened (the Keystore was reset) or is missing while an encrypted database
     * exists (files restored onto another phone), that database is unreadable for good: it is deleted and
     * the next sync downloads the library again.
     */
    fun key(context: Context, db: File, cipher: SecretCipher = KeystoreCipher("openlibrary-db-key")): String {
        val file = File(context.noBackupFilesDir, KEY_FILE)
        if (file.exists()) {
            runCatching { cipher.decrypt(file.readText()) }.onSuccess { return it }
            file.delete()
        }
        if (db.exists() && !isPlain(db)) delete(db)
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val key = "x'" + bytes.joinToString("") { "%02X".format(it) } + "'"
        val tmp = File(file.path + ".tmp")
        tmp.writeText(cipher.encrypt(key))
        tmp.renameTo(file)
        return key
    }

    fun delete(db: File) {
        for (suffix in listOf("", "-wal", "-shm", "-journal")) File(db.path + suffix).delete()
    }

    /** True for a database file still in plain SQLite (installed before encryption existed). */
    fun isPlain(db: File): Boolean {
        if (!db.exists() || db.length() < SQLITE_HEADER.size) return false
        val head = ByteArray(SQLITE_HEADER.size)
        db.inputStream().use { it.read(head) }
        return head.contentEquals(SQLITE_HEADER)
    }

    /**
     * Encrypts a plain database in place, keeping everything (pending changes included): it is copied into
     * an encrypted file with `sqlcipher_export`, which then replaces the original. If anything fails the
     * original file is left untouched.
     */
    fun encryptInPlace(db: File, key: String) {
        val target = File(db.path + ".encrypting")
        target.delete()
        val plain = SQLiteDatabase.openDatabase(
            db.path, "", null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY, null, null,
        )
        try {
            plain.rawQuery("PRAGMA wal_checkpoint(FULL)", null).use { it.moveToFirst() }
            val version = plain.rawQuery("PRAGMA user_version", null).use { it.moveToFirst(); it.getInt(0) }
            plain.execSQL("ATTACH DATABASE ? AS encrypted KEY \"$key\"", arrayOf(target.path))
            plain.rawQuery("SELECT sqlcipher_export('encrypted')", null).use { it.moveToFirst() }
            plain.execSQL("PRAGMA encrypted.user_version = $version")
            plain.execSQL("DETACH DATABASE encrypted")
        } finally {
            plain.close()
        }
        for (suffix in listOf("-wal", "-shm", "-journal")) File(db.path + suffix).delete()
        if (!target.renameTo(db)) error("could not replace ${db.name} with its encrypted copy")
    }
}
