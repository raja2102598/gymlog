package io.github.raja2102598.gymlog.wear

import java.time.Instant
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reading /gymlog/state (docs/watch.md) and choosing the day to show from it. Pure, for StateLogicTest: WatchRepo does
 * the Data Layer and the files.
 */
object StateLogic {
    /** The shape of state this build reads. A newer phone's `v` asks for a newer watch app. */
    const val VERSION = 1

    /** What a /gymlog/state payload turned out to be. */
    sealed interface Parsed {
        data class Ok(val state: WatchState) : Parsed

        /** A shape from a newer phone app than this watch app knows. */
        data object Newer : Parsed

        /** Not this JSON at all. */
        data object Broken : Parsed
    }

    /** Never throws: a field missing or of the wrong kind takes its default, and a day or lift that can't be read is
     *  left out, so one odd value doesn't cost the whole workout. */
    fun parse(json: String?): Parsed {
        if (json.isNullOrBlank()) return Parsed.Broken
        val o = try {
            JSONObject(json)
        } catch (e: Exception) {
            return Parsed.Broken
        }
        val v = o.optInt("v", 0)
        if (v > VERSION) return Parsed.Newer
        if (v < 1) return Parsed.Broken
        return Parsed.Ok(
            WatchState(
                sentAt = o.optLong("sentAt", 0L),
                signedIn = o.optBoolean("signedIn", false),
                applied = strings(o.optJSONArray("applied")).toSet(),
                run = o.optJSONObject("run")?.let(::run),
                rest = o.optJSONObject("rest")?.let(::rest),
                days = objects(o.optJSONArray("days")).mapNotNull(::day),
                account = o.str("account")?.takeIf { it.isNotEmpty() },
            ),
        )
    }

    private fun run(o: JSONObject): Run? {
        val day = o.str("day") ?: return null
        val startedAt = o.long("startedAt") ?: return null
        return Run(day, startedAt, o.long("pausedAt"), o.long("pausedMs") ?: 0L, o.long("endedAt"))
    }

    private fun rest(o: JSONObject): Rest? {
        val endAt = o.long("endAt") ?: return null
        return Rest(o.str("day") ?: "", o.str("lift") ?: "", endAt, o.long("pausedAt"), o.int("sec"), o.long("startedAt"))
    }

    private fun day(o: JSONObject): Day? {
        val date = o.str("date") ?: return null
        val blocks = arrays(o.optJSONArray("blocks")).map { objects(it).mapNotNull(::lift) }.filter { it.isNotEmpty() }
        return Day(
            date = date,
            title = o.str("title") ?: "",
            skipped = o.optBoolean("skipped", false),
            cardio = o.str("cardio")?.trim()?.takeIf { it.isNotEmpty() },
            cardioDone = o.optBoolean("cardioDone", false),
            blocks = blocks,
        )
    }

    private fun lift(o: JSONObject): Lift? {
        val key = o.str("key") ?: return null
        return Lift(
            key = key,
            name = o.str("name")?.takeIf { it.isNotBlank() } ?: key,
            done = o.optBoolean("done", false),
            skipped = o.optBoolean("skipped", false),
            restSec = (o.int("restSec") ?: 0).coerceAtLeast(0),
            // The phone's own default step (LiftItem.tsx's liftModel) when it can't say.
            inc = o.double("inc")?.takeIf { it > 0 } ?: 2.5,
            cue = o.str("cue") ?: "",
            rows = objects(o.optJSONArray("rows")).map {
                SetRow(it.int("reps"), it.double("kg"), it.str("type"), it.int("sugReps"), it.double("sugKg"))
            },
        )
    }

    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else opt(k) as? String

    private fun JSONObject.double(k: String): Double? = if (isNull(k)) null else optDouble(k).takeIf { it.isFinite() }

    private fun JSONObject.long(k: String): Long? = double(k)?.let { Math.round(it) }

    private fun JSONObject.int(k: String): Int? = long(k)?.toInt()

    private fun strings(a: JSONArray?): List<String> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.opt(it) as? String }

    private fun objects(a: JSONArray?): List<JSONObject> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }

    private fun arrays(a: JSONArray?): List<JSONArray> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONArray(it) }

    /** A moment's date on the watch's own clock, as the phone writes a day's: "2026-09-29". */
    fun dateOf(epochMs: Long, zone: ZoneId): String = Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate().toString()

    /**
     * The day the watch shows: the workout under way's while it is (one started at 23:40 stays on screen past
     * midnight, as the phone's lock screen and widget follow it), else the one for the watch's own date, `today`.
     * Null when the phone sent neither: it hasn't been opened for a week, say.
     */
    fun dayFor(state: WatchState, today: String, now: Long): Day? {
        val r = state.run
        if (r != null && TimerLogic.underWay(r, now)) state.days.firstOrNull { it.date == r.day }?.let { return it }
        return state.days.firstOrNull { it.date == today }
    }

    /** What the watch says instead of a workout, or null when it has one to show. */
    fun blank(parsed: Parsed?, day: Day?): String? =
        when {
            parsed is Parsed.Newer -> "Update Gym Log on your watch"
            parsed !is Parsed.Ok -> OPEN_PHONE
            !parsed.state.signedIn -> "Sign in on your phone"
            day == null -> OPEN_PHONE
            else -> null
        }

    const val OPEN_PHONE = "Open Gym Log on your phone"
}
