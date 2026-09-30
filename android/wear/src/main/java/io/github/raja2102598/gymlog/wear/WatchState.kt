package io.github.raja2102598.gymlog.wear

/*
 * What the phone sends the watch on /gymlog/state (docs/watch.md), as the watch holds it. The phone works all of it out
 * with its own rules (src/native/watch.ts), so these are plain values: the watch only moves through them, and shows
 * its own commands on top until the phone has them (OverlayLogic).
 */

/** One working set's row, as the phone's set table shows it: what's logged (null for nothing yet), its kind (null for
 *  a straight set), and what the phone shows greyed in an empty row, which is also what its Complete set logs. */
data class SetRow(
    val reps: Int?,
    val kg: Double?,
    val type: String? = null,
    val sugReps: Int? = null,
    val sugKg: Double? = null,
)

/** A lift on a day. `key` is the day's name for it, which commands use; `name` is what it's done as (a swap's own
 *  name), which the watch shows and a rest is named after. `inc` is one bezel click of weight, kg. */
data class Lift(
    val key: String,
    val name: String,
    val done: Boolean,
    val skipped: Boolean,
    val restSec: Int,
    val inc: Double,
    val cue: String,
    val rows: List<SetRow>,
)

/** A day's workout: its steps in order (`blocks`, each one lift or a superset's lifts), then its cardio, if any. */
data class Day(
    val date: String,
    val title: String,
    val skipped: Boolean,
    val cardio: String?,
    val cardioDone: Boolean,
    val blocks: List<List<Lift>>,
)

/** The workout clock (the phone's lib/workout.ts WorkoutRun). Times are epoch ms. `pauses` are those resumed so far,
 *  which the heart rate's readings are kept out of (HeartLogic.counts). */
data class Run(
    val day: String,
    val startedAt: Long,
    val pausedAt: Long? = null,
    val pausedMs: Long = 0,
    val endedAt: Long? = null,
    val pauses: List<Pause> = emptyList(),
)

/** A pause of the workout clock, resumed: from when to when, epoch ms. */
data class Pause(val from: Long, val to: Long)

/** The rest timer (the phone's store.rest). `sec` is its full length, when the phone knows it. `startedAt` tells it
 *  from the next rest, which the rest buttons' commands name it by (null for a timer the phone kept from before). */
data class Rest(
    val day: String,
    val lift: String,
    val endAt: Long,
    val pausedAt: Long? = null,
    val sec: Int? = null,
    val startedAt: Long? = null,
)

/** The whole of /gymlog/state. `applied` holds the ids of the watch's commands the phone has applied. `account` is the
 *  account signed in on the phone (null: none), which every command made on it carries. `restChangedAt` is when the
 *  rest timer last changed (started, paused, resumed, made longer, skipped, ended by Finish), or null: a rest button or
 *  set done before then doesn't touch the rest. */
data class WatchState(
    val sentAt: Long,
    val signedIn: Boolean,
    val applied: Set<String>,
    val run: Run?,
    val rest: Rest?,
    val days: List<Day>,
    val account: String? = null,
    val restChangedAt: Long? = null,
)
