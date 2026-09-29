package io.github.raja2102598.gymlog.wear

/** Small builders for the watch's tests: a day's lifts and a state around them, with the defaults the phone sends. */
object Fixtures {
    const val TODAY = "2026-09-29"

    /** A lift whose rows have these reps (null: not logged yet), each at 100 kg once logged, suggesting 12 × 100. */
    fun lift(key: String, vararg reps: Int?, restSec: Int = 90, name: String = key, skipped: Boolean = false, done: Boolean = false, inc: Double = 2.5) =
        Lift(
            key = key,
            name = name,
            done = done,
            skipped = skipped,
            restSec = restSec,
            inc = inc,
            cue = "",
            rows = reps.map { SetRow(it, if (it == null) null else 100.0, null, 12, 100.0) },
        )

    fun day(vararg blocks: List<Lift>, date: String = TODAY, cardio: String? = null, cardioDone: Boolean = false) =
        Day(date = date, title = "Legs", skipped = false, cardio = cardio, cardioDone = cardioDone, blocks = blocks.toList())

    fun state(vararg days: Day, run: Run? = null, rest: Rest? = null, applied: Set<String> = emptySet()) =
        WatchState(sentAt = 1_000L, signedIn = true, applied = applied, run = run, rest = rest, days = days.toList())

    /** The one lift `key` on `date` in a state. */
    fun liftIn(s: WatchState, key: String, date: String = TODAY): Lift =
        s.days.first { it.date == date }.blocks.flatten().first { it.key == key }
}
