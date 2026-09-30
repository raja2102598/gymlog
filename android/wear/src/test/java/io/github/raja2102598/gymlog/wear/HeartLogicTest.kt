package io.github.raja2102598.gymlog.wear

import io.github.raja2102598.gymlog.wear.Fixtures.TODAY
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The workout's heart rate on the watch (docs/watch.md): which readings count, their average and highest, when the
 *  day's goes to the phone as `hr`, and the reading on screen. */
class HeartLogicTest {
    private val t0 = 1_000_000L
    private val min = 60_000L
    private val run = Run(TODAY, startedAt = t0)

    private fun beats(vararg bpm: Double, from: Long = t0 + min) = bpm.mapIndexed { i, b -> Beat(b, from + i * 1_000L) }

    @Test
    fun theAverageAndHighestAreOverEveryReadingCounted() {
        val first = HeartLogic.add(null, run, beats(102.0, 165.4, 131.0), now = t0 + min)
        assertEquals(3, first.samples)
        assertEquals(398.4, first.sum, 1e-9)
        assertEquals(165, first.max) // to the nearest beat
        assertEquals(133, HeartLogic.avg(first)) // 132.8, rounded
        assertEquals(t0 + min, first.sentAt) // the time for sending starts with the day's count
        // More readings add to the day's, rather than start it again: the highest stays the day's.
        val more = HeartLogic.add(first, run, beats(120.0, 140.0, from = t0 + 2 * min), now = t0 + 2 * min)
        assertEquals(5, more.samples)
        assertEquals(165, more.max)
        assertEquals(132, HeartLogic.avg(more)) // 658.4 / 5 = 131.68
        assertEquals(t0 + min, more.sentAt)
        assertEquals(0, HeartLogic.avg(Heart(TODAY, 0.0, 0, 0)))
    }

    @Test
    fun onlyTheWorkoutsReadingsCountAndOnlyAHeartRate() {
        // Before the clock started, after Finish, and since it was paused: not the workout's.
        assertFalse(HeartLogic.counts(run, t0 - 1))
        assertTrue(HeartLogic.counts(run, t0))
        assertFalse(HeartLogic.counts(run.copy(endedAt = t0 + min), t0 + min + 1))
        assertTrue(HeartLogic.counts(run.copy(endedAt = t0 + min), t0 + min))
        assertFalse(HeartLogic.counts(run.copy(pausedAt = t0 + min), t0 + min))
        assertTrue(HeartLogic.counts(run.copy(pausedAt = t0 + min), t0 + min - 1))
        val paused = HeartLogic.add(null, run.copy(pausedAt = t0 + min + 1_500L), beats(100.0, 110.0, 190.0), now = t0 + 2 * min)
        assertEquals(2, paused.samples)
        assertEquals(110, paused.max)
        // The sensor's noise, off the wrist: out of range, never counted.
        val noise = HeartLogic.add(null, run, beats(0.0, 29.9, 30.0, 240.0, 240.1), now = t0 + min)
        assertEquals(2, noise.samples)
        assertEquals(240, noise.max)
    }

    @Test
    fun aReadingHandedOverAgainCountsOnce() {
        // Health Services hands its last readings over again when the callback is set anew (the app restarted).
        val first = HeartLogic.add(null, run, beats(100.0, 120.0), now = t0 + min)
        assertEquals(first, HeartLogic.add(first, run, beats(100.0, 120.0), now = t0 + 2 * min))
        val again = HeartLogic.add(first, run, beats(100.0, 120.0, 150.0), now = t0 + 2 * min)
        assertEquals(3, again.samples)
        assertEquals(370.0, again.sum, 0.0)
    }

    @Test
    fun eachDayAndAccountHasItsOwn() {
        val today = HeartLogic.add(null, run, beats(120.0), now = t0 + min)
        val tomorrow = HeartLogic.add(today, Run("2026-09-30", startedAt = t0), beats(90.0), now = t0 + 2 * min)
        assertEquals(Heart("2026-09-30", 90.0, 1, 90, sentAt = t0 + 2 * min, lastAt = t0 + min), tomorrow)
        // The phone signed out of a and into b since: b's workout that day starts its own count, and each day's `hr`
        // goes to the account it was measured in.
        val a = HeartLogic.add(null, run, beats(120.0, 130.0), now = t0 + min, account = "a")
        assertEquals(3, HeartLogic.add(a, run, beats(125.0, from = t0 + 2 * min), now = t0 + 2 * min, account = "a").samples) // a's own adds to it
        val b = HeartLogic.add(a, run, beats(90.0, from = t0 + 2 * min), now = t0 + 2 * min, account = "b")
        assertEquals(Heart(TODAY, 90.0, 1, 90, sentAt = t0 + 2 * min, lastAt = t0 + 2 * min, account = "b"), b)
        assertEquals(listOf("a", "b"), listOf(a, b).map { HeartLogic.command("c-1", t0, it).account })
        // A week's kept, the latest.
        val days = (1..9).associate { d -> "2026-09-0$d" to Heart("2026-09-0$d", 100.0, 1, 100) }
        assertEquals((3..9).map { "2026-09-0$it" }.toSet(), HeartLogic.keep(days).keys)
    }

    @Test
    fun itGoesToThePhoneEveryFiveMinutesAndAtTheEndWhenThereIsMore() {
        val h = HeartLogic.add(null, run, beats(120.0, 130.0), now = t0)
        assertFalse(HeartLogic.due(null, t0 + 60 * min, ending = true))
        // During the workout: five minutes after the day's first readings, then five after each send.
        assertFalse(HeartLogic.due(h, t0 + HeartLogic.SEND_EVERY_MS - 1, ending = false))
        assertTrue(HeartLogic.due(h, t0 + HeartLogic.SEND_EVERY_MS, ending = false))
        // At the end (Finish, or left behind): at once.
        assertTrue(HeartLogic.due(h, t0 + 1, ending = true))
        val sent = HeartLogic.sent(h, t0 + 7 * min)
        assertEquals(2, sent.sentSamples)
        // The day's count goes on from there: the phone keeps whichever `hr` has the most, so it never goes back.
        assertEquals(h.samples, sent.samples)
        // Nothing new since: nothing to send, even at the end.
        assertFalse(HeartLogic.due(sent, t0 + 20 * min, ending = true))
        val more = HeartLogic.add(sent, run, beats(140.0, from = t0 + 8 * min), now = t0 + 8 * min)
        assertTrue(HeartLogic.due(more, t0 + 8 * min, ending = true))
        assertFalse(HeartLogic.due(more, t0 + 12 * min - 1, ending = false))
        assertTrue(HeartLogic.due(more, t0 + 12 * min, ending = false))
    }

    @Test
    fun itsSentAsTheDaysWholeHeartRateSoFar() {
        val h = HeartLogic.add(null, run, beats(118.0, 131.0, 165.0), now = t0)
        val cmd = JSONObject(OverlayLogic.toJson(HeartLogic.command("c-7", t0 + 5 * min, h)))
        assertEquals(setOf("v", "id", "at", "type", "day", "avg", "max", "samples"), cmd.keys().asSequence().toSet())
        assertEquals("hr", cmd.getString("type"))
        assertEquals(TODAY, cmd.getString("day"))
        assertEquals(138, cmd.getInt("avg"))
        assertEquals(165, cmd.getInt("max"))
        assertEquals(3, cmd.getInt("samples"))
    }

    @Test
    fun theScreenShowsTheLatestReadingWhileItsFresh() {
        assertEquals(128, HeartLogic.showing(Beat(127.6, t0), t0 + HeartLogic.FRESH_MS - 1))
        assertNull(HeartLogic.showing(Beat(127.6, t0), t0 + HeartLogic.FRESH_MS)) // the sensor lost the wrist
        assertNull(HeartLogic.showing(Beat(0.0, t0), t0))
        assertNull(HeartLogic.showing(null, t0))
    }

    @Test
    fun theDaysAreKeptAsTheyWere() {
        val days = mapOf(TODAY to Heart(TODAY, 351.5, 3, 131, sentSamples = 2, sentAt = t0, lastAt = t0 + min, account = "a"), "2026-09-28" to Heart("2026-09-28", 100.0, 1, 100))
        assertEquals(days, HeartLogic.fromJson(HeartLogic.toJson(days)))
        assertEquals(emptyMap<String, Heart>(), HeartLogic.fromJson("not json"))
        assertEquals(emptyMap<String, Heart>(), HeartLogic.fromJson(null))
    }
}
