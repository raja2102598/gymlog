package io.github.raja2102598.gymlog.wear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseTrackedStatus
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.health.services.client.data.HeartRateAccuracy
import androidx.health.services.client.endExercise
import androidx.health.services.client.getCapabilities
import androidx.health.services.client.getCurrentExerciseInfo
import androidx.health.services.client.pauseExercise
import androidx.health.services.client.resumeExercise
import androidx.health.services.client.startExercise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Heart rate during the workout (docs/watch.md), from Health Services' ExerciseClient: an exercise of Health Services'
 * own, weight training, from the workout clock's start to Finish (or the workout being left behind). Health Services
 * keeps the sensor going with the screen off and while Gym Log is out of sight, and hands back what it read when the
 * app is running again, which MeasureClient, the simpler way, doesn't: it only measures while the app is on screen,
 * and a workout's watch is mostly dark between sets. WorkoutService, the foreground service that holds the workout on
 * the watch face, keeps the app running through it and calls `follow` on every change.
 *
 * Each day's readings are kept in a file (HeartLogic has the rules), and the day's average and highest go to the phone
 * as an `hr` command every few minutes and at the end. Without the permission, nothing is measured and the rest of
 * the workout goes on as it would. Everything here runs on the main thread: the service, the callback and the screens.
 */
object HeartMonitor {
    private const val TAG = "GymLogWatch"
    private const val FILE = "heart.json"

    /** Wear OS 6 (API 36) replaced BODY_SENSORS with Health Connect's own permission for heart rate. */
    private const val READ_HEART_RATE = "android.permission.health.READ_HEART_RATE"

    /** Weight training, as Health Services names it, else the nearest it offers, whichever measures heart rate. */
    private val TYPES = listOf(ExerciseType.WEIGHTLIFTING, ExerciseType.STRENGTH_TRAINING, ExerciseType.WORKOUT)

    private val latest = MutableStateFlow<Beat?>(null)

    /** The latest reading while measuring, for the lift and rest screens (HeartLogic.showing says whether it's fresh). */
    val beat: StateFlow<Beat?> = latest

    /** The permission to ask for on this watch. */
    val permission: String get() = if (Build.VERSION.SDK_INT >= 36) READ_HEART_RATE else Manifest.permission.BODY_SENSORS

    fun granted(ctx: Context): Boolean = ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var days: Map<String, Heart>? = null

    /** The day being measured, or null. */
    private var measuring: String? = null

    /** The day measured last, for Health Services' last readings, which arrive after the end. */
    private var last: String? = null
    private var callback: ExerciseUpdateCallback? = null
    private var exercise: ExerciseClient? = null

    /** One client for the process: each holds its own connection to Health Services. */
    private fun client(app: Context): ExerciseClient = exercise ?: HealthServices.getClient(app).exerciseClient.also { exercise = it }

    /** Health Services' calls, one after the other: an end is done before the next start asks what's running. */
    private var calls: Job? = null

    private fun queue(call: suspend () -> Unit) {
        val before = calls
        calls = scope.launch {
            before?.join()
            call()
        }
    }

    /** Whether the exercise running is ours: started here, or found running after Android stopped the app. */
    private var ours = false

    /** Whether it was last asked to be paused, or null when that isn't known (just started, or found running), so the
     *  next `follow` asks either way. */
    private var exercisePaused: Boolean? = null

    /**
     * Follows the workout: measuring while one is under way and the permission is there, and ending with it, when the
     * last of the day's heart rate goes to the phone. While its clock is paused, so is the exercise: Health Services
     * takes no readings then, to hand over later (and those it had are kept out all the same, HeartLogic.counts).
     */
    fun follow(ctx: Context, state: WatchState?, now: Long) {
        val app = ctx.applicationContext
        val run = StepLogic.live(state, now)?.run
        val want = run?.day?.takeIf { granted(app) }
        if (want != measuring) {
            val was = measuring
            // Set first: sending the day's heart rate below changes the state, which calls back in here.
            measuring = want
            if (was != null) stop(app, was)
            if (want != null) start(app, want)
        }
        if (want != null) pauseWith(app, run.pausedAt != null)
    }

    /** Pauses or resumes our exercise with the workout's clock, once per change. */
    private fun pauseWith(app: Context, paused: Boolean) {
        if (paused == exercisePaused) return
        exercisePaused = paused
        val client = client(app)
        queue {
            if (!ours) return@queue
            try {
                if (paused) client.pauseExercise() else client.resumeExercise()
            } catch (e: Exception) {
                // Already so (found running after Android stopped the app), or Health Services ended it.
                Log.i(TAG, "Health Services wouldn't ${if (paused) "pause" else "resume"} the exercise", e)
            }
        }
    }

    private fun start(app: Context, day: String) {
        last = day
        ours = false
        exercisePaused = null
        val client = client(app)
        val cb = callback ?: updates(app).also { callback = it }
        // Set before starting, and again after Android stopped the app mid-workout: Health Services then hands over
        // what it read meanwhile, and ends an exercise left five minutes with no one to hand it to.
        client.setUpdateCallback(cb)
        queue {
            try {
                when (client.getCurrentExerciseInfo().exerciseTrackedStatus) {
                    // Ours already, from before the app was stopped: it carries on.
                    ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS -> {
                        ours = true
                        return@queue
                    }
                    // Another app's workout (Samsung Health's, say): starting ours would end it, so it goes on without
                    // heart rate here.
                    ExerciseTrackedStatus.OTHER_APP_IN_PROGRESS -> {
                        Log.i(TAG, "Another app is recording a workout: no heart rate in Gym Log")
                        return@queue
                    }
                }
                val caps = client.getCapabilities()
                val type = TYPES.firstOrNull { it in caps.supportedExerciseTypes && DataType.HEART_RATE_BPM in caps.getExerciseTypeCapabilities(it).supportedDataTypes }
                if (type == null) {
                    Log.i(TAG, "This watch measures no heart rate in a workout")
                    return@queue
                }
                client.startExercise(
                    ExerciseConfig.builder(type)
                        .setDataTypes(setOf(DataType.HEART_RATE_BPM))
                        .setIsAutoPauseAndResumeEnabled(false)
                        .setIsGpsEnabled(false)
                        .build(),
                )
                ours = true
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't start measuring heart rate", e)
            }
        }
    }

    private fun stop(app: Context, day: String) {
        latest.value = null
        exercisePaused = null
        sendIfDue(app, day, ending = true)
        queue {
            try {
                client(app).endExercise()
            } catch (e: Exception) {
                // None of ours was running: the start above never got that far, or Health Services ended it.
            }
            ours = false
        }
    }

    private fun updates(app: Context) = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            // A reading's time is counted from the watch's boot; the phone's times are the wall clock's.
            val boot = System.currentTimeMillis() - SystemClock.elapsedRealtime()
            val beats = update.latestMetrics.getData(DataType.HEART_RATE_BPM)
                .filter { (it.accuracy as? HeartRateAccuracy)?.sensorStatus.let { s -> s != HeartRateAccuracy.SensorStatus.NO_CONTACT && s != HeartRateAccuracy.SensorStatus.UNRELIABLE } }
                .map { Beat(it.value, boot + it.timeDurationFromBoot.toMillis()) }
            take(app, beats, ended = update.exerciseStateInfo.state.isEnded)
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}

        override fun onRegistered() {}

        override fun onRegistrationFailed(throwable: Throwable) {
            Log.w(TAG, "Health Services wouldn't take the heart rate callback", throwable)
        }

        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    /** Readings in: counted for the day being measured (or the one just ended, for the last of them), shown while
     *  measuring, and sent on when due. */
    private fun take(app: Context, beats: List<Beat>, ended: Boolean) {
        val day = measuring ?: last ?: return
        val state = WatchRepo.snapshot.value.state
        val run = state?.run?.takeIf { it.day == day } ?: return
        val now = System.currentTimeMillis()
        val kept = load(app)
        val before = kept[day]
        // Counted for the account whose workout it is, and sent to it only (HeartLogic.command).
        val after = HeartLogic.add(before, run, beats, now, state.account)
        if (after != before) days = HeartLogic.keep(kept + (day to after))
        if (ended) latest.value = null else if (measuring == day) beats.maxByOrNull { it.at }?.let { latest.value = it }
        if (!sendIfDue(app, day, ending = ended || measuring != day) && after != before) save(app)
    }

    /** Sends the day's heart rate when HeartLogic says it's due, and says whether it did (and so kept the days). */
    private fun sendIfDue(app: Context, day: String, ending: Boolean): Boolean {
        val kept = load(app)
        val h = kept[day] ?: return false
        val now = System.currentTimeMillis()
        if (!HeartLogic.due(h, now, ending)) return false
        days = kept + (day to HeartLogic.sent(h, now))
        save(app)
        WatchRepo.send(app, HeartLogic.command(OverlayLogic.newId(), now, h))
        return true
    }

    private fun load(app: Context): Map<String, Heart> = days ?: HeartLogic.fromJson(WatchRepo.read(app, FILE)).also { days = it }

    private fun save(app: Context) {
        days?.let { WatchRepo.save(app, FILE, HeartLogic.toJson(it)) }
    }
}
