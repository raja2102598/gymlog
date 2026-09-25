package io.github.raja2102598.gymlog

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.DigestInputStream
import java.security.MessageDigest

/**
 * Updating the app from inside itself (src/native/update.ts): checks this build's own GitHub repo for a newer
 * release, downloads and verifies the APK, and hands it to Android's installer. GYMLOG_UPDATE_REPO (BuildConfig,
 * set by .github/workflows/android.yml) names the repo; empty in a local build, so it never checks — see
 * docs/android.md, "Updates and the signing key". Every address it fetches is built here from that repo, and
 * "check", "download" and "install" take no arguments, so a web page can't make the app fetch or run anything
 * else. The pure decisions (parsing version.json, "newer?", hashing, the two URLs) are AppUpdateLogic.
 */
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {
    // Network and file work, off the main thread; SupervisorJob so one failed call doesn't cancel another's.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var cleanedLeftover = false
    private val downloads = SingleRun<PluginCall>()

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()
    }

    private fun repo(): String = BuildConfig.GYMLOG_UPDATE_REPO

    private fun safely(call: PluginCall, block: () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                call.reject(e.message ?: "Update check failed", null, e)
            }
        }
    }

    private data class Installed(val code: Long, val name: String)

    private fun updatesDir(): File = File(context.cacheDir, "updates").apply { mkdirs() }
    private fun apkFile(): File = File(updatesDir(), "gym-log.apk")

    // GET_SIGNING_CERTIFICATES (API 28) replaces the older GET_SIGNATURES this app's minSdk (26) still has to serve.
    // From 28 it asks for both: Android 9 and 10 only read a downloaded APK's certificates (getPackageArchiveInfo) for
    // GET_SIGNATURES, so with GET_SIGNING_CERTIFICATES alone its signingInfo is null and every update would look
    // signed by someone else.
    @Suppress("DEPRECATION")
    private val signatureFlags: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES else PackageManager.GET_SIGNATURES

    // The (String, Int) overloads are deprecated from API 33 in favour of the PackageInfoFlags ones.
    @Suppress("DEPRECATION")
    private fun installedPackageInfo(flags: Int): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            context.packageManager.getPackageInfo(context.packageName, flags)
        }

    @Suppress("DEPRECATION")
    private fun archivePackageInfo(path: String, flags: Int): PackageInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageArchiveInfo(path, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            context.packageManager.getPackageArchiveInfo(path, flags)
        }

    private fun installedVersion(): Installed {
        val info = installedPackageInfo(0)
        return Installed(PackageInfoCompat.getLongVersionCode(info), info.versionName ?: "")
    }

    /** Each signing certificate's SHA-256 hex: the modern signingInfo from API 28 (every signer, in case of more
     *  than one); the older `signatures` before that, or wherever signingInfo is missing all the same. */
    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo): Set<String> {
        val modern = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners else null
        val sigs: Array<Signature> = modern ?: info.signatures ?: emptyArray()
        return sigs.map { AppUpdateLogic.sha256Hex(ByteArrayInputStream(it.toByteArray())) }.toSet()
    }

    /** GETs version.json. Null for a 404 (nothing published yet, or CI is mid-replace) or a body that doesn't parse;
     *  anything else throws, which `safely` turns into a rejection the UI can show. */
    private fun fetchLatest(repo: String): AppUpdateLogic.Latest? {
        val conn = URL(AppUpdateLogic.versionJsonUrl(repo)).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.instanceFollowRedirects = true // GitHub redirects a release asset to its file host
            val code = conn.responseCode
            if (code == HttpURLConnection.HTTP_NOT_FOUND) return null
            if (code !in 200..299) throw IOException("Couldn't check for updates (HTTP $code)")
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            return AppUpdateLogic.parseVersionJson(text)
        } finally {
            conn.disconnect()
        }
    }

    /** { enabled, current: {code, name}, latest?: {…}, available } */
    @PluginMethod
    fun check(call: PluginCall) = safely(call) {
        val current = installedVersion()
        // Once per app start (not every call): a download from an older visit that's no longer any use.
        if (!cleanedLeftover) {
            cleanedLeftover = true
            cleanupLeftoverDownload(current.code)
        }
        val repo = repo()
        if (repo.isEmpty()) {
            call.resolve(checkResult(enabled = false, current, null))
            return@safely
        }
        val latest = fetchLatest(repo)
        call.resolve(checkResult(enabled = true, current, latest))
    }

    private fun checkResult(enabled: Boolean, current: Installed, latest: AppUpdateLogic.Latest?): JSObject {
        val out = JSObject()
            .put("enabled", enabled)
            .put("current", JSObject().put("code", current.code).put("name", current.name))
            .put("available", latest != null && AppUpdateLogic.isNewer(latest.code, current.code))
        if (latest != null) {
            out.put("latest", JSObject().put("code", latest.code).put("name", latest.name).put("commit", latest.commit).put("size", latest.size).put("sha256", latest.sha256))
        }
        return out
    }

    private fun cleanupLeftoverDownload(installedCode: Long) {
        val file = apkFile()
        if (!file.exists()) return
        val info = archivePackageInfo(file.absolutePath, 0)
        if (info == null || AppUpdateLogic.isStaleDownload(PackageInfoCompat.getLongVersionCode(info), installedCode)) file.delete()
    }

    /**
     * Re-reads version.json, downloads gym-log.apk to a temp file, verifies it and renames it into place, emitting
     * "progress" ({received, total}) as it goes. Resolves once it's ready for install() to hand to Android's
     * installer. Rejects, with the file removed, on any check that fails — see the reasons in downloadAndVerify.
     * A call while a download is under way joins it and resolves or rejects with it, so the file is never written
     * twice at once.
     */
    @PluginMethod
    fun download(call: PluginCall) {
        if (!downloads.join(call)) return
        scope.launch {
            var problem: String? = "Couldn’t download the update"
            var error: Exception? = null
            try {
                problem = downloadAndVerify()
            } catch (e: Exception) {
                problem = e.message ?: problem
                error = e
            } finally {
                for (c in downloads.finish()) if (problem == null) c.resolve() else c.reject(problem, null, error)
            }
        }
    }

    /** download()'s work: null once the verified APK is in place, or why it isn't (with the file removed). */
    private fun downloadAndVerify(): String? {
        val repo = repo()
        if (repo.isEmpty()) return "This build doesn't check for updates"
        val dest = apkFile()
        val tmp = File(updatesDir(), "gym-log.apk.tmp")
        var lastProblem = "Couldn’t download the update"
        // Up to twice: if the hash doesn't match, CI may have replaced the release while this was downloading.
        for (attempt in 1..2) {
            val latest = fetchLatest(repo) ?: return "No update is published right now"
            val sha = downloadToFile(tmp, latest)
            if (!sha.equals(latest.sha256, ignoreCase = true)) {
                tmp.delete()
                lastProblem = "The download didn’t match what was expected"
                continue
            }
            val current = installedVersion()
            val archiveInfo = archivePackageInfo(tmp.absolutePath, signatureFlags)
            val problem = when {
                archiveInfo == null -> "That file isn’t a valid Android app"
                archiveInfo.packageName != context.packageName -> "That build isn’t Gym Log"
                !AppUpdateLogic.isNewer(PackageInfoCompat.getLongVersionCode(archiveInfo), current.code) -> "That build isn’t newer than what’s installed"
                !AppUpdateLogic.sameSigners(signerDigests(installedPackageInfo(signatureFlags)), signerDigests(archiveInfo)) ->
                    "This update is signed differently from the app on this phone, so it can’t be installed over it"
                else -> null
            }
            if (problem != null) {
                tmp.delete()
                return problem
            }
            if (!tmp.renameTo(dest)) {
                tmp.delete()
                return "Couldn’t save the download"
            }
            return null
        }
        return "$lastProblem. Try again."
    }

    /** Streams the APK to `tmp`, hashing it as it goes, and returns the hex SHA-256. Emits "progress" at most 4
     *  times a second (always including the last chunk, so a listener always sees 100%). */
    private fun downloadToFile(tmp: File, latest: AppUpdateLogic.Latest): String {
        val conn = URL(AppUpdateLogic.apkUrl(repo())).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000 // a slow mobile connection shouldn't fail a download of several megabytes
            conn.instanceFollowRedirects = true
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("Couldn't download the update (HTTP $code)")
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: latest.size
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            var lastEmit = 0L
            DigestInputStream(conn.inputStream, digest).use { input ->
                FileOutputStream(tmp).use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        received += n
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastEmit >= 250 || received >= total) {
                            lastEmit = now
                            notifyListeners("progress", JSObject().put("received", received).put("total", total))
                        }
                    }
                }
            }
            return AppUpdateLogic.hex(digest.digest())
        } finally {
            conn.disconnect()
        }
    }

    /** { started: true }, or { needsPermission: true } if Android hasn't allowed Gym Log to install apps yet. */
    @PluginMethod
    fun install(call: PluginCall) {
        if (!context.packageManager.canRequestPackageInstalls()) {
            call.resolve(JSObject().put("needsPermission", true))
            return
        }
        val file = apkFile()
        if (!file.exists()) {
            call.reject("No update has been downloaded yet")
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve(JSObject().put("started", true))
    }

    /** Android's "install unknown apps" page for Gym Log, for the one-time permission install() found missing. */
    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
        call.resolve()
    }
}
