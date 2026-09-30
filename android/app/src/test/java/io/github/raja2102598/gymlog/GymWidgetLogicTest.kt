package io.github.raja2102598.gymlog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The home-screen widget's data without Android (see src/native/widget.ts for the JavaScript side that writes it,
 * and GymWidgetProvider for the RemoteViews that show it).
 */
class GymWidgetLogicTest {
    private val json = """{"date":"2026-09-25","session":"Push day","done":2,"planned":5,"restEndsAt":null}"""

    @Test
    fun parsesASnapshotsFields() {
        val s = GymWidgetLogic.parse(json)
        assertEquals("2026-09-25", s?.date)
        assertEquals("Push day", s?.session)
        assertEquals(2, s?.done)
        assertEquals(5, s?.planned)
        assertNull(s?.restEndsAt)
    }

    @Test
    fun parsesARestEndsAtWhenItsThere() {
        val s = GymWidgetLogic.parse("""{"date":"2026-09-25","session":"Push day","done":0,"planned":3,"restEndsAt":"2026-09-25T10:32:00Z"}""")
        assertEquals("2026-09-25T10:32:00Z", s?.restEndsAt)
    }

    @Test
    fun somethingThatIsntThisJsonParsesToNull() {
        assertNull(GymWidgetLogic.parse(null))
        assertNull(GymWidgetLogic.parse(""))
        assertNull(GymWidgetLogic.parse("<html>Not Found</html>"))
        assertNull(GymWidgetLogic.parse("{}"))
        // Short a required field (planned).
        assertNull(GymWidgetLogic.parse("""{"date":"2026-09-25","session":"Push day","done":2}"""))
    }

    @Test
    fun toJsonRoundTripsThroughParse() {
        val s = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Push day", 2, 5, null))
        assertEquals("2026-09-25", s?.date)
        assertEquals("Push day", s?.session)
        assertEquals(2, s?.done)
        assertEquals(5, s?.planned)
        assertNull(s?.restEndsAt)
        val withRest = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Push day", 2, 5, "2026-09-25T10:32:00Z"))
        assertEquals("2026-09-25T10:32:00Z", withRest?.restEndsAt)
        assertEquals("2026-09-25T10:00:00Z", GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Push day", 2, 5, null, workoutSince = "2026-09-25T10:00:00Z"))?.workoutSince)
    }

    @Test
    fun isCurrentForTodaysOwnDateOrWhileItsWorkoutIsUnderWay() {
        val s = GymWidgetLogic.parse(json)!!
        assertTrue(GymWidgetLogic.isCurrent(s, "2026-09-25", 0L))
        assertFalse(GymWidgetLogic.isCurrent(s, "2026-09-26", 0L))
        assertFalse(GymWidgetLogic.isCurrent(s, "2026-09-24", 0L))
        // Another day's workout, opened on the 25th for the Monday gone by: current while its clock counts, and not
        // once it's left behind, or before it started by the phone's clock (set back since).
        val since = java.time.Instant.parse("2026-09-25T10:00:00Z").toEpochMilli()
        val monday = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-21", "Push day", 2, 5, null, workoutSince = "2026-09-25T10:00:00Z"))!!
        assertTrue(GymWidgetLogic.isCurrent(monday, "2026-09-25", since + 60_000))
        assertTrue(GymWidgetLogic.isCurrent(monday, "2026-09-25", since + GymWidgetLogic.STALE_WORKOUT_MS - 1))
        assertFalse(GymWidgetLogic.isCurrent(monday, "2026-09-25", since + GymWidgetLogic.STALE_WORKOUT_MS))
        assertFalse(GymWidgetLogic.isCurrent(monday, "2026-09-25", since - 60_000))
    }

    @Test
    fun displayShowsTheSessionAndProgressForToday() {
        val d = GymWidgetLogic.display(GymWidgetLogic.parse(json), "2026-09-25", 0L)
        assertEquals("Push day", d.title)
        assertEquals("2/5 lifts", d.subtitle)
    }

    @Test
    fun aWorkoutStartedBeforeMidnightKeepsItsSessionProgressAndClockUntilLeftBehind() {
        // Tuesday's Pull, started at 23:40 with a lift done, and the widget drawn again at 00:30 on Wednesday.
        val since = java.time.Instant.parse("2026-09-22T23:40:00Z").toEpochMilli()
        val late = java.time.Instant.parse("2026-09-23T00:30:00Z").toEpochMilli()
        val pull = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-22", "Pull", 1, 6, null, workoutSince = "2026-09-22T23:40:00Z"))
        assertEquals(GymWidgetLogic.Display("Pull", "1/6 lifts"), GymWidgetLogic.display(pull, "2026-09-23", late))
        assertEquals(GymWidgetLogic.Clock(rest = false, atMs = since), GymWidgetLogic.clock(pull, "2026-09-23", late))
        val leftBehind = since + GymWidgetLogic.STALE_WORKOUT_MS
        assertEquals(leftBehind, GymWidgetLogic.nextChangeMs(pull, "2026-09-23", late))
        // A rest in it counts down, and the widget is drawn again when it's over, or when the workout would be left
        // behind if that comes first.
        fun resting(endsMs: Long) = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-22", "Pull", 1, 6, java.time.Instant.ofEpochMilli(endsMs).toString(), workoutSince = "2026-09-22T23:40:00Z"))
        val ends = late + 90_000
        assertEquals(GymWidgetLogic.Clock(rest = true, atMs = ends), GymWidgetLogic.clock(resting(ends), "2026-09-23", late))
        assertEquals(ends, GymWidgetLogic.nextChangeMs(resting(ends), "2026-09-23", late))
        val restingPast = resting(leftBehind + 30_000)
        assertEquals(leftBehind, GymWidgetLogic.nextChangeMs(restingPast, "2026-09-23", leftBehind - 60_000))
        // Drawn again then, with or without the app running, it's a day that has passed: nothing of it shows.
        for (s in listOf(pull, restingPast)) {
            assertEquals(GymWidgetLogic.Display("Gym Log", "Open Gym Log"), GymWidgetLogic.display(s, "2026-09-23", leftBehind))
            assertNull(GymWidgetLogic.clock(s, "2026-09-23", leftBehind))
            assertNull(GymWidgetLogic.nextChangeMs(s, "2026-09-23", leftBehind))
        }
    }

    @Test
    fun theClockCountsARunningRestDownThenTheWorkoutUp() {
        val since = "2026-09-25T10:00:00Z"
        val s = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Push day", 2, 5, "2026-09-25T10:32:00Z", workoutSince = since))
        val ends = java.time.Instant.parse("2026-09-25T10:32:00Z").toEpochMilli()
        val start = java.time.Instant.parse(since).toEpochMilli()
        // Resting: the rest counts down, and the widget is drawn again when it's over.
        assertEquals(GymWidgetLogic.Clock(rest = true, atMs = ends), GymWidgetLogic.clock(s, "2026-09-25", ends - 60_000))
        assertEquals(ends, GymWidgetLogic.nextChangeMs(s, "2026-09-25", ends - 60_000))
        // Over: the workout counts up, until it would count as left behind.
        assertEquals(GymWidgetLogic.Clock(rest = false, atMs = start), GymWidgetLogic.clock(s, "2026-09-25", ends))
        assertEquals(start + GymWidgetLogic.STALE_WORKOUT_MS, GymWidgetLogic.nextChangeMs(s, "2026-09-25", ends))
        // The progress beside it is just the progress.
        assertEquals("2/5 lifts", GymWidgetLogic.display(s, "2026-09-25", ends).subtitle)
    }

    @Test
    fun theClockShowsNothingLeftBehindUnreadableOrFromAnotherDay() {
        val since = java.time.Instant.parse("2026-09-25T10:00:00Z").toEpochMilli()
        val working = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Push day", 2, 5, null, workoutSince = "2026-09-25T10:00:00Z"))
        assertNull(GymWidgetLogic.clock(working, "2026-09-25", since + GymWidgetLogic.STALE_WORKOUT_MS))
        assertNull(GymWidgetLogic.nextChangeMs(working, "2026-09-25", since + GymWidgetLogic.STALE_WORKOUT_MS))
        // From a day that has passed with no workout under way: not even a rest that's still running.
        val resting = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Push day", 2, 5, "2026-09-26T00:02:00Z"))
        assertNull(GymWidgetLogic.clock(resting, "2026-09-26", java.time.Instant.parse("2026-09-26T00:01:00Z").toEpochMilli()))
        val odd = GymWidgetLogic.parse("""{"date":"2026-09-25","session":"Push day","done":2,"planned":5,"restEndsAt":"soon","workoutSince":"earlier"}""")
        assertNull(GymWidgetLogic.clock(odd, "2026-09-25", 0L))
        // A snapshot from before the clock was added has none.
        assertNull(GymWidgetLogic.parse(json)!!.workoutSince)
        assertNull(GymWidgetLogic.clock(GymWidgetLogic.parse(json), "2026-09-25", 0L))
    }

    @Test
    fun displayShowsARestDayWithNothingPlanned() {
        val rest = GymWidgetLogic.parse("""{"date":"2026-09-25","session":"Rest","done":0,"planned":0,"restEndsAt":null}""")
        val d = GymWidgetLogic.display(rest, "2026-09-25", 0L)
        assertEquals("Rest", d.title)
        assertEquals("Rest day", d.subtitle)
    }

    @Test
    fun displaySaysSkippedForASkippedWorkout() {
        val skipped = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Upper", 0, 6, null, skipped = true))
        assertTrue(skipped?.skipped == true)
        val d = GymWidgetLogic.display(skipped, "2026-09-25", 0L)
        assertEquals("Upper", d.title)
        assertEquals("Skipped", d.subtitle)
        // A snapshot written before skipping existed doesn't say, and isn't skipped.
        assertFalse(GymWidgetLogic.parse(json)!!.skipped)
    }

    @Test
    fun displayIsNeutralOnceTheDayHasPassed() {
        val d = GymWidgetLogic.display(GymWidgetLogic.parse(json), "2026-09-26", 0L)
        assertEquals("Gym Log", d.title)
        assertEquals("Open Gym Log", d.subtitle)
    }

    @Test
    fun displayIsNeutralWithNoDataAtAll() {
        val d = GymWidgetLogic.display(null, "2026-09-25", 0L)
        assertEquals("Gym Log", d.title)
        assertEquals("Open Gym Log", d.subtitle)
    }

    @Test
    fun onlyAWidgetWideEnoughShowsTheShortcuts() {
        assertFalse(GymWidgetLogic.showsShortcuts(90))
        assertTrue(GymWidgetLogic.showsShortcuts(180))
        assertTrue(GymWidgetLogic.showsShortcuts(250))
    }

    @Test
    fun aWideButShortWidgetLeavesTheShortcutsOut() {
        assertFalse(GymWidgetLogic.showsShortcuts(250, 64))
        assertFalse(GymWidgetLogic.showsShortcuts(250, 100))
        assertTrue(GymWidgetLogic.showsShortcuts(250, 110))
        assertFalse(GymWidgetLogic.showsShortcuts(90, 200))
        assertTrue(GymWidgetLogic.showsShortcuts(250, 0)) // a launcher that doesn't say how tall: by width, as before
    }
}
