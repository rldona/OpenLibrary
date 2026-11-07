package io.github.rldona.openlibrary.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Fts4
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

/*
 * Local copy of the catalog. Rows mirror the server records; there are no foreign keys because a sync
 * page is not ordered by dependency (a copy can arrive before its edition). Local edits are applied to
 * these rows right away and queued in the outbox (F3); `version` stays the last one seen from the server.
 * The rows are @Serializable so an op's `fields` (server field names) can be applied generically.
 */

@Entity(tableName = "works", indices = [Index("sortTitle")])
@Serializable
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
    /** Synced work field: shared with the web Favorites. */
    @ColumnInfo(defaultValue = "0") val favorite: Boolean = false,
)

@Entity(tableName = "editions", indices = [Index("workId")])
@Serializable
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
@Serializable
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
@Serializable
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

/** One reading of a copy (F4). The work's status is derived from these (see [workReadingStatus]). */
@Serializable
@Entity(tableName = "readings", indices = [Index("copyId")])
data class ReadingEntity(
    @PrimaryKey val id: String,
    val version: Int,
    val copyId: String,
    val status: String,
    val startedOn: String?,
    val finishedOn: String?,
    val rating: Double?,
    val notes: String,
    val createdAt: String,
    val updatedAt: String,
)

/** BR13, like workReadingStatus in packages/contracts: reading if any session is, read if any was. */
fun workReadingStatus(sessions: List<ReadingEntity>): String =
    when {
        sessions.any { it.status == "reading" } -> "reading"
        sessions.any { it.status == "read" } -> "read"
        else -> "pending"
    }

/** A book you want (F4); never part of the collection (BR14). */
@Serializable
@Entity(tableName = "wishes", indices = [Index("isbn13")])
data class WishEntity(
    @PrimaryKey val id: String,
    val version: Int,
    val title: String,
    val authors: List<String>,
    val isbn13: String?,
    val workId: String?,
    val priority: String,
    val notes: String,
    val status: String,
    val acquiredCopyId: String?,
    val createdAt: String,
    val updatedAt: String,
    /** Cover found by the ISBN lookup; "I bought it" gives it to the book. */
    val coverAssetId: String? = null,
)

/** A passage kept from a work (F4). */
@Serializable
@Entity(tableName = "quotes", indices = [Index("workId")])
data class QuoteEntity(
    @PrimaryKey val id: String,
    val version: Int,
    val workId: String,
    val copyId: String?,
    val text: String,
    val page: Int?,
    val note: String,
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

/**
 * Changes made on this phone waiting for the server, in order. `payload` is the op as sent to
 * POST /sync/push. `status`: pending → sent on the next sync; conflict / rejected → shown to the user,
 * who resolves or discards them (they are never sent again as they are).
 */
@Entity(tableName = "outbox", indices = [Index(value = ["opId"], unique = true), Index("status")])
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val opId: String,
    val type: String,
    val entityId: String,
    val payload: String,
    val status: String = "pending",
    val message: String? = null,
    /** JSON list of {field, current, yours} for conflicts. */
    val conflicts: String? = null,
    val currentVersion: Int? = null,
    val createdAt: Long,
)

/** Cover photos taken on this phone, uploaded before the ops that reference them. */
@Entity(tableName = "pending_uploads")
data class PendingUploadEntity(@PrimaryKey val assetId: String, val createdAt: Long)

/** Single row: where this phone's copy of the library stands. */
@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val id: Int = 0,
    val epoch: String,
    val cursor: Long,
    val lastSyncAt: Long?,
    /**
     * Entity types the local copy was downloaded with ([SYNC_FORMAT]). An older app skips records of types it
     * does not know yet while the cursor moves on, so a newer app must take a snapshot to get them.
     */
    @ColumnInfo(defaultValue = "0") val format: Int = SYNC_FORMAT,
)

/** 1: catalog (F2); 2: + reading sessions and wishes; 3: + quotes (F4); 4: + favorite on works. Bump it when a synced field/entity is added. */
const val SYNC_FORMAT = 4
