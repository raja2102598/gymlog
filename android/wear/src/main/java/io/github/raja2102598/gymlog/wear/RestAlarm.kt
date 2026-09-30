package io.github.raja2102598.gymlog.wear

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * The rest timer's buzz at zero, screen on or off, app open or not: an exact alarm at the rest's end, and
 * RestOverReceiver, below, when it goes off. It follows whatever rest the watch has, the phone's or its own, so a rest
 * started on the phone buzzes on the wrist too. The phone's own "Rest over" isn't shown on the watch as well (bridging
 * is off, MainActivity), so it buzzes once.
 */
object RestAlarm {
    private const val CHANNEL_OVER = "rest-over"
    private const val OVER_ID = 5203
    private const val REQUEST_CODE = 5201
    const val EXTRA_END_AT = "endAt"

    // Three long pulses at full strength: unmistakable on the wrist mid-set, over in about two seconds.
    private val BUZZ_TIMINGS = longArrayOf(0, 500, 200, 500, 200, 900)
    private val BUZZ_AMPLITUDES = intArrayOf(0, 255, 0, 255, 0, 255)
    val BUZZ_MS: Long = BUZZ_TIMINGS.sum()

    /**
     * Follows the rest there is now: an alarm at its end while it counts down, none once it's skipped or paused. One
     * already over is left alone, since its alarm has gone off or is going off right now; the receiver checks it's
     * still due before buzzing. A rest with time to come (a new one from the phone or said to it, say, while the app is
     * out of sight) takes down a "Rest over" still showing, which is for the rest before it, as the phone's scheduler
     * does.
     */
    fun sync(ctx: Context, state: WatchState?, now: Long) {
        val r = state?.rest
        if (TimerLogic.restToCome(r, now)) clearOver(ctx)
        when {
            r == null || r.pausedAt != null -> cancel(ctx)
            r.endAt > now -> schedule(ctx, r.endAt)
        }
    }

    // Scheduling again with a new end replaces the alarm rather than adding one: AlarmManager matches a PendingIntent
    // by its request code and the receiver, never by its extras.
    private fun pendingIntent(ctx: Context, endAt: Long): PendingIntent {
        val intent = Intent(ctx, RestOverReceiver::class.java).putExtra(EXTRA_END_AT, endAt)
        return PendingIntent.getBroadcast(ctx, REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun schedule(ctx: Context, endAt: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pi = pendingIntent(ctx, endAt)
        // USE_EXACT_ALARM (API 33 on) and SCHEDULE_EXACT_ALARM (31 and 32) are granted on install, but either can be
        // turned off in Settings on 31 and 32: then the inexact alarm, which Doze may hold back a little.
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi) else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi)
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi)
        }
    }

    private fun cancel(ctx: Context) {
        ctx.getSystemService(AlarmManager::class.java)?.cancel(pendingIntent(ctx, 0L))
    }

    /** The rest is over: the buzz, and "Rest over" with what's next unless Gym Log is on screen, which says so itself. */
    fun over(ctx: Context, rest: Rest, state: WatchState) {
        buzz(ctx)
        if (!AppVisibility.visible) notifyOver(ctx, rest, state)
    }

    /** Takes "Rest over" down: the app is on screen. */
    fun clearOver(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(OVER_ID)

    // As an alarm's vibration, which Wear OS plays with the screen off and through Do Not Disturb when alarms are
    // allowed, as they are unless turned off. It needs no notification permission.
    private fun buzz(ctx: Context) {
        val v: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Vibrator::class.java)
        } ?: return
        if (!v.hasVibrator()) return
        val effect = VibrationEffect.createWaveform(BUZZ_TIMINGS, BUZZ_AMPLITUDES, -1)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        } else {
            @Suppress("DEPRECATION")
            v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        }
    }

    private fun notifyOver(ctx: Context, rest: Rest, state: WatchState) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val nm = NotificationManagerCompat.from(ctx)
        if (nm.getNotificationChannelCompat(CHANNEL_OVER) == null) {
            // Silent itself: the buzz above is the alert, so a second one from the channel would only double it.
            nm.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_OVER, NotificationManagerCompat.IMPORTANCE_HIGH)
                    .setName("Rest over")
                    .setDescription("Says when your rest is over, with a buzz.")
                    .setSound(null, null)
                    .setVibrationEnabled(false)
                    .build(),
            )
        }
        val next = StepLogic.afterRest(state.days.firstOrNull { it.date == rest.day }, rest.lift)
        val n = NotificationCompat.Builder(ctx, CHANNEL_OVER)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(StepLogic.OVER_TITLE)
            .setContentText(StepLogic.overText(rest.lift, next))
            .setContentIntent(MainActivity.openIntent(ctx))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        nm.notify(OVER_ID, n)
    }
}

/** Whether Gym Log is on screen: MainActivity sets it as it starts and stops. */
object AppVisibility {
    @Volatile
    var visible = false
}

/**
 * The rest timer's alarm going off. Gym Log may not be running at all, so the rest is read from the files: it buzzes
 * only if that rest is still the one due now (not skipped, paused or pushed out since), then stays alive until the buzz
 * is over, so it isn't cut short with the process.
 */
class RestOverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val state = WatchRepo.load(context).state ?: return
        val rest = state.rest
        if (rest == null || !TimerLogic.alarmStillDue(rest, intent.getLongExtra(RestAlarm.EXTRA_END_AT, 0L))) return
        val done = goAsync()
        RestAlarm.over(context, rest, state)
        Handler(Looper.getMainLooper()).postDelayed({ done.finish() }, RestAlarm.BUZZ_MS + 200L)
    }
}
