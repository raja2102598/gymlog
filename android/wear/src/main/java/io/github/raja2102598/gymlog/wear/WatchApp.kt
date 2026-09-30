package io.github.raja2102598.gymlog.wear

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.CurvedTextStyle
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.material3.timeTextCurvedText
import androidx.wear.compose.material3.timeTextSeparator
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import java.time.ZoneId
import kotlinx.coroutines.delay

/**
 * What every screen reads, and does: the phone's state with the watch's own commands on top, the day shown, and the
 * time now. Each action is a command (docs/watch.md), shown at once and sent to the phone.
 */
class WatchUi(private val ctx: Context, snap: WatchRepo.Snapshot, val now: Long, zone: ZoneId, beat: Beat? = null) {
    val state: WatchState? = snap.state
    val day: Day? = state?.let { StateLogic.dayFor(it, StateLogic.dateOf(now, zone), now) }
    val blank: String? = StateLogic.blank(snap.parsed, day)

    /** The shown day's workout clock, if it has one. */
    val run: Run? = state?.run?.takeIf { it.day == day?.date }
    val rest: Rest? = state?.rest

    /** The heart rate now, while the workout is under way and the sensor has a fresh reading (HeartMonitor). */
    val bpm: Int? = if (TimerLogic.underWay(run, now)) HeartLogic.showing(beat, now) else null

    /** Each made under the account whose workout is on screen, which the phone checks before applying it. */
    private fun send(make: (id: String, at: Long) -> Command) =
        WatchRepo.send(ctx, make(OverlayLogic.newId(), System.currentTimeMillis()).copy(account = state?.account))

    /** Opening the workout starts its clock, as the phone's does, unless every lift is done or it's already going. */
    fun openWorkout() {
        val d = day ?: return
        if (StepLogic.sessionDone(d) || TimerLogic.underWay(run, System.currentTimeMillis())) return
        send { id, at -> OverlayLogic.ofDay(id, at, OverlayLogic.START_RUN, d.date) }
    }

    /** Logs set `set` of `lift` as given, or clears it with no reps (the tick's undo), over the row as it's shown. */
    fun logSet(lift: Lift, set: Int, reps: Int?, kg: Double?) {
        val d = day ?: return
        send { id, at -> OverlayLogic.set(id, at, d.date, lift.key, set, reps, kg, lift.rows.getOrNull(set), lift.done) }
    }

    /** The clock, tapped: pauses it, or resumes it paused. Both, and Finish, name the run on screen, so one restarted
     *  on the phone since isn't the one they change. */
    fun toggleRun() {
        val r = run ?: return
        if (r.endedAt != null) return
        send { id, at -> OverlayLogic.ofRun(id, at, if (r.pausedAt != null) OverlayLogic.RESUME_RUN else OverlayLogic.PAUSE_RUN, r.day, r) }
    }

    fun finish() {
        val d = day ?: return
        send { id, at -> OverlayLogic.ofRun(id, at, OverlayLogic.FINISH, d.date, run) }
    }

    // The rest's buttons name the rest on screen, so a newer one started since on the phone isn't the one they change.
    fun restAdd() {
        val r = rest ?: return
        send { id, at -> OverlayLogic.ofRest(id, at, OverlayLogic.REST_ADD, r, 15) }
    }

    fun restSkip() {
        val r = rest ?: return
        send { id, at -> OverlayLogic.ofRest(id, at, OverlayLogic.REST_SKIP, r) }
    }

    fun toggleRest() {
        val r = rest ?: return
        send { id, at -> OverlayLogic.ofRest(id, at, if (r.pausedAt != null) OverlayLogic.REST_RESUME else OverlayLogic.REST_PAUSE, r) }
    }

    fun skipLift(lift: Lift) {
        val d = day ?: return
        send { id, at -> OverlayLogic.skipLift(id, at, d.date, lift) }
    }

    fun cardio(done: Boolean) {
        val d = day ?: return
        send { id, at -> OverlayLogic.cardioDone(id, at, d, done) }
    }

    /** The rest counting down now, if one is. */
    fun restRunning(): Rest? = rest?.takeIf { it.pausedAt == null && it.endAt > now }
}

/** A set picked from a step's list to change, rather than the one the step is on. */
data class Pick(val at: Int, val lift: Int, val set: Int)

/** The app: Today, then a step (a lift and its bezel, or the cardio), its sets, the rest, and Finish. `onWorkout` is
 *  called as a workout is opened, which asks for the heart rate's permission the first time (MainActivity). */
@Composable
fun WatchApp(onWorkout: () -> Unit = {}) {
    val ctx = LocalContext.current
    val snap by WatchRepo.snapshot.collectAsStateWithLifecycle()
    val beat by HeartMonitor.beat.collectAsStateWithLifecycle()
    // Every second while a clock is on screen (the workout's or the rest's), else often enough to see the day turn.
    val now by produceState(System.currentTimeMillis(), snap) {
        while (true) {
            val live = StepLogic.live(snap.state, value) != null || snap.state?.rest?.let { it.pausedAt == null } == true
            delay(if (live) 1000L - value % 1000L else 15_000L)
            value = System.currentTimeMillis()
        }
    }
    val ui = WatchUi(ctx, snap, now, ZoneId.systemDefault(), beat)
    GymTheme {
        AppScaffold(timeText = { RestTimeText(ui) }) {
            val blank = ui.blank
            if (blank != null) {
                BlankScreen(blank)
            } else {
                // Made anew after a blank spell (signed out, say), so it starts again from Today.
                val nav = rememberSwipeDismissableNavController()
                var pick by remember { mutableStateOf<Pick?>(null) }
                val toToday: () -> Unit = { nav.popBackStack("today", inclusive = false) }
                SwipeDismissableNavHost(navController = nav, startDestination = "today") {
                    composable("today") {
                        TodayScreen(
                            ui,
                            onOpen = { at ->
                                ui.openWorkout()
                                onWorkout()
                                pick = null
                                nav.navigate("step/$at")
                            },
                            onFinish = { nav.navigate("finish") },
                        )
                    }
                    composable("step/{at}") { entry ->
                        val at = entry.arguments?.getString("at")?.toIntOrNull() ?: 0
                        StepScreen(
                            ui,
                            at,
                            pick = pick?.takeIf { it.at == at },
                            onPicked = { pick = it },
                            onSets = { nav.navigate("sets/$at") },
                            onRest = { nav.navigate("rest") },
                            onStep = { to ->
                                pick = null
                                nav.navigate("step/$to") { popUpTo("today") }
                            },
                            onFinish = { nav.navigate("finish") },
                            onGone = toToday,
                        )
                    }
                    composable("sets/{at}") { entry ->
                        val at = entry.arguments?.getString("at")?.toIntOrNull() ?: 0
                        SetsScreen(
                            ui,
                            at,
                            onPick = { p ->
                                pick = p
                                nav.popBackStack()
                            },
                            onStep = { to ->
                                pick = null
                                nav.navigate("step/$to") { popUpTo("today") }
                            },
                            onFinish = { nav.navigate("finish") },
                            onGone = toToday,
                        )
                    }
                    composable("rest") { RestScreen(ui, onDone = { nav.popBackStack() }) }
                    composable("finish") { FinishScreen(ui, onDone = toToday) }
                }
            }
        }
    }
}

/** The time at the top of every screen, and the rest counting down beside it while there is one, so it can be seen
 *  from any screen. */
@Composable
private fun RestTimeText(ui: WatchUi) {
    val r = ui.restRunning()
    val accent = MaterialTheme.colorScheme.secondary
    TimeText { time ->
        if (r != null) {
            timeTextCurvedText("Rest ${TimerLogic.mmss(TimerLogic.restLeftSec(r, ui.now))}", CurvedTextStyle(color = accent))
            timeTextSeparator()
        }
        timeTextCurvedText(time)
    }
}

/** The heart rate, small: a heart and the beats a minute, beside what's on screen rather than in the way of it. */
@Composable
fun HeartRate(bpm: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "Heart rate $bpm" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_heart), contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(12.dp))
        Text(
            bpm.toString(),
            modifier = Modifier.padding(start = 3.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
    }
}

/** Nothing to show: what to do about it. */
@Composable
fun BlankScreen(message: String) {
    ScreenScaffold {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // The launcher icon's foreground: its dumbbell fills only the middle of its square.
            Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.mipmap.ic_launcher_foreground), contentDescription = null, modifier = Modifier.requiredSize(120.dp), tint = MaterialTheme.colorScheme.secondary)
            }
            Text(message, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        }
    }
}

/**
 * A screen that fits without scrolling: its content centred in the space above the step's button, which hugs the
 * bottom edge (Material's edge button), clear of the time at the top and the round screen's corners. `height` is
 * that space, for content that sizes itself to it.
 */
@Composable
fun EdgeScreen(
    button: String,
    onButton: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.(height: Dp) -> Unit,
) {
    ScreenScaffold(modifier = modifier) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // The time's line at the top, and the edge button and its gap at the bottom.
            val top = maxHeight * 0.12f
            val bottom = EDGE_BUTTON_ROOM
            val room = maxHeight - top - bottom
            Column(
                modifier = Modifier.fillMaxSize().padding(top = top, bottom = bottom),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                content(room)
            }
            EdgeButton(onClick = onButton, modifier = Modifier.align(Alignment.BottomCenter), buttonSize = EdgeButtonSize.Small) {
                Text(button, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** A small edge button's height, and a little room above it. */
private val EDGE_BUTTON_ROOM = 62.dp

/** Leaves a screen whose step has gone (the day turned, or the phone's plan changed under it) for Today. */
@Composable
fun GoneEffect(onGone: () -> Unit) {
    LaunchedEffect(Unit) { onGone() }
}
