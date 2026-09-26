package io.github.raja2102598.gymlog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun titleFallsBackWithoutALiftName() {
        assertEquals("Bench press", RestTimerLogic.titleFor("Bench press"))
        assertEquals("Rest timer", RestTimerLogic.titleFor(""))
        assertEquals("Rest timer", RestTimerLogic.titleFor("   "))
    }

    @Test
    fun textSaysWhetherItsOver() {
        assertEquals("Resting", RestTimerLogic.textFor(ended = false))
        assertEquals("Rest over", RestTimerLogic.textFor(ended = true))
    }
}
