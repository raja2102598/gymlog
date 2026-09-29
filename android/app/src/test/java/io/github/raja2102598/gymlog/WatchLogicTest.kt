package io.github.raja2102598.gymlog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The watch's commands on the phone, without Android (docs/watch.md): what WatchListenerService and WatchPlugin keep
 * for src/native/watch.ts to apply, and forget once it has (tests/unit/watch.test.ts has the applying).
 */
class WatchLogicTest {
    private fun json(id: String, at: Long, type: String = "restSkip") = """{"v":1,"id":"$id","at":$at,"type":"$type"}"""
    private fun arrival(id: String, at: Long) = WatchLogic.Arrival("/gymlog/cmd/$id", json(id, at))
    private fun ids(cs: List<WatchLogic.Command>) = cs.map { it.id }

    @Test
    fun readsACommandsIdAndWhenItWasDoneAndKeepsItsJson() {
        val c = WatchLogic.parse(json("c-1", 1790000000000L, "set"))
        assertEquals(WatchLogic.Command("c-1", 1790000000000L, json("c-1", 1790000000000L, "set")), c)
        // No time: taken as the earliest.
        assertEquals(0L, WatchLogic.parse("""{"v":1,"id":"c-2","type":"restSkip"}""")?.at)
        // A newer version is still a command: JavaScript drops it, and acks it so the watch stops showing it.
        assertEquals("c-3", WatchLogic.parse("""{"v":2,"id":"c-3","at":5,"type":"teleport"}""")?.id)
    }

    @Test
    fun somethingWithoutAUsableIdIsntACommand() {
        assertNull(WatchLogic.parse(null))
        assertNull(WatchLogic.parse(""))
        assertNull(WatchLogic.parse("not json"))
        assertNull(WatchLogic.parse("""{"v":1,"at":5,"type":"restSkip"}"""))
        assertNull(WatchLogic.parse("""{"v":1,"id":7,"at":5}"""))
        // It goes into a data item's path, so nothing that could name another item.
        assertNull(WatchLogic.parse("""{"v":1,"id":"../state","at":5}"""))
        assertNull(WatchLogic.parse("""{"v":1,"id":"","at":5}"""))
        assertEquals("/gymlog/cmd/c-1", WatchLogic.pathOf("c-1"))
        assertNull(WatchLogic.pathOf("c/1"))
    }

    @Test
    fun takesEachCommandOnceInTheOrderItWasDone() {
        val first = WatchLogic.take(emptyList(), emptyList(), listOf(arrival("c-2", 200), arrival("c-1", 100), arrival("c-3", 200)))
        assertEquals(listOf("c-1", "c-2", "c-3"), ids(first.queue)) // by when, then as they came
        assertEquals(listOf("c-2", "c-1", "c-3"), ids(first.added))
        // The same again, found in the Data Layer on resume, with one more done in between: only that one is new.
        val again = WatchLogic.take(first.queue, emptyList(), listOf(arrival("c-1", 100), arrival("c-4", 150), arrival("c-1", 100)))
        assertEquals(listOf("c-1", "c-4", "c-2", "c-3"), ids(again.queue))
        assertEquals(listOf("c-4"), ids(again.added))
        assertEquals(emptyList<String>(), again.stale)
    }

    @Test
    fun deletesItemsAckedAlreadyOrNoCommandAtAllAndLeavesOthersPathsAlone() {
        val t = WatchLogic.take(
            emptyList(),
            listOf("c-1"),
            listOf(
                arrival("c-1", 100), // applied and acked, but its deletion hasn't landed
                WatchLogic.Arrival("/gymlog/cmd/junk", "not json"),
                WatchLogic.Arrival("/gymlog/cmd/none", null),
                WatchLogic.Arrival("/gymlog/state", json("c-9", 100)), // the phone's own item
                arrival("c-2", 100),
            ),
        )
        assertEquals(listOf("c-2"), ids(t.queue))
        assertEquals(listOf("/gymlog/cmd/c-1", "/gymlog/cmd/junk", "/gymlog/cmd/none"), t.stale)
    }

    @Test
    fun keepsTheLatestCommandsWithinItsLimit() {
        val many = (1..WatchLogic.QUEUE_MAX).map { arrival("c-$it", it.toLong()) }
        val full = WatchLogic.take(emptyList(), emptyList(), many)
        assertEquals(WatchLogic.QUEUE_MAX, full.queue.size)
        // One more, done later: the earliest goes. One done earlier than all of them isn't kept at all.
        val more = WatchLogic.take(full.queue, emptyList(), listOf(arrival("c-late", 5000), arrival("c-early", 0)))
        assertEquals(WatchLogic.QUEUE_MAX, more.queue.size)
        assertEquals("c-2", more.queue.first().id)
        assertEquals("c-late", more.queue.last().id)
        assertEquals(listOf("c-late"), ids(more.added))
    }

    @Test
    fun forgetsAppliedCommandsAndRemembersTheLatestAckedIds() {
        val queue = WatchLogic.take(emptyList(), emptyList(), listOf(arrival("c-1", 1), arrival("c-2", 2), arrival("c-3", 3))).queue
        val (left, acked) = WatchLogic.ack(queue, listOf("c-0"), listOf("c-1", "c-3", "c-3"))
        assertEquals(listOf("c-2"), ids(left))
        assertEquals(listOf("c-0", "c-1", "c-3"), acked)
        // Acked twice (its ack landed late): remembered once, as the latest.
        assertEquals(listOf("c-1", "c-3", "c-0"), WatchLogic.ack(left, acked, listOf("c-0")).second)
        // Within its limit, the oldest forgotten first.
        val lots = (1..WatchLogic.ACKED_KEPT).map { "a-$it" }
        val trimmed = WatchLogic.ack(emptyList(), lots, listOf("a-new")).second
        assertEquals(WatchLogic.ACKED_KEPT, trimmed.size)
        assertEquals("a-2", trimmed.first())
        assertEquals("a-new", trimmed.last())
    }

    @Test
    fun keepsItsListsAsJsonAndReadsNothingFromWhatIsnt() {
        val queue = WatchLogic.take(emptyList(), emptyList(), listOf(arrival("c-1", 1), arrival("c-2", 2))).queue
        assertEquals(queue, WatchLogic.decodeQueue(WatchLogic.encodeQueue(queue)))
        assertEquals(listOf("c-1", "c-2"), WatchLogic.decodeIds(WatchLogic.encodeIds(listOf("c-1", "c-2"))))
        assertEquals(emptyList<WatchLogic.Command>(), WatchLogic.decodeQueue(null))
        assertEquals(emptyList<String>(), WatchLogic.decodeIds("{oops"))
    }
}
