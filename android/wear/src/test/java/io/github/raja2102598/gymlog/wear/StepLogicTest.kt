package io.github.raja2102598.gymlog.wear

import io.github.raja2102598.gymlog.wear.Fixtures.day
import io.github.raja2102598.gymlog.wear.Fixtures.lift
import io.github.raja2102598.gymlog.wear.StepLogic.Primary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Moving through a workout as the phone's workout screen does (WorkoutView.tsx, LiftItem.tsx, SupersetItem.tsx). */
class StepLogicTest {
    @Test
    fun aLiftIsOnItsFirstSetWithNoReps() {
        assertEquals(1, StepLogic.nextSet(lift("Squat", 12, null, null)))
        assertEquals(0, StepLogic.nextSet(lift("Squat", null, 12))) // a gap before a logged set comes first
        assertEquals(1, StepLogic.nextSet(lift("Squat", 12, 0, null))) // 0 reps isn't a set done
        assertEquals(-1, StepLogic.nextSet(lift("Squat", 12, 10)))
        assertEquals(-1, StepLogic.nextSet(lift("Squat", null, null, skipped = true)))
    }

    @Test
    fun aSupersetGoesRoundByRound() {
        fun on(vararg ls: Lift) = StepLogic.nextInRounds(ls.toList())
        assertEquals(0 to 0, on(lift("A", null, null), lift("B", null, null)))
        assertEquals(1 to 0, on(lift("A", 12, null), lift("B", null, null))) // A1's set 1, then B's
        assertEquals(0 to 1, on(lift("A", 12, null), lift("B", 12, null))) // then round 2
        assertEquals(0 to 1, on(lift("A", 12, null), lift("B", null, null, skipped = true))) // a skipped lift drops out
        assertEquals(0 to 3, on(lift("A", 12, 12, 12, null), lift("B", 12, 12, 12))) // a longer lift fills the last rounds alone
        assertNull(on(lift("A", 12, 12), lift("B", 12, 12)))
        assertEquals(4, StepLogic.rounds(listOf(lift("A", 12, 12, 12, null), lift("B", 12), lift("C", 1, 2, 3, 4, 5, skipped = true))))
    }

    private val legs = day(
        listOf(lift("Squat", 12, null, null)),
        listOf(lift("Leg Curl", 12, null), lift("Calf Raise", 15, null)),
        listOf(lift("Row", null, null), lift("Pulldown", null, null)),
        cardio = "Cycling - 15-20 min",
    )

    @Test
    fun theBigButtonSaysWhatItDoesAsThePhonesDoes() {
        assertEquals(Primary.LogSet(0, 1), StepLogic.primary(legs, 0))
        assertEquals("Complete set 2", StepLogic.label(legs, 0, StepLogic.primary(legs, 0)))
        assertEquals(Primary.LogSet(0, 1), StepLogic.primary(legs, 1))
        assertEquals("Complete A1 · set 2", StepLogic.label(legs, 1, StepLogic.primary(legs, 1)))
        assertEquals("Complete B1 · set 1", StepLogic.label(legs, 2, StepLogic.primary(legs, 2))) // the day's second superset
        assertEquals("Done with cardio", StepLogic.label(legs, 3, StepLogic.primary(legs, 3)))
        assertEquals("Finish workout", StepLogic.label(legs, 3, StepLogic.primary(legs.copy(cardioDone = true), 3)))
    }

    @Test
    fun aFinishedStepGoesOnThenFinishesFromTheLast() {
        val d = day(listOf(lift("Squat", 12, 12)), listOf(lift("Bench", 10)))
        assertEquals(Primary.NextStep, StepLogic.primary(d, 0))
        assertEquals("Next exercise", StepLogic.label(d, 0, Primary.NextStep))
        assertEquals(Primary.Finish, StepLogic.primary(d, 1))
        assertEquals(Primary.NextStep, StepLogic.primary(day(listOf(lift("Squat", null, skipped = true)), listOf(lift("Bench", null))), 0))
        // The last lift done with cardio to come: on to the cardio.
        assertEquals(Primary.NextStep, StepLogic.primary(d.copy(cardio = "Walk"), 1))
    }

    @Test
    fun nextNamesTheStepAfterThenTheCardio() {
        assertEquals("Leg Curl + Calf Raise", StepLogic.nextName(legs, 0))
        assertEquals("Cycling - 15-20 min", StepLogic.nextName(legs, 2))
        assertNull(StepLogic.nextName(legs, 3))
        assertNull(StepLogic.nextName(legs.copy(cardio = null), 2))
        assertEquals(4, StepLogic.steps(legs))
        assertEquals(3, StepLogic.steps(legs.copy(cardio = null)))
        assertTrue(StepLogic.isCardio(legs, 3))
        assertFalse(StepLogic.isCardio(legs, 2))
    }

    @Test
    fun startOpensTheFirstStepNotFinished() {
        val done = lift("Squat", 12, done = true)
        assertEquals(1, StepLogic.firstOpen(day(listOf(done), listOf(lift("Bench", null)))))
        assertEquals(1, StepLogic.firstOpen(day(listOf(lift("Squat", null, skipped = true)), listOf(lift("Bench", null)))))
        assertEquals(1, StepLogic.firstOpen(day(listOf(done), cardio = "Walk"))) // the lifts done: the cardio
        assertEquals(0, StepLogic.firstOpen(day(listOf(done), cardio = "Walk", cardioDone = true))) // all of it: the first
        assertTrue(StepLogic.sessionDone(day(listOf(done), listOf(lift("Bench", null, skipped = true)))))
        assertFalse(StepLogic.sessionDone(day(listOf(done), listOf(lift("Bench", null)))))
        assertFalse(StepLogic.sessionDone(day(cardio = "Walk"))) // no lifts: nothing done
    }

    @Test
    fun afterARestItSaysWhatsNext() {
        assertEquals("Next: set 2 of 3", StepLogic.afterRest(legs, "Squat"))
        assertEquals("Next: round 2 of 2", StepLogic.afterRest(legs, "Calf Raise"))
        val squatDone = legs.copy(blocks = listOf(listOf(lift("Squat", 12, 12, 12))) + legs.blocks.drop(1))
        assertEquals("Next: Leg Curl + Calf Raise", StepLogic.afterRest(squatDone, "Squat"))
        val lastDone = legs.copy(blocks = legs.blocks.dropLast(1) + listOf(listOf(lift("Row", 1, 1), lift("Pulldown", 1, 1))))
        assertEquals("Next: Cycling - 15-20 min", StepLogic.afterRest(lastDone, "Row"))
        assertEquals("", StepLogic.afterRest(lastDone.copy(cardio = null), "Row")) // then Finish
        assertEquals("", StepLogic.afterRest(legs, "Bench")) // not today's
        assertEquals("", StepLogic.afterRest(null, "Squat"))
        // A swap rests under its own name.
        assertEquals("Next: set 2 of 2", StepLogic.afterRest(day(listOf(lift("Leg Press", 12, null, name = "Hack Squat"))), "Hack Squat"))
    }

    @Test
    fun todaySaysHowFarEachStepHasGot() {
        assertEquals("1 of 3 sets", StepLogic.progress(legs, 0))
        assertEquals("Superset A · 2 of 4 sets", StepLogic.progress(legs, 1))
        assertEquals("Cardio", StepLogic.progress(legs, 3))
        assertEquals("Done", StepLogic.progress(legs.copy(cardioDone = true), 3))
        assertEquals("Done", StepLogic.progress(day(listOf(lift("Squat", 12, done = true))), 0))
        assertEquals("Skipped", StepLogic.progress(day(listOf(lift("Squat", null, skipped = true))), 0))
        assertEquals("Leg Curl + Calf Raise", StepLogic.stepName(legs, 1))
        assertEquals("Cycling - 15-20 min", StepLogic.stepName(legs, 3))
    }

    @Test
    fun theSetLineSaysWhereTheSetSits() {
        assertEquals("Set 2 of 3", StepLogic.setLine(legs, 0, 0, 1))
        assertEquals("A2 · round 2 of 2", StepLogic.setLine(legs, 1, 1, 1))
        assertEquals("B1 · round 1 of 2", StepLogic.setLine(legs, 2, 0, 0))
    }

    @Test
    fun theBezelStartsAtWhatsLoggedElseWhatCompleteSetWouldLog() {
        val l = Lift(
            "Squat", "Squat", false, false, 90, 2.5, "",
            listOf(
                SetRow(12, 105.0, sugReps = 12, sugKg = 100.0), // logged heavier than suggested
                SetRow(null, null, sugReps = 12, sugKg = 105.0), // the phone's suggestion: the set before's weight
                SetRow(null, 90.0, sugReps = 12, sugKg = 100.0), // a weight typed on the phone, no reps yet
                SetRow(null, null, sugReps = null, sugKg = null), // nothing to suggest
            ),
        )
        assertEquals(105.0, StepLogic.startKg(l, 0)!!, 0.0)
        assertEquals(105.0, StepLogic.startKg(l, 1)!!, 0.0)
        assertEquals(90.0, StepLogic.startKg(l, 2)!!, 0.0)
        assertNull(StepLogic.startKg(l, 3))
        assertNull(StepLogic.startKg(l, 9))
        assertEquals(12, StepLogic.startReps(l, 0))
        assertEquals(12, StepLogic.startReps(l, 1))
        assertNull(StepLogic.startReps(l, 3)) // nothing to suggest: the reps get picked instead
    }

    @Test
    fun setsReadAsThePhoneWritesThem() {
        assertEquals("12 × 100 kg", StepLogic.setText(12, 100.0))
        assertEquals("8 × 37.5 kg", StepLogic.setText(8, 37.5))
        assertEquals("15 reps", StepLogic.setText(15, null))
        assertEquals("- × 60 kg", StepLogic.setText(null, 60.0))
        assertEquals("–", StepLogic.setText(null, null))
    }

    @Test
    fun workoutCompleteAddsUpTheLoggedSets() {
        val d = day(listOf(lift("Squat", 12, 10, null)), listOf(lift("Row", 8, skipped = true)))
        assertEquals(3 to Math.round(100.0 * 30), StepLogic.totals(d)) // 12 + 10 + 8 reps at 100 kg
        assertEquals(0 to 0L, StepLogic.totals(day(listOf(lift("Squat", null)))))
    }

    @Test
    fun theWatchFaceShowsTheWorkoutUnderWay() {
        val t0 = 1_000_000L
        // Done, half done with a lift skipped, not started, and skipped: a skipped lift counts as done.
        val d = day(listOf(lift("Squat", 12, done = true)), listOf(lift("A", 1), lift("B", null, skipped = true)), listOf(lift("Row", null)), listOf(lift("Lunge", null, skipped = true)))
        val s = Fixtures.state(d, run = Run(Fixtures.TODAY, t0), rest = Rest(Fixtures.TODAY, "Squat", t0 + 90_000L))
        assertEquals(StepLogic.Live("Legs", "2 of 4 exercises done", Run(Fixtures.TODAY, t0), t0 + 90_000L), StepLogic.live(s, t0 + 1_000L))
        assertNull(StepLogic.live(s, t0 + 100_000L)?.restEndAt) // over
        assertNull(StepLogic.live(s.copy(rest = s.rest?.copy(pausedAt = t0)), t0 + 1_000L)?.restEndAt) // paused
        assertNull(StepLogic.live(s.copy(run = Run(Fixtures.TODAY, t0, endedAt = t0 + 1)), t0 + 1_000L)) // finished
        assertNull(StepLogic.live(s.copy(run = null), t0))
        assertEquals("No exercises yet", StepLogic.live(Fixtures.state(day(), run = Run(Fixtures.TODAY, t0)), t0)?.text)
        assertEquals("0 of 1 exercise done", StepLogic.live(Fixtures.state(day(listOf(lift("Row", null))), run = Run(Fixtures.TODAY, t0)), t0)?.text)
    }

    @Test
    fun restOverSaysWhichLiftAndWhatsNext() {
        assertEquals("Rest over", StepLogic.OVER_TITLE)
        assertEquals("Squat · Next: set 2 of 3", StepLogic.overText("Squat", StepLogic.afterRest(legs, "Squat")))
        assertEquals("Squat", StepLogic.overText("Squat", ""))
        assertEquals("Time for your next set", StepLogic.overText(" ", ""))
    }

    @Test
    fun aButtonBreaksBeforeItsLastWordsNotInThem() {
        assertEquals("Complete A1\u00A0·\u00A0set\u00A02", StepLogic.keepTail("Complete A1 · set 2"))
        assertEquals("Complete set\u00A03", StepLogic.keepTail("Complete set 3"))
        assertEquals("Next exercise", StepLogic.keepTail("Next exercise"))
    }
}
