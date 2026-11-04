package io.github.rldona.openlibrary.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/*
 * Offline operations sent to POST /sync/push (see SyncOp in packages/contracts/src/sync.ts).
 * The `type` discriminator is kotlinx.serialization's default, which matches the server's field.
 */

/** Ops omit absent optional fields (the server's schemas use `optional`, not `nullable`, for them). */
val OpJson = Json { explicitNulls = false; encodeDefaults = true; ignoreUnknownKeys = true }

@Serializable
data class Patch(val baseVersion: Int, val fields: JsonObject)

@Serializable
data class NewWork(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val authors: List<String> = emptyList(),
    val subjects: List<String> = emptyList(),
    val description: String? = null,
    val series: String? = null,
)

@Serializable
data class NewEdition(
    val id: String,
    val title: String? = null,
    val subtitle: String? = null,
    val publisher: String? = null,
    val publishedYear: Int? = null,
    val language: String? = null,
    val pages: Int? = null,
    val format: String? = null,
    val isbn13: String? = null,
    val coverAssetId: String? = null,
    val metadataStatus: String = "complete",
    val metadataSource: String? = null,
)

@Serializable
data class NewCopy(
    val id: String,
    val editionId: String? = null,
    val locationId: String? = null,
    val condition: String = "good",
    val acquiredOn: String? = null,
    val notes: String = "",
)

@Serializable
data class NewBook(
    val workId: String? = null,
    val work: NewWork? = null,
    val edition: NewEdition,
    val copy: NewCopy,
    val allowDuplicateIsbn: Boolean = false,
)

@Serializable
data class NewLocation(
    val id: String,
    /** Always sent, even when null: the server requires it explicitly (top level). */
    val parentId: JsonElement = JsonNull,
    val name: String,
    val kind: String = "other",
    val sortOrder: Int = 0,
)

@Serializable
data class NewReading(
    val id: String,
    val copyId: String,
    val status: String,
    val startedOn: String? = null,
    val finishedOn: String? = null,
    val rating: Double? = null,
    val notes: String = "",
)

@Serializable
data class NewWish(
    val id: String,
    val title: String,
    val authors: List<String> = emptyList(),
    val isbn13: String? = null,
    val priority: String = "normal",
    val notes: String = "",
)

@Serializable
sealed interface Op {
    val opId: String

    @Serializable @SerialName("book.create")
    data class BookCreate(override val opId: String, val book: NewBook) : Op

    @Serializable @SerialName("copy.create")
    data class CopyCreate(override val opId: String, val copy: NewCopy) : Op

    @Serializable @SerialName("location.create")
    data class LocationCreate(override val opId: String, val location: NewLocation) : Op

    @Serializable @SerialName("reading.create")
    data class ReadingCreate(override val opId: String, val reading: NewReading) : Op

    @Serializable @SerialName("wish.create")
    data class WishCreate(override val opId: String, val wish: NewWish) : Op

    sealed interface Update : Op {
        val id: String
        val patch: Patch
    }

    @Serializable @SerialName("work.update")
    data class WorkUpdate(override val opId: String, override val id: String, override val patch: Patch) : Update

    @Serializable @SerialName("edition.update")
    data class EditionUpdate(override val opId: String, override val id: String, override val patch: Patch) : Update

    @Serializable @SerialName("copy.update")
    data class CopyUpdate(override val opId: String, override val id: String, override val patch: Patch) : Update

    @Serializable @SerialName("location.update")
    data class LocationUpdate(override val opId: String, override val id: String, override val patch: Patch) : Update

    @Serializable @SerialName("reading.update")
    data class ReadingUpdate(override val opId: String, override val id: String, override val patch: Patch) : Update

    @Serializable @SerialName("wish.update")
    data class WishUpdate(override val opId: String, override val id: String, override val patch: Patch) : Update
}

/** Same op, new id and base version: how "keep mine" resolves a conflict. */
fun Op.Update.rebased(opId: String, baseVersion: Int, fields: JsonObject): Op.Update =
    when (this) {
        is Op.WorkUpdate -> copy(opId = opId, patch = Patch(baseVersion, fields))
        is Op.EditionUpdate -> copy(opId = opId, patch = Patch(baseVersion, fields))
        is Op.CopyUpdate -> copy(opId = opId, patch = Patch(baseVersion, fields))
        is Op.LocationUpdate -> copy(opId = opId, patch = Patch(baseVersion, fields))
        is Op.ReadingUpdate -> copy(opId = opId, patch = Patch(baseVersion, fields))
        is Op.WishUpdate -> copy(opId = opId, patch = Patch(baseVersion, fields))
    }
