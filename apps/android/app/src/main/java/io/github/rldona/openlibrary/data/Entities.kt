package io.github.rldona.openlibrary.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Fts4
import androidx.room.Index
import androidx.room.PrimaryKey

/*
 * Local copy of the catalog (read-only in F2). Rows mirror the server records; there are no foreign keys
 * because a sync page is not ordered by dependency (a copy can arrive before its edition).
 */

@Entity(tableName = "works", indices = [Index("sortTitle")])
data class WorkEntity(
    @PrimaryKey val id: String,
    val version: Int,
    val title: String,
    val subtitle: String?,
    val authors: List<String>,
    val subjects: List<String>,
    val description: String?,
    val originalTitle: String?,
    val originalLanguage: String?,
    val series: String?,
    val seriesIndex: Double?,
    val createdAt: String,
    val updatedAt: String,
    /** Derived locally: folded title for sorting. */
    val sortTitle: String,
)

@Entity(tableName = "editions", indices = [Index("workId")])
data class EditionEntity(
    @PrimaryKey val id: String,
    val version: Int,
    val workId: String,
    val title: String?,
    val subtitle: String?,
    val publisher: String?,
    val publishedYear: Int?,
    val language: String?,
    val pages: Int?,
    val format: String?,
    val isbn13: String?,
    val coverAssetId: String?,
    val metadataStatus: String,
    val metadataSource: String?,
    val createdAt: String,
    val updatedAt: String,
)

@Entity(tableName = "copies", indices = [Index("editionId"), Index("locationId")])
data class CopyEntity(
    @PrimaryKey val id: String,
    val version: Int,
    val editionId: String,
    val code: String,
    val locationId: String?,
    val condition: String,
    val acquiredOn: String?,
    val priceCents: Long?,
    val priceCurrency: String,
    val notes: String,
    val status: String,
    val retiredReason: String?,
    val retiredOn: String?,
    val createdAt: String,
    val updatedAt: String,
)

@Entity(tableName = "locations", indices = [Index("parentId")])
data class LocationEntity(
    @PrimaryKey val id: String,
    val version: Int,
    val parentId: String?,
    val name: String,
    val kind: String,
    val sortOrder: Int,
    val createdAt: String,
    val updatedAt: String,
)

/** Full-text index, one row per edition: folded title, authors, ISBN, publisher, subjects and locations. */
@Fts4(notIndexed = ["editionId"])
@Entity(tableName = "book_fts")
data class BookFts(
    @PrimaryKey @ColumnInfo(name = "rowid") val rowId: Int = 0,
    val editionId: String,
    val body: String,
)

/** Single row: where this phone's copy of the library stands. */
@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val id: Int = 0,
    val epoch: String,
    val cursor: Long,
    val lastSyncAt: Long?,
)
