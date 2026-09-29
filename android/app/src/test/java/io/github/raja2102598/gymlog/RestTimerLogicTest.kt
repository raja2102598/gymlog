package io.github.raja2102598.gymlog

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rest timer's background alert, checked without Android or a network (see store.ts and tests/unit/rest.test.ts
 *  for the JavaScript side: starting, pausing, and the sensible-default plan and lift fields). */
class RestTimerLogicTest {
    @Test
    fun exactAlarmsAreAlwaysFineBeforeAndroid12() {
        assertTrue(RestTimerLogic.useExactAlarm(sdkInt = 30, canScheduleExact = false))
        assertTrue(RestTimerLogic.useExactAlarm(sdkInt = 21, canScheduleExact = false))
    }

    @Test
    fun fromAndroid12OnExactNeedsThePhonesPermission() {
        assertTrue(RestTimerLogic.useExactAlarm(sdkInt = 31, canScheduleExact = true))
        assertFalse(RestTimerLogic.useExactAlarm(sdkInt = 33, canScheduleExact = false))
    }

    @Test
    fun remainingMsNeverGoesNegative() {
        assertEquals(5000L, RestTimerLogic.remainingMs(endAt = 15000L, now = 10000L))
        assertEquals(0L, RestTimerLogic.remainingMs(endAt = 10000L, now = 15000L))
        assertEquals(0L, RestTimerLogic.remainingMs(endAt = 10000L, now = 10000L))
    }

    @Test
    fun theCountdownSaysWhatsHappeningThenWhatsNext() {
        assertEquals("Resting · Chest-Supported Row", RestTimerLogic.restTitle("Chest-Supported Row"))
        assertEquals("Resting", RestTimerLogic.restTitle(""))
        assertEquals("Resting", RestTimerLogic.restTitle("   "))
        assertEquals("Next: set 3 of 4", RestTimerLogic.restText("Next: set 3 of 4", endsAt = "10:14"))
        assertEquals("Rest over at 10:14", RestTimerLogic.restText(" ", endsAt = "10:14")) // nothing left to do
    }

    @Test
    fun restOverNamesTheLiftAndWhatsNext() {
        assertEquals("Rest over", RestTimerLogic.OVER_TITLE)
        assertEquals("Bench press · Next: set 3 of 4", RestTimerLogic.overText("Bench press", "Next: set 3 of 4"))
        assertEquals("Bench press", RestTimerLogic.overText("Bench press", ""))
        assertEquals("Next: Squat", RestTimerLogic.overText(" ", "Next: Squat"))
        assertEquals("Time for your next set", RestTimerLogic.overText("", ""))
    }

    @Test
    fun onlySamsungsNowBarGetsAShortText() {
        // Set for One UI's Now Bar, which may or may not show it; Android's own chip would show it instead of the
        // ticking chronometer, so everywhere else there's none. (From Android 17 there's none at all: see below.)
        assertEquals("Till 10:14", RestTimerLogic.shortFor("samsung", RestTimerLogic.restShort("10:14")))
        assertEquals("2/5 done", RestTimerLogic.shortFor("Samsung", "2/5 done"))
        assertNull(RestTimerLogic.shortFor("Google", "2/5 done"))
        assertNull(RestTimerLogic.shortFor("", "2/5 done"))
        assertNull(RestTimerLogic.shortFor("samsung", "")) // no exercises yet: the app's name, as before
    }

    @Test
    fun metricStyleFromAndroid17On() {
        // Where Notification.MetricStyle exists; RestAlarm.post then sets no short critical text, whatever the phone.
        assertFalse(RestTimerLogic.metricStyle(sdkInt = 26))
        assertFalse(RestTimerLogic.metricStyle(sdkInt = 36))
        assertTrue(RestTimerLogic.metricStyle(sdkInt = 37))
        assertTrue(RestTimerLogic.metricStyle(sdkInt = 38))
    }

    @Test
    fun theCountdownsMetricsAreItsClockThenWhatsNext() {
        val endAt = 1_790_000_000_000L
        assertEquals(
            listOf(RestTimerLogic.LiveMetric.Timer("Rest", endAt), RestTimerLogic.LiveMetric.Text("Next", "Set 3 of 4")),
            RestTimerLogic.restMetrics(endAt, "Next: set 3 of 4"),
        )
        assertEquals(RestTimerLogic.LiveMetric.Text("Next", "Sissy Squat + Hamstring Curl"), RestTimerLogic.restMetrics(endAt, "Next: Sissy Squat + Hamstring Curl")[1])
        assertEquals(listOf(RestTimerLogic.LiveMetric.Timer("Rest", endAt)), RestTimerLogic.restMetrics(endAt, " ")) // Finish workout
    }

    @Test
    fun theWorkoutsMetricsAreItsClockThenExercisesDone() {
        val since = 1_790_000_000_000L
        assertEquals(
            listOf(RestTimerLogic.LiveMetric.Stopwatch("Workout", since), RestTimerLogic.LiveMetric.Text("Exercises", "2/5")),
            RestTimerLogic.workoutMetrics(since, "2/5 done"),
        )
        assertEquals(listOf(RestTimerLogic.LiveMetric.Stopwatch("Workout", since)), RestTimerLogic.workoutMetrics(since, "")) // no exercises yet
    }

    @Test
    fun metricLabelsFitAndroids10Characters() {
        val all = RestTimerLogic.restMetrics(0L, "Next: set 1 of 3") + RestTimerLogic.workoutMetrics(0L, "0/5 done")
        assertEquals(4, all.size)
        all.forEach { assertTrue(it.label, it.label.length <= 10) }
    }

    @Test
    fun onlyASamsungIsASamsung() {
        assertTrue(RestTimerLogic.samsungPhone("samsung"))
        assertTrue(RestTimerLogic.samsungPhone(" Samsung "))
        assertFalse(RestTimerLogic.samsungPhone("Google"))
        assertFalse(RestTimerLogic.samsungPhone(""))
    }

    @Test
    fun aSamsungGetsTheNowBarsAutomationPairAndNothingElse() {
        val pkg = "io.github.raja2102598.gymlog"
        assertEquals(
            mapOf("android.ongoingActivityNoti.automation" to true, "android.ongoingActivityNoti.automationPackage" to pkg),
            RestTimerLogic.samsungExtras("samsung", pkg, card = null),
        )
        assertEquals(emptyMap<String, Any>(), RestTimerLogic.samsungExtras("Google", pkg, card = null))
    }

    @Test
    fun withTheCardOnASamsungGetsTheCardsFieldsInstead() {
        val pkg = "io.github.raja2102598.gymlog"
        val card = RestTimerLogic.SamsungCard("Resting · Leg Press", "Next: set 3 of 4", "Till 10:14")
        assertEquals(
            mapOf(
                "android.ongoingActivityNoti.style" to 1,
                "android.ongoingActivityNoti.primaryInfo" to "Resting · Leg Press",
                "android.ongoingActivityNoti.secondaryInfo" to "Next: set 3 of 4",
                "android.ongoingActivityNoti.chipExpandedText" to "Till 10:14",
                "android.ongoingActivityNoti.nowbarPrimaryInfo" to "Resting · Leg Press",
                "android.ongoingActivityNoti.nowbarSecondaryInfo" to "Next: set 3 of 4",
                "android.ongoingActivityNoti.chronometerRemoteViewPosition" to 1,
                "android.ongoingActivityNoti.chronometerRemoteViewTag" to "gymlog_clock",
                "android.ongoingActivityNoti.nowbarChronometerPosition" to 1,
            ),
            RestTimerLogic.samsungExtras("Samsung", pkg, card),
        )
        // The card's style cancels the automation pair, so that doesn't come too; and other phones get neither.
        assertEquals(emptyMap<String, Any>(), RestTimerLogic.samsungExtras("Google", pkg, card))
    }

    @Test
    fun clockTimeFollowsThePhones12Or24HourSetting() {
        val zone = ZoneId.of("Asia/Kolkata")
        val at = ZonedDateTime.of(2026, 9, 29, 22, 14, 40, 0, zone).toInstant().toEpochMilli()
        assertEquals("10:14", RestTimerLogic.clockTime(at, zone, is24Hour = false))
        assertEquals("22:14", RestTimerLogic.clockTime(at, zone, is24Hour = true))
        val morning = ZonedDateTime.of(2026, 9, 29, 9, 5, 0, 0, zone).toInstant().toEpochMilli()
        assertEquals("9:05", RestTimerLogic.clockTime(morning, zone, is24Hour = false))
        assertEquals("9:05", RestTimerLogic.clockTime(morning, zone, is24Hour = true))
    }
}
