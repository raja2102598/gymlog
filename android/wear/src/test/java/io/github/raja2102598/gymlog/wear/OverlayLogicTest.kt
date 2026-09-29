package io.github.raja2102598.gymlog.wear

import io.github.raja2102598.gymlog.wear.Fixtures.TODAY
import io.github.raja2102598.gymlog.wear.Fixtures.day
import io.github.raja2102598.gymlog.wear.Fixtures.lift
import io.github.raja2102598.gymlog.wear.Fixtures.liftIn
import io.github.raja2102598.gymlog.wear.Fixtures.state
import io.github.raja2102598.gymlog.wear.OverlayLogic.apply
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** The watch's commands (docs/watch.md): shown as done on top of the last state until the phone has them, doing what
 *  the phone's store will, and written as the phone reads them. */
class OverlayLogicTest {
    private val t0 = 1_000_000L

    private fun set(id: String, lift: String, set: Int, reps: Int?, kg: Double? = 100.0, at: Long = t0) =
        OverlayLogic.set(id, at, TODAY, lift, set, reps, kg)

    @Test
    fun aSetShowsAsLoggedUntilThePhoneHasIt() {
        val s = state(day(listOf(lift("Squat", 12, null, null))))
        val pending = listOf(set("c-1", "Squat", 1, reps = 10, kg = 102.5))
        assertEquals(SetRow(10, 102.5, null, 12, 100.0), liftIn(apply(s, pending), "Squat").rows[1])
        // The phone's next state has it applied, with the set in it: the watch stops laying it on top.
        val fromPhone = s.copy(applied = setOf("c-1"))
        val left = OverlayLogic.prune(pending, fromPhone.applied, now = t0 + 5_000L)
        assertEquals(emptyList<Command>(), left)
        assertSame(fromPhone, apply(fromPhone, left))
        // Even before it's pruned, an applied command is never laid on twice.
        assertEquals(null, liftIn(apply(fromPhone, pending), "Squat").rows[1].reps)
    }

    @Test
    fun commandsThePhoneNeverTakesGoAfterTwoDays() {
        val old = set("c-old", "Squat", 0, 12, at = t0)
        val acked = set("c-acked", "Squat", 1, 12, at = t0 + 1)
        val fresh = set("c-fresh", "Squat", 2, 12, at = t0 + 2)
        val now = t0 + OverlayLogic.KEEP_MS + 1
        assertEquals(listOf(fresh), OverlayLogic.prune(listOf(old, acked, fresh), setOf("c-acked"), now))
    }

    @Test
    fun theyApplyInTheOrderTheyWereDone() {
        val s = state(day(listOf(lift("Squat", null))))
        val logged = set("c-1", "Squat", 0, 12, at = t0)
        val undone = set("c-2", "Squat", 0, null, at = t0 + 1_000L)
        assertNull(liftIn(apply(s, listOf(undone, logged)), "Squat").rows[0].reps) // sent in either order
    }

    @Test
    fun theFirstRepsOfASetStartItsLiftsRest() {
        val s = state(day(listOf(lift("Leg Press", 12, null, null, restSec = 90, name = "Hack Squat"))))
        val rest = apply(s, listOf(set("c-1", "Leg Press", 1, 12, at = t0))).rest
        assertEquals(Rest(TODAY, "Hack Squat", t0 + 90_000L, null, 90), rest) // named as done, a swap's own name
        // A set that already had reps, or one before a set already logged, is a correction: no rest.
        assertNull(apply(s, listOf(set("c-1", "Leg Press", 0, 10))).rest)
        val later = state(day(listOf(lift("Leg Press", null, 12, null))))
        assertNull(apply(later, listOf(set("c-1", "Leg Press", 0, 12))).rest)
        // Clearing a set starts none either.
        assertNull(apply(s, listOf(set("c-1", "Leg Press", 0, null))).rest)
    }

    @Test
    fun aSupersetRestsOnceTheRoundIsComplete() {
        val s = state(day(listOf(lift("Leg Curl", null, null, restSec = 60), lift("Calf Raise", null, null, restSec = 45))))
        val first = set("c-1", "Leg Curl", 0, 12, at = t0)
        assertNull(apply(s, listOf(first)).rest) // A1 alone: on to A2
        val round = apply(s, listOf(first, set("c-2", "Calf Raise", 0, 15, at = t0 + 30_000L))).rest
        assertEquals(Rest(TODAY, "Calf Raise", t0 + 30_000L + 60_000L, null, 60), round) // the longer of the two rests
        // With A2 skipped, A1's set completes the round by itself.
        val skipped = state(day(listOf(lift("Leg Curl", null, null, restSec = 60), lift("Calf Raise", null, null, restSec = 45, skipped = true))))
        assertEquals(60, apply(skipped, listOf(first)).rest?.sec)
    }

    @Test
    fun aLiftTicksItselfDoneWithItsLastSetAndUnticksWhenOneIsCleared() {
        val s = state(day(listOf(lift("Squat", 12, null))))
        val done = apply(s, listOf(set("c-1", "Squat", 1, 12)))
        assertTrue(liftIn(done, "Squat").done)
        val cleared = apply(done, listOf(set("c-2", "Squat", 1, null, at = t0 + 1)))
        assertFalse(liftIn(cleared, "Squat").done)
        assertEquals(100.0, liftIn(cleared, "Squat").rows[1].kg) // the undo keeps the weight, as the phone's does
    }

    @Test
    fun aSetLogsWhatCompleteSetWouldAndTheSetsAfterItRepeatIt() {
        val s = state(day(listOf(lift("Squat", null, null, null))))
        // No weight given: what the phone's Complete set would log, its suggestion.
        assertEquals(SetRow(12, 100.0, null, 12, 100.0), liftIn(apply(s, listOf(set("c-1", "Squat", 0, 12, kg = null))), "Squat").rows[0])
        // Logged heavier and for more reps: every empty set after it suggests it, reps and weight, as the phone's do.
        val heavier = liftIn(apply(s, listOf(set("c-1", "Squat", 0, 15, kg = 105.0))), "Squat")
        assertEquals(listOf(15 to 105.0, 15 to 105.0), heavier.rows.drop(1).map { it.sugReps to it.sugKg })
        assertEquals(105.0, StepLogic.startKg(heavier, 1)) // where the bezel starts for it
        // Cleared: nothing follows from it.
        assertEquals(12 to 100.0, liftIn(apply(s, listOf(set("c-1", "Squat", 0, null, kg = 105.0))), "Squat").rows[1].let { it.sugReps to it.sugKg })
        // A drop set is lighter on purpose: the set after it repeats the one before it instead.
        val dropped = s.copy(days = s.days.map { d -> d.copy(blocks = d.blocks.map { b -> b.map { l -> l.copy(rows = l.rows.mapIndexed { i, r -> if (i == 1) r.copy(type = "drop") else r }) } }) })
        val afterDrop = apply(dropped, listOf(set("c-1", "Squat", 0, 15, kg = 105.0, at = 1), set("c-2", "Squat", 1, 8, kg = 70.0, at = 2)))
        assertEquals(15 to 105.0, liftIn(afterDrop, "Squat").rows[2].let { it.sugReps to it.sugKg })
    }

    @Test
    fun whatThePhoneWouldDropIsDropped() {
        val s = state(day(listOf(lift("Squat", 12, null)), listOf(lift("Row", null, skipped = true))))
        assertEquals(s, apply(s, listOf(set("c-1", "Squat", 2, 12)))) // past its rows
        assertEquals(s, apply(s, listOf(set("c-1", "Row", 0, 12)))) // a skipped lift's
        assertEquals(s, apply(s, listOf(set("c-1", "Bench", 0, 12)))) // not today's
        assertEquals(s, apply(s, listOf(OverlayLogic.set("c-1", t0, "2026-10-01", "Squat", 1, 12, 100.0)))) // not a day it has
        assertEquals(s, apply(s, listOf(Command("c-1", t0, "somethingNew"))))
    }

    @Test
    fun theClockStartsPausesResumesAndFinishes() {
        val s = state(day(listOf(lift("Squat", null))), rest = Rest(TODAY, "Squat", t0 + 60_000L))
        fun cmd(type: String, at: Long, day: String = TODAY) = OverlayLogic.ofDay("c-$type-$at", at, type, day)
        val started = apply(s, listOf(cmd(OverlayLogic.START_RUN, t0)))
        assertEquals(Run(TODAY, t0), started.run)
        // Already running for the day: the second Start leaves it be.
        assertEquals(Run(TODAY, t0), apply(started, listOf(cmd(OverlayLogic.START_RUN, t0 + 60_000L))).run)
        // Another day's, finished, or left running for hours: it starts again from 0:00.
        assertEquals(Run(TODAY, t0), apply(s.copy(run = Run("2026-09-28", t0 - 1)), listOf(cmd(OverlayLogic.START_RUN, t0))).run)
        assertEquals(Run(TODAY, t0), apply(s.copy(run = Run(TODAY, t0 - 10, endedAt = t0 - 5)), listOf(cmd(OverlayLogic.START_RUN, t0))).run)
        assertEquals(Run(TODAY, t0), apply(s.copy(run = Run(TODAY, t0 - TimerLogic.LEFT_BEHIND_MS)), listOf(cmd(OverlayLogic.START_RUN, t0))).run)

        val paused = apply(started, listOf(cmd(OverlayLogic.PAUSE_RUN, t0 + 60_000L)))
        assertEquals(t0 + 60_000L, paused.run?.pausedAt)
        val resumed = apply(paused, listOf(cmd(OverlayLogic.RESUME_RUN, t0 + 90_000L)))
        assertEquals(Run(TODAY, t0, null, 30_000L), resumed.run)
        assertEquals(paused, apply(paused, listOf(cmd(OverlayLogic.RESUME_RUN, t0 + 90_000L, day = "2026-09-28")))) // another day's

        val finished = apply(resumed, listOf(cmd(OverlayLogic.FINISH, t0 + 600_000L)))
        assertEquals(t0 + 600_000L, finished.run?.endedAt)
        assertNull(finished.rest) // the day's rest goes with it
        val otherRest = resumed.copy(rest = Rest("2026-09-28", "Row", t0 + 60_000L))
        assertEquals(otherRest.rest, apply(otherRest, listOf(cmd(OverlayLogic.FINISH, t0 + 600_000L))).rest)
    }

    @Test
    fun theRestSkipsAddsPausesAndResumes() {
        val s = state(day(listOf(lift("Squat", null))), rest = Rest(TODAY, "Squat", t0 + 90_000L, sec = 90))
        fun rest(type: String, at: Long, sec: Int? = null) = apply(s, listOf(OverlayLogic.ofRest("c-1", at, type, sec))).rest
        assertNull(rest(OverlayLogic.REST_SKIP, t0))
        assertEquals(t0 + 105_000L, rest(OverlayLogic.REST_ADD, t0 + 10_000L, 15)?.endAt)
        assertEquals(t0 + 30_000L, rest(OverlayLogic.REST_PAUSE, t0 + 30_000L)?.pausedAt)
        val paused = s.copy(rest = s.rest?.copy(pausedAt = t0 + 30_000L))
        assertEquals(Rest(TODAY, "Squat", t0 + 160_000L, null, 90), apply(paused, listOf(OverlayLogic.ofRest("c-2", t0 + 100_000L, OverlayLogic.REST_RESUME))).rest)
    }

    @Test
    fun skippingALiftAndTickingTheCardio() {
        val s = state(day(listOf(lift("Squat", 12, null, done = true)), cardio = "Walk"))
        val skipped = apply(s, listOf(OverlayLogic.skipLift("c-1", t0, TODAY, "Squat")))
        assertTrue(liftIn(skipped, "Squat").skipped)
        assertFalse(liftIn(skipped, "Squat").done)
        assertTrue(apply(s, listOf(OverlayLogic.cardioDone("c-2", t0, TODAY, true))).days[0].cardioDone)
    }

    @Test
    fun commandsAreWrittenAsThePhoneReadsThem() {
        val set = JSONObject(OverlayLogic.toJson(set("c-9", "Squat", 1, reps = null, kg = 100.0, at = 42L)))
        assertEquals(1, set.getInt("v"))
        assertEquals("c-9", set.getString("id"))
        assertEquals(42L, set.getLong("at"))
        assertEquals("set", set.getString("type"))
        assertEquals(TODAY, set.getString("day"))
        assertEquals("Squat", set.getString("lift"))
        assertEquals(1, set.getInt("set"))
        assertTrue(set.has("reps") && set.isNull("reps")) // null reps is the undo: it has to be there
        assertEquals(100.0, set.getDouble("kg"), 0.0)

        val add = JSONObject(OverlayLogic.toJson(OverlayLogic.ofRest("c-10", 43L, OverlayLogic.REST_ADD, 15)))
        assertEquals(setOf("v", "id", "at", "type", "sec"), add.keys().asSequence().toSet())
        val start = JSONObject(OverlayLogic.toJson(OverlayLogic.ofDay("c-11", 44L, OverlayLogic.START_RUN, TODAY)))
        assertEquals(setOf("v", "id", "at", "type", "day"), start.keys().asSequence().toSet())
        val cardio = JSONObject(OverlayLogic.toJson(OverlayLogic.cardioDone("c-12", 45L, TODAY, false)))
        assertEquals(false, cardio.getBoolean("done"))

        // Kept on the watch as the same JSON, and read back the same.
        for (c in listOf(set("c-9", "Squat", 1, null), OverlayLogic.ofRest("c-10", 43L, OverlayLogic.REST_ADD, 15), OverlayLogic.cardioDone("c-12", 45L, TODAY, false))) {
            assertEquals(c, OverlayLogic.fromJson(OverlayLogic.toJson(c)))
        }
        assertNull(OverlayLogic.fromJson("{}"))
    }

    @Test
    fun idsAreNewEachTimeAndFitInTheItemsPath() {
        val ids = List(100) { OverlayLogic.newId() }
        assertEquals(100, ids.toSet().size)
        assertTrue(ids.all { it.startsWith("c-") && OverlayLogic.validId(it) })
        assertTrue(OverlayLogic.validId("c-1.a_b:c"))
        assertFalse(OverlayLogic.validId("c/1")) // would be another path
        assertFalse(OverlayLogic.validId("c 1"))
        assertFalse(OverlayLogic.validId("c-é"))
        assertFalse(OverlayLogic.validId(""))
        assertFalse(OverlayLogic.validId("c".repeat(129)))
    }
}
