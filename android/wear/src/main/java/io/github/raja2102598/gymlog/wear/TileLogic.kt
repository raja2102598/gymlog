package io.github.raja2102598.gymlog.wear

import java.time.Instant
import java.time.ZoneId

/**
 * What the tile says (GymTileService): during a workout, its session, the clock or the rest counting down, and the next
 * set; otherwise today's session and Start. Pure, for TileLogicTest: the tile itself makes the clock and the countdown
 * tick on the watch's own (ProtoLayout's dynamic time), from the times here, with these words for when it can't.
 */
object TileLogic {
    /** How often the tile is looked at again during a workout, for one left behind: the clock ticks by itself. */
    const val LIVE_FRESH_MS = 5 * 60_000L

    /** Otherwise, and when the day turns, for the next day's session. */
    const val IDLE_FRESH_MS = 30 * 60_000L

    sealed interface Face

    /** No workout under way: a heading, today's session (or why there's none), a line about it, and the button's word. */
    data class Idle(val heading: String, val title: String, val line: String, val button: String) : Face

    /**
     * The workout under way: its session, its clock, the rest when there is one (counting down, or paused), and the next
     * set. The button carries on with it.
     */
    data class Live(val title: String, val run: Run, val rest: Rest?, val next: String) : Face {
        val button: String get() = "Continue"
    }

    /** The tile for the phone's state as the watch has it, on the watch's own date `today`. */
    fun face(parsed: StateLogic.Parsed?, state: WatchState?, today: String, now: Long): Face {
        val live = StepLogic.live(state, now)
        if (state != null && live != null) {
            val day = state.days.firstOrNull { it.date == live.run.day }
            // A rest of this workout's, not over: a paused one stays as it was.
            val rest = state.rest?.takeIf { it.day == live.run.day && (it.pausedAt != null || it.endAt > now) }
            return Live(live.title, live.run, rest, day?.let { next(it, rest) } ?: "")
        }
        val day = state?.let { StateLogic.dayFor(it, today, now) }
        val blank = StateLogic.blank(parsed, day)
        if (blank != null || day == null) return Idle("Gym Log", "", blank ?: StateLogic.OPEN_PHONE, "Open")
        val steps = StepLogic.steps(day)
        val title = day.title.ifBlank { "Workout" }
        return when {
            steps == 0 -> Idle("Today", "Rest day", "Recover today. A walk counts.", "Open")
            day.skipped -> Idle("Today", title, "Skipped today", "Open")
            StepLogic.sessionDone(day) && (day.cardio == null || day.cardioDone) -> Idle("Today", title, "Workout complete", "Review")
            else -> Idle("Today", title, progress(day), "Start")
        }
    }

    /** How far today's session has got, before its clock starts: "5 exercises", "2 of 5 exercises done", or its cardio
     *  alone. A superset is one exercise, and a skipped lift counts as done, as on the phone's lock screen. */
    fun progress(day: Day): String {
        val n = day.blocks.size
        if (n == 0) return day.cardio.orEmpty()
        val done = day.blocks.count(StepLogic::blockDone)
        val exercises = "exercise${if (n == 1) "" else "s"}"
        return if (done == 0) "$n $exercises" else "$done of $n $exercises done"
    }

    /**
     * The next set, as "Leg Press · Set 3 of 4 · 100 kg × 12": the rested lift's next set while its step has one (what
     * "Rest over" names), else the first step not finished; its cardio after the lifts; and once everything's done,
     * that.
     */
    fun next(day: Day, rest: Rest?): String {
        val rested = rest?.let { r -> day.blocks.indexOfFirst { b -> b.any { it.name == r.lift } } } ?: -1
        val at = if (rested >= 0 && StepLogic.setOn(day.blocks[rested]) != null) rested else StepLogic.firstOpen(day)
        val block = day.blocks.getOrNull(at)
        val on = block?.let(StepLogic::setOn)
        if (block != null && on != null) {
            val (n, j) = on
            val lift = block[n]
            val set = setWords(StepLogic.startKg(lift, j), StepLogic.startReps(lift, j))
            return listOf(lift.name, StepLogic.setLine(day, at, n, j), set).filter { it.isNotEmpty() }.joinToString(" · ")
        }
        if (day.cardio != null && !day.cardioDone) return day.cardio
        return "Every set done"
    }

    /** What a set is to be done with, weight first: "100 kg × 12", "12 reps" with no weight, "" with nothing. */
    fun setWords(kg: Double?, reps: Int?): String =
        when {
            kg != null && reps != null -> "${BezelLogic.kgText(kg)} kg × $reps"
            reps != null -> "$reps reps"
            kg != null -> "${BezelLogic.kgText(kg)} kg"
            else -> ""
        }

    /** The rest counting down, not paused. */
    fun resting(face: Live, now: Long): Boolean = face.rest != null && face.rest.pausedAt == null && face.rest.endAt > now

    /** The small word over the time: whose time it is. */
    fun label(face: Live, now: Long): String =
        when {
            face.rest != null && face.rest.pausedAt != null -> "Rest paused"
            resting(face, now) -> "Rest"
            face.run.pausedAt != null -> "Paused"
            else -> "Workout"
        }

    /** The time as it is at `now`: the rest's time left while there's a rest, else the workout's clock. The tile shows
     *  these where it can't tick by itself, and as it was when paused. */
    fun time(face: Live, now: Long): String =
        if (face.rest != null) TimerLogic.mmss(TimerLogic.restLeftSec(face.rest, now)) else TimerLogic.clock(TimerLogic.runSec(face.run, now))

    /** How long the tile holds before it's asked for again: a few minutes during a workout, else half an hour, or
     *  until just past midnight if that comes first, for the next day's session. */
    fun freshMs(face: Face, now: Long, zone: ZoneId): Long {
        if (face is Live) return LIVE_FRESH_MS
        val midnight = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        return minOf(IDLE_FRESH_MS, midnight - now + 60_000L)
    }
}
