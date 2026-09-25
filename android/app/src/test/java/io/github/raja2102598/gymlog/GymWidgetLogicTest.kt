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
    fun displayShowsARestDayWithNothingPlanned() {
        val rest = GymWidgetLogic.parse("""{"date":"2026-09-25","session":"Rest","done":0,"planned":0,"restEndsAt":null}""")
        val d = GymWidgetLogic.display(rest, "2026-09-25")
        assertEquals("Rest", d.title)
        assertEquals("Rest day", d.subtitle)
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
}
