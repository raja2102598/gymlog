package io.github.raja2102598.gymlog.wear

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.PaddingValues
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText

/**
 * The rest (the phone's rest card): a ring counting down from its end, the time left (a tap pauses or resumes it, as
 * the phone's ring does), +15 s and Skip. At zero it says "Rest over", and the alarm (RestAlarm) has buzzed, whether
 * or not this was on screen. It goes back to the lift once the rest is skipped, here or on the phone.
 */
@Composable
fun RestScreen(ui: WatchUi, onDone: () -> Unit) {
    val r = ui.rest ?: return GoneEffect(onDone)
    val now = ui.now
    val over = TimerLogic.restOver(r, now)
    val paused = r.pausedAt != null
    val left = TimerLogic.restLeftSec(r, now)
    val len = r.sec ?: ui.state?.days?.firstOrNull { it.date == r.day }?.blocks?.flatten()?.firstOrNull { it.name == r.lift }?.restSec ?: 0
    // Laid out for a 225 dp watch (a Galaxy Watch4 Classic's 450 px) and scaled for smaller ones, so the buttons stay
    // inside the ring.
    val s = (LocalConfiguration.current.screenWidthDp / 225f).coerceIn(0.8f, 1.2f)
    val c = MaterialTheme.colorScheme
    // The time alone at the top: the rest is what's on screen.
    ScreenScaffold(timeText = { TimeText() }) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            // A gap at the top, where the time is.
            CircularProgressIndicator(
                progress = { TimerLogic.restFraction(r, now, len) },
                modifier = Modifier.fillMaxSize().padding(2.dp),
                startAngle = 300f,
                endAngle = 240f,
                strokeWidth = 8.dp,
                colors = ProgressIndicatorDefaults.colors(indicatorColor = if (paused) c.outline else c.secondary, trackColor = c.surfaceContainer),
            )
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    if (over) StepLogic.OVER_TITLE else if (paused) "Paused" else "Resting",
                    style = MaterialTheme.typography.titleSmall,
                    color = if (over) c.tertiary else c.onSurface,
                )
                Box(
                    modifier = Modifier
                        .sizeIn(minWidth = 96.dp * s, minHeight = 52.dp * s)
                        .clip(RoundedCornerShape(26.dp))
                        .clickable(enabled = !over, onClickLabel = if (paused) "Resume rest" else "Pause rest") { ui.toggleRest() }
                        .semantics { contentDescription = if (over) "Rest over" else "${TimerLogic.mmss(left)} left" },
                    contentAlignment = Alignment.Center,
                ) {
                    if (over) {
                        Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = c.tertiary, modifier = Modifier.size(40.dp * s))
                    } else {
                        Text(TimerLogic.mmss(left), style = MaterialTheme.typography.numeralLarge, fontSize = (40 * s).sp, lineHeight = (44 * s).sp, color = if (paused) c.onSurfaceVariant else c.onSurface)
                    }
                }
                // The heart rate beside the rest's length: coming down between sets.
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (over) "On to the next set" else if (paused) "Tap to resume" else "of ${TimerLogic.mmss(len.toLong())}",
                        style = MaterialTheme.typography.labelSmall,
                        color = c.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    ui.bpm?.let { HeartRate(it, Modifier.padding(start = 8.dp)) }
                }
                Row(modifier = Modifier.padding(top = 8.dp * s), horizontalArrangement = Arrangement.spacedBy(6.dp * s)) {
                    RestButton("+15s", s, ui::restAdd)
                    RestButton("Skip", s) {
                        ui.restSkip()
                        onDone()
                    }
                }
            }
        }
    }
}

@Composable
private fun RestButton(text: String, s: Float, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        modifier = Modifier.width(62.dp * s).height(48.dp),
        contentPadding = PaddingValues(horizontal = 6.dp),
        label = { Text(text, modifier = Modifier, textAlign = TextAlign.Center, maxLines = 1) },
    )
}
