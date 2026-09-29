package io.github.raja2102598.gymlog

import org.json.JSONArray
import org.json.JSONObject

/**
 * The watch's commands on their way to JavaScript (docs/watch.md; src/native/watch.ts applies them): which data items
 * are commands, reading one, keeping each once and in the order it was done on the watch, and forgetting it once
 * applied. Pure, for WatchLogicTest (like GymWidgetLogic.kt and RestTimerLogic.kt); WatchQueue keeps the lists in
 * SharedPreferences, and WatchPlugin and WatchListenerService talk to the Data Layer.
 */
object WatchLogic {
    /** The phone's state for the watch: one data item, replaced whenever it changes. */
    const val STATE_PATH = "/gymlog/state"

    /** One data item per command: `/gymlog/cmd/<id>`. */
    const val COMMAND_PREFIX = "/gymlog/cmd/"

    /** Every payload is JSON, under this key of its item's DataMap. */
    const val KEY_JSON = "json"

    /** How many acked ids are remembered, so an item whose deletion hasn't landed is never taken in again: well past
     *  the 200 JavaScript remembers applying (src/native/watch.ts, APPLIED_KEPT), which would then apply it again. */
    const val ACKED_KEPT = 1000

    /** At most this many wait for the app, the latest kept: only reached were it left unopened through dozens of
     *  workouts done on the watch. */
    const val QUEUE_MAX = 1000

    /** A command: its id, when it was done (epoch ms, the watch's clock; 0 when it doesn't say) and its own JSON, which
     *  JavaScript reads the rest of. */
    data class Command(val id: String, val at: Long, val json: String)

    /** A data item that arrived, or was found in the Data Layer: its path and its DataMap's JSON, if any. */
    data class Arrival(val path: String, val json: String?)

    /** An id goes into its item's path, so only what's safe there: letters, digits and . _ : - */
    private val ID = Regex("[A-Za-z0-9._:-]{1,128}")

    /** The path of command `id`'s data item, or null for an id that couldn't be one. */
    fun pathOf(id: String): String? = if (ID.matches(id)) COMMAND_PREFIX + id else null

    /** Null for anything that isn't a command: not JSON, or no usable id. Its type and fields are JavaScript's to
     *  judge, so one of a newer version is kept and handed over, to be dropped there and acked. */
    fun parse(json: String?): Command? {
        if (json.isNullOrEmpty()) return null
        return try {
            val o = JSONObject(json)
            val id = o.opt("id") as? String ?: return null
            if (pathOf(id) == null) return null
            Command(id, (o.opt("at") as? Number)?.toLong() ?: 0L, json)
        } catch (e: Exception) {
            null
        }
    }

    /** What came of taking in some data items: the queue to keep, the commands new to it, and the paths of items to
     *  delete from the Data Layer: ones acked already, whose deletion didn't land, and ones that aren't commands at all,
     *  which nothing could ever apply or ack. */
    data class Taken(val queue: List<Command>, val added: List<Command>, val stale: List<String>)

    /** Adds the commands among `arriving` that are new: not in the queue already, and not acked. The queue stays in the
     *  order the commands were done (by `at`, then as they came), and within QUEUE_MAX, the oldest going first. Items
     *  outside `/gymlog/cmd/` are none of this. */
    fun take(queue: List<Command>, acked: List<String>, arriving: List<Arrival>): Taken {
        val have = queue.map { it.id }.toMutableSet()
        val done = acked.toSet()
        val added = mutableListOf<Command>()
        val stale = mutableListOf<String>()
        for (a in arriving) {
            if (!a.path.startsWith(COMMAND_PREFIX)) continue
            val c = parse(a.json)
            when {
                c == null || c.id in done -> stale += a.path
                have.add(c.id) -> added += c
            }
        }
        val kept = (queue + added).sortedBy { it.at }.takeLast(QUEUE_MAX)
        return Taken(kept, added.filter { it in kept }, stale)
    }

    /** Forgets the commands JavaScript applied: out of the queue, and remembered as acked, the latest ACKED_KEPT. */
    fun ack(queue: List<Command>, acked: List<String>, ids: List<String>): Pair<List<Command>, List<String>> {
        val gone = ids.toSet()
        return queue.filter { it.id !in gone } to (acked.filter { it !in gone } + ids.distinct()).takeLast(ACKED_KEPT)
    }

    fun encodeQueue(queue: List<Command>): String = JSONArray(queue.map { it.json }).toString()

    /** The queue as kept, or empty for anything unreadable. */
    fun decodeQueue(s: String?): List<Command> = strings(s).mapNotNull { parse(it) }

    fun encodeIds(ids: List<String>): String = JSONArray(ids).toString()

    fun decodeIds(s: String?): List<String> = strings(s)

    private fun strings(s: String?): List<String> {
        if (s.isNullOrEmpty()) return emptyList()
        return try {
            val a = JSONArray(s)
            (0 until a.length()).mapNotNull { a.opt(it) as? String }
        } catch (e: Exception) {
            emptyList()
        }
    }
}
