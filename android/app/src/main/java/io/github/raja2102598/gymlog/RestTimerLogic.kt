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

    /** The countdown's short text for Samsung's Now Bar, below Android 17 (shortFor decides whether it's used):
     *  when it's over. It never needs changing, which a time left would every second, and it's never out of date,
     *  since Android takes the countdown down at that moment (RestAlarm.showRest's setTimeoutAfter). */
    fun restShort(endsAt: String): String = "Till $endsAt"

    /**
     * The Live Update's short critical text (Notification.Builder.setShortCriticalText), or null for none. It's set
     * for Samsung's Now Bar, which without it showed only the app's name, not the chronometer the notification counts
     * with; whether One UI shows this instead is unconfirmed. Android's own status bar chip does show that chronometer,
     * ticking, unless a short critical text is set, which it shows instead (SystemUI's NotifChipsViewModel): a fixed
     * text there would only be worse than the clock, so it's for Samsung's phones only.
     */
    fun shortFor(manufacturer: String, text: String): String? = text.trim().takeIf { it.isNotEmpty() && samsungPhone(manufacturer) }

    /** A moment as the phone's clock shows it, without AM/PM ("9:05", or "21:05" on a 24-hour phone): short enough
     *  for the Now Bar and a notification's line, and a rest is never long enough for the half of the day to be in
     *  doubt. */
    fun clockTime(epochMs: Long, zone: ZoneId, is24Hour: Boolean): String =
        DateTimeFormatter.ofPattern(if (is24Hour) "H:mm" else "h:mm").format(Instant.ofEpochMilli(epochMs).atZone(zone))

    /**
     * Whether the countdown and the workout's clock carry Notification.MetricStyle (RestAlarm.post): from Android 17
     * (API 37), where it first exists. Its first metric is a clock the system counts itself, and the status bar's chip
     * shows that one, ticking, unless there's a short critical text, which it shows instead (Notification's
     * resolveCompactContent): so on this path there's none, on any phone. Below 17, both are as they always were.
     */
    fun metricStyle(sdkInt: Int): Boolean = sdkInt >= 37

    /** One of MetricStyle's metrics, without Android's types (RestAlarm builds the real ones): a timer counting down to
     *  `at`, a stopwatch counting up from it (epoch ms; the system counts both), or a fixed text. Android asks for
     *  labels of 10 characters or fewer. */
    sealed interface LiveMetric {
        val label: String

        data class Timer(override val label: String, val at: Long) : LiveMetric

        data class Stopwatch(override val label: String, val at: Long) : LiveMetric

        data class Text(override val label: String, val value: String) : LiveMetric
    }

    /** The countdown's metrics: first the rest counting down to `endAt`, the one the chip shows, then what's next, as
     *  the page words it without its "Next: " (MetricStyle shows no content text, so this is where it goes). With
     *  nothing next (Finish workout), the countdown alone. */
    fun restMetrics(endAt: Long, next: String): List<LiveMetric> =
        listOfNotNull(
            LiveMetric.Timer("Rest", endAt),
            next.trim().removePrefix("Next:").trim().replaceFirstChar { it.uppercase() }.takeIf { it.isNotEmpty() }?.let { LiveMetric.Text("Next", it) },
        )

    /** The workout's: first its clock counting up from `since`, then how many exercises are done, from its short
     *  text ("2/5 done", lib/session.ts), which is empty until there are any. */
    fun workoutMetrics(since: Long, short: String): List<LiveMetric> =
        listOfNotNull(
            LiveMetric.Stopwatch("Workout", since),
            Regex("""(\d+/\d+) done""").matchEntire(short.trim())?.let { LiveMetric.Text("Exercises", it.groupValues[1]) },
        )

    /** A Samsung phone, by Build.MANUFACTURER: where samsungExtras has anything to add, where Settings offers the
     *  Samsung timer card (RestTimerPlugin.isSamsung), and where its Live Updates row speaks of the Now Bar and opens
     *  Developer options (liveUpdatePages). */
    fun samsungPhone(manufacturer: String): Boolean = manufacturer.trim().equals("samsung", ignoreCase = true)

    /** A page of Android's own settings that the rows under Settings' "Rest timer notifications" open, without
     *  Android's types: RestTimerPlugin makes each an Intent. */
    enum class SettingsPage {
        /** Alarms & reminders for Gym Log (Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Android 12 and later). */
        EXACT_ALARMS,

        /** Live Updates for Gym Log (Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS, Android 16 and later). */
        LIVE_UPDATES,

        /** Developer options, where One UI keeps Live notifications for all apps. */
        DEVELOPER_OPTIONS,

        /** Gym Log's notification settings. */
        APP_NOTIFICATIONS,

        /** Gym Log's own page in Android's settings (App info), the last to try. */
        APP_INFO,
    }

    /** Where "Open settings" under Alarms & reminders goes, the first of these the phone has: that page, from Android
     *  12 (API 31), the first to have it, and otherwise Gym Log's own page. */
    fun exactAlarmPages(sdkInt: Int): List<SettingsPage> =
        listOfNotNull(SettingsPage.EXACT_ALARMS.takeIf { sdkInt >= 31 }, SettingsPage.APP_INFO)

    /**
     * Where "Open settings" under Live Updates goes, the first of these the phone has. Android's Live Updates page
     * for Gym Log from Android 16 (API 36). On a Samsung, Developer options instead: One UI answers "not allowed"
     * even while its Now Bar shows Gym Log, and the switch that lets any app in there is Developer options → Live
     * notifications for all apps (docs/android.md), which no app can turn on itself. Then Gym Log's notification
     * settings, and its own page, for a phone whose Settings app lacks the ones before.
     */
    fun liveUpdatePages(sdkInt: Int, samsung: Boolean): List<SettingsPage> =
        listOfNotNull(
            when {
                samsung -> SettingsPage.DEVELOPER_OPTIONS
                sdkInt >= 36 -> SettingsPage.LIVE_UPDATES
                else -> null
            },
            SettingsPage.APP_NOTIFICATIONS,
            SettingsPage.APP_INFO,
        )

    /** What Samsung's own Now Bar card says, with Settings' "Samsung timer card (experimental)" on: its first and
     *  second lines, in the notification and the Now Bar alike, and the status bar chip's text. */
    data class SamsungCard(val primary: String, val secondary: String, val chip: String)

    private const val SAMSUNG = "android.ongoingActivityNoti."

    /** The card's style, which samsungExtras sets only with the card; RestAlarm then adds its clock. */
    const val SAMSUNG_STYLE = "${SAMSUNG}style"

    /** The card's clock, a RemoteViews holding a Chronometer (res/layout/samsung_chronometer.xml), which RestAlarm
     *  adds itself, being an Android type. */
    const val SAMSUNG_CHRONOMETER_VIEW = "${SAMSUNG}chronometerRemoteView"

    /**
     * Samsung's private extras for the two running notifications: with `card` (the experiment in Settings), on a
     * Samsung, the fields of Samsung's own "chronometer card", which One UI honours only for apps Samsung approves, so
     * it may do nothing; none otherwise, and on any other phone, which doesn't read them. Samsung doesn't document the
     * two positions: 1 is what its partners' examples use (akexorcist.dev, "Live Notifications and Now Bar in Samsung
     * One UI 7"). Not One UI's automation pair (`automation`, `automationPackage`): from One UI 8.5 it lets a Live
     * Update into the Now Bar without Samsung's allowlist, but that's Gemini's lane, for Gemini acting in an app, and
     * the Now Bar shows it under Gemini's name and logo, whatever the package it names (docs/android.md).
     */
    fun samsungExtras(manufacturer: String, card: SamsungCard?): Map<String, Any> =
        when {
            !samsungPhone(manufacturer) || card == null -> emptyMap()
            else ->
                mapOf(
                    SAMSUNG_STYLE to 1,
                    "${SAMSUNG}primaryInfo" to card.primary,
                    "${SAMSUNG}secondaryInfo" to card.secondary,
                    "${SAMSUNG}chipExpandedText" to card.chip,
                    "${SAMSUNG}nowbarPrimaryInfo" to card.primary,
                    "${SAMSUNG}nowbarSecondaryInfo" to card.secondary,
                    "${SAMSUNG}chronometerRemoteViewPosition" to 1,
                    "${SAMSUNG}chronometerRemoteViewTag" to "gymlog_clock",
                    "${SAMSUNG}nowbarChronometerPosition" to 1,
                )
        }
}
