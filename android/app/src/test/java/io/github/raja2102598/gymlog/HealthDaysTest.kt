package io.github.raja2102598.gymlog

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.ZoneId

/**
 * The background sync must build the same days as the app does in the foreground: both run
 * tests/fixtures/health-days.json (see tests/unit/health.test.ts for the JavaScript side).
 */
class HealthDaysTest {
    private val fixture = JSONObject(File(System.getProperty("fixtures"), "health-days.json").readText())

    @Test
    fun buildsTheSameDaysAsTheApp() {
        val built = HealthDays.build(fixture.getJSONObject("readings"), ZoneId.of(fixture.getString("zone")))
        assertEquals(canon(fixture.getJSONObject("expected")), canon(built))
    }

    @Test
    fun leavesOutDaysWithNothingInThem() {
        val r = JSONObject().put("steps", JSONArray().put(JSONObject().put("startDate", "2026-09-20T18:30:00Z").put("value", 0)))
        assertEquals("{}", HealthDays.build(r, ZoneId.of("Asia/Kolkata")).toString())
    }

    // Keys sorted and numbers written one way (80 and 80.0 alike), so only values are compared.
    private fun canon(v: Any?): String = when (v) {
        is JSONObject -> v.keys().asSequence().sorted().joinToString(",", "{", "}") { "\"$it\":${canon(v.get(it))}" }
        is JSONArray -> (0 until v.length()).joinToString(",", "[", "]") { canon(v.get(it)) }
        is Number -> v.toDouble().let { d -> if (d == Math.rint(d)) d.toLong().toString() else d.toString() }
        is String -> "\"$v\""
        else -> v.toString()
    }
}
