package io.github.raja2102598.gymlog.wear

import kotlin.math.roundToLong

/**
 * The bezel on a lift: turning it changes the picked number, weight by the lift's step, reps by one, never below 0.
 * Pure, for BezelLogicTest; LiftScreen reads the rotary events and gives the haptic ticks.
 */
object BezelLogic {
    /** The weight after `clicks` (negative: turned back) of `inc` kg each. With none yet, turning forward starts from
     *  0 and turning back leaves it empty. Rounded to 0.01 kg, so steps of 1.25 or 0.1 never pile up float noise. */
    fun stepKg(kg: Double?, inc: Double, clicks: Int): Double? {
        if (clicks == 0) return kg
        val base = kg ?: if (clicks > 0) 0.0 else return null
        val step = if (inc > 0) inc else 2.5
        return ((base + step * clicks).coerceAtLeast(0.0) * 100).roundToLong() / 100.0
    }

    /** The reps after `clicks`, one each, from 0 when there were none. */
    fun stepReps(reps: Int?, clicks: Int): Int? {
        if (clicks == 0) return reps
        val base = reps ?: if (clicks > 0) 0 else return null
        return (base + clicks).coerceAtLeast(0)
    }

    /**
     * Turns one rotary event's scroll, `delta` pixels (positive clockwise), into whole clicks, and what's carried to
     * the next event. A bezel (`lowRes`, the Galaxy Watch's) sends one event per detent, so each is exactly one click
     * whatever its size. A crown sends a smooth stream, counted in `perClick` pixels; turning the other way drops
     * what was carried, so a click back always goes back. With no size for a click, each event is one, as a bezel's.
     */
    fun clicks(carried: Float, delta: Float, perClick: Float, lowRes: Boolean): Pair<Int, Float> {
        if (delta == 0f) return 0 to carried
        if (lowRes || perClick <= 0f) return (if (delta > 0) 1 else -1) to 0f
        val sum = if (carried != 0f && (carried > 0) != (delta > 0)) delta else carried + delta
        val n = (sum / perClick).toInt()
        return n to (sum - n * perClick)
    }

    /** A weight as the phone writes one: "100", "37.5", "1.25", or "–" for none. */
    fun kgText(kg: Double?): String {
        if (kg == null) return "–"
        val s = "%.2f".format(java.util.Locale.ROOT, kg).trimEnd('0').trimEnd('.')
        return if (s == "-0") "0" else s
    }

    /** Reps, or "–" for none. */
    fun repsText(reps: Int?): String = reps?.toString() ?: "–"
}
