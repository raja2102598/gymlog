package io.github.raja2102598.gymlog

import android.content.Context
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService

/**
 * Takes in what's done on the watch as it arrives (docs/watch.md), even with Gym Log closed: Google Play services
 * starts this for a changed `/gymlog/cmd/` data item (the manifest's filter), and each command waits in WatchQueue
 * until JavaScript applies it. While the app is running it's told straight away (WatchPlugin.arrived); otherwise it
 * finds them when it next starts.
 */
class WatchListenerService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        // Read now: the buffer is released once this returns. A deletion (an ack landing) is nothing to take in.
        val arriving = events.filter { it.type == DataEvent.TYPE_CHANGED }.map { WatchPlugin.arrival(it.dataItem) }
        if (WatchQueue.take(this, arriving).isNotEmpty()) WatchPlugin.arrived()
    }
}

/**
 * The watch's commands waiting for JavaScript, in SharedPreferences so they outlast the app being closed or killed,
 * with the ids acked lately. The listener service and the plugin each call in on threads of their own, hence
 * synchronized, and commit() rather than apply(): Android may stop the service's process as soon as it returns.
 */
object WatchQueue {
    private const val PREFS = "gymlog.watch"
    private const val KEY_QUEUE = "queue"
    private const val KEY_ACKED = "acked"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Takes in data items that arrived or were found in the Data Layer, deleting any acked already or that aren't
     *  commands (WatchLogic.take). Returns the commands new to the queue. */
    @Synchronized
    fun take(ctx: Context, arriving: List<WatchLogic.Arrival>): List<WatchLogic.Command> {
        val p = prefs(ctx)
        val t = WatchLogic.take(WatchLogic.decodeQueue(p.getString(KEY_QUEUE, null)), WatchLogic.decodeIds(p.getString(KEY_ACKED, null)), arriving)
        if (t.added.isNotEmpty()) p.edit().putString(KEY_QUEUE, WatchLogic.encodeQueue(t.queue)).commit()
        delete(ctx, t.stale)
        return t.added
    }

    @Synchronized
    fun pending(ctx: Context): List<WatchLogic.Command> = WatchLogic.decodeQueue(prefs(ctx).getString(KEY_QUEUE, null))

    /** Forgets commands JavaScript applied, and deletes their data items. */
    @Synchronized
    fun ack(ctx: Context, ids: List<String>) {
        val p = prefs(ctx)
        val (queue, acked) = WatchLogic.ack(WatchLogic.decodeQueue(p.getString(KEY_QUEUE, null)), WatchLogic.decodeIds(p.getString(KEY_ACKED, null)), ids)
        p.edit().putString(KEY_QUEUE, WatchLogic.encodeQueue(queue)).putString(KEY_ACKED, WatchLogic.encodeIds(acked)).commit()
        delete(ctx, ids.mapNotNull { WatchLogic.pathOf(it) })
    }

    /** Deletes these items from the Data Layer. One that doesn't go is found again by the next pending() and, being
     *  acked, deleted again rather than taken in. */
    private fun delete(ctx: Context, paths: List<String>) {
        if (paths.isEmpty()) return
        val client = Wearable.getDataClient(ctx)
        for (path in paths) client.deleteDataItems(WatchPlugin.uri(path))
    }
}
