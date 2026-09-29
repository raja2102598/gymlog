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
 * whether "Rest over" will be on time and Live Updates are allowed, and open Android's page for each that isn't.
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

    /** { samsung }: whether this is a Samsung phone, the only kind Settings offers the Samsung timer card on. */
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
     * { exact, liveUpdates, samsung }: what Settings shows under "Rest timer notifications", each of the first two
     * null where this phone's Android has no such setting, so there's nothing to show or change. `exact`: whether
     * "Rest over" gets its exact alarm rather than an inexact one that can be minutes late (RestAlarm.exactAlarms,
     * Android 12 and later). `liveUpdates`: whether the countdown and the workout's clock may be Live Updates
     * (RestAlarm.liveUpdates, Android 16 and later). `samsung`: a Samsung phone, whose Now Bar has a say of its own
     * (RestTimerLogic.samsungPhone). Read again each time the app comes back from Android's settings.
     */
    @PluginMethod
    fun checkAlarms(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("exact", RestAlarm.exactAlarms(context) ?: JSONObject.NULL)
                .put("liveUpdates", RestAlarm.liveUpdates(context) ?: JSONObject.NULL)
                .put("samsung", RestTimerLogic.samsungPhone(Build.MANUFACTURER)),
        )
    }

    /** Android's "Alarms & reminders" page for Gym Log, where "Rest over" is allowed to come on time. Settings only
     *  offers it from Android 12, the first to have it; a phone without it gets Gym Log's page in its settings. */
    @PluginMethod
    fun openExactAlarmSettings(call: PluginCall) {
        val app = Uri.parse("package:${context.packageName}")
        val alarms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, app) else null
        open(call, alarms, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app))
    }

    /** Android 16's Live Updates page for Gym Log. Settings only offers it from Android 16; a phone whose own Settings
     *  app hasn't got that page (a maker's may not) gets Gym Log's notification settings instead. */
    @PluginMethod
    fun openLiveUpdateSettings(call: PluginCall) {
        val app = context.packageName
        val promotion = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app) else null
        open(call, promotion, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app))
    }

    /** Opens the first of `screens` this phone has, a null being one its Android is too old for. */
    private fun open(call: PluginCall, vararg screens: Intent?) {
        for (screen in screens.filterNotNull()) {
            try {
                context.startActivity(screen)
                return call.resolve()
            } catch (e: ActivityNotFoundException) {
                // Not on this phone: the next one.
            }
        }
        call.reject("Couldn’t open Android’s settings")
    }
}
