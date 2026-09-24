package io.github.raja2102598.gymlog

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Voice logging in the app must say what the website says for the same trouble: SpeechPlugin rejects with the
 * browser's reasons, which src/hooks/useVoice.ts turns into words (see tests/unit/speech.test.ts for the JavaScript).
 */
class SpeechErrorsTest {
    @Test
    fun silenceAndUnclearWordsAreNoSpeechAndNoMatch() {
        assertEquals("no-speech", SpeechErrors.reason(SpeechRecognizer.ERROR_SPEECH_TIMEOUT))
        assertEquals("no-match", SpeechErrors.reason(SpeechRecognizer.ERROR_NO_MATCH))
    }

    @Test
    fun noMicrophonePermissionIsNotAllowed() {
        assertEquals("not-allowed", SpeechErrors.reason(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS))
    }

    @Test
    fun theNetworkTheServerAndAMissingLanguageAreNetwork() {
        for (error in listOf(
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
            SpeechRecognizer.ERROR_SERVER,
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
            SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
        )) {
            assertEquals("error $error", "network", SpeechErrors.reason(error))
        }
    }

    @Test
    fun aCancelIsAborted() {
        assertEquals("aborted", SpeechErrors.reason(SpeechRecognizer.ERROR_CLIENT))
    }

    @Test
    fun anythingElseFailed() {
        for (error in listOf(
            SpeechRecognizer.ERROR_AUDIO,
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
            SpeechRecognizer.ERROR_TOO_MANY_REQUESTS,
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
            SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT,
            SpeechRecognizer.ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS,
            0,
            99,
        )) {
            assertEquals("error $error", "failed", SpeechErrors.reason(error))
        }
    }

    @Test
    fun onlyAMissingLanguageTriesThePhonesSpeechService() {
        assertTrue(SpeechErrors.tryAnother(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED))
        assertTrue(SpeechErrors.tryAnother(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE))
        for (error in listOf(SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_CLIENT)) {
            assertFalse("error $error", SpeechErrors.tryAnother(error))
        }
    }
}
