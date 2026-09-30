package io.github.raja2102598.gymlog

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import org.json.JSONObject

private const val NOTIFICATIONS = "notifications"

/**
 * The lock screen while Gym Log is backgrounded or closed (src/native/rest.ts). schedule() arms RestAlarm for when a
 * running rest timer ends and shows its countdown, cancelRest() takes those down; workout() shows the workout under
 * way, apart from the rest, and cancelWorkout() takes it down; cancel() takes down all of it. Called from JavaScript as
 * the app goes to the background, and again on coming back (where the page counts down and says when rest is over
 * itself) or on any change to either, so the native side always matches the page's. checkPermissions() and
 * requestPermissions() (asking for POST_NOTIFICATIONS, Android 13 and later; older versions grant it on install) are
 * Plugin's own, built from `permissions` below, exactly as SpeechPlugin uses them for the microphone; Settings'
 * "Rest timer notifications" row (SettingsView.tsx) is what calls them. The rows under it call checkAlarms(), for
 * whether "Rest over" will be on time and Live Updates are allowed, and open Android's page for each.
 */
@CapacitorPlugin(name = "RestTimer", permissions = [Permission(alias = NOTIFICATIONS, strings = [Manifest.permission.POST_NOTIFICATIONS])])
class RestTimerPlugin : Plugin() {
    /** { lift, endAt, next, samsungCard }: schedules the alert for `endAt` (epoch ms), `next` being what comes after
     *  the rest, and `samsungCard` whether Settings' Samsung timer card is on. */
    @PluginMethod
    fun schedule(call: PluginCall) {
        val lift = call.getString("lift") ?: ""
        val endAt = call.getLong("endAt", 0L) ?: 0L
        RestAlarm.schedule(context, lift, endAt, call.getString("next") ?: "", call.getBoolean("samsungCard", false) ?: false)
        call.resolve()
    }

    /** Cancels the pending alert and takes down the countdown and any "Rest over". */
    @PluginMethod
    fun cancelRest(call: PluginCall) {
        RestAlarm.cancelRest(context)
        call.resolve()
    }

    /** { title, text, chip, since, forMs, samsungCard }: the workout under way, its clock counting up from `since`
     *  (RestAlarm.showWorkout). */
    @PluginMethod
    fun workout(call: PluginCall) {
        RestAlarm.showWorkout(
            context,
            call.getString("title") ?: "",
            call.getString("text") ?: "",
            call.getString("chip") ?: "",
            call.getLong("since", 0L) ?: 0L,
            call.getLong("forMs", 0L) ?: 0L,
            call.getBoolean("samsungCard", false) ?: false,
        )
        call.resolve()
    }

    /** Takes down the workout's clock. */
    @PluginMethod
    fun cancelWorkout(call: PluginCall) {
        RestAlarm.cancelWorkout(context)
        call.resolve()
    }

    /** Cancels the pending alert and takes down every notification of these, whichever are up. */
    @PluginMethod
    fun cancel(call: PluginCall) {
        RestAlarm.cancel(context)
        call.resolve()
    }

    /** { samsung }: whether this is a Samsung phone, the only kind Settings offers the Samsung timer card on, and
     *  where its Live Updates row speaks of the Now Bar instead (openLiveUpdateSettings). */
    @PluginMethod
    fun isSamsung(call: PluginCall) {
        call.resolve(JSObject().put("samsung", RestTimerLogic.samsungPhone(Build.MANUFACTURER)))
    }

    // Android 12 and older have no POST_NOTIFICATIONS to ask for (notifications come with the app), so Capacitor's
    // own check would read it as never granted. There, the answer is the phone's notifications switch for Gym Log.
    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return super.checkPermissions(call)
        call.resolve(JSObject().put(NOTIFICATIONS, if (RestAlarm.canNotify(context)) "granted" else "denied"))
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return super.requestPermissions(call)
        checkPermissions(call)
    }

    /**
     * { exact, liveUpdates }: what Settings shows under "Rest timer notifications", each null where this phone's
     * Android has no such setting, so there's nothing to show or change. `exact`: whether "Rest over" gets its exact
     * alarm rather than an inexact one that can be minutes late (RestAlarm.exactAlarms, Android 12 and later).
     * `liveUpdates`: whether the countdown and the workout's clock may be Live Updates (RestAlarm.liveUpdates, Android
     * 16 and later). Read again each time the app comes back from Android's settings.
     */
    @PluginMethod
    fun checkAlarms(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("exact", RestAlarm.exactAlarms(context) ?: JSONObject.NULL)
                .put("liveUpdates", RestAlarm.liveUpdates(context) ?: JSONObject.NULL),
        )
    }

    /** Android's "Alarms & reminders" page for Gym Log, where "Rest over" is allowed to come on time, or the first
     *  page after it this phone has (RestTimerLogic.exactAlarmPages). */
    @PluginMethod
    fun openExactAlarmSettings(call: PluginCall) {
        open(call, RestTimerLogic.exactAlarmPages(Build.VERSION.SDK_INT))
    }

    /** Android's Live Updates page for Gym Log, or on a Samsung, Developer options; or the first page after it this
     *  phone has (RestTimerLogic.liveUpdatePages). */
    @PluginMethod
    fun openLiveUpdateSettings(call: PluginCall) {
        open(call, RestTimerLogic.liveUpdatePages(Build.VERSION.SDK_INT, RestTimerLogic.samsungPhone(Build.MANUFACTURER)))
    }

    /** Opens the first of `pages` this phone has, resolving each first: a maker's Settings app may lack any of them.
     *  Android's own Settings app is visible to every app (AOSP's config_forceQueryablePackages), so resolving needs
     *  no <queries> in the manifest; one that resolves but still won't start goes on to the next all the same. */
    private fun open(call: PluginCall, pages: List<RestTimerLogic.SettingsPage>) {
        for (page in pages) {
            val screen = intentFor(page) ?: continue
            if (screen.resolveActivity(context.packageManager) == null) continue
            try {
                context.startActivity(screen)
                return call.resolve()
            } catch (e: ActivityNotFoundException) {
                // Not on this phone after all: the next one.
            } catch (e: SecurityException) {
                // Not for Gym Log to open: the next one.
            }
        }
        call.reject("Couldn’t open Android’s settings")
    }

    /** `page` as an Intent, or null on a phone whose Android is too old for it (RestTimerLogic only offers those from
     *  where they exist, but each is guarded here too). */
    private fun intentFor(page: RestTimerLogic.SettingsPage): Intent? {
        val app = context.packageName
        return when (page) {
            RestTimerLogic.SettingsPage.EXACT_ALARMS ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$app")) else null
            RestTimerLogic.SettingsPage.LIVE_UPDATES ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app) else null
            RestTimerLogic.SettingsPage.DEVELOPER_OPTIONS -> Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
            RestTimerLogic.SettingsPage.APP_NOTIFICATIONS -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app)
            RestTimerLogic.SettingsPage.APP_INFO -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$app"))
        }
    }
}
