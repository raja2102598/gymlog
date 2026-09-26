package io.github.raja2102598.gymlog

import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The home-screen widget's data from JavaScript (src/native/widget.ts): today's session and lift progress, saved
 * through GymWidgetStore and pushed straight to any placed widget. GymWidgetLogic has the pure parts: parsing this
 * JSON, whether it's still today's, and the words on screen.
 */
@CapacitorPlugin(name = "GymWidget")
class WidgetPlugin : Plugin() {
    /** { date, session, done, planned, restEndsAt, skipped, workoutSince } */
    @PluginMethod
    fun update(call: PluginCall) {
        val date = call.getString("date")
        val session = call.getString("session")
        val done = call.getInt("done")
        val planned = call.getInt("planned")
        if (date.isNullOrEmpty() || session.isNullOrEmpty() || done == null || planned == null) {
            call.reject("date, session, done and planned are needed")
            return
        }
        val json = GymWidgetLogic.toJson(date, session, done, planned, call.getString("restEndsAt"), call.getBoolean("skipped", false) == true, call.getString("workoutSince"))
        GymWidgetStore.write(context, json)
        GymWidgetProvider.refresh(context)
        call.resolve()
    }

    /** Signing out: nothing left to show until someone signs in again. */
    @PluginMethod
    fun clear(call: PluginCall) {
        GymWidgetStore.clear(context)
        GymWidgetProvider.refresh(context)
        call.resolve()
    }
}
