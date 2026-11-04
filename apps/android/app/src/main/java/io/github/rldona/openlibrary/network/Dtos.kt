package io.github.rldona.openlibrary.network

import kotlinx.serialization.Serializable

/*
 * Wire format of the sync API. Mirrors packages/contracts/openapi.yaml; SyncContractTest decodes the
 * server's fixtures strictly, so a field added on either side without the other fails the build.
 */

@Serializable
data class HealthResponse(val status: String, val version: String, val epoch: String, val time: String)

@Serializable
data class DeviceRegisterRequest(val password: String, val name: String, val platform: String = "android")

@Serializable
data class DeviceRegisterResponse(val deviceId: String, val token: String)

@Serializable
data class SessionInfo(val authenticated: Boolean, val kind: String, val sessionId: String, val expiresAt: String?)

@Serializable
data class Problem(
    val type: String = "",
    val title: String = "",
    val status: Int = 0,
    val code: String? = null,
    val detail: String? = null,
    val retryAfterSeconds: Int? = null,
)

@Serializable
data class SyncWork(
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val title: String,
    val subtitle: String?,
    val authors: List<String>,
    val subjects: List<String>,
    val description: String?,
    val originalTitle: String?,
    val originalLanguage: String?,
    val series: String?,
    val seriesIndex: Double?,
)

@Serializable
data class SyncEdition(
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
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
)

@Serializable
data class SyncCopy(
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
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
)

@Serializable
data class SyncLocation(
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val parentId: String?,
    val name: String,
    val kind: String,
    val sortOrder: Int,
)

@Serializable
data class SyncTombstone(val entity: String, val id: String, val version: Int, val deletedAt: String)

@Serializable
data class SyncSnapshot(
    val epoch: String,
    val cursor: Long,
    val serverTime: String,
    val works: List<SyncWork>,
    val editions: List<SyncEdition>,
    val copies: List<SyncCopy>,
    val locations: List<SyncLocation>,
)

@Serializable
data class SyncPullPage(
    val epoch: String,
    val cursor: Long,
    val hasMore: Boolean,
    val serverTime: String,
    val works: List<SyncWork>,
    val editions: List<SyncEdition>,
    val copies: List<SyncCopy>,
    val locations: List<SyncLocation>,
    val deleted: List<SyncTombstone>,
)
