package io.github.raja2102598.gymlog

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Background sync: about every hour, even with the app closed, read the last three days from Health Connect and
 * send them to Supabase with this phone's sync key (public.sync_health_days). The app turns it on and off from
 * Settings through GymSyncPlugin. What happened last time is kept for Settings to show.
 */
object HealthSync {
    private const val PREFS = "gymlog.sync"
    private const val WORK = "gymlog-health-sync"
    private const val WORK_NOW = "gymlog-health-sync-now"
    const val BACKGROUND = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND

    class Config(val key: String, val url: String, val anonKey: String)

    fun config(ctx: Context): Config? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = p.getString("key", null) ?: return null
        return Config(key, p.getString("url", "")!!, p.getString("anonKey", "")!!)
    }

    fun enable(ctx: Context, c: Config) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("key", c.key).putString("url", c.url).putString("anonKey", c.anonKey).apply()
        val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val hourly = PeriodicWorkRequestBuilder<HealthSyncWorker>(1, TimeUnit.HOURS)
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, hourly)
    }

    fun disable(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("key").remove("url").remove("anonKey").apply()
    }

    fun runNow(ctx: Context) {
        val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(WORK_NOW, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<HealthSyncWorker>().setConstraints(online).build())
    }

    fun record(ctx: Context, ok: Boolean, msg: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("lastRunAt", System.currentTimeMillis()).putBoolean("lastOk", ok).putString("lastMsg", msg).apply()
    }

    fun last(ctx: Context): Triple<Long, Boolean, String> {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Triple(p.getLong("lastRunAt", 0L), p.getBoolean("lastOk", false), p.getString("lastMsg", "") ?: "")
    }

    /** Whether this phone's Health Connect lets apps read while in the background at all. */
    fun backgroundAvailable(client: HealthConnectClient): Boolean =
        client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
            HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    /** Sends days to public.sync_health_days; returns how many changed. */
    fun send(c: Config, days: JSONArray): Int {
        val conn = URL("${c.url}/rest/v1/rpc/sync_health_days").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 20_000
            conn.readTimeout = 30_000
            conn.doOutput = true
            conn.setRequestProperty("apikey", c.anonKey)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(JSONObject().put("sync_key", c.key).put("days", days).toString().toByteArray()) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code in 200..299) return body.trim().toIntOrNull() ?: 0
            throw SendError(code, runCatching { JSONObject(body).optString("message") }.getOrNull().orEmpty().ifEmpty { "HTTP $code" })
        } finally {
            conn.disconnect()
        }
    }

    class SendError(val status: Int, message: String) : Exception(message)
}

class HealthSyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val c = HealthSync.config(ctx) ?: return Result.success()
        if (HealthConnectClient.getSdkStatus(ctx) != HealthConnectClient.SDK_AVAILABLE) {
            HealthSync.record(ctx, false, "Health Connect isn’t available on this phone.")
            return Result.success()
        }
        val client = HealthConnectClient.getOrCreate(ctx)
        val granted = client.permissionController.getGrantedPermissions()
        if (HealthSync.backgroundAvailable(client) && HealthSync.BACKGROUND !in granted) {
            HealthSync.record(ctx, false, "Health Connect doesn’t allow Gym Log to read in the background. Turn it on in Settings.")
            return Result.success()
        }
        val zone = ZoneId.systemDefault()
        val first = LocalDate.now(zone).minusDays(2)
        val read = HealthRead.read(
            client,
            from = first.atStartOfDay(zone).toInstant(),
            sleepFrom = first.minusDays(1).atStartOfDay(zone).toInstant(),
            to = Instant.now(),
            granted = granted,
        )
        if (read.readings.length() == 0 && read.failed.isNotEmpty()) {
            HealthSync.record(ctx, false, "Health Connect didn’t let Gym Log read in the background, so nothing was sent. It syncs when you open the app.")
            return Result.success()
        }
        val built = HealthDays.build(read.readings, zone)
        val days = JSONArray()
        for (k in built.keys()) if (k >= first.toString()) days.put(JSONObject().put("day", k).put("data", built.getJSONObject(k)))
        return try {
            val n = HealthSync.send(c, days)
            val saved = if (n == 0) "Up to date" else "$n day${if (n == 1) "" else "s"} updated"
            HealthSync.record(ctx, true, if (read.failed.isEmpty()) "$saved." else "$saved; couldn’t read ${read.failed.joinToString(", ")}.")
            Result.success()
        } catch (e: HealthSync.SendError) {
            // The key was removed (background sync turned off from another device, or the account deleted): stop.
            if (e.status == 401 || e.status == 403) {
                HealthSync.disable(ctx)
                HealthSync.record(ctx, false, "Background sync was turned off: this phone’s sync key no longer works. Turn it on again in Settings.")
                return Result.success()
            }
            HealthSync.record(ctx, false, "Couldn’t save to Supabase (${e.message}). Trying again later.")
            Result.retry()
        } catch (e: IOException) {
            HealthSync.record(ctx, false, "Couldn’t reach Supabase. Trying again later.")
            Result.retry()
        }
    }
}
