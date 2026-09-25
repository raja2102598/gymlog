package io.github.raja2102598.gymlog

import org.json.JSONObject
import java.io.InputStream
import java.security.MessageDigest

/**
 * The parts of updating the app from inside itself (src/native/update.ts) that don't need Android: parsing
 * version.json, deciding whether a build is newer, hex SHA-256 of a download, the two addresses a repo's releases
 * give us, and whether two sets of signing certificates match. AppUpdatePlugin does the rest: the HTTP, the file
 * system, PackageManager. Pure, for AppUpdateLogicTest (like HealthDays.kt and SpeechErrors).
 */
object AppUpdateLogic {
    /** version.json, as .github/workflows/android.yml writes it next to the APK. */
    data class Latest(val code: Long, val name: String, val commit: String, val size: Long, val sha256: String)

    /** version.json's fields, or null if it doesn't look like one: a 404 page, or CI mid-write. Not a crash either
     *  way — the caller treats it the same as nothing published yet. */
    fun parseVersionJson(text: String): Latest? =
        try {
            val o = JSONObject(text)
            Latest(
                code = o.getLong("versionCode"),
                name = o.getString("versionName"),
                commit = o.getString("commit"),
                size = o.getLong("size"),
                sha256 = o.getString("sha256"),
            )
        } catch (e: Exception) {
            null
        }

    /** Whether `latestCode` is a newer build than `currentCode`: a strictly higher versionCode. A tie or an older
     *  build (someone reinstalling an old release over a newer one) is not "newer". */
    fun isNewer(latestCode: Long, currentCode: Long): Boolean = latestCode > currentCode

    /** A leftover download is safe to delete once it's no longer ahead of what's installed (it either finished
     *  installing already, or was overtaken by a newer build installed some other way). */
    fun isStaleDownload(downloadedCode: Long, installedCode: Long): Boolean = downloadedCode <= installedCode

    /** version.json's and the APK's addresses for `repo` ("owner/name"), from the `android-latest` release that
     *  every push to main replaces (.github/workflows/android.yml). */
    fun versionJsonUrl(repo: String): String = "https://github.com/$repo/releases/download/android-latest/version.json"

    fun apkUrl(repo: String): String = "https://github.com/$repo/releases/download/android-latest/gym-log.apk"

    /** Lower-case hex. */
    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    /** `stream`'s SHA-256, reading it to the end (and closing it) without holding it all in memory. */
    fun sha256Hex(stream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(64 * 1024)
        stream.use {
            while (true) {
                val n = it.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return hex(digest.digest())
    }

    /** Whether two APKs were signed with the same key(s): the same, non-empty set of certificates (each as its
     *  SHA-256 hex), order aside. Two empty sets (neither could be read) don't count as matching. */
    fun sameSigners(a: Set<String>, b: Set<String>): Boolean = a.isNotEmpty() && a == b
}

/**
 * One run at a time, for any number of callers: a caller that arrives while a run is under way joins it and hears
 * how it ended, instead of starting another. AppUpdatePlugin's download: two at once (Settings left and opened
 * again mid-download, say) would write the same file over each other.
 */
class SingleRun<C> {
    private var joined: MutableList<C>? = null

    /** True if `caller` should start a run, as none is under way; false if it has joined the one that is. */
    @Synchronized
    fun join(caller: C): Boolean {
        joined?.let {
            it.add(caller)
            return false
        }
        joined = mutableListOf(caller)
        return true
    }

    /** Ends the run under way, returning every caller that started or joined it, to tell how it went. */
    @Synchronized
    fun finish(): List<C> = joined.orEmpty().also { joined = null }
}
