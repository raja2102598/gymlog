package io.github.raja2102598.gymlog.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/**
 * The phone's state arriving (/gymlog/state), whether or not Gym Log is open on the watch: Google Play services starts
 * this for it (the manifest's filter names the path). It's kept for the next time the app opens, and the rest alarm
 * follows it straight away, so a rest started on the phone buzzes on the wrist too.
 */
class StateListenerService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        // The buffer is only valid during this call, so each payload is read out here.
        val states = events.filter { it.type == DataEvent.TYPE_CHANGED && it.dataItem.uri.path == WatchRepo.STATE_PATH }
            .mapNotNull { DataMapItem.fromDataItem(it.dataItem).dataMap.getString("json") }
        states.forEach { WatchRepo.onState(applicationContext, it) }
    }
}
