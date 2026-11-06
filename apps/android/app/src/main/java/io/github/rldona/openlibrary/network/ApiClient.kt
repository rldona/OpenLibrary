package io.github.rldona.openlibrary.network

import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** Error answered by the server (RFC 9457). `detail` is already translated to the phone's language. */
class ApiException(val status: Int, val code: String?, override val message: String) : Exception(message)

val ApiJson = Json { ignoreUnknownKeys = true }

/**
 * Minimal client for the endpoints Android uses (see openapi.yaml). Network failures surface as
 * [IOException]; answers with an error status as [ApiException].
 */
class ApiClient(
    serverUrl: String,
    private val token: String?,
    private val http: OkHttpClient = defaultHttpClient(),
    private val language: () -> String = { Locale.getDefault().language },
) {
    private val base: HttpUrl = normalizeServerUrl(serverUrl).toHttpUrl().newBuilder().addPathSegments("api/v1").build()

    suspend fun health(): HealthResponse = get("health")

    suspend fun registerDevice(password: String, name: String): DeviceRegisterResponse =
        post("auth/devices", ApiJson.encodeToString(DeviceRegisterRequest(password, name)))

    suspend fun me(): SessionInfo = get("auth/me")

    suspend fun snapshot(): SyncSnapshot = get("sync/snapshot")

    suspend fun pull(since: Long, epoch: String, limit: Int = 500): SyncPullPage =
        get("sync/pull") {
            addQueryParameter("since", since.toString())
            addQueryParameter("epoch", epoch)
            addQueryParameter("limit", limit.toString())
        }

    suspend fun push(epoch: String, ops: List<Op>): SyncPushResponse {
        val body = SyncPushRequest(epoch, ops.map { OpJson.encodeToJsonElement(Op.serializer(), it) })
        return post("sync/push", OpJson.encodeToString(SyncPushRequest.serializer(), body))
    }

    suspend fun lookup(isbn13: String): LookupResult = get("lookup/isbn/$isbn13")

    /** Candidates for title/author text read on a cover; absent parameters are left out of the URL. */
    suspend fun search(title: String?, author: String?): MetadataSearchResult =
        get("lookup/search") {
            if (title != null) addQueryParameter("title", title)
            if (author != null) addQueryParameter("author", author)
        }

    /** Uploads a cover photo; the returned id is the SHA-256 of [bytes]. */
    suspend fun uploadAsset(bytes: ByteArray): Asset =
        execute(request(url("assets")).post(bytes.toRequestBody(JPEG)).build()) {
            ApiJson.decodeFromString<Asset>(it.body.string())
        }

    /** Copies a provider's cover to the server. */
    suspend fun fetchAsset(coverUrl: String): Asset =
        post("assets/fetch", ApiJson.encodeToString(FetchAssetRequest.serializer(), FetchAssetRequest(coverUrl)))

    /** Cover thumbnail (JPEG, 400 px wide). */
    suspend fun asset(id: String, size: String = "thumb"): ByteArray =
        execute(request(url("assets/$id") { addQueryParameter("size", size) }).get().build()) { it.body.bytes() }

    /** Revokes this device's own access (best effort when disconnecting). */
    suspend fun revokeDevice(deviceId: String) {
        execute(request(url("auth/devices/$deviceId")).delete().build()) { }
    }

    private suspend inline fun <reified T> get(path: String, noinline query: HttpUrl.Builder.() -> Unit = {}): T =
        execute(request(url(path, query)).get().build()) { ApiJson.decodeFromString<T>(it.body.string()) }

    private suspend inline fun <reified T> post(path: String, json: String): T =
        execute(request(url(path)).post(json.toRequestBody(JSON)).build()) {
            ApiJson.decodeFromString<T>(it.body.string())
        }

    private fun url(path: String, query: HttpUrl.Builder.() -> Unit = {}): HttpUrl =
        base.newBuilder().addPathSegments(path).apply(query).build()

    private fun request(url: HttpUrl): Request.Builder =
        Request.Builder().url(url).header("Accept-Language", language()).apply {
            if (token != null) header("Authorization", "Bearer $token")
        }

    private suspend fun <T> execute(req: Request, read: (Response) -> T): T =
        withContext(Dispatchers.IO) {
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) throw problemOf(res)
                read(res)
            }
        }

    private fun problemOf(res: Response): ApiException {
        val body = runCatching { res.body.string() }.getOrDefault("")
        val p = runCatching { ApiJson.decodeFromString<Problem>(body) }.getOrNull()
        return ApiException(res.code, p?.code, p?.detail ?: p?.title ?: "HTTP ${res.code}")
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        private val JPEG = "image/jpeg".toMediaType()

        fun defaultHttpClient(): OkHttpClient =
            OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()
    }
}

/** Accepts "openlibrary.tailnet.ts.net" or a full URL; strips a trailing slash and an /api/v1 suffix. */
fun normalizeServerUrl(input: String): String {
    var s = input.trim().trimEnd('/')
    if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
    s = s.removeSuffix("/api/v1")
    s.toHttpUrl() // validates; throws IllegalArgumentException
    return s
}
