package io.github.raja2102598.gymlog

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * The rest timer's alert while Gym Log is backgrounded or closed: an alarm for when it ends (RestTimerPlugin
 * schedules and cancels it from JavaScript, following the in-page timer in store.ts), and a notification that counts
 * down on its own (setUsesChronometer, so nothing has to wake the app every second just to redraw it) until
 * RestTimerReceiver, below, turns it into "Rest over" when the alarm fires. The pure decisions are RestTimerLogic.
 */
object RestAlarm {
    // Two channels, so logging a set never makes a sound: the countdown is quiet, and only "Rest over" alerts.
    private const val CHANNEL_OVER = "rest-timer"
    private const val CHANNEL_RUNNING = "rest-timer-running"
    private const val NOTIFICATION_ID = 4201
    private const val REQUEST_CODE = 4201
    const val EXTRA_LIFT = "lift"

    private fun channels(ctx: Context) {
        val nm = NotificationManagerCompat.from(ctx)
        if (nm.getNotificationChannelCompat(CHANNEL_OVER) == null) {
            nm.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_OVER, NotificationManagerCompat.IMPORTANCE_HIGH)
                    .setName("Rest over")
                    .setDescription("Says when a rest timer you started in Gym Log is over.")
                    .build(),
            )
        }
        if (nm.getNotificationChannelCompat(CHANNEL_RUNNING) == null) {
            nm.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_RUNNING, NotificationManagerCompat.IMPORTANCE_LOW)
                    .setName("Rest timer running")
                    .setDescription("The countdown while you rest, without a sound.")
                    .build(),
            )
        }
    }

    // Cancelling and (re)scheduling both build this from just the request code and the receiver's own class, since
    // AlarmManager and PendingIntent match an existing alarm by those and the intent's action/data/categories, never
    // by extras: a cancel-only PendingIntent with no lift name still cancels one that was scheduled with one, and
    // scheduling again with the real lift name replaces it rather than adding a second alarm.
    private fun pendingIntent(ctx: Context, lift: String): PendingIntent {
        val intent = Intent(ctx, RestTimerReceiver::class.java).putExtra(EXTRA_LIFT, lift)
        return PendingIntent.getBroadcast(ctx, REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun openAppIntent(ctx: Context): PendingIntent {
        val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            ?.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            ?: Intent()
        return PendingIntent.getActivity(ctx, REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Whether Gym Log can post at all right now: POST_NOTIFICATIONS (asked for from Settings) and the phone's own
     *  per-app notifications switch, which Android lets you turn off without touching the permission. */
    fun canNotify(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    /** Schedules the alert for `endAt` (epoch ms) and shows the counting-down notification right away, replacing
     *  whichever lift's timer was scheduled before (only one rest timer runs at a time, store.ts). Quietly does
     *  nothing if Gym Log isn't allowed to notify, so callers don't have to check first. */
    fun schedule(ctx: Context, lift: String, endAt: Long) {
        if (!canNotify(ctx)) return
        if (RestTimerLogic.remainingMs(endAt, System.currentTimeMillis()) <= 0) {
            show(ctx, lift, ended = true)
            return
        }
        show(ctx, lift, ended = false, endAt = endAt)
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        // canScheduleExactAlarms() doesn't exist before API 31; true there just means "not restricted", which is
        // also what useExactAlarm does with it below sdkInt 31 regardless of the value passed.
        val canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        val pi = pendingIntent(ctx, lift)
        try {
            if (RestTimerLogic.useExactAlarm(Build.VERSION.SDK_INT, canScheduleExact)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi)
            }
        } catch (e: SecurityException) {
            // Exact access was revoked between the check above and this call: the inexact alarm still gets there.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi)
        }
    }

    /** Cancels the pending alarm and takes down the notification: rest was paused, skipped, or finished while Gym
     *  Log was open (store.ts's own countdown got there first, so there's nothing left to alert about here). */
    fun cancel(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pendingIntent(ctx, ""))
        NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID)
    }

    /** Posts (or updates) the one notification: counting down on its own from `endAt` while running, or saying it's
     *  over. Same id either way, so the running one turns into the over one instead of leaving two. */
    fun show(ctx: Context, lift: String, ended: Boolean, endAt: Long = 0L) {
        // Checked here as well as in schedule(): the alarm can fire after notifications were turned off.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        channels(ctx)
        val b = NotificationCompat.Builder(ctx, if (ended) CHANNEL_OVER else CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(RestTimerLogic.titleFor(lift))
            .setContentText(RestTimerLogic.textFor(ended))
            .setContentIntent(openAppIntent(ctx))
            .setOnlyAlertOnce(!ended)
            .setOngoing(!ended)
            .setAutoCancel(ended)
            .setCategory(if (ended) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_PROGRESS)
        if (!ended) b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(endAt)
        NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build())
    }
}

/** The rest timer's alarm firing: Gym Log may be backgrounded or not running at all, so this only turns the
 *  notification RestAlarm already posted into "Rest over". The in-page timer (store.ts) keeps its own clock and
 *  isn't touched by this; if it's open and gets there first, it cancels the alarm before this ever runs. */
class RestTimerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        RestAlarm.show(context, intent.getStringExtra(RestAlarm.EXTRA_LIFT) ?: "", ended = true)
        // The home-screen widget says "rest until …" while a timer runs: redrawn now, it drops that line.
        GymWidgetProvider.refresh(context)
    }
}
