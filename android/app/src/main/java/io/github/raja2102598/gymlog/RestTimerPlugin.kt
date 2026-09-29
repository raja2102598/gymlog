package io.github.raja2102598.gymlog

import android.Manifest
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

private const val NOTIFICATIONS = "notifications"

/**
 * The lock screen while Gym Log is backgrounded or closed (src/native/rest.ts). schedule() arms RestAlarm for when a
 * running rest timer ends and shows its countdown, cancelRest() takes those down; workout() shows the workout under
 * way, apart from the rest, and cancelWorkout() takes it down; cancel() takes down all of it. Called from JavaScript as
 * the app goes to the background, and again on coming back (where the page counts down and says when rest is over
 * itself) or on any change to either, so the native side always matches the page's. checkPermissions() and
 * requestPermissions() (asking for POST_NOTIFICATIONS, Android 13 and later; older versions grant it on install) are
 * Plugin's own, built from `permissions` below, exactly as SpeechPlugin uses them for the microphone; Settings'
 * "Rest timer notifications" row (SettingsView.tsx) is what calls them.
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
}
