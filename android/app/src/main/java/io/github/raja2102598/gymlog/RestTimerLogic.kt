package io.github.raja2102598.gymlog

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

    /** The notification's title: the lift a set was just logged on, or a generic one for a call with none. */
    fun titleFor(lift: String): String = lift.ifBlank { "Rest timer" }

    /** The notification's line: short and plain either way, since Android's own chrome (the app's name and icon)
     *  already says whose alert this is, and the running one counts down on its own (setUsesChronometer) rather
     *  than saying a number that would need updating here. */
    fun textFor(ended: Boolean): String = if (ended) "Rest over" else "Resting"
}
