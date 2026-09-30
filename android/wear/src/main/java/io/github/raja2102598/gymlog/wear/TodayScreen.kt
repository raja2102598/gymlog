package io.github.raja2102598.gymlog.wear

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text

/**
 * Today: the session's name, the workout clock once it's started (a tap pauses or resumes it, as on the phone), Start
 * or Continue, then each step with how far it's got, and Finish while the workout's under way. The bezel scrolls it.
 */
@Composable
fun TodayScreen(ui: WatchUi, onOpen: (Int) -> Unit, onFinish: () -> Unit) {
    val day = ui.day ?: return
    val steps = StepLogic.steps(day)
    val list = rememberScalingLazyListState()
    ScreenScaffold(scrollState = list) { padding ->
        ScalingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
            item {
                ListHeader {
                    Text(
                        if (steps == 0) "Rest day" else day.title.ifBlank { "Workout" },
                        style = MaterialTheme.typography.titleLarge,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            when {
                steps == 0 -> item { Note("Recover today. A walk counts.") }
                day.skipped -> item { Note("Skipped today. To train after all, open it on your phone.") }
            }
            ui.run?.let { run -> item { ClockButton(run, ui.now, ui::toggleRun) } }
            if (steps > 0 && !day.skipped) {
                item {
                    val started = TimerLogic.underWay(ui.run, ui.now)
                    val allDone = StepLogic.sessionDone(day) && (day.cardio == null || day.cardioDone)
                    Button(
                        onClick = { onOpen(StepLogic.firstOpen(day)) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(if (started) "Continue" else if (allDone) "Review" else "Start", maxLines = 1) },
                    )
                }
                items(steps) { at -> StepButton(day, at) { onOpen(at) } }
                if (TimerLogic.underWay(ui.run, ui.now)) {
                    item {
                        FilledTonalButton(onClick = onFinish, modifier = Modifier.fillMaxWidth(), label = { Text("Finish workout", maxLines = 1) })
                    }
                }
            }
        }
    }
}

/** A step: its lift or superset, how far it's got, and a tick once it's done. */
@Composable
private fun StepButton(day: Day, at: Int, onClick: () -> Unit) {
    val done = StepLogic.stepDone(day, at)
    FilledTonalButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        icon = if (done) {
            { Icon(painterResource(R.drawable.ic_check), contentDescription = "Done", tint = MaterialTheme.colorScheme.tertiary, modifier = Modifier.size(ButtonDefaults.IconSize)) }
        } else {
            null
        },
        secondaryLabel = { Text(StepLogic.progress(day, at), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        label = { Text(StepLogic.stepName(day, at), maxLines = 2, overflow = TextOverflow.Ellipsis) },
    )
}

/** The workout clock: counting up (a tap pauses it), paused (a tap resumes it), or how long it took once finished. */
@Composable
fun ClockButton(run: Run, now: Long, onToggle: () -> Unit) {
    val time = TimerLogic.clock(TimerLogic.runSec(run, now))
    val ended = run.endedAt != null
    val paused = run.pausedAt != null
    FilledTonalButton(
        onClick = onToggle,
        enabled = !ended,
        modifier = Modifier.fillMaxWidth(),
        icon = {
            Icon(
                painterResource(if (ended) R.drawable.ic_check else if (paused) R.drawable.ic_play else R.drawable.ic_pause),
                contentDescription = null,
                tint = if (ended) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(ButtonDefaults.IconSize),
            )
        },
        secondaryLabel = { Text(if (ended) "Workout complete" else if (paused) "Paused. Tap to resume" else "Tap to pause", maxLines = 1) },
        label = { Text(time, style = MaterialTheme.typography.numeralSmall, maxLines = 1) },
    )
}

/** A line of plain text in a list. */
@Composable
fun Note(text: String) {
    Text(
        text,
        modifier = Modifier.fillMaxWidth(),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}
