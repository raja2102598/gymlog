package io.github.raja2102598.gymlog.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The workout clock and the rest timer, done as the phone does them (lib/workout.ts, store.ts's rest timer). */
class TimerLogicTest {
    private val t0 = 1_000_000L
    private val min = 60_000L

    @Test
    fun theClockCountsUpLessThePauses() {
        val r = Run("2026-09-29", startedAt = t0, pausedMs = 2 * min)
        assertEquals(8 * min, TimerLogic.runMs(r, t0 + 10 * min)) // ten minutes in, two of them paused before
        // Paused three minutes ago: stopped there.
        assertEquals(5 * min, TimerLogic.runMs(r.copy(pausedAt = t0 + 7 * min), t0 + 10 * min))
        // Finished: stopped at its end, however long ago.
        assertEquals(6 * min, TimerLogic.runMs(r.copy(endedAt = t0 + 8 * min), t0 + 60 * min))
        assertEquals(0L, TimerLogic.runMs(r, t0 - min)) // a clock ahead of the watch's never goes negative
        assertEquals(480L, TimerLogic.runSec(r, t0 + 10 * min))
    }

    @Test
    fun pausingAndResumingTheClock() {
        val r = Run("2026-09-29", startedAt = t0)
        val paused = TimerLogic.pauseRun(r, t0 + 5 * min)
        assertEquals(t0 + 5 * min, paused.pausedAt)
        assertEquals(paused, TimerLogic.pauseRun(paused, t0 + 9 * min)) // already paused: stays as it was
        val resumed = TimerLogic.resumeRun(paused, t0 + 8 * min)
        assertEquals(null, resumed.pausedAt)
        assertEquals(3 * min, resumed.pausedMs)
        assertEquals(listOf(Pause(t0 + 5 * min, t0 + 8 * min)), resumed.pauses) // kept, as the phone keeps it
        assertEquals(7 * min, TimerLogic.runMs(resumed, t0 + 10 * min))
        assertEquals(r, TimerLogic.resumeRun(r, t0 + 9 * min)) // running: nothing to resume
        val ended = TimerLogic.endRun(r, t0 + 20 * min)
        assertEquals(ended, TimerLogic.pauseRun(ended, t0 + 21 * min)) // finished: nothing to pause
        assertEquals(t0 + 20 * min, TimerLogic.endRun(ended, t0 + 30 * min).endedAt) // finishing twice keeps the first
    }

    @Test
    fun aClockLeftRunningForHoursIsNoLongerUnderWay() {
        val r = Run("2026-09-29", startedAt = t0)
        assertTrue(TimerLogic.underWay(r, t0 + 179 * min))
        assertFalse(TimerLogic.underWay(r, t0 + 180 * min))
        // Paused on purpose after three hours and more of it: it waits, however long.
        assertTrue(TimerLogic.underWay(r.copy(pausedAt = t0 + 200 * min), t0 + 600 * min))
        assertFalse(TimerLogic.underWay(r.copy(endedAt = t0 + min), t0 + 2 * min))
        assertFalse(TimerLogic.underWay(null, t0))
    }

    @Test
    fun theRestCountsDownFromItsEnd() {
        val r = Rest("2026-09-29", "Squat", endAt = t0 + 90_000L, sec = 90)
        assertEquals(60_000L, TimerLogic.restLeftMs(r, t0 + 30_000L))
        assertEquals(60L, TimerLogic.restLeftSec(r, t0 + 30_400L)) // 59.6 s: rounded, as the phone rounds it
        assertEquals(0L, TimerLogic.restLeftMs(r, t0 + 100_000L))
        assertFalse(TimerLogic.restOver(r, t0 + 89_999L))
        assertTrue(TimerLogic.restOver(r, t0 + 90_000L))
        // Paused: what was left stays, and it's never over.
        val paused = TimerLogic.pauseRest(r, t0 + 30_000L)
        assertEquals(60_000L, TimerLogic.restLeftMs(paused, t0 + 500_000L))
        assertFalse(TimerLogic.restOver(paused, t0 + 500_000L))
        assertEquals(paused, TimerLogic.pauseRest(paused, t0 + 40_000L))
    }

    @Test
    fun resumingARestKeepsWhatWasLeft() {
        val r = Rest("2026-09-29", "Squat", endAt = t0 + 90_000L, pausedAt = t0 + 30_000L, sec = 90)
        val resumed = TimerLogic.resumeRest(r, t0 + 200_000L)
        assertEquals(null, resumed.pausedAt)
        assertEquals(t0 + 260_000L, resumed.endAt) // the 60 s it had, from then
        val running = r.copy(pausedAt = null)
        assertEquals(running, TimerLogic.resumeRest(running, t0 + 50_000L))
    }

    @Test
    fun plusFifteenPushesTheEndOut() {
        val r = Rest("2026-09-29", "Squat", endAt = t0 + 90_000L, sec = 90)
        assertEquals(t0 + 105_000L, TimerLogic.addRest(r, 15, t0 + 10_000L).endAt)
        // Already over: fifteen seconds from now, not from when it ended.
        assertEquals(t0 + 215_000L, TimerLogic.addRest(r, 15, t0 + 200_000L).endAt)
        // Paused: added to what's left.
        val paused = r.copy(pausedAt = t0 + 30_000L)
        assertEquals(t0 + 105_000L, TimerLogic.addRest(paused, 15, t0 + 200_000L).endAt)
    }

    @Test
    fun theRingIsHowMuchIsLeft() {
        val r = Rest("2026-09-29", "Squat", endAt = t0 + 90_000L, sec = 90)
        assertEquals(1f, TimerLogic.restFraction(r, t0, 60), 0.001f)
        assertEquals(0.5f, TimerLogic.restFraction(r, t0 + 45_000L, 60), 0.001f)
        assertEquals(0f, TimerLogic.restFraction(r, t0 + 95_000L, 60), 0.001f)
        // +15 s past its length: full, then down from there.
        assertEquals(1f, TimerLogic.restFraction(r.copy(endAt = t0 + 105_000L), t0, 60), 0.001f)
        assertEquals(52.5f / 90f, TimerLogic.restFraction(r.copy(endAt = t0 + 105_000L), t0 + 52_500L, 60), 0.001f) // of its 1:30
        // No length sent: the lift's own rest.
        assertEquals(0.5f, TimerLogic.restFraction(r.copy(sec = null, endAt = t0 + 30_000L), t0, 60), 0.001f)
    }

    @Test
    fun anAlarmOnlyBuzzesForTheRestThereStillIs() {
        val r = Rest("2026-09-29", "Squat", endAt = t0 + 90_000L)
        assertTrue(TimerLogic.alarmStillDue(r, t0 + 90_000L))
        assertTrue(TimerLogic.alarmStillDue(r, t0 + 90_400L))
        assertFalse(TimerLogic.alarmStillDue(null, t0 + 90_000L)) // skipped
        assertFalse(TimerLogic.alarmStillDue(r.copy(pausedAt = t0), t0 + 90_000L))
        assertFalse(TimerLogic.alarmStillDue(r.copy(endAt = t0 + 105_000L), t0 + 90_000L)) // +15 s moved it on
        // "Rest over" goes once there's a rest with time to come, counting or paused: a new one, or this one pushed
        // out by +15 s. It stays while the rest is over, and with no rest.
        assertTrue(TimerLogic.restToCome(r, t0 + 30_000L))
        assertTrue(TimerLogic.restToCome(r.copy(pausedAt = t0 + 30_000L), t0 + 500_000L))
        assertFalse(TimerLogic.restToCome(r, t0 + 90_000L))
        assertTrue(TimerLogic.restToCome(TimerLogic.addRest(r, 15, t0 + 95_000L), t0 + 95_000L))
        assertFalse(TimerLogic.restToCome(null, t0))
    }

    @Test
    fun timesReadAsThePhoneWritesThem() {
        assertEquals("0:00", TimerLogic.clock(0))
        assertEquals("18:42", TimerLogic.clock(18 * 60 + 42L))
        assertEquals("1:05:10", TimerLogic.clock(3600 + 5 * 60 + 10L))
        assertEquals("1:30", TimerLogic.mmss(90))
        assertEquals("0:05", TimerLogic.mmss(5))
        assertEquals("0:00", TimerLogic.mmss(-3))
    }
}
