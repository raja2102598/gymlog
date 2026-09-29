package io.github.raja2102598.gymlog.wear

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The workout under way, while its clock runs: a foreground service with an Ongoing Activity, which puts the workout's
 * icon and clock (or the rest counting down) on the watch face and at the top of the app list, one tap from the app.
 * It keeps Gym Log's process alive through the workout too, so it opens at once on the set it was on. The rest's buzz
 * doesn't depend on it: that's an exact alarm (RestAlarm), which fires whether or not this runs.
 *
 * Android only lets an app start one while it's on screen, so MainActivity's start does (sync); from then on it
 * follows WatchRepo itself, and stops once the workout is finished or left behind.
 */
class WorkoutService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())
    private var foreground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        scope.launch { WatchRepo.snapshot.collect { show(it.state) } }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android wants startForeground within seconds of startForegroundService: done here with what there is now.
        show(WatchRepo.load(this).state)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        scope.cancel()
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun show(state: WatchState?) {
        handler.removeCallbacksAndMessages(null)
        val now = System.currentTimeMillis()
        val live = StepLogic.live(state, now)
        val n = notification(live, now)
        if (!foreground) {
            try {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, n, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
                foreground = true
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't keep the workout on the watch face", e)
                stopSelf()
                return
            }
        }
        if (live == null) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        if (canNotify()) NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, n)
        // Nothing changes in the state when a rest runs out or a clock is left running for hours, so look again then.
        val next = listOfNotNull(live.restEndAt, if (live.run.pausedAt == null) now + TimerLogic.LEFT_BEHIND_MS - TimerLogic.runMs(live.run, now) else null).minOrNull()
        if (next != null) handler.postDelayed({ show(WatchRepo.snapshot.value.state) }, (next - now).coerceAtLeast(0L) + 500L)
    }

    private fun canNotify(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** The ongoing notification, with its Ongoing Activity: the rest counting down while there is one, else the
     *  workout's clock counting up (or stopped where it was paused). */
    private fun notification(live: StepLogic.Live?, now: Long): android.app.Notification {
        val nm = NotificationManagerCompat.from(this)
        if (nm.getNotificationChannelCompat(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
                    .setName("Workout under way")
                    .setDescription("Your workout's clock on the watch face while it runs, without a sound.")
                    .build(),
            )
        }
        val open = MainActivity.openIntent(this)
        val b = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(live?.title ?: "Workout")
            .setContentText(live?.text ?: "")
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
        if (live == null) return b.build()
        // The Ongoing Activity counts on SystemClock.elapsedRealtime's clock, not the wall clock the phone's times use.
        val elapsed = SystemClock.elapsedRealtime()
        val status = if (live.restEndAt != null) {
            Status.Builder().addTemplate("Rest #t#").addPart("t", Status.TimerPart(elapsed + (live.restEndAt - now))).build()
        } else {
            val zero = elapsed - TimerLogic.runMs(live.run, now)
            val part = if (live.run.pausedAt != null) Status.StopwatchPart(zero, elapsed) else Status.StopwatchPart(zero)
            Status.Builder().addTemplate("#t#").addPart("t", part).build()
        }
        OngoingActivity.Builder(applicationContext, NOTIFICATION_ID, b)
            .setStaticIcon(R.drawable.ic_rest_timer)
            .setTouchIntent(open)
            .setStatus(status)
            .build()
            .apply(applicationContext)
        return b.build()
    }

    companion object {
        private const val TAG = "GymLogWatch"
        private const val CHANNEL = "workout"
        private const val NOTIFICATION_ID = 5204

        @Volatile
        private var running = false

        /** Starts it for a workout under way, while Gym Log is on screen, which is the only time Android allows it.
         *  Once running, it follows the state itself. */
        fun sync(ctx: Context, state: WatchState?) {
            if (running || !AppVisibility.visible || StepLogic.live(state, System.currentTimeMillis()) == null) return
            try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, WorkoutService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't start the workout on the watch face", e)
            }
        }
    }
}
