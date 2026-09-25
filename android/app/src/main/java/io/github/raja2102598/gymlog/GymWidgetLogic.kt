package io.github.raja2102598.gymlog

import org.json.JSONObject

/**
 * The home-screen widget's data (src/native/widget.ts writes it, GymWidgetProvider shows it): parsing the JSON,
 * whether it's still today's so stale data never shows as today's, and the words on screen. Pure, for
 * GymWidgetLogicTest (like HealthDays.kt and AppUpdateLogic.kt).
 */
object GymWidgetLogic {
    /** Today's session (src/lib/store.ts's planFor), lifts done out of planned counted the way Today counts a
     *  lift done (SessionCard.tsx's LiftPill), and restEndsAt for the rest timer: a later issue, always null
     *  until it exists, kept here now so the JSON won't need to change shape when it does. */
    data class Snapshot(val date: String, val session: String, val done: Int, val planned: Int, val restEndsAt: String?)

    /** Null for anything that isn't this JSON: missing at all, unparsable, or short a required field. */
    fun parse(json: String?): Snapshot? {
        if (json.isNullOrEmpty()) return null
        return try {
            val o = JSONObject(json)
            Snapshot(
                date = o.getString("date"),
                session = o.getString("session"),
                done = o.getInt("done"),
                planned = o.getInt("planned"),
                restEndsAt = if (o.isNull("restEndsAt")) null else o.getString("restEndsAt"),
            )
        } catch (e: Exception) {
            null
        }
    }

    fun toJson(date: String, session: String, done: Int, planned: Int, restEndsAt: String?): String =
        JSONObject()
            .put("date", date)
            .put("session", session)
            .put("done", done)
            .put("planned", planned)
            .put("restEndsAt", restEndsAt ?: JSONObject.NULL)
            .toString()

    /** Whether a snapshot is still today's, by the phone's own clock now, not whenever it was written: once a
     *  day has passed, its lift counts belong to a session that no longer exists on screen. */
    fun isCurrent(s: Snapshot, today: String): Boolean = s.date == today

    data class Display(val title: String, val subtitle: String)

    /** What the widget says: the session and its progress, worded the same as Today's own lift count ("3/5
     *  lifts", "Rest day"), or a neutral invitation once the data is missing or from a day that's passed. */
    fun display(s: Snapshot?, today: String): Display {
        if (s == null || !isCurrent(s, today)) return Display("Gym Log", "Open Gym Log")
        val progress = if (s.planned <= 0) "Rest day" else "${s.done}/${s.planned} lifts"
        return Display(s.session, progress)
    }

    /** A widget narrower than this can't fit the Log weight and Log steps buttons next to the session card. */
    private const val MIN_WIDTH_FOR_SHORTCUTS_DP = 180

    fun showsShortcuts(minWidthDp: Int): Boolean = minWidthDp >= MIN_WIDTH_FOR_SHORTCUTS_DP
}
