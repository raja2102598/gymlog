package io.github.raja2102598.gymlog

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

private const val MICROPHONE = "microphone"

/**
 * Voice logging from JavaScript (src/native/speech.ts). The app's web view has no speech recognition of its own, so
 * this hears one phrase at a time with Android's SpeechRecognizer: on the phone itself where it can (on-device
 * recognition, Android 12 and later), otherwise with the phone's speech service, which prefers its offline model.
 * It needs the microphone, which Settings asks for when Log sets by voice is switched on (Capacitor's
 * requestPermissions, as "microphone").
 */
@CapacitorPlugin(name = "Speech", permissions = [Permission(alias = MICROPHONE, strings = [Manifest.permission.RECORD_AUDIO])])
class SpeechPlugin : Plugin() {
    /** A listen in progress: its call, and the recognizer hearing it. */
    private class Listening(val call: PluginCall, val recognizer: SpeechRecognizer)

    // SpeechRecognizer works on the main thread only, so everything to do with the listen in progress happens there.
    private val main = Handler(Looper.getMainLooper())
    private var current: Listening? = null

    /** { available }: whether this phone can turn speech into text at all. */
    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(JSObject().put("available", onDevice() || SpeechRecognizer.isRecognitionAvailable(context)))
    }

    /**
     * { lang } → { matches }: up to 5 guesses at one phrase, best first, in the language given (English: the page reads
     * only English), not the phone's own. Rejects with a SpeechErrors reason as its code.
     */
    @PluginMethod
    fun listen(call: PluginCall) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            call.reject("Gym Log isn't allowed to use the microphone", SpeechErrors.NOT_ALLOWED)
            return
        }
        val lang = call.getString("lang")
        val onDevice = onDevice()
        main.post { start(call, lang, onDevice) }
    }

    /** Stops a listen in progress, which then rejects with "aborted". */
    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            end(SpeechErrors.ABORTED)
            call.resolve()
        }
    }

    // Leaving the app stops listening: the microphone is only on while Gym Log is in front.
    override fun handleOnPause() {
        super.handleOnPause()
        end(SpeechErrors.ABORTED)
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        end(SpeechErrors.ABORTED)
    }

    private fun onDevice(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    private fun start(call: PluginCall, lang: String?, onDevice: Boolean) {
        end(SpeechErrors.ABORTED) // one listen at a time
        val recognizer = try {
            if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            } else {
                SpeechRecognizer.createSpeechRecognizer(context)
            }
        } catch (e: Exception) {
            call.reject(e.message ?: "Couldn't start speech recognition", SpeechErrors.FAILED)
            return
        }
        val now = Listening(call, recognizer)
        current = now
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                if (!done(now)) return
                val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty().take(5)
                call.resolve(JSObject().put("matches", JSArray(heard)))
            }

            override fun onError(error: Int) {
                if (!done(now)) return
                // The phone's on-device recognizer doesn't have this language (yet): its speech service may.
                if (onDevice && SpeechErrors.tryAnother(error) && SpeechRecognizer.isRecognitionAvailable(context)) {
                    start(call, lang, false)
                } else {
                    call.reject("Speech recognition error $error", SpeechErrors.reason(error))
                }
            }

            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        if (!lang.isNullOrBlank()) intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
        recognizer.startListening(intent)
    }

    /** Lets go of a listen's recognizer once it has answered. False when that listen had already ended. */
    private fun done(l: Listening): Boolean {
        if (current !== l) return false
        current = null
        l.recognizer.destroy()
        return true
    }

    /** Ends the listen in progress, if there is one, rejecting it with `reason`. */
    private fun end(reason: String) {
        val l = current ?: return
        done(l)
        l.call.reject("Stopped listening", reason)
    }
}

/**
 * SpeechRecognizer's errors as the reasons the browser's speech recognition gives (src/lib/speech.ts), so the app
 * says the same as the website: silence is "no-speech", words it couldn't make out "no-match", no microphone
 * permission "not-allowed", no connection (or a language the phone would first have to download) "network", and
 * anything else "failed", which asks you to try again. None of them is "aborted", which says nothing: only the
 * plugin's own stops are (end()), and it lets go of the recognizer before any error of that listen could arrive, so
 * an ERROR_CLIENT that does arrive is a real failure. Pure, for SpeechErrorsTest.
 */
object SpeechErrors {
    const val NO_SPEECH = "no-speech"
    const val NO_MATCH = "no-match"
    const val NOT_ALLOWED = "not-allowed"
    const val NETWORK = "network"
    const val ABORTED = "aborted"
    const val FAILED = "failed"

    fun reason(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> NO_SPEECH
        SpeechRecognizer.ERROR_NO_MATCH -> NO_MATCH
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> NOT_ALLOWED
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        SpeechRecognizer.ERROR_SERVER,
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
        -> NETWORK
        else -> FAILED
    }

    /** An on-device recognizer's error for a language it doesn't have: the phone's speech service may have it. */
    fun tryAnother(error: Int): Boolean =
        error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
}
