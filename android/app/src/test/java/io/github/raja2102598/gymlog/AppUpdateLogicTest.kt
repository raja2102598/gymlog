package io.github.raja2102598.gymlog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

/**
 * The app's own self-update, checked without Android or a network (see src/lib/update.ts and tests/unit/update.test.ts
 * for the JavaScript side: should-we-check-now, the words, remembering a dismissal).
 */
class AppUpdateLogicTest {
    private val json = """{"versionCode": 46, "versionName": "1.0.46", "commit": "abc123def456", "size": 19594240, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}"""

    @Test
    fun parsesVersionJsonsFields() {
        val v = AppUpdateLogic.parseVersionJson(json)
        assertEquals(46L, v?.code)
        assertEquals("1.0.46", v?.name)
        assertEquals("abc123def456", v?.commit)
        assertEquals(19594240L, v?.size)
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", v?.sha256)
    }

    @Test
    fun aPageThatIsntVersionJsonParsesToNull() {
        assertNull(AppUpdateLogic.parseVersionJson("<html>Not Found</html>"))
        assertNull(AppUpdateLogic.parseVersionJson("{}"))
        assertNull(AppUpdateLogic.parseVersionJson(""))
    }

    @Test
    fun isNewerOnlyForAStrictlyHigherVersionCode() {
        assertTrue(AppUpdateLogic.isNewer(46, 45))
        assertFalse(AppUpdateLogic.isNewer(45, 45))
        assertFalse(AppUpdateLogic.isNewer(44, 45))
    }

    @Test
    fun aLeftoverDownloadIsStaleOnceItsNoLongerAheadOfWhatsInstalled() {
        assertTrue(AppUpdateLogic.isStaleDownload(45, 45))
        assertTrue(AppUpdateLogic.isStaleDownload(44, 45))
        assertFalse(AppUpdateLogic.isStaleDownload(46, 45))
    }

    @Test
    fun buildsBothUrlsFromTheRepo() {
        assertEquals("https://github.com/raja2102598/gymlog/releases/download/android-latest/version.json", AppUpdateLogic.versionJsonUrl("raja2102598/gymlog"))
        assertEquals("https://github.com/raja2102598/gymlog/releases/download/android-latest/gym-log.apk", AppUpdateLogic.apkUrl("raja2102598/gymlog"))
    }

    @Test
    fun sha256HexMatchesKnownVectors() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", AppUpdateLogic.sha256Hex(ByteArrayInputStream(ByteArray(0))))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", AppUpdateLogic.sha256Hex(ByteArrayInputStream("abc".toByteArray())))
    }

    @Test
    fun sameSignersIgnoresOrderButNotAnEmptyMatch() {
        assertTrue(AppUpdateLogic.sameSigners(setOf("a", "b"), setOf("b", "a")))
        assertFalse(AppUpdateLogic.sameSigners(setOf("a"), setOf("b")))
        assertFalse(AppUpdateLogic.sameSigners(setOf("a"), setOf("a", "b")))
        assertFalse(AppUpdateLogic.sameSigners(emptySet(), emptySet()))
    }

    @Test
    fun aCallerArrivingMidRunJoinsItAndTheNextRunStartsFresh() {
        val runs = SingleRun<String>()
        assertTrue(runs.join("first"))
        assertFalse(runs.join("second"))
        assertFalse(runs.join("third"))
        assertEquals(listOf("first", "second", "third"), runs.finish())
        // Once that run has ended, the next caller starts one of its own.
        assertTrue(runs.join("fourth"))
        assertEquals(listOf("fourth"), runs.finish())
        assertEquals(emptyList<String>(), runs.finish())
    }
}
