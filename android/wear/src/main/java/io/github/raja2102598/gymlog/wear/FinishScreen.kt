package io.github.raja2102598.gymlog.wear

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import java.util.Locale

/**
 * Finish: the workout so far (its time, sets and kg lifted) and Finish workout, which ends the clock and the rest as
 * the phone's Finish does. Then Workout complete, as the phone says it; the phone shows the rest of it. Swiping back
 * leaves it unfinished.
 */
@Composable
fun FinishScreen(ui: WatchUi, onDone: () -> Unit) {
    val day = ui.day ?: return GoneEffect(onDone)
    val run = ui.run
    val finished = run?.endedAt != null
    val (sets, kg) = StepLogic.totals(day)
    val c = MaterialTheme.colorScheme
    EdgeScreen(
        button = if (finished) "Done" else "Finish workout",
        onButton = { if (finished) onDone() else ui.finish() },
    ) { height ->
        Text(
            if (finished) "Workout complete" else "Finish workout?",
            style = MaterialTheme.typography.titleMedium,
            color = if (finished) c.tertiary else c.onSurface,
            textAlign = TextAlign.Center,
        )
        Text(day.title, modifier = Modifier.fillMaxWidth(0.7f), style = MaterialTheme.typography.labelMedium, color = c.onSurfaceVariant, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (run != null) {
            // Smaller on a smaller watch, so the line under it still fits above the button.
            Text(
                TimerLogic.clock(TimerLogic.runSec(run, ui.now)),
                style = if (height < 110.dp) MaterialTheme.typography.numeralSmall else MaterialTheme.typography.numeralMedium,
            )
        }
        Text(
            "$sets set${if (sets == 1) "" else "s"} · ${String.format(Locale.ROOT, "%,d", kg)} kg lifted",
            style = MaterialTheme.typography.labelSmall,
            color = c.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
