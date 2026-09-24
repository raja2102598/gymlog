package io.github.raja2102598.gymlog

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/**
 * Health Connect readings, as the Health plugin returns them, turned into one day each for the background sync
 * (HealthSyncWorker). It must match healthDays() in src/lib/health.ts, which the app uses in the foreground:
 * tests/fixtures/health-days.json holds readings and the days both must make (HealthDaysTest, health.test.ts).
 */
object HealthDays {
    private val STAGES = setOf("deep", "rem", "light", "awake")

    fun build(r: JSONObject, zone: ZoneId): JSONObject {
        val out = JSONObject()
        fun day(k: String): JSONObject = out.optJSONObject(k) ?: JSONObject().also { out.put(k, it) }
        fun dayOf(iso: String): String = Instant.parse(iso).atZone(zone).toLocalDate().toString()
        fun list(key: String): List<JSONObject> {
            val a = r.optJSONArray(key) ?: JSONArray()
            return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        }
        fun byStart(key: String) = list(key).sortedBy { Instant.parse(it.getString("startDate")) }
        fun value(o: JSONObject) = o.optDouble("value", Double.NaN)

        // Day totals count on the local date their bucket starts.
        fun totals(key: String, set: (JSONObject, Double) -> Unit) {
            for (t in list(key)) if (value(t) > 0) set(day(dayOf(t.getString("startDate"))), value(t))
        }
        totals("steps") { d, v -> d.put("steps", round0(v)) }
        totals("distance") { d, v -> d.put("km", round(v / 1000, 2)) }
        totals("activeKcal") { d, v -> d.put("activeKcal", round0(v)) }
        totals("eatenKcal") { d, v -> d.put("eatenKcal", round0(v)) }
        totals("water") { d, v -> d.put("waterMl", round0(v * 1000)) }
        totals("restingHr") { d, v -> d.put("restingHr", round0(v)) }
        for (t in list("heartRate")) {
            val d = day(dayOf(t.getString("startDate")))
            val values = t.optJSONObject("values")
            val avg = values?.takeIf { it.has("average") }?.optDouble("average") ?: value(t)
            val min = values?.optDouble("min", Double.NaN) ?: Double.NaN
            val max = values?.optDouble("max", Double.NaN) ?: Double.NaN
            if (avg > 0) d.put("hrAvg", round0(avg))
            if (min > 0) d.put("hrMin", round0(min))
            if (max > 0) d.put("hrMax", round0(max))
        }
        // Steps hour by hour, in local hours.
        for (t in list("stepsHourly")) {
            if (!(value(t) > 0)) continue
            val start = t.getString("startDate")
            val d = day(dayOf(start))
            val hours = d.optJSONArray("stepsByHour") ?: JSONArray().also { a -> repeat(24) { a.put(0L) }; d.put("stepsByHour", a) }
            val h = Instant.parse(start).atZone(zone).hour
            hours.put(h, hours.getLong(h) + round0(value(t)))
        }
        // Samples that add up over the day they start: all calories burned, floors.
        fun sums(key: String, set: (JSONObject, Double) -> Unit) {
            val by = LinkedHashMap<String, Double>()
            for (s in byStart(key)) if (value(s) > 0) by.merge(dayOf(s.getString("startDate")), value(s), Double::plus)
            for ((k, v) in by) set(day(k), v)
        }
        sums("totalKcal") { d, v -> d.put("totalKcal", round0(v)) }
        sums("floors") { d, v -> d.put("floors", round0(v)) }
        // Readings averaged over the day: HRV, blood oxygen, breathing rate.
        fun means(key: String, set: (JSONObject, Double) -> Unit) {
            val by = LinkedHashMap<String, DoubleArray>()
            for (s in byStart(key)) {
                if (!(value(s) > 0)) continue
                val a = by.getOrPut(dayOf(s.getString("startDate"))) { doubleArrayOf(0.0, 0.0) }
                a[0] += value(s)
                a[1] += 1.0
            }
            for ((k, a) in by) set(day(k), a[0] / a[1])
        }
        means("hrv") { d, v -> d.put("hrv", round0(v)) }
        means("spo2") { d, v -> d.put("spo2", round(v, 1)) }
        means("respRate") { d, v -> d.put("respRate", round(v, 1)) }
        // One reading a day: the first for weight and body fat, the latest otherwise.
        fun pick(key: String, first: Boolean, set: (JSONObject, JSONObject) -> Unit) {
            val seen = HashSet<String>()
            for (s in byStart(key)) {
                val k = dayOf(s.getString("startDate"))
                if (!(value(s) > 0) || (first && k in seen)) continue
                seen += k
                set(day(k), s)
            }
        }
        pick("weight", true) { d, s -> d.put("weight", round(value(s), 1)) }
        pick("bodyFat", true) { d, s -> d.put("bodyFat", round(value(s), 1)) }
        pick("height", false) { d, s -> d.put("height", round0(value(s))) }
        pick("bmr", false) { d, s -> d.put("bmr", round0(value(s))) }
        pick("vo2max", false) { d, s -> d.put("vo2max", round(value(s), 1)) }
        pick("bp", false) { d, s ->
            val sys = s.optDouble("systolic", value(s))
            val dia = s.optDouble("diastolic", 0.0)
            if (sys > 0 && dia > 0) d.put("bp", JSONObject().put("sys", round0(sys)).put("dia", round0(dia)))
        }
        // Sleep counts on the day it ended; asleep is every stage but awake, or the whole session without stages.
        // The longest session that day gives bedtime and waking time.
        val longest = HashMap<String, Long>()
        for (s in byStart("sleep")) {
            val k = dayOf(s.getString("endDate"))
            val stages = s.optJSONArray("stages")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } } ?: emptyList()
            val asleep = if (stages.isNotEmpty()) stages.filter { it.optString("stage") != "awake" }.sumOf { it.optDouble("durationMinutes", 0.0) } else value(s)
            if (!(asleep > 0)) continue
            val d = day(k)
            d.put("sleepMin", d.optLong("sleepMin", 0L) + round0(asleep))
            for (x in stages) {
                val st = x.optString("stage")
                if (st !in STAGES) continue
                val by = d.optJSONObject("sleepStages") ?: JSONObject().also { d.put("sleepStages", it) }
                by.put(st, by.optLong(st, 0L) + round0(x.optDouble("durationMinutes", 0.0)))
            }
            val span = Instant.parse(s.getString("endDate")).toEpochMilli() - Instant.parse(s.getString("startDate")).toEpochMilli()
            if (span > (longest[k] ?: -1L)) {
                longest[k] = span
                d.put("bed", s.getString("startDate"))
                d.put("wake", s.getString("endDate"))
            }
        }
        // Workouts count on the day they started, earliest first.
        for (w in byStart("workouts")) {
            val duration = w.optDouble("duration", Double.NaN)
            if (!(duration > 0)) continue
            val x = JSONObject()
                .put("type", w.optString("workoutType").ifEmpty { "other" })
                .put("start", w.getString("startDate"))
                .put("end", w.getString("endDate"))
                .put("min", round0(duration / 60))
            val kcal = w.optDouble("totalEnergyBurned", Double.NaN)
            val metres = w.optDouble("totalDistance", Double.NaN)
            if (kcal > 0) x.put("kcal", round0(kcal))
            if (metres > 0) x.put("km", round(metres / 1000, 2))
            w.optString("sourceName").takeIf { it.isNotEmpty() }?.let { x.put("source", it) }
            val d = day(dayOf(w.getString("startDate")))
            (d.optJSONArray("workouts") ?: JSONArray().also { d.put("workouts", it) }).put(x)
        }
        return out
    }

    // As Math.round in JavaScript for the positive numbers here: halves round up.
    private fun round0(v: Double): Long = Math.round(v)
    private fun round(v: Double, dp: Int): Double {
        val f = Math.pow(10.0, dp.toDouble())
        return Math.round(v * f) / f
    }
}
