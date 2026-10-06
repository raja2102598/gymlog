package io.github.raja2102598.gymlog

import android.view.WindowManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Keeps the screen on while the workout is open (src/lib/awake.ts), with the window's own flag: Android lets it go by
 * itself when the app leaves the screen, and holds it again when the app comes back, with no permission needed.
 */
@CapacitorPlugin(name = "GymScreen")
class ScreenPlugin : Plugin() {
    /** { on } */
    @PluginMethod
    fun keepOn(call: PluginCall) {
        val on = call.getBoolean("on", false) == true
        activity.runOnUiThread {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }
}
