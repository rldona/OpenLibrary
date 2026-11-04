package io.github.rldona.openlibrary.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import kotlinx.serialization.json.Json

class Converters {
    @TypeConverter fun fromList(value: List<String>): String = Json.encodeToString(value)
    @TypeConverter fun toList(value: String): List<String> = Json.decodeFromString(value)
}

@Database(
    entities = [
        WorkEntity::class, EditionEntity::class, CopyEntity::class, LocationEntity::class,
        BookFts::class, SyncStateEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun catalog(): CatalogDao
    abstract fun sync(): SyncDao

    companion object {
        fun open(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "library.db").build()
    }
}
