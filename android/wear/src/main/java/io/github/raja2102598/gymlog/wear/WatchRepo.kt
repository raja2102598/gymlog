package io.github.raja2102598.gymlog.wear

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.core.util.AtomicFile
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import java.io.File
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the watch knows (docs/watch.md): the phone's last /gymlog/state, and the watch's own commands the phone hasn't
 * applied yet, laid over it (OverlayLogic). Both are kept in files, so the watch opens on the last workout from cold,
 * away from the phone. One per process: the app, StateListenerService and the rest alarm's receiver all read it.
 */
object WatchRepo {
    const val STATE_PATH = "/gymlog/state"
    const val CMD_PATH = "/gymlog/cmd/"
    private const val TAG = "GymLogWatch"
    private const val STATE_FILE = "state.json"
    private const val PENDING_FILE = "pending.json"

    /** The phone's last state as it came (null: none yet), and the commands still waiting on the phone. */
    data class Snapshot(val parsed: StateLogic.Parsed?, val pending: List<Command>) {
        /** The last state with those commands done on top of it: what the watch shows. */
        val state: WatchState? = (parsed as? StateLogic.Parsed.Ok)?.state?.let { OverlayLogic.apply(it, pending) }
    }

    private val lock = Any()
    private var loaded = false
    private var raw: String? = null

    /** Ids of commands not yet handed to the Data Layer: sent again the next time the app opens. */
    private val unsent = mutableSetOf<String>()

    /** Counts the states taken in, so a fetch that raced a newer arrival doesn't put the older one back. */
    private var arrivals = 0

    /** Writes go to the files in order, off whichever thread changed them; memory is always ahead of the files. */
    private val disk = Executors.newSingleThreadExecutor()

    private val flow = MutableStateFlow(Snapshot(null, emptyList()))
    val snapshot: StateFlow<Snapshot> = flow

    /** Reads the files, once per process. Cheap enough for a receiver waking the app from cold. */
    fun load(ctx: Context): Snapshot {
        synchronized(lock) {
            if (!loaded) {
                raw = read(ctx, STATE_FILE)
                val kept = read(ctx, PENDING_FILE)?.let(::pendingFrom) ?: (emptyList<Command>() to emptySet())
                unsent += kept.second
                flow.value = Snapshot(raw?.let(StateLogic::parse), kept.first)
                loaded = true
            }
            return flow.value
        }
    }

    /** A /gymlog/state payload from the phone: kept, and the commands it has applied stop being laid over it. */
    fun onState(ctx: Context, json: String) = take(ctx, json, since = null)

    private fun take(ctx: Context, json: String, since: Int?) {
        synchronized(lock) {
            load(ctx)
            if (since != null && since != arrivals) return
            arrivals++
            if (json == raw) return
            val parsed = StateLogic.parse(json)
            raw = json
            val applied = (parsed as? StateLogic.Parsed.Ok)?.state?.applied.orEmpty()
            val pending = OverlayLogic.prune(flow.value.pending, applied, System.currentTimeMillis())
            unsent.retainAll(pending.map { it.id }.toSet())
            flow.value = Snapshot(parsed, pending)
            save(ctx, STATE_FILE, json)
            savePending(ctx)
        }
        changed(ctx)
    }

    /** Does something on the watch: shown at once, kept, and sent to the phone as its own urgent data item. An `hr`
     *  replaces the day's earlier ones still waiting to be sent (OverlayLogic.supersede). */
    fun send(ctx: Context, cmd: Command) {
        synchronized(lock) {
            load(ctx)
            val kept = OverlayLogic.supersede(flow.value.pending, unsent, cmd)
            unsent.retainAll(kept.map { it.id }.toSet())
            unsent += cmd.id
            flow.value = flow.value.copy(pending = kept + cmd)
            savePending(ctx)
        }
        put(ctx.applicationContext, cmd)
        changed(ctx)
    }

    /**
     * Catches up as the app opens: the phone's state as the Data Layer has it now (StateListenerService may not have
     * run, or the app may be new), then any command that never reached the Data Layer, sent again.
     */
    suspend fun refresh(ctx: Context) {
        val app = ctx.applicationContext
        val since = synchronized(lock) {
            load(app)
            arrivals
        }
        try {
            val uri = Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(STATE_PATH).build()
            val items = Wearable.getDataClient(app).getDataItems(uri, DataClient.FILTER_LITERAL).await()
            val found = try {
                items.mapNotNull { DataMapItem.fromDataItem(it).dataMap.getString("json") }
            } finally {
                items.release()
            }
            // One per phone that ever sent one: the newest.
            found.maxByOrNull { (StateLogic.parse(it) as? StateLogic.Parsed.Ok)?.state?.sentAt ?: -1L }?.let { take(app, it, since) }
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't read the phone's state from the Data Layer", e)
        }
        val again = synchronized(lock) { flow.value.pending.filter { it.id in unsent } }
        again.forEach { put(app, it) }
    }

    private fun put(ctx: Context, cmd: Command) {
        val req = PutDataMapRequest.create(CMD_PATH + cmd.id).apply { dataMap.putString("json", OverlayLogic.toJson(cmd)) }
            .asPutDataRequest()
            .setUrgent()
        Wearable.getDataClient(ctx).putDataItem(req)
            .addOnSuccessListener {
                synchronized(lock) {
                    if (unsent.remove(cmd.id)) savePending(ctx)
                }
            }
            .addOnFailureListener { Log.w(TAG, "Couldn't send ${cmd.type} to the phone; it's sent again next time", it) }
    }

    /** The rest alarm and the workout on the watch face follow every change, from wherever it came. */
    private fun changed(ctx: Context) {
        val snap = flow.value
        RestAlarm.sync(ctx.applicationContext, snap.state, System.currentTimeMillis())
        WorkoutService.sync(ctx.applicationContext, snap.state)
    }

    // Callers hold the lock, so the file is written with the lists as they are at this change.
    private fun savePending(ctx: Context) {
        val o = JSONObject()
            .put("pending", JSONArray(flow.value.pending.map { OverlayLogic.toJson(it) }))
            .put("unsent", JSONArray(unsent.toList()))
        save(ctx, PENDING_FILE, o.toString())
    }

    private fun pendingFrom(json: String): Pair<List<Command>, Set<String>> =
        try {
            val o = JSONObject(json)
            val p = o.optJSONArray("pending") ?: JSONArray()
            val u = o.optJSONArray("unsent") ?: JSONArray()
            (0 until p.length()).mapNotNull { OverlayLogic.fromJson(p.optString(it)) } to (0 until u.length()).map { u.optString(it) }.toSet()
        } catch (e: Exception) {
            emptyList<Command>() to emptySet()
        }

    /** A file kept in the app's own storage, or null for none (HeartMonitor keeps its own this way too). */
    internal fun read(ctx: Context, name: String): String? =
        try {
            AtomicFile(File(ctx.filesDir, name)).readFully().toString(Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }

    /** Writes a file whole, off the caller's thread, in the order asked. */
    internal fun save(ctx: Context, name: String, text: String) {
        val dir = ctx.applicationContext.filesDir
        disk.execute {
            val f = AtomicFile(File(dir, name))
            val out = try {
                f.startWrite()
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't keep $name", e)
                return@execute
            }
            try {
                out.write(text.toByteArray(Charsets.UTF_8))
                f.finishWrite(out)
            } catch (e: Exception) {
                f.failWrite(out)
                Log.w(TAG, "Couldn't keep $name", e)
            }
        }
    }
}
