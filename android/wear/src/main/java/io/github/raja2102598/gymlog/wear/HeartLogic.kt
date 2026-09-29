package io.github.raja2102598.gymlog.wear

import kotlin.math.max
import org.json.JSONArray
import org.json.JSONObject

/** One heart-rate reading from the watch's sensor: beats a minute, and when it was taken (epoch ms). */
data class Beat(val bpm: Double, val at: Long)

/**
 * A day's heart rate during its workout, as the watch keeps it (docs/watch.md): the readings counted so far, as their
 * sum and how many there were, the highest, and when the latest was taken. `sentSamples` and `sentAt` are how many
 * readings the last `hr` sent to the phone covered, and when it went (or, before the first, when the day's count
 * began), so the next goes only when there's more to say.
 */
data class Heart(
    val day: String,
    val sum: Double,
    val samples: Int,
    val max: Int,
    val sentSamples: Int = 0,
    val sentAt: Long = 0L,
    val lastAt: Long = 0L,
)

/**
 * The workout's heart rate: which readings count, their average and highest, when the day's total goes to the phone,
 * and the reading the screens show. Pure, for HeartLogicTest; HeartMonitor takes the readings from Health Services
 * and keeps the days in a file.
 */
object HeartLogic {
    /** Readings outside this range are the sensor's noise (loose on the wrist, say), not a heart rate. */
    const val MIN_BPM = 30.0
    const val MAX_BPM = 240.0

    /** How often the day's heart rate goes to the phone during the workout, so the watch being reset or lost before
     *  Finish costs a few minutes of it at most. */
    const val SEND_EVERY_MS = 5 * 60_000L

    /** How long the latest reading stays on screen: older, the sensor has lost the wrist, and an old number would
     *  pass for a new one. */
    const val FRESH_MS = 30_000L

    /** The days kept on the watch, the latest: a week of workouts. */
    const val KEEP_DAYS = 7

    /** Whether a reading taken at `at` belongs to the workout: from its start, until it finished, and not once its clock
     *  was paused. (A pause resumed since is only known as a total, so readings from it that arrive late still count;
     *  the sensor's readings come within seconds while the screen is on.) */
    fun counts(run: Run, at: Long): Boolean =
        at >= run.startedAt && (run.pausedAt == null || at < run.pausedAt) && (run.endedAt == null || at <= run.endedAt)

    /** The day's heart rate with `beats` added: those in range, taken during `run`, and after the latest counted
     *  (Health Services hands its last readings over again when the app sets its callback anew, after Android stopped
     *  it, say). A day with none yet starts afresh, its time for sending counted from `now`. */
    fun add(h: Heart?, run: Run, beats: List<Beat>, now: Long): Heart {
        val day = h?.takeIf { it.day == run.day } ?: Heart(run.day, 0.0, 0, 0, sentAt = now)
        val good = beats.filter { it.bpm in MIN_BPM..MAX_BPM && counts(run, it.at) && it.at > day.lastAt }
        if (good.isEmpty()) return day
        return day.copy(
            sum = day.sum + good.sumOf { it.bpm },
            samples = day.samples + good.size,
            max = max(day.max, good.maxOf { Math.round(it.bpm).toInt() }),
            lastAt = good.maxOf { it.at },
        )
    }

    /** The average over every reading counted, to the nearest beat (0 with none). */
    fun avg(h: Heart): Int = if (h.samples == 0) 0 else Math.round(h.sum / h.samples).toInt()

    /** Whether to send the day's heart rate now: only with readings the phone hasn't had, and then at the workout's
     *  end (Finish, or left behind), or every SEND_EVERY_MS during it. */
    fun due(h: Heart?, now: Long, ending: Boolean): Boolean =
        h != null && h.samples > h.sentSamples && (ending || now - h.sentAt >= SEND_EVERY_MS)

    /** The day as sent at `now`: the next goes SEND_EVERY_MS on, or at the end, and only with more readings. */
    fun sent(h: Heart, now: Long): Heart = h.copy(sentSamples = h.samples, sentAt = now)

    /** The `hr` command for the day as it stands (OverlayLogic.heart). */
    fun command(id: String, at: Long, h: Heart): Command = OverlayLogic.heart(id, at, h.day, avg(h), h.max, h.samples)

    /** The heart rate to show now, in whole beats: the latest reading while it's fresh and in range, else null. */
    fun showing(b: Beat?, now: Long): Int? =
        b?.takeIf { now - it.at < FRESH_MS && it.bpm in MIN_BPM..MAX_BPM }?.let { Math.round(it.bpm).toInt() }

    /** The latest KEEP_DAYS days, the rest dropped. */
    fun keep(days: Map<String, Heart>): Map<String, Heart> =
        days.entries.sortedByDescending { it.key }.take(KEEP_DAYS).associate { it.key to it.value }

    fun toJson(days: Map<String, Heart>): String =
        JSONArray(
            days.values.map {
                JSONObject().put("day", it.day).put("sum", it.sum).put("samples", it.samples).put("max", it.max)
                    .put("sentSamples", it.sentSamples).put("sentAt", it.sentAt).put("lastAt", it.lastAt)
            },
        ).toString()

    /** The days as kept (toJson), or none for anything unreadable. */
    fun fromJson(json: String?): Map<String, Heart> {
        if (json.isNullOrBlank()) return emptyMap()
        return try {
            val a = JSONArray(json)
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.mapNotNull { o ->
                val day = o.optString("day").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                day to Heart(day, o.optDouble("sum", 0.0), o.optInt("samples"), o.optInt("max"), o.optInt("sentSamples"), o.optLong("sentAt"), o.optLong("lastAt"))
            }.toMap()
        } catch (e: Exception) {
            emptyMap()
        }
    }
}
