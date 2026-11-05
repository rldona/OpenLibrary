package io.github.rldona.openlibrary.data

import android.content.Context
import android.util.Log
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import kotlinx.serialization.json.Json
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

class Converters {
    @TypeConverter fun fromList(value: List<String>): String = Json.encodeToString(value)
    @TypeConverter fun toList(value: String): List<String> = Json.decodeFromString(value)
}

@Database(
    entities = [
        WorkEntity::class, EditionEntity::class, CopyEntity::class, LocationEntity::class,
        BookFts::class, SyncStateEntity::class, OutboxEntity::class, PendingUploadEntity::class,
        ReadingEntity::class, WishEntity::class, QuoteEntity::class,
    ],
    version = 6,
    exportSchema = true,
    autoMigrations = [AutoMigration(from = 1, to = 2), AutoMigration(from = 2, to = 3), AutoMigration(from = 3, to = 4),
        AutoMigration(from = 4, to = 5), AutoMigration(from = 5, to = 6),
    ],
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun catalog(): CatalogDao
    abstract fun sync(): SyncDao
    abstract fun outbox(): OutboxDao

    companion object {
        /** The encrypted database; a plain one from an older version is encrypted first, keeping its data. */
        fun open(context: Context): AppDatabase {
            EncryptedDb.loadLibrary()
            val file = context.getDatabasePath(NAME)
            val key = EncryptedDb.key(context, file)
            // If encrypting fails (it should not) the app keeps working on the plain file and retries next start.
            val plain = EncryptedDb.isPlain(file) &&
                runCatching { EncryptedDb.encryptInPlace(file, key) }
                    .onFailure { Log.e("OpenLibrary", "could not encrypt the local database", it) }
                    .isFailure
            return Room.databaseBuilder(context, AppDatabase::class.java, NAME)
                .apply { if (!plain) openHelperFactory(SupportOpenHelperFactory(key.toByteArray())) }
                .build()
        }

        private const val NAME = "library.db"
    }
}
