package io.github.raja2102598.gymlog

import org.json.JSONObject

/**
 * The home-screen widget's data (src/native/widget.ts writes it, GymWidgetProvider shows it): parsing the JSON,
 * whether it's still today's so stale data never shows as today's, and the words on screen. Pure, for
 * GymWidgetLogicTest (like HealthDays.kt and AppUpdateLogic.kt).
 */
object GymWidgetLogic {
    /** Today's session (src/lib/store.ts's planFor), lifts done out of planned counted the way Today counts a
     *  lift done (SessionCard.tsx's LiftPill), when a running rest timer ends (an ISO instant), or null, and whether
     *  the day's workout was skipped (false when the snapshot doesn't say, as an older build's doesn't). */
    data class Snapshot(val date: String, val session: String, val done: Int, val planned: Int, val restEndsAt: String?, val skipped: Boolean = false)

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
                skipped = o.optBoolean("skipped", false),
            )
        } catch (e: Exception) {
            null
        }
    }

    fun toJson(date: String, session: String, done: Int, planned: Int, restEndsAt: String?, skipped: Boolean = false): String =
        JSONObject()
            .put("date", date)
            .put("session", session)
            .put("done", done)
            .put("planned", planned)
            .put("restEndsAt", restEndsAt ?: JSONObject.NULL)
            .put("skipped", skipped)
            .toString()

    /** Whether a snapshot is still today's, by the phone's own clock now, not whenever it was written: once a
     *  day has passed, its lift counts belong to a session that no longer exists on screen. */
    fun isCurrent(s: Snapshot, today: String): Boolean = s.date == today

    data class Display(val title: String, val subtitle: String)

    /** What the widget says: the session and its progress, worded the same as Today's own lift count ("3/5
     *  lifts", "Rest day", "Skipped"), or a neutral invitation once the data is missing or from a day that's passed. While a
     *  rest timer is still running at `nowMs`, the progress adds when it ends ("3/5 lifts · rest until 10:32",
     *  the time as `clock` writes it), since a widget can't count down every second. */
    fun display(s: Snapshot?, today: String, nowMs: Long = Long.MAX_VALUE, clock: (Long) -> String = { "" }): Display {
        if (s == null || !isCurrent(s, today)) return Display("Gym Log", "Open Gym Log")
        val progress = if (s.planned <= 0) "Rest day" else if (s.skipped) "Skipped" else "${s.done}/${s.planned} lifts"
        val ends = restEndMs(s)
        return Display(s.session, if (ends != null && ends > nowMs) "$progress · rest until ${clock(ends)}" else progress)
    }

    /** restEndsAt in epoch ms, or null when there's none or it can't be read. */
    fun restEndMs(s: Snapshot): Long? = s.restEndsAt?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }

    /** A widget narrower than this can't fit the Log weight and Log steps buttons next to the session card. */
    private const val MIN_WIDTH_FOR_SHORTCUTS_DP = 180

    /** Nor one shorter than this, the size the full layout is made for (gym_widget_info.xml's minHeight): the two
     *  lines, and the 44dp buttons under them. */
    private const val MIN_HEIGHT_FOR_SHORTCUTS_DP = 110

    /** Whether the full layout fits a widget `widthDp` wide and `heightDp` tall. A launcher that doesn't say how tall
     *  (0) leaves it to the width alone. */
    fun showsShortcuts(widthDp: Int, heightDp: Int = 0): Boolean =
        widthDp >= MIN_WIDTH_FOR_SHORTCUTS_DP && (heightDp <= 0 || heightDp >= MIN_HEIGHT_FOR_SHORTCUTS_DP)
}
