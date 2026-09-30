package io.github.raja2102598.gymlog.wear

/**
 * Moving through a day's workout the way the phone's workout screen does (src/components/workout/WorkoutView.tsx): its
 * steps (each lift or superset, then the day's cardio), the set each is on, what the big button says and does, and
 * what comes next. Pure, for StepLogicTest.
 */
object StepLogic {
    /** A set counts as logged once it has reps. */
    fun logged(r: SetRow): Boolean = (r.reps ?: 0) > 0

    /** The set a lift is on: the first working set with no reps yet (LiftItem.tsx, nextSet), or -1 once they all have
     *  them or the lift is skipped. */
    fun nextSet(l: Lift): Int = if (l.skipped) -1 else l.rows.indexOfFirst { !logged(it) }

    /** A superset's rounds: its longest lift's sets. A skipped lift drops out. */
    fun rounds(block: List<Lift>): Int = block.filter { !it.skipped }.maxOfOrNull { it.rows.size } ?: 0

    /** The set a superset is on, as (lift, set): round by round, A1's set 1 then A2's, then round 2 (SupersetItem.tsx,
     *  nextInRounds). A skipped lift drops out, and one with more sets than the others fills the last rounds alone.
     *  Null once every round is logged. */
    fun nextInRounds(block: List<Lift>): Pair<Int, Int>? {
        for (j in 0 until rounds(block)) {
            for (n in block.indices) {
                val l = block[n]
                if (!l.skipped && j < l.rows.size && !logged(l.rows[j])) return n to j
            }
        }
        return null
    }

    /** The set a step is on, as (lift in the block, set), or null when it has none left to log. */
    fun setOn(block: List<Lift>): Pair<Int, Int>? =
        if (block.size > 1) nextInRounds(block) else block.firstOrNull()?.let { l -> nextSet(l).takeIf { it >= 0 }?.let { 0 to it } }

    /** Every lift in it done or skipped. */
    fun blockDone(block: List<Lift>): Boolean = block.all { it.done || it.skipped }

    /** The workout's steps: its lifts and supersets, then the day's cardio. */
    fun steps(day: Day): Int = day.blocks.size + if (day.cardio != null) 1 else 0

    /** Whether step `at` is the day's cardio. */
    fun isCardio(day: Day, at: Int): Boolean = day.cardio != null && at == day.blocks.size

    /** Whether a step is finished: its lifts done or skipped, or its cardio ticked. */
    fun stepDone(day: Day, at: Int): Boolean = if (isCardio(day, at)) day.cardioDone else day.blocks.getOrNull(at)?.let(::blockDone) ?: false

    /** Where Start or Continue opens: the first step not finished, the cardio after the lifts, or else the first. */
    fun firstOpen(day: Day): Int {
        for (b in day.blocks.indices) if (!blockDone(day.blocks[b])) return b
        return if (day.cardio != null && !day.cardioDone) day.blocks.size else 0
    }

    /** Every lift done or skipped (the phone's sessionDone): opening the workout then starts no clock. */
    fun sessionDone(day: Day): Boolean = day.blocks.isNotEmpty() && day.blocks.all(::blockDone)

    /** A superset's letter: A, B, … in the day's order. */
    fun letter(day: Day, b: Int): Char = 'A' + day.blocks.take(b).count { it.size > 1 }

    /** What a step's big button does. */
    sealed interface Primary {
        /** Logs the set a step is on: `lift` in its block, `set` in that lift's rows. */
        data class LogSet(val lift: Int, val set: Int) : Primary

        data object NextStep : Primary

        data object Finish : Primary

        data object CardioDone : Primary
    }

    /** The big button: the step's set, or on to the next step, or Finish from the last. */
    fun primary(day: Day, at: Int): Primary {
        val block = day.blocks.getOrNull(at)
        if (block != null) {
            setOn(block)?.let { (n, j) -> return Primary.LogSet(n, j) }
            return if (at + 1 < steps(day)) Primary.NextStep else Primary.Finish
        }
        return if (day.cardio != null && !day.cardioDone) Primary.CardioDone else Primary.Finish
    }

    /** Its words, as the phone's button has them. */
    fun label(day: Day, at: Int, p: Primary): String =
        when (p) {
            is Primary.LogSet ->
                if ((day.blocks.getOrNull(at)?.size ?: 1) > 1) "Complete ${letter(day, at)}${p.lift + 1} · set ${p.set + 1}" else "Complete set ${p.set + 1}"
            Primary.NextStep -> "Next exercise"
            Primary.Finish -> "Finish workout"
            Primary.CardioDone -> "Done with ${day.cardio.orEmpty().lowercase()}"
        }

    /** The step after `at`, named as the phone's "Next:" names it: its lifts, or the day's cardio after the last. */
    fun nextName(day: Day, at: Int): String? =
        when {
            at + 1 < day.blocks.size -> day.blocks[at + 1].joinToString(" + ") { it.name }
            at + 1 == day.blocks.size -> day.cardio
            else -> null
        }

    /** The weight the bezel starts at for set `j`: what's logged, else what the phone's Complete set would log (`sugKg`,
     *  which is already the set before's weight once that one's logged). Null for none: a lift done without weight. */
    fun startKg(l: Lift, j: Int): Double? {
        val row = l.rows.getOrNull(j) ?: return null
        return row.kg ?: row.sugKg
    }

    /** The reps it starts at: what's logged, else the suggestion. Null when the phone has none to suggest. */
    fun startReps(l: Lift, j: Int): Int? {
        val row = l.rows.getOrNull(j) ?: return null
        return (row.reps ?: row.sugReps)?.takeIf { it > 0 }
    }

    /** A set as the phone writes one (lib/format.ts, setsSummary): "12 × 100 kg", "12 reps" with no weight. */
    fun setText(reps: Int?, kg: Double?): String =
        when {
            reps == null && kg == null -> "–"
            kg == null -> "$reps reps"
            else -> "${reps ?: "-"} × ${BezelLogic.kgText(kg)} kg"
        }

    /** A day's lifting in numbers, for Workout complete: sets logged, and kg lifted (weight × reps of each). */
    fun totals(day: Day): Pair<Int, Long> {
        val logged = day.blocks.flatten().flatMap { it.rows }.filter(::logged)
        return logged.size to Math.round(logged.sumOf { (it.kg ?: 0.0) * (it.reps ?: 0) })
    }

    /** Where a set sits, over the numbers: "Set 2 of 4", or a superset's "A1 · round 2 of 3". */
    fun setLine(day: Day, at: Int, lift: Int, set: Int): String {
        val block = day.blocks.getOrNull(at) ?: return ""
        return if (block.size > 1) "${letter(day, at)}${lift + 1} · round ${set + 1} of ${rounds(block)}"
        else "Set ${set + 1} of ${block[lift].rows.size}"
    }

    /** How far a step has got, under its name on Today: "Done", "Skipped", or its sets so far. */
    fun progress(day: Day, at: Int): String {
        if (isCardio(day, at)) return if (day.cardioDone) "Done" else "Cardio"
        val block = day.blocks.getOrNull(at) ?: return ""
        if (block.all { it.skipped }) return "Skipped"
        if (blockDone(block)) return "Done"
        val live = block.filter { !it.skipped }
        val sets = "${live.sumOf { l -> l.rows.count(::logged) }} of ${live.sumOf { it.rows.size }} sets"
        return if (block.size > 1) "Superset ${letter(day, at)} · $sets" else sets
    }

    /** A step's name on Today: its lift, or a superset's lifts. */
    fun stepName(day: Day, at: Int): String =
        if (isCardio(day, at)) day.cardio.orEmpty() else day.blocks.getOrNull(at)?.joinToString(" + ") { it.name }.orEmpty()

    /**
     * What comes after a rest, as the phone words it (lib/session.ts, afterRest): the rested lift's next set while it
     * has one ("Next: set 3 of 4", or its round in a superset), else the step after it, else nothing (Finish). `lift`
     * is the rest's lift, the one performed.
     */
    fun afterRest(day: Day?, lift: String): String {
        if (day == null) return ""
        val b = day.blocks.indexOfFirst { block -> block.any { it.name == lift } }
        if (b < 0) return ""
        val block = day.blocks[b]
        val rows = block.map { if (it.skipped) 0 else it.rows.size }
        val rounds = rows.maxOrNull() ?: 0
        for (j in 0 until rounds) {
            if (block.indices.any { n -> j < rows[n] && !logged(block[n].rows[j]) }) {
                return "Next: ${if (block.size > 1) "round" else "set"} ${j + 1} of $rounds"
            }
        }
        if (b + 1 < day.blocks.size) return "Next: " + day.blocks[b + 1].joinToString(" + ") { it.name }
        return day.cardio?.let { "Next: $it" } ?: ""
    }

    /** The workout under way, as the watch face shows it (WorkoutService): its session, how far it's got, its clock,
     *  and when the rest counting down now ends, if one is. */
    data class Live(val title: String, val text: String, val run: Run, val restEndAt: Long?)

    /** The workout under way, or null: none started, finished, or left running for hours. Worded as the phone's lock
     *  screen words it (lib/session.ts, liveWorkout): a superset is one exercise, and a skipped lift counts as done. */
    fun live(state: WatchState?, now: Long): Live? {
        val run = state?.run?.takeIf { TimerLogic.underWay(it, now) } ?: return null
        val day = state.days.firstOrNull { it.date == run.day }
        val blocks = day?.blocks.orEmpty()
        val done = blocks.count { b -> b.all { it.skipped || it.done } }
        val text = if (blocks.isEmpty()) "No exercises yet" else "$done of ${blocks.size} exercise${if (blocks.size == 1) "" else "s"} done"
        val rest = state.rest?.takeIf { it.pausedAt == null && it.endAt > now }
        return Live(day?.title?.takeIf { it.isNotBlank() } ?: "Workout", text, run, rest?.endAt)
    }

    /** A button's words kept together after the first, so a narrow button breaks "Complete / A1 · set 2", never
     *  "Complete A1 / · set 2". */
    fun keepTail(label: String): String {
        val words = label.split(' ')
        if (words.size < 3) return label
        return words.first() + " " + words.drop(1).joinToString("\u00A0")
    }

    /** "Rest over", as the phone's own notification says it (RestTimerLogic.kt). */
    const val OVER_TITLE = "Rest over"

    /** Its line: which lift, and what comes next, whichever of them there is (the phone's RestTimerLogic.overText). */
    fun overText(lift: String, next: String): String =
        listOf(lift.trim(), next.trim()).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Time for your next set" }
}
