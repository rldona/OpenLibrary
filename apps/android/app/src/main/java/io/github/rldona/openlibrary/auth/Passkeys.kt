package io.github.rldona.openlibrary.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException

/** Why the phone produced no passkey answer. */
sealed class PasskeyUnavailable(message: String) : Exception(message) {
    /** The owner closed the prompt. */
    class Cancelled : PasskeyUnavailable("cancelled")
    /** No passkey for this library on this phone (or in its password manager). */
    class NoCredential : PasskeyUnavailable("no credential")
    class Failed(message: String) : PasskeyUnavailable(message)
}

/** Produces a WebAuthn sign-in answer for the server's request JSON. Faked in the JVM tests. */
fun interface PasskeyProvider {
    /** Returns the AuthenticationResponseJSON, or throws [PasskeyUnavailable]. */
    suspend fun signIn(requestJson: String): String
}

/**
 * Credential Manager: the phone's passkeys (Google Password Manager or another provider). It only
 * offers the passkeys of the server's relying party when the site's /.well-known/assetlinks.json
 * lists this app's signing certificate, so it needs the real HTTPS hostname.
 */
class CredentialManagerPasskeys(private val activity: Activity) : PasskeyProvider {
    override suspend fun signIn(requestJson: String): String {
        val request = GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson)))
        val result =
            try {
                CredentialManager.create(activity).getCredential(activity, request)
            } catch (_: GetCredentialCancellationException) {
                throw PasskeyUnavailable.Cancelled()
            } catch (_: NoCredentialException) {
                throw PasskeyUnavailable.NoCredential()
            } catch (e: GetCredentialException) {
                throw PasskeyUnavailable.Failed(e.errorMessage?.toString() ?: e.type)
            }
        val credential = result.credential as? PublicKeyCredential ?: throw PasskeyUnavailable.Failed("not a passkey")
        return credential.authenticationResponseJson
    }
}
