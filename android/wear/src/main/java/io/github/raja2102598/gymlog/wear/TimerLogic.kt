package io.github.raja2102598.gymlog.wear

import kotlin.math.max

/**
 * The workout clock and the rest timer, done the phone's way (src/lib/workout.ts and store.ts's rest timer) so both
 * screens always read the same, and so a command done on the watch lands where the phone will put it. Pure, for
 * TimerLogicTest.
 */
object TimerLogic {
    /** A clock left running this long was left behind (the phone's STALE_RUN_MS): no longer the workout under way. */
    const val LEFT_BEHIND_MS = 3 * 60 * 60 * 1000L

    /** How long a workout has lasted, ms, to its end or to `now`, less the time it was paused (still paused: up to
     *  then). */
    fun runMs(r: Run, now: Long): Long {
        val end = r.endedAt ?: now
        val paused = r.pausedMs + (r.pausedAt?.let { max(0L, end - it) } ?: 0L)
        return max(0L, end - r.startedAt - paused)
    }

    /** Seconds it has lasted, rounded as the phone rounds them (runSeconds). */
    fun runSec(r: Run, now: Long): Long = Math.round(runMs(r, now) / 1000.0)

    /** Left running for hours: closed without Finish, then opened another day. A paused clock was stopped on purpose,
     *  so it waits. */
    fun leftBehind(r: Run, now: Long): Boolean = r.endedAt == null && r.pausedAt == null && runMs(r, now) >= LEFT_BEHIND_MS

    /** The workout under way: started, not finished, and not left behind. A paused one still is. */
    fun underWay(r: Run?, now: Long): Boolean = r != null && r.endedAt == null && !leftBehind(r, now)

    /** Stops the clock where it is. Nothing for a finished or already paused one. */
    fun pauseRun(r: Run, at: Long): Run = if (r.endedAt != null || r.pausedAt != null) r else r.copy(pausedAt = at)

    /** Starts a paused clock again from where it stopped: the time it was paused doesn't count. */
    fun resumeRun(r: Run, at: Long): Run {
        val p = r.pausedAt ?: return r
        if (r.endedAt != null) return r
        return r.copy(pausedAt = null, pausedMs = r.pausedMs + max(0L, at - p))
    }

    /** Finish: the duration stops there, and stays put if it had already. */
    fun endRun(r: Run, at: Long): Run = r.copy(endedAt = r.endedAt ?: at)

    /** Ms left, counted from `endAt` so it can't drift: 0 once it's reached zero, whether running or paused. */
    fun restLeftMs(r: Rest, now: Long): Long = max(0L, r.endAt - (r.pausedAt ?: now))

    /** Seconds left, rounded as the phone rounds them (store.ts, restRemaining). */
    fun restLeftSec(r: Rest, now: Long): Long = Math.round(restLeftMs(r, now) / 1000.0)

    /** Over: counting, and at zero. A paused rest is never over. */
    fun restOver(r: Rest, now: Long): Boolean = r.pausedAt == null && now >= r.endAt

    /** How much of the rest is left, 1 to 0, for its ring: out of its full length, or of what's left when +15 s took
     *  it past that. `fallbackSec` is the lift's own rest, for a timer that came without its length. */
    fun restFraction(r: Rest, now: Long, fallbackSec: Int): Float {
        if (restOver(r, now)) return 0f
        val left = restLeftMs(r, now)
        val len = (r.sec ?: fallbackSec) * 1000L
        return (left.toDouble() / max(max(len, left), 1000L)).toFloat().coerceIn(0f, 1f)
    }

    /** +15 s (or any amount): pushes the end out, whether running or paused. One already over counts that much down
     *  again, from `at`. */
    fun addRest(r: Rest, sec: Int, at: Long): Rest =
        r.copy(endAt = (if (r.pausedAt == null) max(r.endAt, at) else r.endAt) + sec * 1000L)

    fun pauseRest(r: Rest, at: Long): Rest = if (r.pausedAt != null) r else r.copy(pausedAt = at)

    /** What was left when it paused, from `at`. */
    fun resumeRest(r: Rest, at: Long): Rest {
        val p = r.pausedAt ?: return r
        return r.copy(endAt = at + (r.endAt - p), pausedAt = null)
    }

    /** Whether an alarm set for a rest ending at `endAt` is still for the rest there is now: nothing skipped, paused
     *  or moved it since (a second's leeway for rounding on the way). */
    fun alarmStillDue(r: Rest?, endAt: Long): Boolean = r != null && r.pausedAt == null && kotlin.math.abs(r.endAt - endAt) < 1000L

    /** "18:42", or "1:05:10" past an hour: the workout clock, as the phone's top bar shows it. */
    fun clock(sec: Long): String {
        val s = max(0L, sec)
        val h = s / 3600
        val m = (s % 3600) / 60
        val mm = if (h > 0) m.toString().padStart(2, '0') else m.toString()
        return (if (h > 0) "$h:" else "") + mm + ":" + (s % 60).toString().padStart(2, '0')
    }

    /** "1:30": a rest's time, as the phone's rest card shows it. */
    fun mmss(sec: Long): String {
        val s = max(0L, sec)
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }
}
