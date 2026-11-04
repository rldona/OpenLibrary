package io.github.rldona.openlibrary.sync

import androidx.room.withTransaction
import io.github.rldona.openlibrary.core.fold
import io.github.rldona.openlibrary.core.uuidv7
import io.github.rldona.openlibrary.data.AppDatabase
import io.github.rldona.openlibrary.data.CopyEntity
import io.github.rldona.openlibrary.data.EditionEntity
import io.github.rldona.openlibrary.data.LocationEntity
import io.github.rldona.openlibrary.data.OutboxEntity
import io.github.rldona.openlibrary.data.PendingUploadEntity
import io.github.rldona.openlibrary.data.ReadingEntity
import io.github.rldona.openlibrary.data.WishEntity
import io.github.rldona.openlibrary.data.QuoteEntity
import io.github.rldona.openlibrary.data.WorkEntity
import io.github.rldona.openlibrary.network.FieldConflict
import io.github.rldona.openlibrary.network.NewBook
import io.github.rldona.openlibrary.network.NewCopy
import io.github.rldona.openlibrary.network.NewLocation
import io.github.rldona.openlibrary.network.NewReading
import io.github.rldona.openlibrary.network.NewWish
import io.github.rldona.openlibrary.network.NewQuote
import io.github.rldona.openlibrary.network.Op
import io.github.rldona.openlibrary.network.OpJson
import io.github.rldona.openlibrary.network.Patch
import io.github.rldona.openlibrary.network.rebased
import java.time.Instant
import java.time.LocalDate
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Changes made on the phone (F3). Each one is applied to the local rows and queued in the outbox in ONE
 * transaction, so it survives the app being killed or the phone rebooting, and is pushed on the next sync.
 */
class LocalWrites(
    private val db: AppDatabase,
    private val now: () -> Long = System::currentTimeMillis,
    /** Called after every queued change (schedules a sync). */
    private val onQueued: () -> Unit = {},
) {
    private val outbox get() = db.outbox()

    // ---------------- Copies ----------------
    suspend fun editCopy(copy: CopyEntity, fields: JsonObject) =
        enqueue(Op.CopyUpdate(uuidv7(), copy.id, Patch(baseOf(copy.version), fields)))

    suspend fun retireCopy(copy: CopyEntity, reason: String) =
        editCopy(copy, buildJsonObject { put("status", "retired"); put("retiredReason", reason) })

    suspend fun restoreCopy(copy: CopyEntity) = editCopy(copy, buildJsonObject { put("status", "active") })

    suspend fun addCopy(editionId: String, locationId: String?, condition: String, notes: String): String {
        val id = uuidv7()
        enqueue(Op.CopyCreate(uuidv7(), NewCopy(id, editionId, locationId, condition, today(), notes)))
        return id
    }

    // ---------------- Books ----------------
    /** New book (work + edition + first copy), or a new edition of an existing work when `book.workId` is set. */
    suspend fun addBook(book: NewBook, coverPhoto: String? = null) {
        if (coverPhoto != null) outbox.addUpload(PendingUploadEntity(coverPhoto, now()))
        enqueue(Op.BookCreate(uuidv7(), book.copy(copy = book.copy.copy(acquiredOn = book.copy.acquiredOn ?: today()))))
    }

    suspend fun editWork(work: WorkEntity, fields: JsonObject) =
        enqueue(Op.WorkUpdate(uuidv7(), work.id, Patch(baseOf(work.version), fields)))

    suspend fun editEdition(edition: EditionEntity, fields: JsonObject, coverPhoto: String? = null) {
        if (coverPhoto != null) outbox.addUpload(PendingUploadEntity(coverPhoto, now()))
        enqueue(Op.EditionUpdate(uuidv7(), edition.id, Patch(baseOf(edition.version), fields)))
    }

    // ---------------- Locations ----------------
    suspend fun createLocation(parentId: String?, name: String, kind: String): String {
        val id = uuidv7()
        enqueue(Op.LocationCreate(uuidv7(), NewLocation(id, parentId?.let(::JsonPrimitive) ?: JsonNull, name.trim(), kind)))
        return id
    }

    // ---------------- Reading ----------------
    /** Starts reading a copy ("reading") or records it as already read ("read"). */
    suspend fun startReading(copyId: String, status: String) =
        enqueue(Op.ReadingCreate(uuidv7(), NewReading(uuidv7(), copyId, status)))

    suspend fun editReading(reading: ReadingEntity, fields: JsonObject) =
        enqueue(Op.ReadingUpdate(uuidv7(), reading.id, Patch(baseOf(reading.version), fields)))

    // ---------------- Wishlist ----------------
    suspend fun addWish(title: String, authors: List<String>, isbn13: String?, priority: String = "normal", notes: String = "") =
        enqueue(Op.WishCreate(uuidv7(), NewWish(uuidv7(), title.trim(), authors, isbn13, priority, notes.trim())))

    suspend fun editWish(wish: WishEntity, fields: JsonObject) =
        enqueue(Op.WishUpdate(uuidv7(), wish.id, Patch(baseOf(wish.version), fields)))

    /** BR14: the wish is kept as history, linked to the copy that fulfilled it. Queue it after that copy's op. */
    suspend fun acquireWish(wish: WishEntity, copyId: String) =
        editWish(wish, buildJsonObject { put("status", "acquired"); put("acquiredCopyId", copyId) })

    // ---------------- Quotes ----------------
    suspend fun addQuote(workId: String, text: String, page: Int?, note: String, copyId: String?) =
        enqueue(Op.QuoteCreate(uuidv7(), NewQuote(uuidv7(), workId, text.trim(), page, note.trim(), copyId)))

    suspend fun editQuote(quote: QuoteEntity, fields: JsonObject) =
        enqueue(Op.QuoteUpdate(uuidv7(), quote.id, Patch(baseOf(quote.version), fields)))

    suspend fun deleteQuote(quote: QuoteEntity) = enqueue(Op.QuoteDelete(uuidv7(), quote.id))

    // ---------------- Conflicts and rejections ----------------
    /** Re-sends my values on top of the server's current version. `edited` replaces some of them (combine). */
    suspend fun keepMine(problem: OutboxEntity, edited: Map<String, String> = emptyMap()) {
        val op = decode(problem.payload) as? Op.Update ?: return discard(problem)
        val fields = JsonObject(op.patch.fields + edited.mapValues { JsonPrimitive(it.value) })
        db.withTransaction {
            outbox.delete(problem.opId)
            enqueue(op.rebased(uuidv7(), problem.currentVersion ?: op.patch.baseVersion, fields), notify = false)
        }
        onQueued()
    }

    /** Keeps the server's values (conflict) or drops an op the server refused (rejected). */
    suspend fun discard(problem: OutboxEntity) {
        outbox.delete(problem.opId)
        onQueued()
    }

    // ---------------- Internals ----------------
    private suspend fun enqueue(op: Op, notify: Boolean = true) {
        db.withTransaction {
            applyLocally(db, op)
            rebuildSearchIndex(db)
            outbox.insert(
                OutboxEntity(
                    opId = op.opId,
                    type = op.typeName(),
                    entityId = op.entityId(),
                    payload = OpJson.encodeToString(Op.serializer(), op),
                    createdAt = now(),
                ),
            )
        }
        if (notify) onQueued()
    }

    /** Entities created on the phone have version 0 until the server knows them; after their create op they are 1. */
    private fun baseOf(version: Int) = version.coerceAtLeast(1)

    private fun today() = LocalDate.now().toString()

    companion object {
        fun decode(payload: String): Op = OpJson.decodeFromString(Op.serializer(), payload)

        fun conflictsOf(problem: OutboxEntity): List<FieldConflict> =
            problem.conflicts?.let { OpJson.decodeFromString(ListSerializer(FieldConflict.serializer()), it) }.orEmpty()

        /**
         * The local effect of an op. Used when the change is made and again after every pull, so pending
         * changes stay visible on top of the server's data until they are pushed.
         */
        suspend fun applyLocally(db: AppDatabase, op: Op) {
            val d = db.sync()
            val c = db.catalog()
            val ts = Instant.now().toString()
            when (op) {
                is Op.BookCreate -> {
                    val b = op.book
                    val workId = b.workId ?: b.work!!.id
                    b.work?.let { w ->
                        if (c.workById(w.id) == null) {
                            d.upsertWorks(listOf(WorkEntity(w.id, 0, w.title, w.subtitle, w.authors, w.subjects, w.description,
                                null, null, w.series, null, ts, ts, sortTitle = fold(w.title))))
                        }
                    }
                    val e = b.edition
                    if (c.editionById(e.id) == null) {
                        d.upsertEditions(listOf(EditionEntity(e.id, 0, workId, e.title, e.subtitle, e.publisher, e.publishedYear,
                            e.language, e.pages, e.format, e.isbn13, e.coverAssetId, e.metadataStatus, e.metadataSource, ts, ts)))
                    }
                    insertCopy(db, b.copy.copy(editionId = e.id), ts)
                }
                is Op.CopyCreate -> insertCopy(db, op.copy, ts)
                is Op.LocationCreate -> {
                    val l = op.location
                    if (c.locationById(l.id) == null) {
                        val parent = l.parentId.jsonPrimitiveOrNull()
                        d.upsertLocations(listOf(LocationEntity(l.id, 0, parent, l.name, l.kind, l.sortOrder, ts, ts)))
                    }
                }
                is Op.WorkUpdate -> c.workById(op.id)?.let { w ->
                    val p = patched(w, op.patch.fields, WorkEntity.serializer())
                    d.upsertWorks(listOf(p.copy(sortTitle = fold(p.title))))
                }
                is Op.EditionUpdate -> c.editionById(op.id)?.let { d.upsertEditions(listOf(patched(it, op.patch.fields, EditionEntity.serializer()))) }
                is Op.LocationUpdate -> c.locationById(op.id)?.let { d.upsertLocations(listOf(patched(it, op.patch.fields, LocationEntity.serializer()))) }
                is Op.ReadingCreate -> {
                    val r = op.reading
                    if (c.readingById(r.id) == null) {
                        val dates = readingDates(r.status, r.startedOn, r.finishedOn)
                        d.upsertReadings(listOf(ReadingEntity(r.id, 0, r.copyId, r.status, dates.first, dates.second, r.rating, r.notes, ts, ts)))
                    }
                }
                is Op.QuoteCreate -> {
                    val q = op.quote
                    if (c.quoteById(q.id) == null) {
                        d.upsertQuotes(listOf(QuoteEntity(q.id, 0, q.workId, q.copyId, q.text, q.page, q.note, ts, ts)))
                    }
                }
                is Op.QuoteUpdate -> c.quoteById(op.id)?.let { d.upsertQuotes(listOf(patched(it, op.patch.fields, QuoteEntity.serializer()))) }
                is Op.QuoteDelete -> d.deleteQuotes(listOf(op.id))
                is Op.WishCreate -> {
                    val w = op.wish
                    if (c.wishById(w.id) == null) {
                        d.upsertWishes(listOf(WishEntity(w.id, 0, w.title, w.authors, w.isbn13, null, w.priority, w.notes, "open", null, ts, ts)))
                    }
                }
                is Op.WishUpdate -> c.wishById(op.id)?.let { d.upsertWishes(listOf(patched(it, op.patch.fields, WishEntity.serializer()))) }
                is Op.ReadingUpdate -> c.readingById(op.id)?.let { r ->
                    val p = patched(r, op.patch.fields, ReadingEntity.serializer())
                    val dates = readingDates(op.patch.fields["status"]?.jsonPrimitive?.contentOrNull, p.startedOn, p.finishedOn)
                    d.upsertReadings(listOf(p.copy(startedOn = dates.first, finishedOn = dates.second)))
                }
                is Op.CopyUpdate -> c.copyById(op.id)?.let { copy ->
                    var p = patched(copy, op.patch.fields, CopyEntity.serializer())
                    // Same rule as the server: retiring stamps the date and a reason; restoring clears them.
                    when (op.patch.fields["status"]?.jsonPrimitive?.contentOrNull) {
                        "retired" -> p = p.copy(retiredOn = LocalDate.now().toString(), retiredReason = p.retiredReason ?: "other")
                        "active" -> p = p.copy(retiredOn = null, retiredReason = null)
                    }
                    d.upsertCopies(listOf(p))
                }
            }
        }

        /** BR11, as on the server: entering "reading" or "read" without the matching date stamps today. */
        private fun readingDates(status: String?, startedOn: String?, finishedOn: String?): Pair<String?, String?> {
            val today = LocalDate.now().toString()
            return Pair(
                if (status == "reading" && startedOn == null) today else startedOn,
                if (status == "read" && finishedOn == null) today else finishedOn,
            )
        }

        private suspend fun insertCopy(db: AppDatabase, n: NewCopy, ts: String) {
            if (db.catalog().copyById(n.id) != null) return
            // The human code (EJ-0001) is assigned by the server; it arrives with the next pull.
            db.sync().upsertCopies(listOf(CopyEntity(n.id, 0, n.editionId!!, "", n.locationId, n.condition, n.acquiredOn,
                null, "EUR", n.notes, "active", null, null, ts, ts)))
        }

        private fun <T> patched(row: T, fields: JsonObject, serializer: kotlinx.serialization.KSerializer<T>): T {
            val merged = JsonObject(OpJson.encodeToJsonElement(serializer, row).jsonObject + fields)
            return OpJson.decodeFromJsonElement(serializer, merged)
        }

        private fun kotlinx.serialization.json.JsonElement.jsonPrimitiveOrNull(): String? =
            (this as? JsonPrimitive)?.contentOrNull
    }
}

private fun Op.typeName(): String =
    when (this) {
        is Op.BookCreate -> "book.create"
        is Op.CopyCreate -> "copy.create"
        is Op.LocationCreate -> "location.create"
        is Op.WorkUpdate -> "work.update"
        is Op.EditionUpdate -> "edition.update"
        is Op.CopyUpdate -> "copy.update"
        is Op.LocationUpdate -> "location.update"
        is Op.ReadingCreate -> "reading.create"
        is Op.ReadingUpdate -> "reading.update"
        is Op.WishCreate -> "wish.create"
        is Op.WishUpdate -> "wish.update"
        is Op.QuoteCreate -> "quote.create"
        is Op.QuoteUpdate -> "quote.update"
        is Op.QuoteDelete -> "quote.delete"
    }

private fun Op.entityId(): String =
    when (this) {
        is Op.BookCreate -> book.edition.id
        is Op.CopyCreate -> copy.id
        is Op.LocationCreate -> location.id
        is Op.ReadingCreate -> reading.id
        is Op.WishCreate -> wish.id
        is Op.QuoteCreate -> quote.id
        is Op.QuoteDelete -> id
        is Op.Update -> id
    }
