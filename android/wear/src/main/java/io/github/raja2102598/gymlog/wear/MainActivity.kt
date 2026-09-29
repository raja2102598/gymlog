package io.github.raja2102598.gymlog.wear

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.wear.phone.interactions.notifications.BridgingConfig
import androidx.wear.phone.interactions.notifications.BridgingManager
import kotlinx.coroutines.launch

/** The watch app's one screen host (WatchApp). It catches up with the phone each time it comes to the front. */
class MainActivity : ComponentActivity() {
    private val askToNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WatchRepo.load(this)
        // The watch buzzes "Rest over" itself (RestAlarm), for rests started here or on the phone, so the phone app's
        // own notifications aren't shown on the watch as well: that would buzz twice. The phone app's only other
        // notifications are ongoing ones, which Wear OS never shows on the watch anyway.
        try {
            BridgingManager.fromContext(this).setConfig(BridgingConfig.Builder(this, false).build())
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't turn off the phone app's notifications on the watch", e)
        }
        askOnceToNotify()
        setContent { WatchApp() }
    }

    override fun onStart() {
        super.onStart()
        AppVisibility.visible = true
        RestAlarm.clearOver(this)
        WorkoutService.sync(applicationContext, WatchRepo.snapshot.value.state)
        lifecycleScope.launch {
            WatchRepo.refresh(applicationContext)
            WorkoutService.sync(applicationContext, WatchRepo.snapshot.value.state)
        }
    }

    override fun onStop() {
        AppVisibility.visible = false
        super.onStop()
    }

    // Wear OS 4 and later ask before an app may post notifications: "Rest over" and the workout on the watch face need
    // it. Asked the first time the app opens, and never again: Settings can turn it on later.
    private fun askOnceToNotify() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences("gymlog", MODE_PRIVATE)
        if (prefs.getBoolean(ASKED, false)) return
        prefs.edit().putBoolean(ASKED, true).apply()
        askToNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    companion object {
        private const val TAG = "GymLogWatch"
        private const val ASKED = "askedToNotify"

        /** Opens the app where it was: from "Rest over" or the workout on the watch face. */
        fun openIntent(ctx: Context): PendingIntent =
            PendingIntent.getActivity(
                ctx,
                0,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
    }
}
