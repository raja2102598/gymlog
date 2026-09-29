package io.github.raja2102598.gymlog

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The rest timer's background alert (src/native/rest.ts): the small decisions behind it, with no Android types, so
 * they're tested on the plain JVM (RestTimerLogicTest), like AppUpdateLogic and SpeechErrors. RestAlarm and
 * RestTimerPlugin do the rest: AlarmManager, NotificationManagerCompat, the receiver.
 */
object RestTimerLogic {
    /**
     * Whether to schedule the exact alarm rather than the inexact fallback. Below Android 12 (S, API 31) exact
     * alarms aren't restricted at all, so this is always true there. From 31 on, only once `canScheduleExact`
     * (AlarmManager.canScheduleExactAlarms, which the caller must not even call before 31: the method doesn't exist
     * yet) says the phone currently allows it: newer versions don't grant that by default, and USE_EXACT_ALARM is
     * reserved for alarm and calendar apps, which Gym Log isn't. Either way the inexact alarm still fires; it just
     * isn't guaranteed to the second while Doze is deferring it.
     */
    fun useExactAlarm(sdkInt: Int, canScheduleExact: Boolean): Boolean = sdkInt < 31 || canScheduleExact

    /** Milliseconds left until `endAt`, never negative (a call that arrives after the moment it was for). */
    fun remainingMs(endAt: Long, now: Long): Long = maxOf(0L, endAt - now)

    /** The countdown's title: what's happening, and after which lift. Its chronometer, counting down on its own
     *  (setUsesChronometer), is the time left, so no number here needs updating. */
    fun restTitle(lift: String): String = if (lift.isBlank()) "Resting" else "Resting · ${lift.trim()}"

    /** The countdown's line: what comes after it, as the page words it (lib/session.ts, afterRest: "Next: set 3 of
     *  4"), or else when it's over, `endsAt` being clockTime's. */
    fun restText(next: String, endsAt: String): String = next.trim().ifEmpty { "Rest over at $endsAt" }

    /** "Rest over", said by the alarm's own notification. */
    const val OVER_TITLE = "Rest over"

    /** Its line: which lift, and what comes next, whichever of them there is. */
    fun overText(lift: String, next: String): String =
        listOf(lift.trim(), next.trim()).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Time for your next set" }

    /** The countdown's short text beside the app's icon in Samsung's Now Bar (shortFor decides whether it's used):
     *  when it's over. It never needs changing, which a time left would every second, and it's never out of date,
     *  since Android takes the countdown down at that moment (RestAlarm.showRest's setTimeoutAfter). */
    fun restShort(endsAt: String): String = "Till $endsAt"

    /**
     * Whether the phone is a Samsung, by Build.MANUFACTURER: One UI's Now Bar is where its Live Updates go, and it
     * takes other apps' only for those Samsung approves, or with Developer options → Live notifications for all apps
     * on (docs/android.md). The short text beside the icon is for it alone (shortFor), and Settings says so under Live
     * Updates (RestTimerPlugin.checkAlarms).
     */
    fun isSamsung(manufacturer: String): Boolean = manufacturer.trim().equals("samsung", ignoreCase = true)

    /**
     * The Live Update's short critical text (Notification.Builder.setShortCriticalText), or null for none. Samsung's
     * Now Bar (One UI 8) puts this beside the app's icon, and without it only the app's name: it doesn't show the
     * chronometer the notification counts with. Android's own status bar chip does show that chronometer, ticking,
     * unless a short critical text is set, which it shows instead (SystemUI's NotifChipsViewModel): a fixed text
     * there would only be worse than the clock, so it's for Samsung's phones only.
     */
    fun shortFor(manufacturer: String, text: String): String? = text.trim().takeIf { it.isNotEmpty() && isSamsung(manufacturer) }

    /** A moment as the phone's clock shows it, without AM/PM ("9:05", or "21:05" on a 24-hour phone): short enough
     *  for the Now Bar and a notification's line, and a rest is never long enough for the half of the day to be in
     *  doubt. */
    fun clockTime(epochMs: Long, zone: ZoneId, is24Hour: Boolean): String =
        DateTimeFormatter.ofPattern(if (is24Hour) "H:mm" else "h:mm").format(Instant.ofEpochMilli(epochMs).atZone(zone))
}
