package io.github.raja2102598.gymlog

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.RemoteViews
import java.time.LocalDate

private const val PREFS = "gymlog.widget"
private const val KEY_JSON = "json"

/** Where WidgetPlugin saves today's session, and GymWidgetProvider reads it back from. Just SharedPreferences;
 *  the parsing and the "is this still today?" decision are GymWidgetLogic, pure and unit-tested on their own. */
object GymWidgetStore {
    fun write(ctx: Context, json: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_JSON, json).apply()
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_JSON).apply()
    }

    fun read(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_JSON, null)
}

/**
 * The home-screen widget: today's session and lift progress (WidgetPlugin writes them, through GymWidgetStore), or
 * a neutral "Open Gym Log" once the day they were written for has passed. A classic AppWidgetProvider with
 * RemoteViews, not Glance: two text views and, space allowing, two small buttons are well within what RemoteViews
 * can do, and Glance would bring Jetpack Compose's compiler and runtime into a project that has neither.
 *
 * Taps open the app the same way the sign-in link does (see AndroidManifest.xml's "go" intent-filter and
 * src/native/app.ts): io.github.raja2102598.gymlog://go/today, .../go/weight or .../go/steps.
 */
class GymWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateOne(context, mgr, id)
    }

    // A resize can cross the size the buttons need, in either direction, so it picks the layout again.
    override fun onAppWidgetOptionsChanged(context: Context, mgr: AppWidgetManager, id: Int, newOptions: Bundle) {
        updateOne(context, mgr, id)
    }

    companion object {
        /** Called after WidgetPlugin saves new data, so every placed widget updates straight away instead of
         *  waiting for the next periodic tick (gym_widget_info.xml's updatePeriodMillis, a fallback for staleness
         *  that catches a day rolling over while nothing else does). */
        fun refresh(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, GymWidgetProvider::class.java))
            for (id in ids) updateOne(context, mgr, id)
        }

        private fun updateOne(context: Context, mgr: AppWidgetManager, id: Int) {
            val snapshot = GymWidgetLogic.parse(GymWidgetStore.read(context))
            val clock = android.text.format.DateFormat.getTimeFormat(context)
            val text = GymWidgetLogic.display(snapshot, LocalDate.now().toString(), System.currentTimeMillis()) { clock.format(java.util.Date(it)) }
            // Its size in portrait, as a phone's home screen is: the launcher's narrowest width and tallest height
            // (in landscape it's the other way round).
            val size = mgr.getAppWidgetOptions(id)
            val full = GymWidgetLogic.showsShortcuts(size.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0), size.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0))
            val views = RemoteViews(context.packageName, if (full) R.layout.widget_gymlog else R.layout.widget_gymlog_small)
            views.setTextViewText(R.id.widgetTitle, text.title)
            views.setTextViewText(R.id.widgetSubtitle, text.subtitle)
            views.setOnClickPendingIntent(R.id.widgetRoot, goIntent(context, "today", 0))
            if (full) {
                views.setOnClickPendingIntent(R.id.widgetWeight, goIntent(context, "weight", 1))
                views.setOnClickPendingIntent(R.id.widgetSteps, goIntent(context, "steps", 2))
            }
            mgr.updateAppWidget(id, views)
        }

        private fun goIntent(context: Context, target: String, requestCode: Int): PendingIntent {
            val scheme = context.getString(R.string.custom_url_scheme)
            // Explicit, so no other app that claims the same scheme can take the tap or raise a chooser.
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://go/$target"), context, MainActivity::class.java)
            return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}
