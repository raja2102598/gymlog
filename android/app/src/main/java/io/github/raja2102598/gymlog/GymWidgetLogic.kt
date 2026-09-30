package io.github.raja2102598.gymlog

import org.json.JSONObject

/**
 * The home-screen widget's data (src/native/widget.ts writes it, GymWidgetProvider shows it): parsing the JSON,
 * whether it's still one to show so stale data never shows as today's, and the words on screen. Pure, for
 * GymWidgetLogicTest (like HealthDays.kt and AppUpdateLogic.kt).
 */
object GymWidgetLogic {
    /** A day's session (src/lib/store.ts's planFor): today's, or while a workout is under way that workout's day,
     *  which can be one gone by. Lifts done out of planned counted the way Today counts a lift done
     *  (SessionCard.tsx's LiftPill), when a running rest timer ends (an ISO instant), or null, whether the day's
     *  workout was skipped (false when the snapshot doesn't say, as an older build's doesn't), and when the workout
     *  under way would have started with no pauses (an ISO instant), or null. */
    data class Snapshot(
        val date: String,
        val session: String,
        val done: Int,
        val planned: Int,
        val restEndsAt: String?,
        val skipped: Boolean = false,
        val workoutSince: String? = null,
    )

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
                workoutSince = if (!o.has("workoutSince") || o.isNull("workoutSince")) null else o.getString("workoutSince"),
            )
        } catch (e: Exception) {
            null
        }
    }

    fun toJson(date: String, session: String, done: Int, planned: Int, restEndsAt: String?, skipped: Boolean = false, workoutSince: String? = null): String =
        JSONObject()
            .put("date", date)
            .put("session", session)
            .put("done", done)
            .put("planned", planned)
            .put("restEndsAt", restEndsAt ?: JSONObject.NULL)
            .put("skipped", skipped)
            .put("workoutSince", workoutSince ?: JSONObject.NULL)
            .toString()

    /** Whether a snapshot is still one to show, by the phone's own clock now, not whenever it was written: today's, or
     *  another day's whose workout is still under way. The app writes the workout's own day while one is under way
     *  (src/native/widget.ts), so one started at 23:40 keeps its session, progress and clock past midnight, as does
     *  one opened for a day gone by. When it stops counting needs nothing more from the app, which may not be running
     *  by then: it's workoutSince plus STALE_WORKOUT_MS, when the app too would count it as left behind, and
     *  nextChangeMs draws the widget again at that moment. Otherwise, once a day has passed, its lift counts belong
     *  to a session that no longer exists on screen. */
    fun isCurrent(s: Snapshot, today: String, nowMs: Long): Boolean = s.date == today || workoutSinceMs(s, nowMs) != null

    data class Display(val title: String, val subtitle: String)

    /** What the widget says: the session and its progress, worded the same as Today's own lift count ("3/5
     *  lifts", "Rest day", "Skipped"), or a neutral invitation once the data is missing or no longer current
     *  (isCurrent). A rest or a workout under way shows in the clock beside it (clock, below). */
    fun display(s: Snapshot?, today: String, nowMs: Long): Display {
        if (s == null || !isCurrent(s, today, nowMs)) return Display("Gym Log", "Open Gym Log")
        return Display(s.session, if (s.planned <= 0) "Rest day" else if (s.skipped) "Skipped" else "${s.done}/${s.planned} lifts")
    }

    /** How long a workout clock runs before the app counts it as left behind (src/lib/workout.ts's STALE_RUN_MS). */
    const val STALE_WORKOUT_MS = 3 * 60 * 60 * 1000L

    /** The widget's clock, which ticks on its own (a Chronometer): counting down to `atMs` for a rest (`rest`), or up
     *  from it for a workout under way. */
    data class Clock(val rest: Boolean, val atMs: Long)

    /** A rest timer still running at `nowMs` counts down; otherwise a workout under way, and not yet left behind,
     *  counts up. Null for neither, or for data that's no longer current (isCurrent). */
    fun clock(s: Snapshot?, today: String, nowMs: Long): Clock? {
        if (s == null || !isCurrent(s, today, nowMs)) return null
        val ends = restEndMs(s)
        if (ends != null && ends > nowMs) return Clock(rest = true, atMs = ends)
        val since = workoutSinceMs(s, nowMs) ?: return null
        return Clock(rest = false, atMs = since)
    }

    /** workoutSince in epoch ms while that workout is under way at `nowMs`: started, and not yet left behind. Null
     *  otherwise, or when there's none or it can't be read. The one rule for both isCurrent and the clock, so another
     *  day's session only ever shows while its workout is still counting. */
    private fun workoutSinceMs(s: Snapshot, nowMs: Long): Long? =
        instantMs(s.workoutSince)?.takeIf { it <= nowMs && nowMs - it < STALE_WORKOUT_MS }

    /** When the widget has to be drawn again for its clock to stay right, since a Chronometer never stops by itself:
     *  when the rest ends (on to the workout's clock, or none), or when the workout would count as left behind,
     *  whichever comes first: another day's snapshot stops being current then, even mid-rest (isCurrent). Null when
     *  the clock shows nothing. */
    fun nextChangeMs(s: Snapshot?, today: String, nowMs: Long): Long? {
        val c = clock(s, today, nowMs) ?: return null
        if (!c.rest) return c.atMs + STALE_WORKOUT_MS
        val leftBehind = s?.let { workoutSinceMs(it, nowMs) }?.plus(STALE_WORKOUT_MS)
        return if (leftBehind != null && leftBehind < c.atMs) leftBehind else c.atMs
    }

    /** restEndsAt in epoch ms, or null when there's none or it can't be read. */
    fun restEndMs(s: Snapshot): Long? = instantMs(s.restEndsAt)

    private fun instantMs(iso: String?): Long? = iso?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }

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
