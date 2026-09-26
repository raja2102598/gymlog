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
    fun isCurrentOnlyForTodaysOwnDate() {
        val s = GymWidgetLogic.parse(json)!!
        assertTrue(GymWidgetLogic.isCurrent(s, "2026-09-25"))
        assertFalse(GymWidgetLogic.isCurrent(s, "2026-09-26"))
        assertFalse(GymWidgetLogic.isCurrent(s, "2026-09-24"))
    }

    @Test
    fun displayShowsTheSessionAndProgressForToday() {
        val d = GymWidgetLogic.display(GymWidgetLogic.parse(json), "2026-09-25")
        assertEquals("Push day", d.title)
        assertEquals("2/5 lifts", d.subtitle)
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
        assertEquals("2/5 lifts", GymWidgetLogic.display(s, "2026-09-25").subtitle)
    }

    @Test
    fun theClockShowsNothingLeftBehindUnreadableOrFromAnotherDay() {
        val since = java.time.Instant.parse("2026-09-25T10:00:00Z").toEpochMilli()
        val working = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Push day", 2, 5, null, workoutSince = "2026-09-25T10:00:00Z"))
        assertNull(GymWidgetLogic.clock(working, "2026-09-25", since + GymWidgetLogic.STALE_WORKOUT_MS))
        assertNull(GymWidgetLogic.nextChangeMs(working, "2026-09-25", since + GymWidgetLogic.STALE_WORKOUT_MS))
        assertNull(GymWidgetLogic.clock(working, "2026-09-26", since + 60_000))
        val odd = GymWidgetLogic.parse("""{"date":"2026-09-25","session":"Push day","done":2,"planned":5,"restEndsAt":"soon","workoutSince":"earlier"}""")
        assertNull(GymWidgetLogic.clock(odd, "2026-09-25", 0L))
        // A snapshot from before the clock was added has none.
        assertNull(GymWidgetLogic.parse(json)!!.workoutSince)
        assertNull(GymWidgetLogic.clock(GymWidgetLogic.parse(json), "2026-09-25", 0L))
    }

    @Test
    fun displayShowsARestDayWithNothingPlanned() {
        val rest = GymWidgetLogic.parse("""{"date":"2026-09-25","session":"Rest","done":0,"planned":0,"restEndsAt":null}""")
        val d = GymWidgetLogic.display(rest, "2026-09-25")
        assertEquals("Rest", d.title)
        assertEquals("Rest day", d.subtitle)
    }

    @Test
    fun displaySaysSkippedForASkippedWorkout() {
        val skipped = GymWidgetLogic.parse(GymWidgetLogic.toJson("2026-09-25", "Upper", 0, 6, null, skipped = true))
        assertTrue(skipped?.skipped == true)
        val d = GymWidgetLogic.display(skipped, "2026-09-25")
        assertEquals("Upper", d.title)
        assertEquals("Skipped", d.subtitle)
        // A snapshot written before skipping existed doesn't say, and isn't skipped.
        assertFalse(GymWidgetLogic.parse(json)!!.skipped)
    }

    @Test
    fun displayIsNeutralOnceTheDayHasPassed() {
        val d = GymWidgetLogic.display(GymWidgetLogic.parse(json), "2026-09-26")
        assertEquals("Gym Log", d.title)
        assertEquals("Open Gym Log", d.subtitle)
    }

    @Test
    fun displayIsNeutralWithNoDataAtAll() {
        val d = GymWidgetLogic.display(null, "2026-09-25")
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
