package io.github.raja2102598.gymlog.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The bezel on a lift: weight by its step, reps by one, never below 0, one click per detent. */
class BezelLogicTest {
    @Test
    fun weightMovesByTheLiftsStep() {
        assertEquals(105.0, BezelLogic.stepKg(100.0, 2.5, 2)!!, 0.0)
        assertEquals(97.5, BezelLogic.stepKg(100.0, 2.5, -1)!!, 0.0)
        assertEquals(22.0, BezelLogic.stepKg(20.0, 1.0, 2)!!, 0.0) // a dumbbell rack's 1 kg steps
        assertEquals(100.0, BezelLogic.stepKg(100.0, 2.5, 0)!!, 0.0)
        assertEquals(102.5, BezelLogic.stepKg(100.0, 0.0, 1)!!, 0.0) // no step sent: the phone's 2.5
    }

    @Test
    fun repsMoveByOne() {
        assertEquals(13, BezelLogic.stepReps(12, 1))
        assertEquals(9, BezelLogic.stepReps(12, -3))
    }

    @Test
    fun neitherGoesBelowZero() {
        assertEquals(0.0, BezelLogic.stepKg(2.5, 2.5, -3)!!, 0.0)
        assertEquals(0, BezelLogic.stepReps(1, -5))
    }

    @Test
    fun anEmptyNumberStartsFromZeroTurningForward() {
        assertEquals(2.5, BezelLogic.stepKg(null, 2.5, 1)!!, 0.0)
        assertNull(BezelLogic.stepKg(null, 2.5, -1))
        assertEquals(1, BezelLogic.stepReps(null, 1))
        assertNull(BezelLogic.stepReps(null, -1))
    }

    @Test
    fun smallStepsDontPileUpFloatNoise() {
        var kg: Double? = 0.0
        repeat(3) { kg = BezelLogic.stepKg(kg, 0.1, 1) }
        assertEquals("0.3", BezelLogic.kgText(kg)) // 0.1 + 0.1 + 0.1 is 0.30000000000000004 in a double
        assertEquals(0.3, kg!!, 0.0)
    }

    @Test
    fun eachBezelDetentIsOneClickWhateverItsSize() {
        assertEquals(1 to 0f, BezelLogic.clicks(0f, 1f, 64f, lowRes = true))
        assertEquals(1 to 0f, BezelLogic.clicks(0f, 250f, 64f, lowRes = true))
        assertEquals(-1 to 0f, BezelLogic.clicks(0f, -0.4f, 64f, lowRes = true))
        assertEquals(0 to 0f, BezelLogic.clicks(0f, 0f, 64f, lowRes = true))
    }

    @Test
    fun aCrownsStreamAddsUpToClicks() {
        var carried = 0f
        val got = listOf(4f, 4f, 4f, 25f).map { d -> BezelLogic.clicks(carried, d, 10f, lowRes = false).also { carried = it.second }.first }
        assertEquals(listOf(0, 0, 1, 2), got) // 4, 8, 12 (one, 2 over), 27 (two, 7 over)
        assertEquals(7f, carried, 0.001f)
        // Turning back drops what was carried forward, so the first click back is a whole click back.
        assertEquals(0 to -6f, BezelLogic.clicks(7f, -6f, 10f, lowRes = false))
        assertEquals(-1 to -1f, BezelLogic.clicks(-6f, -5f, 10f, lowRes = false))
        // No size for a click: one per event.
        assertEquals(1 to 0f, BezelLogic.clicks(0f, 3f, 0f, lowRes = false))
    }

    @Test
    fun numbersReadAsThePhoneWritesThem() {
        assertEquals("100", BezelLogic.kgText(100.0))
        assertEquals("37.5", BezelLogic.kgText(37.5))
        assertEquals("1.25", BezelLogic.kgText(1.25))
        assertEquals("0", BezelLogic.kgText(0.0))
        assertEquals("–", BezelLogic.kgText(null))
        assertEquals("12", BezelLogic.repsText(12))
        assertEquals("–", BezelLogic.repsText(null))
    }
}
