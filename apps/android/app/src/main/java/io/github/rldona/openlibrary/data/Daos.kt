package io.github.rldona.openlibrary.data

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** One row of the library list: an edition with at least one active copy. */
data class LibraryRow(
    val editionId: String,
    val workId: String,
    val title: String,
    val subtitle: String?,
    val authors: List<String>,
    val publisher: String?,
    val publishedYear: Int?,
    val coverAssetId: String?,
    val metadataStatus: String,
    val activeCopies: Int,
)

data class OwnedEdition(val editionId: String, val workId: String, val title: String, val copies: Int)

/** Active copy placement, used to show where each book is. */
data class Placement(val editionId: String, val locationId: String?)

@Dao
interface CatalogDao {
    @Query(
        """
        SELECT e.id AS editionId, w.id AS workId, COALESCE(e.title, w.title) AS title,
               COALESCE(e.subtitle, w.subtitle) AS subtitle, w.authors AS authors, e.publisher AS publisher,
               e.publishedYear AS publishedYear, e.coverAssetId AS coverAssetId, e.metadataStatus AS metadataStatus,
               (SELECT COUNT(*) FROM copies c WHERE c.editionId = e.id AND c.status = 'active') AS activeCopies
        FROM editions e JOIN works w ON w.id = e.workId
        WHERE activeCopies > 0
          AND (:fts = '' OR e.id IN (SELECT editionId FROM book_fts WHERE book_fts MATCH :fts))
          AND (:anyLocation OR e.id IN (
                SELECT editionId FROM copies WHERE status = 'active' AND locationId IN (:locationIds)))
        ORDER BY w.sortTitle, e.publishedYear
        """,
    )
    fun library(fts: String, anyLocation: Boolean, locationIds: List<String>): Flow<List<LibraryRow>>

    @Query("SELECT editionId, locationId FROM copies WHERE status = 'active'")
    fun placements(): Flow<List<Placement>>

    @Query("SELECT * FROM locations ORDER BY sortOrder, name")
    fun locations(): Flow<List<LocationEntity>>

    @Query("SELECT * FROM works WHERE id = :id")
    fun work(id: String): Flow<WorkEntity?>

    @Query("SELECT * FROM editions WHERE workId = :workId ORDER BY publishedYear")
    fun editionsOf(workId: String): Flow<List<EditionEntity>>

    @Query("SELECT * FROM copies WHERE editionId IN (SELECT id FROM editions WHERE workId = :workId) ORDER BY code")
    fun copiesOfWork(workId: String): Flow<List<CopyEntity>>

    @Query("SELECT COUNT(*) FROM editions e WHERE EXISTS (SELECT 1 FROM copies c WHERE c.editionId = e.id AND c.status = 'active')")
    fun editionCount(): Flow<Int>

    @Query(
        "SELECT coverAssetId FROM editions WHERE coverAssetId IS NOT NULL " +
            "UNION SELECT coverAssetId FROM wishes WHERE coverAssetId IS NOT NULL",
    )
    suspend fun coverIds(): List<String>

    @Query(
        """
        SELECT r.* FROM readings r JOIN copies c ON c.id = r.copyId JOIN editions e ON e.id = c.editionId
        WHERE e.workId = :workId ORDER BY r.createdAt
        """,
    )
    fun readingsOfWork(workId: String): Flow<List<ReadingEntity>>

    @Query("SELECT * FROM readings WHERE id = :id") suspend fun readingById(id: String): ReadingEntity?

    /** Open wishes first, by priority (high, normal, low), newest first; then bought and discarded. */
    @Query(
        """
        SELECT * FROM wishes ORDER BY status != 'open',
            CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, createdAt DESC
        """,
    )
    fun wishes(): Flow<List<WishEntity>>

    @Query("SELECT COUNT(*) FROM wishes WHERE status = 'open'") fun openWishCount(): Flow<Int>

    @Query("SELECT * FROM wishes WHERE id = :id") suspend fun wishById(id: String): WishEntity?

    /** In page order, quotes without a page last (as the web shows them). */
    @Query("SELECT * FROM quotes WHERE workId = :workId ORDER BY page IS NULL, page, createdAt")
    fun quotesOfWork(workId: String): Flow<List<QuoteEntity>>

    @Query("SELECT * FROM quotes WHERE id = :id") suspend fun quoteById(id: String): QuoteEntity?

    /** BR15: the open wish a scanned ISBN fulfils. */
    @Query("SELECT * FROM wishes WHERE status = 'open' AND isbn13 = :isbn13 LIMIT 1")
    suspend fun openWishByIsbn(isbn13: String): WishEntity?

    @Query("SELECT * FROM works WHERE id = :id") suspend fun workById(id: String): WorkEntity?
    @Query("SELECT * FROM editions WHERE id = :id") suspend fun editionById(id: String): EditionEntity?
    @Query("SELECT * FROM copies WHERE id = :id") suspend fun copyById(id: String): CopyEntity?
    @Query("SELECT * FROM locations WHERE id = :id") suspend fun locationById(id: String): LocationEntity?

    /** Editions you already own with this ISBN (scanning a book twice offers "add another copy"). */
    @Query("""
        SELECT e.id AS editionId, w.id AS workId, COALESCE(e.title, w.title) AS title,
               (SELECT COUNT(*) FROM copies c WHERE c.editionId = e.id AND c.status = 'active') AS copies
        FROM editions e JOIN works w ON w.id = e.workId WHERE e.isbn13 = :isbn13 LIMIT 1
    """)
    suspend fun byIsbn(isbn13: String): OwnedEdition?
}

@Dao
interface SyncDao {
    @Upsert suspend fun upsertWorks(rows: List<WorkEntity>)
    @Upsert suspend fun upsertEditions(rows: List<EditionEntity>)
    @Upsert suspend fun upsertCopies(rows: List<CopyEntity>)
    @Upsert suspend fun upsertLocations(rows: List<LocationEntity>)
    @Upsert suspend fun upsertReadings(rows: List<ReadingEntity>)
    @Upsert suspend fun upsertWishes(rows: List<WishEntity>)
    @Upsert suspend fun upsertQuotes(rows: List<QuoteEntity>)
    @Upsert suspend fun setState(state: SyncStateEntity)

    @Query("DELETE FROM works WHERE id IN (:ids)") suspend fun deleteWorks(ids: List<String>)
    @Query("DELETE FROM editions WHERE id IN (:ids)") suspend fun deleteEditions(ids: List<String>)
    @Query("DELETE FROM copies WHERE id IN (:ids)") suspend fun deleteCopies(ids: List<String>)
    @Query("DELETE FROM locations WHERE id IN (:ids)") suspend fun deleteLocations(ids: List<String>)
    @Query("DELETE FROM readings WHERE id IN (:ids)") suspend fun deleteReadings(ids: List<String>)
    @Query("DELETE FROM wishes WHERE id IN (:ids)") suspend fun deleteWishes(ids: List<String>)
    @Query("DELETE FROM quotes WHERE id IN (:ids)") suspend fun deleteQuotes(ids: List<String>)

    @Query("DELETE FROM works") suspend fun clearWorks()
    @Query("DELETE FROM editions") suspend fun clearEditions()
    @Query("DELETE FROM copies") suspend fun clearCopies()
    @Query("DELETE FROM locations") suspend fun clearLocations()
    @Query("DELETE FROM readings") suspend fun clearReadings()
    @Query("DELETE FROM wishes") suspend fun clearWishes()
    @Query("DELETE FROM quotes") suspend fun clearQuotes()
    @Query("DELETE FROM sync_state") suspend fun clearState()

    @Query("SELECT * FROM sync_state WHERE id = 0") suspend fun state(): SyncStateEntity?
    @Query("SELECT * FROM sync_state WHERE id = 0") fun stateFlow(): Flow<SyncStateEntity?>

    @Query("UPDATE sync_state SET lastSyncAt = :at WHERE id = 0") suspend fun markSynced(at: Long)

    /** Search text per edition: work + edition fields + the names of the locations of its active copies. */
    @Query(
        """
        SELECT e.id AS editionId,
               w.title || ' ' || COALESCE(w.subtitle, '') || ' ' || w.authors || ' ' || w.subjects || ' ' ||
               COALESCE(w.series, '') || ' ' || COALESCE(e.title, '') || ' ' || COALESCE(e.publisher, '') || ' ' ||
               COALESCE(e.isbn13, '') || ' ' || COALESCE(e.publishedYear, '') AS text
        FROM editions e JOIN works w ON w.id = e.workId
        """,
    )
    suspend fun searchSources(): List<SearchSource>

    @Query(
        """
        SELECT e.id AS editionId,
               w.title || ' ' || COALESCE(w.subtitle, '') || ' ' || w.authors || ' ' || w.subjects || ' ' ||
               COALESCE(w.series, '') || ' ' || COALESCE(e.title, '') || ' ' || COALESCE(e.publisher, '') || ' ' ||
               COALESCE(e.isbn13, '') || ' ' || COALESCE(e.publishedYear, '') AS text
        FROM editions e JOIN works w ON w.id = e.workId
        WHERE e.id IN (:editionIds)
        """,
    )
    suspend fun searchSourcesOf(editionIds: List<String>): List<SearchSource>

    @Query("SELECT editionId, locationId FROM copies WHERE status = 'active' AND editionId IN (:editionIds)")
    suspend fun activePlacementsOf(editionIds: List<String>): List<Placement>

    @Query("SELECT id FROM editions WHERE workId = :workId") suspend fun editionIdsOf(workId: String): List<String>

    @Query("SELECT editionId FROM copies WHERE id = :copyId") suspend fun editionOfCopy(copyId: String): String?

    @Query("DELETE FROM book_fts WHERE editionId IN (:editionIds)") suspend fun deleteFts(editionIds: List<String>)

    @Query("SELECT editionId, locationId FROM copies WHERE status = 'active'")
    suspend fun activePlacements(): List<Placement>

    @Query("SELECT * FROM locations") suspend fun allLocations(): List<LocationEntity>
    @Query("SELECT * FROM works") suspend fun allWorks(): List<WorkEntity>
    @Query("SELECT * FROM editions") suspend fun allEditions(): List<EditionEntity>
    @Query("SELECT * FROM copies") suspend fun allCopies(): List<CopyEntity>
    @Query("SELECT * FROM readings") suspend fun allReadings(): List<ReadingEntity>
    @Query("SELECT * FROM wishes") suspend fun allWishes(): List<WishEntity>

    @Query("DELETE FROM book_fts") suspend fun clearFts()
    @androidx.room.Insert suspend fun insertFts(rows: List<BookFts>)
}

data class SearchSource(val editionId: String, val text: String)

@Dao
interface OutboxDao {
    @androidx.room.Insert suspend fun insert(op: OutboxEntity)

    @Query("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT :limit")
    suspend fun pending(limit: Int = 100): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq")
    suspend fun allPending(): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE status != 'pending' ORDER BY seq")
    fun problems(): Flow<List<OutboxEntity>>

    @Query("SELECT COUNT(*) FROM outbox WHERE status = 'pending'")
    fun pendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox WHERE status != 'pending'")
    fun problemCount(): Flow<Int>

    @Query("SELECT * FROM outbox WHERE opId = :opId")
    suspend fun byOpId(opId: String): OutboxEntity?

    @Query("DELETE FROM outbox WHERE opId = :opId")
    suspend fun delete(opId: String)

    @Query("UPDATE outbox SET status = :status, message = :message, conflicts = :conflicts, currentVersion = :currentVersion WHERE opId = :opId")
    suspend fun markFailed(opId: String, status: String, message: String?, conflicts: String?, currentVersion: Int?)

    @Query("DELETE FROM outbox") suspend fun clear()

    @androidx.room.Insert(onConflict = androidx.room.OnConflictStrategy.IGNORE)
    suspend fun addUpload(upload: PendingUploadEntity)

    @Query("SELECT * FROM pending_uploads ORDER BY createdAt") suspend fun uploads(): List<PendingUploadEntity>

    @Query("DELETE FROM pending_uploads WHERE assetId = :id") suspend fun uploaded(id: String)

    @Query("DELETE FROM pending_uploads") suspend fun clearUploads()
}
