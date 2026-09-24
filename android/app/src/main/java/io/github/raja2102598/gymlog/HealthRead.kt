package io.github.raja2102598.gymlog

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import app.capgo.plugin.health.HealthDataType
import app.capgo.plugin.health.HealthManager
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Reads what readDays() in src/native/health.ts reads, the same way and through the same Health plugin code, as
 * readings for [HealthDays]. Kinds of data that weren't allowed are skipped; one that fails doesn't stop the rest.
 */
object HealthRead {
    class Result(val readings: JSONObject, val failed: List<String>)

    private val WORKOUTS = HealthPermission.getReadPermission(ExerciseSessionRecord::class)

    suspend fun read(client: HealthConnectClient, from: Instant, sleepFrom: Instant, to: Instant, granted: Set<String>): Result {
        val m = HealthManager()
        val r = JSONObject()
        val failed = mutableListOf<String>()

        suspend fun get(permission: String, key: String, label: String, block: suspend () -> JSONArray) {
            if (permission !in granted) return
            try {
                r.put(key, block())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failed += label
            }
        }
        suspend fun total(type: HealthDataType, key: String, label: String, aggregations: List<String>, bucket: String = "day") =
            get(type.readPermission, key, label) { m.queryAggregated(client, type, from, to, bucket, aggregations).getJSONArray("samples") }
        // Newest first, in pages of 500, as the app reads them.
        suspend fun samples(type: HealthDataType, key: String, label: String, start: Instant = from) =
            get(type.readPermission, key, label) { m.readSamples(client, type, start, to, 5000, false) }

        total(HealthDataType.STEPS, "steps", "steps", listOf("sum"))
        total(HealthDataType.STEPS, "stepsHourly", "steps by hour", listOf("sum"), "hour")
        total(HealthDataType.DISTANCE, "distance", "distance", listOf("sum"))
        samples(HealthDataType.FLIGHTS_CLIMBED, "floors", "floors")
        total(HealthDataType.CALORIES, "activeKcal", "active calories", listOf("sum"))
        samples(HealthDataType.TOTAL_CALORIES, "totalKcal", "total calories")
        samples(HealthDataType.BASAL_CALORIES, "bmr", "resting calories")
        total(HealthDataType.DIETARY_ENERGY, "eatenKcal", "calories eaten", listOf("sum"))
        total(HealthDataType.HYDRATION, "water", "water", listOf("sum"))
        total(HealthDataType.HEART_RATE, "heartRate", "heart rate", listOf("average", "min", "max"))
        total(HealthDataType.RESTING_HEART_RATE, "restingHr", "resting heart rate", listOf("average"))
        samples(HealthDataType.HEART_RATE_VARIABILITY, "hrv", "heart rate variability")
        samples(HealthDataType.OXYGEN_SATURATION, "spo2", "blood oxygen")
        samples(HealthDataType.RESPIRATORY_RATE, "respRate", "breathing rate")
        samples(HealthDataType.VO2_MAX, "vo2max", "VO2 max")
        samples(HealthDataType.BLOOD_PRESSURE, "bp", "blood pressure")
        samples(HealthDataType.WEIGHT, "weight", "weight")
        samples(HealthDataType.BODY_FAT, "bodyFat", "body fat")
        samples(HealthDataType.HEIGHT, "height", "height")
        // A night's sleep that ends on the first day started the evening before.
        samples(HealthDataType.SLEEP, "sleep", "sleep", sleepFrom)
        get(WORKOUTS, "workouts", "workouts") {
            val all = JSONArray()
            var anchor: String? = null
            for (page in 0 until 20) {
                val res = m.queryWorkouts(client, null, from, to, 100, true, anchor)
                val list = res.getJSONArray("workouts")
                for (i in 0 until list.length()) all.put(list.get(i))
                anchor = res.optString("anchor").ifEmpty { null } ?: break
            }
            all
        }
        return Result(r, failed)
    }
}
