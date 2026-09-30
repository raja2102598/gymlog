package io.github.raja2102598.gymlog

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.text.format.DateFormat
import android.util.Log
import android.widget.RemoteViews
import androidx.annotation.ChecksSdkIntAtLeast
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.time.Instant
import java.time.ZoneId

/**
 * The lock screen while Gym Log is backgrounded or closed (src/native/rest.ts). A workout under way: its clock
 * counting up on its own (setUsesChronometer, so nothing has to wake the app every second just to redraw it). Resting:
 * the rest timer's countdown, counting down the same way, and an alarm for when it ends (RestTimerPlugin schedules and
 * cancels it from JavaScript, following the in-page timer in store.ts), when RestTimerReceiver, below, says "Rest
 * over". Each of the three is a notification with its own id, so none replaces another: the countdown sits over the
 * workout's clock while you rest, and Android takes it down at zero by itself (setTimeoutAfter), leaving the clock,
 * however late the alarm is (an inexact one can be minutes late, docs/android.md). Both running ones ask to be
 * promoted, with Android's own API: Android 16 shows them as Live Updates, on the lock screen and as the status bar's
 * chip, and earlier versions as ordinary notifications. From Android 17 they also carry MetricStyle (post, below),
 * whose clock the system counts in the chip itself. Samsung's One UI puts other apps' Live Updates in its Now Bar
 * only if Samsung has approved the app, or with Developer options → Live notifications for all apps on
 * (docs/android.md). The pure decisions are RestTimerLogic.
 */
object RestAlarm {
    // Three channels, so logging a set never makes a sound: the countdown and the workout's clock are quiet, and only
    // "Rest over" alerts.
    private const val CHANNEL_OVER = "rest-timer"
    private const val CHANNEL_RUNNING = "rest-timer-running"
    private const val CHANNEL_WORKOUT = "workout-live"
    private const val WORKOUT_ID = 4201
    private const val REST_ID = 4202
    private const val OVER_ID = 4203
    private const val REQUEST_CODE = 4201
    private const val TAG = "RestAlarm"
    const val EXTRA_LIFT = "lift"
    const val EXTRA_NEXT = "next"

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
        if (nm.getNotificationChannelCompat(CHANNEL_WORKOUT) == null) {
            nm.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_WORKOUT, NotificationManagerCompat.IMPORTANCE_LOW)
                    .setName("Workout under way")
                    .setDescription("Your workout's clock and how far it's got, while Gym Log is out of sight, without a sound.")
                    .build(),
            )
        }
    }

    // Cancelling and (re)scheduling both build this from just the request code and the receiver's own class, since
    // AlarmManager and PendingIntent match an existing alarm by those and the intent's action/data/categories, never
    // by extras: a cancel-only PendingIntent with no lift name still cancels one that was scheduled with one, and
    // scheduling again with the real lift name replaces it rather than adding a second alarm.
    private fun pendingIntent(ctx: Context, lift: String, next: String = ""): PendingIntent {
        val intent = Intent(ctx, RestTimerReceiver::class.java).putExtra(EXTRA_LIFT, lift).putExtra(EXTRA_NEXT, next)
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

    /** Whether "Rest over" gets its exact alarm (schedule, below), for Settings to say (RestTimerPlugin.checkAlarms):
     *  null before Android 12, where exact alarms need no permission and there's nothing to allow, and from then on
     *  whether the phone allows them now (Alarms & reminders), which schedule() asks each time. */
    fun exactAlarms(ctx: Context): Boolean? {
        // canScheduleExactAlarms() doesn't exist before API 31.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return RestTimerLogic.useExactAlarm(Build.VERSION.SDK_INT, am.canScheduleExactAlarms())
    }

    /** Whether Android may show the countdown and the workout's clock as Live Updates, which both ask to be
     *  (setRequestPromotedOngoing, below), for Settings to say: null before Android 16, which has none, and from then
     *  on whether the phone's settings allow them for Gym Log. One UI says false even while its Now Bar shows Gym Log,
     *  so on a Samsung, Settings doesn't go by it (src/components/settings/restNotifications.ts). */
    fun liveUpdates(ctx: Context): Boolean? {
        // canPostPromotedNotifications() doesn't exist before API 36.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) return null
        return ctx.getSystemService(NotificationManager::class.java).canPostPromotedNotifications()
    }

    /** When a rest ends, as the phone's clock shows it (its 12- or 24-hour setting). */
    private fun clockTime(ctx: Context, at: Long): String = RestTimerLogic.clockTime(at, ZoneId.systemDefault(), DateFormat.is24HourFormat(ctx))

    /** Schedules the alert for `endAt` (epoch ms) and shows the counting-down notification right away, replacing
     *  whichever lift's timer was scheduled before (only one rest timer runs at a time, store.ts), and any "Rest over"
     *  still showing from it. `next` is what comes after the rest, in the page's words, and `card` whether Settings'
     *  Samsung timer card is on. Quietly does nothing if Gym Log isn't allowed to notify, so callers don't have to
     *  check first. */
    fun schedule(ctx: Context, lift: String, endAt: Long, next: String, card: Boolean = false) {
        if (!canNotify(ctx)) return
        NotificationManagerCompat.from(ctx).cancel(OVER_ID)
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val left = RestTimerLogic.remainingMs(endAt, System.currentTimeMillis())
        if (left <= 0) {
            am.cancel(pendingIntent(ctx, ""))
            over(ctx, lift, next)
            return
        }
        showRest(ctx, lift, endAt, left, next, card)
        // canScheduleExactAlarms() doesn't exist before API 31; true there just means "not restricted", which is
        // also what useExactAlarm does with it below sdkInt 31 regardless of the value passed.
        val canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        val pi = pendingIntent(ctx, lift, next)
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

    /** The countdown, gone at zero by itself (setTimeoutAfter: Android's own timing, exact whatever the alarm's), so
     *  it never counts on past zero into minus while an inexact alarm is late, and the workout's clock under it shows
     *  again right then. */
    private fun showRest(ctx: Context, lift: String, endAt: Long, left: Long, next: String, card: Boolean) {
        channels(ctx)
        val endsAt = clockTime(ctx, endAt)
        val title = RestTimerLogic.restTitle(lift)
        val text = RestTimerLogic.restText(next, endsAt)
        val b = NotificationCompat.Builder(ctx, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openAppIntent(ctx))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setWhen(endAt)
            .setShowWhen(true)
            .setTimeoutAfter(left)
            .setRequestPromotedOngoing(true)
        samsungExtras(ctx, b, if (card) RestTimerLogic.SamsungCard(title, text, RestTimerLogic.restShort(endsAt)) else null, endAt, countDown = true)
        post(ctx, REST_ID, b, RestTimerLogic.shortFor(Build.MANUFACTURER, RestTimerLogic.restShort(endsAt)), RestTimerLogic.restMetrics(endAt, next))
    }

    @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.CINNAMON_BUN)
    private val metricStyle = RestTimerLogic.metricStyle(Build.VERSION.SDK_INT)

    /**
     * Posts a running notification as `id`, built by `b`. From Android 17 (RestTimerLogic.metricStyle) with
     * MetricStyle's `metrics` over it (LiveMetrics) and no short critical text, which Android's chip would show instead
     * of the metric's clock. Below 17, or if anything about the style fails, it's the notification as before: `b`'s
     * own, with `short` (RestTimerLogic.shortFor), so a failure never costs the notification itself.
     */
    private fun post(ctx: Context, id: Int, b: NotificationCompat.Builder, short: String?, metrics: List<RestTimerLogic.LiveMetric>) {
        val nm = NotificationManagerCompat.from(ctx)
        if (metricStyle) {
            try {
                nm.notify(id, LiveMetrics.styled(ctx, b.build(), metrics))
                return
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't post it with MetricStyle; posting it without", e)
            } catch (e: LinkageError) {
                // A phone whose Android 17 lacks part of the API: the same.
                Log.w(TAG, "Couldn't post it with MetricStyle; posting it without", e)
            }
        }
        short?.let { b.setShortCriticalText(it) }
        nm.notify(id, b.build())
    }

    /** Samsung's extras on `b` (RestTimerLogic.samsungExtras), none on other phones: with `card`, the card's, and its
     *  clock, a Chronometer counting down to `at` or up from it, as the notification's own does. The card is an
     *  experiment, so if it can't be built the notification goes without it rather than not at all. */
    private fun samsungExtras(ctx: Context, b: NotificationCompat.Builder, card: RestTimerLogic.SamsungCard?, at: Long, countDown: Boolean) {
        try {
            val extras = RestTimerLogic.samsungExtras(Build.MANUFACTURER, card)
            if (extras.isEmpty()) return
            val bundle = Bundle()
            for ((key, value) in extras) {
                when (value) {
                    is Boolean -> bundle.putBoolean(key, value)
                    is Int -> bundle.putInt(key, value)
                    else -> bundle.putString(key, value.toString())
                }
            }
            if (RestTimerLogic.SAMSUNG_STYLE in extras) {
                val clock = RemoteViews(ctx.packageName, R.layout.samsung_chronometer)
                clock.setChronometer(R.id.samsungClock, SystemClock.elapsedRealtime() + (at - System.currentTimeMillis()), null, true)
                clock.setChronometerCountDown(R.id.samsungClock, countDown)
                bundle.putParcelable(RestTimerLogic.SAMSUNG_CHRONOMETER_VIEW, clock)
            }
            b.addExtras(bundle)
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't add Samsung's extras", e)
        }
    }

    /** The rest is over: its countdown goes (Android may already have taken it down) and "Rest over" alerts, as a
     *  notification of its own, so the workout's clock stays where it is. From the alarm, or from schedule() for a
     *  rest already over when it arrives. */
    fun over(ctx: Context, lift: String, next: String) {
        val nm = NotificationManagerCompat.from(ctx)
        nm.cancel(REST_ID)
        // Checked here as well as in schedule(): the alarm can fire after notifications were turned off.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        channels(ctx)
        val b = NotificationCompat.Builder(ctx, CHANNEL_OVER)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(RestTimerLogic.OVER_TITLE)
            .setContentText(RestTimerLogic.overText(lift, next))
            .setContentIntent(openAppIntent(ctx))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
        nm.notify(OVER_ID, b.build())
    }

    /** No rest to show: the pending alarm, the countdown and any "Rest over" all go. */
    fun cancelRest(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pendingIntent(ctx, ""))
        val nm = NotificationManagerCompat.from(ctx)
        nm.cancel(REST_ID)
        nm.cancel(OVER_ID)
    }

    /** No workout under way: its clock goes. */
    fun cancelWorkout(ctx: Context) {
        NotificationManagerCompat.from(ctx).cancel(WORKOUT_ID)
    }

    /** Everything: Gym Log is back in front, where store.ts's own countdown says when rest is over and the workout
     *  shows its own clock. */
    fun cancel(ctx: Context) {
        cancelRest(ctx)
        cancelWorkout(ctx)
    }

    /** The workout under way: its session and how far it's got (`short`, a few characters of that, for Samsung's
     *  Now Bar), and its clock counting up on its own from `since`. Android takes it down after `forMs`, when the
     *  app would count the workout as left behind (lib/workout.ts, STALE_RUN_MS). `card`: whether Settings' Samsung
     *  timer card is on. */
    fun showWorkout(ctx: Context, title: String, text: String, short: String, since: Long, forMs: Long, card: Boolean = false) {
        if (!canNotify(ctx)) return
        channels(ctx)
        val b = NotificationCompat.Builder(ctx, CHANNEL_WORKOUT)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openAppIntent(ctx))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setUsesChronometer(true)
            .setWhen(since)
            .setShowWhen(true)
            .setTimeoutAfter(forMs.coerceAtLeast(1L))
            .setRequestPromotedOngoing(true)
        samsungExtras(ctx, b, if (card) RestTimerLogic.SamsungCard(title, text, short.ifBlank { title }) else null, since, countDown = false)
        post(ctx, WORKOUT_ID, b, RestTimerLogic.shortFor(Build.MANUFACTURER, short), RestTimerLogic.workoutMetrics(since, short))
    }
}

/**
 * Notification.MetricStyle, Android 17's Live Update template for timers and fitness (RestAlarm.post): the system
 * draws its metrics and counts a running timer or stopwatch itself, in the notification, the status bar's chip, the
 * lock screen and the always-on display, with Gym Log frozen. It's framework-only, a style NotificationCompat doesn't
 * know, so it's set on the framework Builder recovered from the notification NotificationCompat built: that Builder
 * adopts the notification itself, so every other field and extra stays exactly as NotificationCompat set it.
 */
@RequiresApi(Build.VERSION_CODES.CINNAMON_BUN)
private object LiveMetrics {
    fun styled(ctx: Context, n: Notification, metrics: List<RestTimerLogic.LiveMetric>): Notification {
        val style = Notification.MetricStyle()
        for (m in metrics) style.addMetric(Notification.Metric(value(m), m.label))
        // The first is the clock: what the chip shows, with no short critical text (RestTimerLogic.metricStyle).
        style.setCriticalMetric(0)
        return Notification.Builder.recoverBuilder(ctx, n).setStyle(style).build()
    }

    private fun value(m: RestTimerLogic.LiveMetric): Notification.Metric.MetricValue =
        when (m) {
            is RestTimerLogic.LiveMetric.Timer -> Notification.Metric.TimeDifference.forTimer(Instant.ofEpochMilli(m.at), Notification.Metric.TimeDifference.FORMAT_CHRONOMETER)
            is RestTimerLogic.LiveMetric.Stopwatch -> Notification.Metric.TimeDifference.forStopwatch(Instant.ofEpochMilli(m.at), Notification.Metric.TimeDifference.FORMAT_CHRONOMETER)
            is RestTimerLogic.LiveMetric.Text -> Notification.Metric.FixedText(m.value)
        }
}

/** The rest timer's alarm firing: Gym Log may be backgrounded or not running at all, so this only says "Rest over"
 *  (RestAlarm.over), leaving the workout's clock as it is. The in-page timer (store.ts) keeps its own clock and isn't
 *  touched by this; coming back to Gym Log cancels the alarm, so this never runs with the app in front. */
class RestTimerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        RestAlarm.over(context, intent.getStringExtra(RestAlarm.EXTRA_LIFT) ?: "", intent.getStringExtra(RestAlarm.EXTRA_NEXT) ?: "")
        // The home-screen widget counts the rest down while it runs: redrawn now, its clock moves on to the workout.
        GymWidgetProvider.refresh(context)
    }
}
