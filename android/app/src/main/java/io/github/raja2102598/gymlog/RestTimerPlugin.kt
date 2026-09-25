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
 * The rest timer's alert while Gym Log is backgrounded or closed (src/native/rest.ts). schedule() arms RestAlarm for
 * when a running timer ends; cancel() disarms it. Called from JavaScript on every change to the timer (started,
 * paused, resumed, given more time, skipped, or reaching zero while the app was open), so the native alert always
 * matches what's on screen without a method here for each of those separately. checkPermissions() and
 * requestPermissions() (asking for POST_NOTIFICATIONS, Android 13 and later; older versions grant it on install) are
 * Plugin's own, built from `permissions` below, exactly as SpeechPlugin uses them for the microphone; Settings'
 * "Rest timer notifications" row (SettingsView.tsx) is what calls them.
 */
@CapacitorPlugin(name = "RestTimer", permissions = [Permission(alias = NOTIFICATIONS, strings = [Manifest.permission.POST_NOTIFICATIONS])])
class RestTimerPlugin : Plugin() {
    /** { lift, endAt }: schedules the alert for `endAt` (epoch ms). */
    @PluginMethod
    fun schedule(call: PluginCall) {
        val lift = call.getString("lift") ?: ""
        val endAt = call.getLong("endAt", 0L) ?: 0L
        RestAlarm.schedule(context, lift, endAt)
        call.resolve()
    }

    /** Cancels the pending alert and takes down the notification, if either is up. */
    @PluginMethod
    fun cancel(call: PluginCall) {
        RestAlarm.cancel(context)
        call.resolve()
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
