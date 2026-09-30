package io.github.raja2102598.gymlog.wear

import io.github.raja2102598.gymlog.wear.Fixtures.day
import io.github.raja2102598.gymlog.wear.Fixtures.lift
import io.github.raja2102598.gymlog.wear.Fixtures.state
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reading the phone's /gymlog/state, and choosing the day the watch shows from it (docs/watch.md). */
class StateLogicTest {
    // docs/watch.md's example, as the phone sends it.
    private val example = """
        {
          "v": 1, "sentAt": 1790000000000, "signedIn": true, "account": "0b6f2a4e-5c1d-4f7a-9e3b-2d8c1a7f6e50", "applied": ["c-1", "c-2"],
          "run": { "day": "2026-09-29", "startedAt": 1789999000000, "pausedAt": null, "pausedMs": 60000, "endedAt": null },
          "rest": { "day": "2026-09-29", "lift": "Leg Press", "endAt": 1790000090000, "pausedAt": null, "sec": 90, "startedAt": 1790000000000 },
          "days": [
            {
              "date": "2026-09-29", "title": "Legs", "skipped": false,
              "cardio": "Cycling - 15-20 min", "cardioDone": false,
              "blocks": [
                [
                  {
                    "key": "Leg Press", "name": "Hack Squat", "done": false, "skipped": false,
                    "restSec": 90, "inc": 2.5, "cue": "Feet high.",
                    "rows": [
                      { "reps": 12, "kg": 100, "type": null, "sugReps": 12, "sugKg": 100 },
                      { "reps": null, "kg": null, "type": null, "sugReps": 12, "sugKg": 102.5 }
                    ]
                  }
                ]
              ]
            }
          ]
        }
    """.trimIndent()

    private fun ok(json: String): WatchState = (StateLogic.parse(json) as StateLogic.Parsed.Ok).state

    @Test
    fun readsTheStateAsThePhoneSendsIt() {
        val s = ok(example)
        assertEquals(1790000000000L, s.sentAt)
        assertTrue(s.signedIn)
        assertEquals("0b6f2a4e-5c1d-4f7a-9e3b-2d8c1a7f6e50", s.account)
        assertEquals(setOf("c-1", "c-2"), s.applied)
        assertEquals(Run("2026-09-29", 1789999000000L, null, 60000L, null), s.run)
        assertEquals(Rest("2026-09-29", "Leg Press", 1790000090000L, null, 90, startedAt = 1790000000000L), s.rest)
        val d = s.days.single()
        assertEquals("Legs", d.title)
        assertEquals("Cycling - 15-20 min", d.cardio)
        val l = d.blocks.single().single()
        assertEquals("Leg Press", l.key)
        assertEquals("Hack Squat", l.name) // a swap: shown by what it's done as, sent back by the day's name
        assertEquals(90, l.restSec)
        assertEquals(2.5, l.inc, 0.0)
        assertEquals("Feet high.", l.cue)
        assertEquals(SetRow(12, 100.0, null, 12, 100.0), l.rows[0])
        assertEquals(SetRow(null, null, null, 12, 102.5), l.rows[1])
    }

    @Test
    fun anythingElseIsBrokenAndANewerShapeAsksForAnUpdate() {
        for (bad in listOf(null, "", "not json", "[]", """{"sentAt": 1}""", """{"v": 0}""")) {
            assertEquals(bad, StateLogic.Parsed.Broken, StateLogic.parse(bad))
        }
        val newer = StateLogic.parse("""{"v": 2, "whatever": true}""")
        assertEquals(StateLogic.Parsed.Newer, newer)
        assertEquals("Update Gym Log on your watch", StateLogic.blank(newer, null))
    }

    @Test
    fun oddValuesTakeDefaultsAndBadPartsAreLeftOut() {
        val s = ok(
            """
            {"v": 1, "days": [
              {"title": "no date: left out"},
              {"date": "2026-09-29", "cardio": "  ", "blocks": [
                [],
                [{"name": "no key: left out"}, {"key": "Row", "name": "", "inc": 0, "restSec": -5,
                  "rows": [{"reps": 12.0, "kg": "heavy"}, "not a row"]}]
              ]}
            ]}
            """.trimIndent(),
        )
        assertEquals(false, s.signedIn) // not said: not signed in
        assertNull(s.account) // nor into any account
        assertNull(s.run)
        val d = s.days.single()
        assertNull(d.cardio) // blank: none
        val l = d.blocks.single().single()
        assertEquals("Row", l.name) // no name of its own: its key
        assertEquals(2.5, l.inc, 0.0) // the phone's default step
        assertEquals(0, l.restSec)
        assertEquals(listOf(SetRow(12, null)), l.rows)
    }

    @Test
    fun theDayIsTheOneForTheWatchsOwnDate() {
        val s = state(day(listOf(lift("Squat", null)), date = "2026-09-29"), day(listOf(lift("Bench", null)), date = "2026-09-30"))
        assertEquals("2026-09-30", StateLogic.dayFor(s, "2026-09-30", now = 0L)?.date)
        assertNull(StateLogic.dayFor(s, "2026-10-09", now = 0L)) // past what the phone sent
    }

    @Test
    fun aWorkoutUnderWayKeepsItsDayPastMidnight() {
        val days = arrayOf(day(listOf(lift("Squat", null)), date = "2026-09-29"), day(listOf(lift("Bench", null)), date = "2026-09-30"))
        val started = 1_000_000L
        val now = started + 30 * 60_000L // half an hour in, and now the 30th on the watch
        fun shown(run: Run) = StateLogic.dayFor(state(*days, run = run), "2026-09-30", now)?.date
        assertEquals("2026-09-29", shown(Run("2026-09-29", started)))
        assertEquals("2026-09-29", shown(Run("2026-09-29", started - 5 * 3_600_000L, pausedAt = started))) // paused waits
        assertEquals("2026-09-30", shown(Run("2026-09-29", started, endedAt = started + 60_000L))) // finished
        assertEquals("2026-09-30", shown(Run("2026-09-29", started - 3 * 3_600_000L))) // left running for hours
    }

    @Test
    fun withNothingToShowItSaysWhereToGo() {
        val s = state(day(listOf(lift("Squat", null))))
        assertEquals("Open Gym Log on your phone", StateLogic.blank(null, null))
        assertEquals("Open Gym Log on your phone", StateLogic.blank(StateLogic.Parsed.Broken, null))
        assertEquals("Sign in on your phone", StateLogic.blank(StateLogic.Parsed.Ok(s.copy(signedIn = false)), s.days[0]))
        assertEquals("Open Gym Log on your phone", StateLogic.blank(StateLogic.Parsed.Ok(s), null))
        assertNull(StateLogic.blank(StateLogic.Parsed.Ok(s), s.days[0]))
    }

    @Test
    fun theDateIsTheWatchsOwn() {
        val t = 1790000000000L // 2026-09-21 14:13:20 UTC
        assertEquals("2026-09-21", StateLogic.dateOf(t, ZoneId.of("UTC")))
        val nearMidnight = t + 9 * 3_600_000L + 30 * 60_000L // 23:43 UTC, 05:13 the next day in India
        assertEquals("2026-09-21", StateLogic.dateOf(nearMidnight, ZoneId.of("UTC")))
        assertEquals("2026-09-22", StateLogic.dateOf(nearMidnight, ZoneId.of("Asia/Kolkata")))
    }
}
