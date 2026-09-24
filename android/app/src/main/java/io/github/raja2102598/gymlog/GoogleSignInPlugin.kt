package io.github.raja2102598.gymlog

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Continue with Google from JavaScript (src/native/google.ts): Android's own account sheet (Credential Manager), then
 * Google's ID token back to the page, which hands it to Supabase. Google won't sign in inside a web view, so the
 * sheet is native. The nonce (already hashed by the page) ties the token to this one sign-in.
 */
@CapacitorPlugin(name = "GoogleSignIn")
class GoogleSignInPlugin : Plugin() {
    private companion object {
        // Google's ID token, as the account sheet returns it: the Sign in with Google flow has a type of its own.
        val TOKEN_TYPES = setOf(
            GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL,
            GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL,
        )
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()
    }

    /** { webClientId, nonce } → { idToken, email }. Rejects with code "cancelled", "no_account" or "failed". */
    @PluginMethod
    fun signIn(call: PluginCall) {
        val clientId = call.getString("webClientId")
        val nonce = call.getString("nonce")
        if (clientId.isNullOrBlank() || nonce.isNullOrBlank()) {
            call.reject("Google sign-in needs the web client ID and a nonce", "failed")
            return
        }
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build())
            .build()
        scope.launch {
            try {
                val credential = CredentialManager.create(context).getCredential(activity, request).credential
                if (credential is CustomCredential && credential.type in TOKEN_TYPES) {
                    val google = GoogleIdTokenCredential.createFrom(credential.data)
                    call.resolve(JSObject().put("idToken", google.idToken).put("email", google.id))
                } else {
                    call.reject("Google didn't send back a sign-in token", "failed")
                }
            } catch (e: GetCredentialCancellationException) {
                call.reject("Cancelled", "cancelled")
            } catch (e: NoCredentialException) {
                call.reject("No Google account on this phone", "no_account")
            } catch (e: GetCredentialException) {
                call.reject(e.errorMessage?.toString() ?: e.type, "failed")
            } catch (e: Exception) {
                call.reject(e.message ?: "Google sign-in failed", "failed")
            }
        }
    }
}
