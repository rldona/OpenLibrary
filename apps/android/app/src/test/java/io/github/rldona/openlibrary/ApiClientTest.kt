package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.network.ApiClient
import java.io.File
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/** Paths, methods and bodies of the capture calls, answered with the server's own fixtures. */
class ApiClientTest {
    private val server = MockWebServer()
    private lateinit var api: ApiClient
    private fun fixture(name: String) = File("../../../packages/contracts/fixtures/$name").readText()
    private fun ok(body: String) = MockResponse.Builder().code(200).addHeader("content-type", "application/json").body(body).build()

    @Before
    fun setUp() {
        server.start()
        api = ApiClient(server.url("/").toString(), "t", language = { "es" })
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun lookupUsesTheIsbnInThePath() = runBlocking {
        server.enqueue(ok(fixture("lookup.json")))
        val r = api.lookup("9788432221477")
        assertEquals("/api/v1/lookup/isbn/9788432221477", server.takeRequest().url.encodedPath)
        assertEquals("Rosa Montero", r.proposal!!.authors.single())
    }

    @Test
    fun coversAreUploadedAsJpegOrFetchedByUrl() = runBlocking {
        server.enqueue(ok(fixture("asset.json")))
        server.enqueue(ok(fixture("asset.json")))
        api.uploadAsset(byteArrayOf(1, 2, 3))
        val upload = server.takeRequest()
        assertEquals("POST /api/v1/assets image/jpeg", "${upload.method} ${upload.url.encodedPath} ${upload.headers["Content-Type"]}")
        api.fetchAsset("https://covers.openlibrary.org/b/id/1-L.jpg")
        val fetch = server.takeRequest()
        assertEquals("/api/v1/assets/fetch", fetch.url.encodedPath)
        assertEquals("""{"url":"https://covers.openlibrary.org/b/id/1-L.jpg"}""", fetch.body!!.utf8())
    }
}
