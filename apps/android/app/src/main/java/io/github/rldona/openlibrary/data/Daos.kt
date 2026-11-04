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

    @Query("SELECT DISTINCT coverAssetId FROM editions WHERE coverAssetId IS NOT NULL")
    suspend fun coverIds(): List<String>
}

@Dao
interface SyncDao {
    @Upsert suspend fun upsertWorks(rows: List<WorkEntity>)
    @Upsert suspend fun upsertEditions(rows: List<EditionEntity>)
    @Upsert suspend fun upsertCopies(rows: List<CopyEntity>)
    @Upsert suspend fun upsertLocations(rows: List<LocationEntity>)
    @Upsert suspend fun setState(state: SyncStateEntity)

    @Query("DELETE FROM works WHERE id IN (:ids)") suspend fun deleteWorks(ids: List<String>)
    @Query("DELETE FROM editions WHERE id IN (:ids)") suspend fun deleteEditions(ids: List<String>)
    @Query("DELETE FROM copies WHERE id IN (:ids)") suspend fun deleteCopies(ids: List<String>)
    @Query("DELETE FROM locations WHERE id IN (:ids)") suspend fun deleteLocations(ids: List<String>)

    @Query("DELETE FROM works") suspend fun clearWorks()
    @Query("DELETE FROM editions") suspend fun clearEditions()
    @Query("DELETE FROM copies") suspend fun clearCopies()
    @Query("DELETE FROM locations") suspend fun clearLocations()
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

    @Query("SELECT editionId, locationId FROM copies WHERE status = 'active'")
    suspend fun activePlacements(): List<Placement>

    @Query("SELECT * FROM locations") suspend fun allLocations(): List<LocationEntity>

    @Query("DELETE FROM book_fts") suspend fun clearFts()
    @androidx.room.Insert suspend fun insertFts(rows: List<BookFts>)
}

data class SearchSource(val editionId: String, val text: String)
