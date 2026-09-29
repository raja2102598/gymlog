package io.github.raja2102598.gymlog

import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.Executors

/**
 * Gym Log's Wear OS app from JavaScript (src/native/watch.ts; docs/watch.md), over Wear OS's Data Layer. publish()
 * puts the state the watch shows as the `/gymlog/state` data item; pending() hands over the watch's commands not yet
 * applied, and ack() forgets them once they are, deleting their data items. WatchListenerService takes commands in as
 * they arrive, even with the app closed, and says so with a "command" event while it's running. Android doesn't start
 * the service for an app that was force-stopped, so pending() first takes in any `/gymlog/cmd/` items still in the
 * Data Layer that it missed; JavaScript asks for them on start, on coming back to the app, and on each event. The pure
 * decisions are WatchLogic's.
 */
@CapacitorPlugin(name = "Watch")
class WatchPlugin : Plugin() {
    // The Data Layer's answers are handled here rather than on the main thread: WatchQueue writes SharedPreferences.
    private val work = Executors.newSingleThreadExecutor()

    override fun load() {
        live = this
    }

    override fun handleOnDestroy() {
        if (live === this) live = null
        work.shutdown()
        super.handleOnDestroy()
    }

    /** { json }: the state, marked urgent, so the watch has it within a moment rather than whenever the Data Layer next
     *  batches its syncs. */
    @PluginMethod
    fun publish(call: PluginCall) {
        val json = call.getString("json")
        if (json.isNullOrEmpty()) {
            call.reject("json is needed")
            return
        }
        val request = PutDataMapRequest.create(WatchLogic.STATE_PATH)
        request.dataMap.putString(WatchLogic.KEY_JSON, json)
        Wearable.getDataClient(context).putDataItem(request.asPutDataRequest().setUrgent())
            .addOnSuccessListener(work) { call.resolve() }
            .addOnFailureListener(work) { e -> call.reject(e.message ?: "Couldn't reach Wear OS", null, e) }
    }

    /** { commands }: the watch's commands waiting, in the order they were done, each as the watch sent it. */
    @PluginMethod
    fun pending(call: PluginCall) {
        Wearable.getDataClient(context).getDataItems(uri(WatchLogic.COMMAND_PREFIX), DataClient.FILTER_PREFIX)
            .addOnCompleteListener(work) { task ->
                try {
                    // Asked or not (no Wear OS on this phone), what's already kept is handed over.
                    if (task.isSuccessful) {
                        val items = task.result
                        try {
                            WatchQueue.take(context, items.map { arrival(it) })
                        } finally {
                            items.release()
                        }
                    }
                    val commands = JSArray()
                    for (c in WatchQueue.pending(context)) commands.put(JSObject(c.json))
                    call.resolve(JSObject().put("commands", commands))
                } catch (e: Exception) {
                    call.reject(e.message ?: "Couldn't read the watch's commands", null, e)
                }
            }
    }

    /** { ids }: forgets these commands, applied now, and deletes their data items, the watch's copies too. */
    @PluginMethod
    fun ack(call: PluginCall) {
        val ids = try {
            call.getArray("ids")?.toList<String>()
        } catch (e: Exception) {
            null
        }
        if (ids == null) {
            call.reject("ids are needed")
            return
        }
        work.execute {
            WatchQueue.ack(context, ids)
            call.resolve()
        }
    }

    companion object {
        /** The plugin while the app is running, for the service to tell. */
        @Volatile
        private var live: WatchPlugin? = null

        /** WatchListenerService's word that commands arrived: JavaScript takes them from pending(). Nothing to tell
         *  while the app isn't running: it asks when it next starts. */
        fun arrived() {
            live?.notifyListeners("command", JSObject())
        }

        /** An item's path on every node: the watch's items as well as the phone's. */
        fun uri(path: String): Uri = Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(path).build()

        fun arrival(item: DataItem) = WatchLogic.Arrival(item.uri.path ?: "", runCatching { DataMapItem.fromDataItem(item).dataMap.getString(WatchLogic.KEY_JSON) }.getOrNull())
    }
}
