package io.github.raja2102598.gymlog

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Background sync from JavaScript (src/native/sync.ts): whether this phone can do it, the Health Connect permission
 * it needs, and turning it on and off. The work itself is HealthSyncWorker.
 */
@CapacitorPlugin(name = "GymSync")
class GymSyncPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val contract = PermissionController.createRequestPermissionResultContract()

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()
    }

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context) else null

    private fun safely(call: PluginCall, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                call.reject(e.message ?: "Background sync call failed", null, e)
            }
        }
    }

    /** { on, available, allowed, lastRunAt, lastOk, lastMsg } */
    @PluginMethod
    fun status(call: PluginCall) = safely(call) {
        val c = client()
        val (at, ok, msg) = HealthSync.last(context)
        val available = c != null && HealthSync.backgroundAvailable(c)
        val allowed = c != null && HealthSync.BACKGROUND in c.permissionController.getGrantedPermissions()
        call.resolve(
            JSObject()
                .put("on", HealthSync.config(context) != null)
                .put("available", available)
                .put("allowed", allowed)
                .put("lastRunAt", at)
                .put("lastOk", ok)
                .put("lastMsg", msg),
        )
    }

    /** { running }: a background run is reading or sending right now, in this process. */
    @PluginMethod
    fun running(call: PluginCall) {
        call.resolve(JSObject().put("running", HealthSync.running))
    }

    /** Asks Health Connect for background reading, where it exists. Resolves { available, allowed }. */
    @PluginMethod
    fun requestBackground(call: PluginCall) = safely(call) {
        val c = client()
        if (c == null || !HealthSync.backgroundAvailable(c)) {
            call.resolve(JSObject().put("available", false).put("allowed", false))
            return@safely
        }
        if (HealthSync.BACKGROUND in c.permissionController.getGrantedPermissions()) {
            call.resolve(JSObject().put("available", true).put("allowed", true))
            return@safely
        }
        startActivityForResult(call, contract.createIntent(context, setOf(HealthSync.BACKGROUND)), "backgroundAnswered")
    }

    @ActivityCallback
    private fun backgroundAnswered(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        safely(call) {
            val allowed = client()?.permissionController?.getGrantedPermissions()?.contains(HealthSync.BACKGROUND) == true
            call.resolve(JSObject().put("available", true).put("allowed", allowed))
        }
    }

    /** Turns it on with this phone's key: { key, url, anonKey }. Runs once straight away. */
    @PluginMethod
    fun enable(call: PluginCall) {
        val key = call.getString("key")
        val url = call.getString("url")
        val anonKey = call.getString("anonKey")
        if (key.isNullOrEmpty() || url.isNullOrEmpty() || anonKey.isNullOrEmpty()) {
            call.reject("key, url and anonKey are needed")
            return
        }
        HealthSync.enable(context, HealthSync.Config(key, url, anonKey))
        HealthSync.runNow(context)
        call.resolve()
    }

    @PluginMethod
    fun disable(call: PluginCall) {
        HealthSync.disable(context)
        call.resolve()
    }

    @PluginMethod
    fun runNow(call: PluginCall) {
        if (HealthSync.config(context) != null) HealthSync.runNow(context)
        call.resolve()
    }
}
