package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.auth.DeviceSetup
import io.github.rldona.openlibrary.auth.PasskeyProvider
import io.github.rldona.openlibrary.auth.PasskeyUnavailable
import io.github.rldona.openlibrary.network.ApiClient
import io.github.rldona.openlibrary.network.ApiException
import io.github.rldona.openlibrary.network.ApiJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** The setup screen's two ways in: a passkey (fake Credential Manager) and password + recovery code. */
class DeviceSetupTest {
    private lateinit var server: MockWebServer
    private lateinit var sessions: MemorySessions
    private lateinit var setup: DeviceSetup
    private val url get() = server.url("/").toString().trimEnd('/')

    private fun json(text: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("content-type", "application/json").body(text).build()

    private val options = """{"ceremonyId":"c1","options":{"rpId":"library.example.com","challenge":"abc","allowCredentials":[],"timeout":300000,"userVerification":"required"}}"""
    private val registered = """{"deviceId":"dev-1","token":"olt_secret"}"""
    private val passkeyRequired =
        """{"type":"about:blank","title":"Forbidden","status":403,"code":"passkey-required","detail":"Protected with a passkey."}"""

    /** Answers like Credential Manager would, and remembers the request it got. */
    private class FakePasskeys(private val answer: () -> String) : PasskeyProvider {
        var request: String? = null

        override suspend fun signIn(requestJson: String): String {
            request = requestJson
            return answer()
        }
    }

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        sessions = MemorySessions(null)
        setup = DeviceSetup({ u, t -> ApiClient(u, t) }, sessions)
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun registersWithAPasskey() = runBlocking {
        server.enqueue(json(options))
        server.enqueue(json(registered, 201))
        val fake = FakePasskeys { """{"id":"cred","rawId":"cred","type":"public-key","response":{"signature":"sig"}}""" }

        val s = setup.withPasskey(url, "Pixel", fake)

        assertEquals("dev-1", s.deviceId)
        assertEquals("olt_secret", sessions.current()!!.token)
        // Credential Manager gets the server's options as they are.
        val request = ApiJson.parseToJsonElement(fake.request!!).jsonObject
        assertEquals("abc", request["challenge"]!!.jsonPrimitive.content)
        assertEquals("required", request["userVerification"]!!.jsonPrimitive.content)
        assertEquals("/api/v1/auth/login/passkey/options", server.takeRequest().url.encodedPath)
        val verify = server.takeRequest()
        assertEquals("/api/v1/auth/devices/passkey", verify.url.encodedPath)
        val body = ApiJson.parseToJsonElement(verify.body!!.utf8()).jsonObject
        assertEquals("c1", body["ceremonyId"]!!.jsonPrimitive.content)
        assertEquals("Pixel", body["name"]!!.jsonPrimitive.content)
        assertEquals("cred", body["response"]!!.jsonObject["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun aCancelledPasskeyPromptRegistersNothing() = runBlocking {
        server.enqueue(json(options))
        val fake = FakePasskeys { throw PasskeyUnavailable.Cancelled() }
        try {
            setup.withPasskey(url, "Pixel", fake)
            fail("expected a cancellation")
        } catch (_: PasskeyUnavailable.Cancelled) {
        }
        assertNull(sessions.current())
        assertEquals(1, server.requestCount)
    }

    @Test
    fun aPasskeyTheServerRejectsRegistersNothing() = runBlocking {
        server.enqueue(json(options))
        server.enqueue(json("""{"type":"x","title":"x","status":401,"code":"unauthorized","detail":"No."}""", 401))
        try {
            setup.withPasskey(url, "Pixel", FakePasskeys { """{"id":"other"}""" })
            fail("expected a refusal")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
        }
        assertNull(sessions.current())
    }

    @Test
    fun withoutPasskeysThePasswordAloneRegistersAsBefore() = runBlocking {
        server.enqueue(json(registered, 201))
        setup.withPassword(url, "Pixel", "correct horse", recoveryCode = null)
        val body = ApiJson.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
        assertEquals("correct horse", body["password"]!!.jsonPrimitive.content)
        // Older servers reject unknown fields: no recoveryCode at all, not even null.
        assertFalse("recoveryCode" in body)
        assertEquals("dev-1", sessions.current()!!.deviceId)
    }

    @Test
    fun passkeyRequiredThenPasswordWithRecoveryCode() = runBlocking {
        server.enqueue(json(passkeyRequired, 403))
        try {
            setup.withPassword(url, "Pixel", "correct horse", recoveryCode = null)
            fail("expected passkey-required")
        } catch (e: ApiException) {
            assertEquals(DeviceSetup.PASSKEY_REQUIRED, e.code)
        }
        assertNull(sessions.current())
        server.takeRequest()

        server.enqueue(json(registered, 201))
        setup.withPassword(url, "Pixel", "correct horse", recoveryCode = " abcd-efgh-jkmn ")
        val body = ApiJson.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
        assertEquals("abcd-efgh-jkmn", body["recoveryCode"]!!.jsonPrimitive.content)
        assertTrue(sessions.current() != null)
    }
}
