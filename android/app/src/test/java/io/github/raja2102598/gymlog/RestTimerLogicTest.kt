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
        // One UI shows it beside the icon instead of just "Gym Log"; Android's own chip would show it instead of the
        // ticking chronometer, so everywhere else there's none.
        assertEquals("Till 10:14", RestTimerLogic.shortFor("samsung", RestTimerLogic.restShort("10:14")))
        assertEquals("2/5 done", RestTimerLogic.shortFor("Samsung", "2/5 done"))
        assertNull(RestTimerLogic.shortFor("Google", "2/5 done"))
        assertNull(RestTimerLogic.shortFor("", "2/5 done"))
        assertNull(RestTimerLogic.shortFor("samsung", "")) // no exercises yet: the app's name, as before
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
