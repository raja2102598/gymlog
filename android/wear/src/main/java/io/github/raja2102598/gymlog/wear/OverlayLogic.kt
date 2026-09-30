package io.github.raja2102598.gymlog.wear

import org.json.JSONObject

/**
 * One thing done on the watch, sent to the phone as its own /gymlog/cmd/<id> data item (docs/watch.md). Only the
 * fields its `type` uses are set. A set carries the row as the watch had it (`baseReps`, `baseKg`), a rest button's the
 * rest it was pressed for (its `day`, `lift` and `restStartedAt`), and the clock's pause, resume and Finish the run, by
 * `runStartedAt`. Every command carries the `account` of the state it was made on, and is only ever applied to it.
 */
data class Command(
    val id: String,
    val at: Long,
    val type: String,
    val day: String? = null,
    val lift: String? = null,
    val set: Int? = null,
    val reps: Int? = null,
    val kg: Double? = null,
    val sec: Int? = null,
    val done: Boolean? = null,
    val avg: Int? = null,
    val max: Int? = null,
    val samples: Int? = null,
    val restStartedAt: Long? = null,
    val account: String? = null,
    val runStartedAt: Long? = null,
    val baseReps: Int? = null,
    val baseKg: Double? = null,
)

/**
 * The watch's commands, and showing them as done before the phone has them. Until a command's id comes back in the
 * state's `applied`, the watch lays it over the last state it had, doing what the phone will (its store's rules,
 * mirrored here), so it keeps working away from the phone; once it's back, the state already includes it. Pure, for
 * OverlayLogicTest.
 */
object OverlayLogic {
    /** How long a command the phone never took is still shown as done: two days, when it's long past mattering. */
    const val KEEP_MS = 2 * 24 * 60 * 60 * 1000L

    const val SET = "set"
    const val START_RUN = "startRun"
    const val PAUSE_RUN = "pauseRun"
    const val RESUME_RUN = "resumeRun"
    const val FINISH = "finish"
    const val REST_SKIP = "restSkip"
    const val REST_ADD = "restAdd"
    const val REST_PAUSE = "restPause"
    const val REST_RESUME = "restResume"
    const val SKIP_LIFT = "skipLift"
    const val CARDIO_DONE = "cardioDone"
    const val HR = "hr"

    /** A new command's id: "c-" and a random UUID, never reused. It's part of the item's path, so only letters, digits
     *  and `. _ : -`, and at most 128 characters, which the phone checks. */
    fun newId(): String = "c-" + java.util.UUID.randomUUID()

    /** Whether an id is one the phone will read (see newId). */
    fun validId(id: String): Boolean = id.length in 1..128 && id.all { it.isLetterOrDigit() && it.code < 128 || it in "._:-" }

    /** A set logged (reps null: cleared, the tick's undo), as Complete set N logs it, over `base`, the row as the watch
     *  has it now (null: none). The phone logs it only over that row, so a change made to it there since stays. */
    fun set(id: String, at: Long, day: String, lift: String, set: Int, reps: Int?, kg: Double?, base: SetRow?) =
        Command(id, at, SET, day = day, lift = lift, set = set, reps = reps, kg = kg, baseReps = base?.reps, baseKg = base?.kg)

    /** A weight as the phone keeps it, to the half kg (lib/lift.ts, setField): the rows' are compared so. */
    private fun halfKg(kg: Double?): Double? = kg?.let { Math.round(it * 2) / 2.0 }

    private fun sameKg(a: Double?, b: Double?): Boolean = halfKg(a) == halfKg(b)

    /** A command naming only its day: startRun. */
    fun ofDay(id: String, at: Long, type: String, day: String) = Command(id, at, type, day = day)

    /** The clock's pauseRun, resumeRun or finish, for the day's run shown, `run` (null: none yet). It names that run,
     *  so neither the phone nor the watch applies it to one restarted (↺) or started again since. */
    fun ofRun(id: String, at: Long, type: String, day: String, run: Run?) =
        Command(id, at, type, day = day, runStartedAt = run?.takeIf { it.day == day }?.startedAt)

    /** Whether a clock command was made for the day's run there is now, `r`, as the phone checks it (lib/watch.ts,
     *  sameRun): the one it showed, by its start, or none when it showed none. */
    fun sameRun(r: Run?, c: Command): Boolean = r?.takeIf { it.day == c.day }?.startedAt == c.runStartedAt

    /** A command about the rest shown, `rest`: restSkip, restPause or restResume, or restAdd with `sec`. It names that
     *  rest, so neither the phone nor the watch applies it to a newer one started since. */
    fun ofRest(id: String, at: Long, type: String, rest: Rest, sec: Int? = null) =
        Command(id, at, type, day = rest.day, lift = rest.lift, sec = sec, restStartedAt = rest.startedAt)

    /** Whether a rest command was made for `r`, the rest there is now, as the phone checks it (lib/watch.ts, sameRest):
     *  the same day and lift, and the same start, unless either doesn't know it (a timer the phone kept from before). */
    fun sameRest(r: Rest?, c: Command): Boolean =
        r != null && r.day == c.day && r.lift == c.lift && (r.startedAt == null || c.restStartedAt == null || r.startedAt == c.restStartedAt)

    fun skipLift(id: String, at: Long, day: String, lift: String) = Command(id, at, SKIP_LIFT, day = day, lift = lift)

    fun cardioDone(id: String, at: Long, day: String, done: Boolean) = Command(id, at, CARDIO_DONE, day = day, done = done)

    /** The day's heart rate so far (HeartLogic): its average and highest over `samples` readings, replacing the one
     *  the phone had. */
    fun heart(id: String, at: Long, day: String, avg: Int, max: Int, samples: Int) =
        Command(id, at, HR, day = day, avg = avg, max = max, samples = samples)

    /** The command as the phone reads it. A set's reps and kg are always there, null included, since null reps is
     *  what clears it. */
    fun toJson(c: Command): String {
        val o = JSONObject().put("v", StateLogic.VERSION).put("id", c.id).put("at", c.at).put("type", c.type)
        c.day?.let { o.put("day", it) }
        c.lift?.let { o.put("lift", it) }
        c.set?.let { o.put("set", it) }
        if (c.type == SET) {
            o.put("reps", c.reps ?: JSONObject.NULL)
            o.put("kg", c.kg ?: JSONObject.NULL)
            o.put("baseReps", c.baseReps ?: JSONObject.NULL)
            o.put("baseKg", c.baseKg ?: JSONObject.NULL)
        }
        c.sec?.let { o.put("sec", it) }
        c.done?.let { o.put("done", it) }
        c.avg?.let { o.put("avg", it) }
        c.max?.let { o.put("max", it) }
        c.samples?.let { o.put("samples", it) }
        c.restStartedAt?.let { o.put("restStartedAt", it) }
        c.account?.let { o.put("account", it) }
        c.runStartedAt?.let { o.put("runStartedAt", it) }
        return o.toString()
    }

    /** A command as the watch kept it (toJson), or null for anything else. */
    fun fromJson(json: String): Command? =
        try {
            val o = JSONObject(json)
            fun str(k: String) = if (o.isNull(k)) null else o.optString(k)
            fun num(k: String) = if (o.isNull(k)) null else o.optDouble(k).takeIf { it.isFinite() }
            Command(
                id = o.getString("id"),
                at = o.getLong("at"),
                type = o.getString("type"),
                day = str("day"),
                lift = str("lift"),
                set = num("set")?.toInt(),
                reps = num("reps")?.toInt(),
                kg = num("kg"),
                sec = num("sec")?.toInt(),
                done = if (o.isNull("done")) null else o.optBoolean("done"),
                avg = num("avg")?.toInt(),
                max = num("max")?.toInt(),
                samples = num("samples")?.toInt(),
                restStartedAt = if (o.isNull("restStartedAt")) null else o.getLong("restStartedAt"),
                account = str("account"),
                runStartedAt = if (o.isNull("runStartedAt")) null else o.getLong("runStartedAt"),
                baseReps = num("baseReps")?.toInt(),
                baseKg = num("baseKg"),
            )
        } catch (e: Exception) {
            null
        }

    /**
     * The commands to keep once `cmd` is sent: all of them, except that an `hr` replaces the same day's earlier ones
     * that never reached the Data Layer (`unsent`). Each carries the day's whole heart rate so far, so one of those sent
     * again later, after this one, would only take the phone back to less of the workout.
     */
    fun supersede(pending: List<Command>, unsent: Set<String>, cmd: Command): List<Command> =
        if (cmd.type != HR) pending else pending.filter { !(it.type == HR && it.day == cmd.day && it.account == cmd.account && it.id in unsent) }

    /**
     * The commands still to show over `state` and send again: not yet in its `applied`, not made under another account
     * than its own, and not so old the phone is never going to take them. The phone signed out and into another
     * account since they were made: they're that account's days, never this one's, so they go (the phone drops them
     * too). Signed out, with no account yet, they wait for the one they were made under, as the phone's own queue does.
     * A state the watch can't read (null) only ages them.
     */
    fun prune(pending: List<Command>, state: WatchState?, now: Long): List<Command> =
        pending.filter { c ->
            now - c.at < KEEP_MS && (state == null || (c.id !in state.applied && (state.account == null || c.account == state.account)))
        }

    /** The state with `pending` done on top of it, in the order they were done, as the phone will apply them: those
     *  made under its account only. */
    fun apply(state: WatchState, pending: List<Command>): WatchState =
        pending.sortedBy { it.at }.fold(state) { s, c -> if (c.id in s.applied || c.account != s.account) s else one(s, c) }

    private fun one(s: WatchState, c: Command): WatchState =
        when (c.type) {
            SET -> logSet(s, c)
            // The phone's startRun: nothing if that day's clock is already going, or any run was started after this was
            // pressed (another day's, on the phone, while this waited out of reach), else it starts from 0:00.
            START_RUN -> {
                val day = c.day
                val newer = (s.run?.startedAt ?: Long.MIN_VALUE) > c.at
                if (day == null || newer || (s.run?.day == day && TimerLogic.underWay(s.run, c.at))) s else s.copy(run = Run(day, c.at))
            }
            // The clock's pause, resume and Finish act on the run they were pressed for, and never on one restarted (↺)
            // on the phone since, as the phone drops them then.
            PAUSE_RUN -> s.run?.takeIf { it.day == c.day && sameRun(it, c) }?.let { s.copy(run = TimerLogic.pauseRun(it, c.at)) } ?: s
            RESUME_RUN -> s.run?.takeIf { it.day == c.day && sameRun(it, c) }?.let { s.copy(run = TimerLogic.resumeRun(it, c.at)) } ?: s
            // Finish ends the clock, and the rest after the last set with it: there's no next set to rest for.
            FINISH -> if (!sameRun(s.run, c)) {
                s
            } else {
                s.copy(
                    run = s.run?.let { if (it.day == c.day) TimerLogic.endRun(it, c.at) else it },
                    rest = s.rest?.takeIf { it.day != c.day },
                )
            }
            // The rest's buttons act on the rest they were pressed for, and never on one that's replaced it since (a
            // set logged on the phone, say), as the phone drops them then.
            REST_SKIP, REST_ADD, REST_PAUSE, REST_RESUME -> s.rest?.takeIf { sameRest(it, c) }?.let { r ->
                s.copy(
                    rest = when (c.type) {
                        REST_SKIP -> null
                        REST_ADD -> TimerLogic.addRest(r, c.sec ?: 15, c.at)
                        REST_PAUSE -> TimerLogic.pauseRest(r, c.at)
                        else -> TimerLogic.resumeRest(r, c.at)
                    },
                )
            } ?: s
            SKIP_LIFT -> editLift(s, c.day, c.lift) { _, l -> l.copy(skipped = true, done = false) }
            CARDIO_DONE -> s.copy(days = s.days.map { if (it.date == c.day) it.copy(cardioDone = c.done ?: true) else it })
            // The phone keeps the day's heart rate for Workout complete; the watch shows its own readings, not the state's.
            HR -> s
            else -> s
        }

    /** Replaces the lift `key` on `date` with what `f` makes of it (given its block too), leaving the rest alone. */
    private fun editLift(s: WatchState, date: String?, key: String?, f: (List<Lift>, Lift) -> Lift): WatchState =
        s.copy(
            days = s.days.map { d ->
                if (d.date != date) d else d.copy(blocks = d.blocks.map { b -> b.map { l -> if (l.key == key) f(b, l) else l } })
            },
        )

    /**
     * A set logged or cleared. A set past the lift's rows, or of a skipped lift, is dropped, as the phone drops it.
     * With no weight given it takes what Complete set N would log (`sugKg`), and the empty rows after it suggest the
     * last logged set before them, reps and weight, a drop set aside, as the phone's do (lib/lift.ts, sugFor): set 1
     * done at 12 × 105 has sets 2 and 3 suggest 12 × 105. A lift whose rows all have reps ticks itself done, and clearing
     * one unticks it, as the phone's tick follows the planned sets. The rest starts as the phone starts it: when a
     * set gets its first reps with no later one logged, for the lift's rest, or in a superset once the round is
     * complete, for the longest rest of its lifts. Only over the row as the watch had it (`baseReps`, `baseKg`), as the
     * phone checks it: changed on the phone since, which the state has, the phone's stays and this isn't shown; one
     * that has this set's numbers already needs nothing.
     */
    private fun logSet(s: WatchState, c: Command): WatchState {
        val day = s.days.firstOrNull { it.date == c.day } ?: return s
        val b = day.blocks.indexOfFirst { block -> block.any { it.key == c.lift } }
        if (b < 0) return s
        val lift = day.blocks[b].first { it.key == c.lift }
        val j = c.set ?: return s
        if (j !in lift.rows.indices || lift.skipped) return s
        val row = lift.rows[j]
        val already = if (c.reps == null) row.reps == null else row.reps == c.reps && (c.kg == null || sameKg(row.kg, c.kg))
        if (already || row.reps != c.baseReps || !sameKg(row.kg, c.baseKg)) return s
        val hadReps = lift.rows[j].reps != null
        val kg = if (c.reps != null) c.kg ?: lift.rows[j].sugKg else c.kg
        val set = lift.rows.mapIndexed { i, r -> if (i == j) r.copy(reps = c.reps, kg = kg) else r }
        val rows = set.mapIndexed { i, r ->
            // Only the rows after it change; one with nothing logged before it keeps the phone's own suggestion.
            val before = if (i > j && r.reps == null) set.subList(0, i).lastOrNull { StepLogic.logged(it) && it.type != "drop" } else null
            if (before == null) r else r.copy(sugReps = before.reps, sugKg = before.kg ?: r.sugKg)
        }
        val done = when {
            lift.skipped -> false
            rows.all(StepLogic::logged) -> true
            c.reps == null -> false
            else -> lift.done
        }
        val edited = lift.copy(rows = rows, done = done)
        val out = editLift(s, day.date, lift.key) { _, _ -> edited }
        if (c.reps == null || hadReps || rows.drop(j + 1).any { it.reps != null }) return out
        val block = out.days.first { it.date == day.date }.blocks[b]
        val sec = restAfter(block, j) ?: return out
        // A rest started after this set was done (on the phone, for a set logged or said there, which the state has
        // already) is the newer one, and stays, as the phone keeps it.
        if ((out.rest?.startedAt ?: Long.MIN_VALUE) > c.at) return out
        // Started at `at`, as the phone starts it (store.startRest's `from`), so it's the same rest there.
        return if (sec > 0) out.copy(rest = Rest(day.date, edited.name, c.at + sec * 1000L, null, sec, startedAt = c.at)) else out
    }

    /** The rest set `j` of a block starts, in seconds, or null for none yet: a superset waits for its round, with
     *  every lift's set j logged and none of them further on. */
    private fun restAfter(block: List<Lift>, j: Int): Int? {
        if (block.size == 1) return block[0].restSec
        val complete = block.all { it.skipped || j >= it.rows.size || it.rows[j].reps != null }
        val later = block.any { l -> l.rows.drop(j + 1).any { it.reps != null } }
        return if (complete && !later) block.filter { !it.skipped }.maxOfOrNull { it.restSec } else null
    }
}
