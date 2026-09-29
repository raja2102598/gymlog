package io.github.raja2102598.gymlog.wear

import io.github.raja2102598.gymlog.wear.Fixtures.TODAY
import io.github.raja2102598.gymlog.wear.Fixtures.day
import io.github.raja2102598.gymlog.wear.Fixtures.lift
import io.github.raja2102598.gymlog.wear.Fixtures.state
import java.time.Instant
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The tile's words (docs/watch.md): the workout under way, with its clock or rest and the next set, or today's session
 *  and Start. */
class TileLogicTest {
    private val now = Instant.parse("2026-09-29T12:00:00Z").toEpochMilli()
    private val sec = 1_000L
    private val min = 60_000L

    private fun ok(s: WatchState) = StateLogic.Parsed.Ok(s)

    /** The next set's words as read, its no-break spaces as spaces. */
    private fun read(next: String) = next.replace('\u00A0', ' ')

    private fun face(s: WatchState, at: Long = now) = TileLogic.face(ok(s), s, TODAY, at)

    /** Hack Squat with a set left, then Leg Press on its third of four, then the cycling. */
    private val legs = day(listOf(lift("Hack Squat", 12, null)), listOf(lift("Leg Press", 12, 12, null, null)), cardio = "Cycling")

    @Test
    fun duringAWorkoutItShowsItsClockAndTheNextSet() {
        val run = Run(TODAY, startedAt = now - (18 * min + 42 * sec))
        val live = face(state(legs, run = run)) as TileLogic.Live
        // Which set, and its weight and reps, each held on one line: a narrow tile breaks between them.
        assertEquals(TileLogic.Live("Legs", run, null, "Hack Squat · Set\u00A02\u00A0of\u00A02 · 100\u00A0kg\u00A0×\u00A012"), live)
        assertEquals("Workout", TileLogic.label(live, now))
        assertEquals("18:42", TileLogic.time(live, now))
        assertEquals("Continue", live.button)
        // Paused: stopped where it was, and says so.
        val paused = face(state(legs, run = run.copy(pausedAt = now - 2 * min))) as TileLogic.Live
        assertEquals("Paused", TileLogic.label(paused, now))
        assertEquals("16:42", TileLogic.time(paused, now))
    }

    @Test
    fun duringARestItCountsDownAndNamesTheRestedLiftsNextSet() {
        val run = Run(TODAY, startedAt = now - 20 * min)
        // Leg Press done out of order, Hack Squat still to finish: after Leg Press's rest, Leg Press's next set.
        val rest = Rest(TODAY, "Leg Press", endAt = now + 65 * sec, sec = 90)
        val live = face(state(legs, run = run, rest = rest)) as TileLogic.Live
        assertEquals("Leg Press · Set 3 of 4 · 100 kg × 12", read(live.next))
        assertTrue(TileLogic.resting(live, now))
        assertEquals("Rest", TileLogic.label(live, now))
        assertEquals("1:05", TileLogic.time(live, now))
        // Paused: its time left, as it was.
        val paused = face(state(legs, run = run, rest = rest.copy(pausedAt = now - 10 * sec)), now + 5 * min) as TileLogic.Live
        assertFalse(TileLogic.resting(paused, now + 5 * min))
        assertEquals("Rest paused", TileLogic.label(paused, now + 5 * min))
        assertEquals("1:15", TileLogic.time(paused, now + 5 * min))
        // Over, or another day's: the clock again.
        assertEquals(null, (face(state(legs, run = run, rest = rest.copy(endAt = now))) as TileLogic.Live).rest)
        assertEquals(null, (face(state(legs, run = run, rest = rest.copy(day = "2026-09-28"))) as TileLogic.Live).rest)
    }

    @Test
    fun theNextSetFollowsTheWorkoutsOwnOrder() {
        // The rested lift has no set left: the first step not finished.
        val done = day(listOf(lift("Hack Squat", 12, null)), listOf(lift("Leg Press", 12, 12, done = true)))
        assertEquals("Hack Squat · Set 2 of 2 · 100 kg × 12", read(TileLogic.next(done, Rest(TODAY, "Leg Press", now + min))))
        // A superset round by round, named as its letter and round.
        val superset = day(listOf(lift("Leg Curl", 12, null), lift("Calf Raise", null, null)))
        assertEquals("Calf Raise · A2 · round 1 of 2 · 100 kg × 12", read(TileLogic.next(superset, null)))
        // The lifts done: the cardio, then nothing left.
        val lifted = day(listOf(lift("Hack Squat", 12, 12, done = true)), cardio = "Cycling")
        assertEquals("Cycling", TileLogic.next(lifted, null))
        assertEquals("Every set done", TileLogic.next(lifted.copy(cardioDone = true), null))
        // A set's weight first, then its reps, with whichever there is.
        assertEquals("102.5 kg × 8", TileLogic.setWords(102.5, 8))
        assertEquals("12 reps", TileLogic.setWords(null, 12))
        assertEquals("60 kg", TileLogic.setWords(60.0, null))
        assertEquals("", TileLogic.setWords(null, null))
        val noWeight = day(listOf(Lift("Plank", "Plank", false, false, 60, 2.5, "", listOf(SetRow(null, null, null, 30, null)))))
        assertEquals("Plank · Set 1 of 1 · 30 reps", read(TileLogic.next(noWeight, null)))
    }

    @Test
    fun otherwiseItShowsTodaysSessionAndStart() {
        val five = day(*Array(5) { listOf(lift("Lift $it", null)) })
        assertEquals(TileLogic.Idle("Today", "Legs", "5 exercises", "Start"), face(state(five)))
        val two = day(*Array(5) { listOf(lift("Lift $it", if (it < 2) 12 else null, done = it < 2)) })
        assertEquals(TileLogic.Idle("Today", "Legs", "2 of 5 exercises done", "Start"), face(state(two)))
        assertEquals("1 exercise", TileLogic.progress(day(listOf(lift("Squat", null)))))
        // A walk alone: the walk.
        assertEquals(TileLogic.Idle("Today", "Legs", "Walk", "Start"), face(state(day(cardio = "Walk"))))
        assertEquals(TileLogic.Idle("Today", "Rest day", "Recover today. A walk counts.", "Open"), face(state(day())))
        assertEquals(TileLogic.Idle("Today", "Legs", "Skipped today", "Open"), face(state(legs.copy(skipped = true))))
        val all = day(listOf(lift("Squat", 12, done = true)), cardio = "Walk", cardioDone = true)
        assertEquals(TileLogic.Idle("Today", "Legs", "Workout complete", "Review"), face(state(all)))
    }

    @Test
    fun aWorkoutFinishedOrLeftBehindIsNoLongerOnIt() {
        val finished = Run(TODAY, startedAt = now - 50 * min, endedAt = now - 5 * min)
        assertEquals(TileLogic.Idle("Today", "Legs", "5 exercises", "Start"), face(state(day(*Array(5) { listOf(lift("Lift $it", null)) }), run = finished)))
        val left = Run(TODAY, startedAt = now - TimerLogic.LEFT_BEHIND_MS)
        assertTrue(face(state(legs, run = left)) is TileLogic.Idle)
        // One started before midnight stays on it after.
        val late = Run("2026-09-28", startedAt = now - 30 * min)
        val live = face(state(legs.copy(date = "2026-09-28"), day(date = TODAY), run = late))
        assertEquals("Hack Squat · Set 2 of 2 · 100 kg × 12", read((live as TileLogic.Live).next))
    }

    @Test
    fun withNothingToShowItSaysWhatToDo() {
        val signedOut = state(legs).copy(signedIn = false)
        assertEquals(TileLogic.Idle("Gym Log", "", "Sign in on your phone", "Open"), TileLogic.face(ok(signedOut), signedOut, TODAY, now))
        assertEquals(TileLogic.Idle("Gym Log", "", StateLogic.OPEN_PHONE, "Open"), TileLogic.face(null, null, TODAY, now))
        assertEquals(TileLogic.Idle("Gym Log", "", "Update Gym Log on your watch", "Open"), TileLogic.face(StateLogic.Parsed.Newer, null, TODAY, now))
        // A state with no day for today (the phone not opened for a week).
        val old = state(legs.copy(date = "2026-09-20"))
        assertEquals(TileLogic.Idle("Gym Log", "", StateLogic.OPEN_PHONE, "Open"), face(old))
    }

    @Test
    fun itsAskedForAgainOftenDuringAWorkoutAndJustAfterMidnight() {
        val live = face(state(legs, run = Run(TODAY, startedAt = now - min)))
        assertEquals(TileLogic.LIVE_FRESH_MS, TileLogic.freshMs(live, now, ZoneOffset.UTC))
        val idle = face(state(legs))
        assertEquals(TileLogic.IDLE_FRESH_MS, TileLogic.freshMs(idle, now, ZoneOffset.UTC))
        val late = Instant.parse("2026-09-29T23:50:00Z").toEpochMilli()
        assertEquals(11 * min, TileLogic.freshMs(idle, late, ZoneOffset.UTC))
    }
}
