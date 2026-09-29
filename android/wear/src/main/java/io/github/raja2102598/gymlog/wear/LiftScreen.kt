package io.github.raja2102598.gymlog.wear

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.requestFocusOnHierarchyActive
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SplitCheckboxButton
import androidx.wear.compose.material3.Text

/**
 * A step of the workout: the lift and the set it's on, with the bezel (LiftPicker); once its sets are all logged, the
 * list of them and on to the next (SetsList); or the day's cardio (CardioStep). `pick` is a set chosen from the list
 * to change instead of the one the step is on.
 */
@Composable
fun StepScreen(
    ui: WatchUi,
    at: Int,
    pick: Pick?,
    onPicked: (Pick?) -> Unit,
    onSets: () -> Unit,
    onRest: () -> Unit,
    onStep: (Int) -> Unit,
    onFinish: () -> Unit,
    onGone: () -> Unit,
) {
    val day = ui.day
    if (day == null || at >= StepLogic.steps(day)) return GoneEffect(onGone)
    if (StepLogic.isCardio(day, at)) return CardioStep(ui, day, at, onFinish)
    val block = day.blocks[at]
    val picked = pick?.takeIf { p -> block.getOrNull(p.lift)?.let { !it.skipped && p.set in it.rows.indices } == true }
    val on = picked?.let { it.lift to it.set } ?: StepLogic.setOn(block)
    if (on == null) return SetsList(ui, day, at, onPick = onPicked, onStep = onStep, onFinish = onFinish, withPrimary = true)
    val (n, j) = on
    LiftPicker(ui, day, at, n, j, onSets) { kg, reps ->
        val before = ui.rest
        ui.logSet(block[n], j, reps, kg)
        onPicked(null)
        // The set started a rest (the phone's rule, OverlayLogic): its countdown comes up.
        val after = WatchRepo.snapshot.value.state?.rest
        if (after != null && after != before && after.pausedAt == null && after.endAt > System.currentTimeMillis()) onRest()
    }
}

/**
 * A lift's set with the bezel: its name and which set (tap them for every set), the weight and reps, big, starting at
 * what's logged or else the phone's suggestion, and Complete set N at the bottom edge. Tap a number to pick it; the
 * bezel changes the picked one (weight by the lift's step, reps by one, never below 0), with a light tick per click.
 */
@Composable
private fun LiftPicker(ui: WatchUi, day: Day, at: Int, n: Int, j: Int, onSets: () -> Unit, onComplete: (Double?, Int) -> Unit) {
    val lift = day.blocks[at][n]
    var kg by remember(at, n, j) { mutableStateOf(StepLogic.startKg(lift, j)) }
    var reps by remember(at, n, j) { mutableStateOf(StepLogic.startReps(lift, j)) }
    // Weight first, since it's what's set before a set; the pick stays as it was for the lift's next set.
    var onKg by remember(at, n) { mutableStateOf(true) }
    val ctx = LocalContext.current
    val view = LocalView.current
    val haptics = remember(view) { Haptics(view) }
    val lowRes = remember(ctx) { Haptics.lowResRotary(ctx) }
    val perClick = with(LocalDensity.current) { 36.dp.toPx() }
    var carried by remember { mutableFloatStateOf(0f) }
    val label = StepLogic.label(day, at, StepLogic.Primary.LogSet(n, j))

    EdgeScreen(
        button = StepLogic.keepTail(label),
        onButton = {
            val r = reps
            // No reps to log: the reps get picked instead, as the phone puts the cursor in their box.
            if (r == null || r <= 0) {
                onKg = false
            } else {
                view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                onComplete(kg, r)
            }
        },
        modifier = Modifier
            .requestFocusOnHierarchyActive()
            .onRotaryScrollEvent { e ->
                val (clicks, left) = BezelLogic.clicks(carried, e.verticalScrollPixels, perClick, lowRes)
                carried = left
                if (clicks != 0) {
                    val changed = if (onKg) {
                        BezelLogic.stepKg(kg, lift.inc, clicks).also { kg = it } != null
                    } else {
                        val was = reps
                        BezelLogic.stepReps(reps, clicks).also { reps = it } != was
                    }
                    if (changed) haptics.tick(e.inputDeviceId)
                }
                true
            }
            .focusable(),
    ) { height ->
        Column(
            modifier = Modifier
                .fillMaxWidth(0.74f)
                .clip(RoundedCornerShape(24.dp))
                .clickable(onClickLabel = "See every set") { onSets() }
                .heightIn(min = 48.dp)
                .padding(horizontal = 8.dp, vertical = 2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(lift.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            // The heart rate beside which set it is, where it takes no room from the numbers.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    StepLogic.setLine(day, at, n, j),
                    modifier = Modifier.weight(1f, fill = false),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                ui.bpm?.let { HeartRate(it, Modifier.padding(start = 8.dp)) }
            }
        }
        // The numbers take what's left under the name, up to 72 dp: smaller on a smaller watch, never cut off.
        val boxHeight = (height - 54.dp).coerceIn(52.dp, 72.dp)
        Row(
            modifier = Modifier.fillMaxWidth(0.84f).padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            NumberBox(BezelLogic.kgText(kg), "kg", "Weight", onKg, boxHeight, Modifier.weight(1f)) { onKg = true }
            NumberBox(BezelLogic.repsText(reps), "reps", "Reps", !onKg, boxHeight, Modifier.weight(1f)) { onKg = false }
        }
    }
}

/** One of the two numbers: big enough to read at arm's length, as big as its box allows. The picked one is ringed. */
@Composable
private fun NumberBox(value: String, unit: String, name: String, picked: Boolean, height: Dp, modifier: Modifier, onPick: () -> Unit) {
    val c = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(22.dp)
    BoxWithConstraints(
        modifier = modifier
            .height(height)
            .clip(shape)
            .background(if (picked) c.primaryContainer else c.surfaceContainer)
            .border(2.dp, if (picked) c.secondary else Color.Transparent, shape)
            .clickable(onClickLabel = "Pick $unit") { onPick() }
            .semantics {
                contentDescription = "$name, $value${if (value == "–") "" else " $unit"}"
                selected = picked
            },
        contentAlignment = Alignment.Center,
    ) {
        // Sized to the box, so "102.5" fits as well as "12", whatever the watch's font size setting.
        val size = with(LocalDensity.current) { (maxWidth / (value.length.coerceAtLeast(2) * 0.62f)).coerceAtMost(maxHeight * 0.58f).coerceAtMost(40.dp).toSp() }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.numeralMedium, fontSize = size, lineHeight = size, maxLines = 1, softWrap = false, color = c.onSurface)
            Text(unit, style = MaterialTheme.typography.labelSmall, color = if (picked) c.secondary else c.onSurfaceVariant)
        }
    }
}

/** Every set of a step, from the lift's name on the lift screen. */
@Composable
fun SetsScreen(ui: WatchUi, at: Int, onPick: (Pick) -> Unit, onStep: (Int) -> Unit, onFinish: () -> Unit, onGone: () -> Unit) {
    val day = ui.day
    if (day == null || at >= day.blocks.size) return GoneEffect(onGone)
    SetsList(ui, day, at, onPick = { p -> if (p != null) onPick(p) }, onStep = onStep, onFinish = onFinish, withPrimary = false)
}

/**
 * A step's sets, in the phone's order (a superset's round by round), each with its tick: a tap on a set picks it to
 * change on the lift screen, its tick completes it with what the lift screen would start at, and a done set's tick
 * undoes it. Then Skip today for each lift, Next, and Finish. `withPrimary`: the step's big button at the bottom edge,
 * for a step whose sets are all logged.
 */
@Composable
private fun SetsList(ui: WatchUi, day: Day, at: Int, onPick: (Pick?) -> Unit, onStep: (Int) -> Unit, onFinish: () -> Unit, withPrimary: Boolean) {
    val list = rememberScalingLazyListState()
    val primary = StepLogic.primary(day, at)
    var skipping by remember { mutableStateOf<Lift?>(null) }
    val onward = { if (at + 1 < StepLogic.steps(day)) onStep(at + 1) else onFinish() }
    ScreenScaffold(scrollState = list) { padding ->
        ScalingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
            setsItems(ui, day, at, onPick, onStep, onFinish, withPrimary, primary, onward) { skipping = it }
        }
    }
    // Skipping can only be undone on the phone, so it asks first.
    AlertDialog(
        visible = skipping != null,
        onDismissRequest = { skipping = null },
        confirmButton = {
            AlertDialogDefaults.ConfirmButton(onClick = {
                skipping?.let(ui::skipLift)
                skipping = null
            })
        },
        title = { Text("Skip ${skipping?.name.orEmpty()} today?", textAlign = TextAlign.Center) },
        text = { Text("Undo it on your phone.", textAlign = TextAlign.Center) },
    )
}

/** The list's items: the step's name, its big button when its sets are all logged, its cue, each set, Skip today for
 *  each lift, then Next and Finish. */
private fun ScalingLazyListScope.setsItems(
    ui: WatchUi,
    day: Day,
    at: Int,
    onPick: (Pick?) -> Unit,
    onStep: (Int) -> Unit,
    onFinish: () -> Unit,
    withPrimary: Boolean,
    primary: StepLogic.Primary,
    onward: () -> Unit,
    onSkip: (Lift) -> Unit,
) {
    val block = day.blocks[at]
    val next = StepLogic.nextName(day, at)
    item { ListHeader { Text(StepLogic.stepName(day, at), textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
    // The step's sets all logged: on to the next, first thing under its name.
    if (withPrimary) {
        item {
            Button(
                onClick = onward,
                modifier = Modifier.fillMaxWidth(),
                secondaryLabel = if (primary == StepLogic.Primary.NextStep && next != null) ({ Text(next, maxLines = 1, overflow = TextOverflow.Ellipsis) }) else null,
                label = { Text(StepLogic.label(day, at, primary), maxLines = 1) },
            )
        }
    }
    if (block.size == 1 && block[0].cue.isNotBlank()) item { Note(block[0].cue) }
    val rounds = if (block.size > 1) StepLogic.rounds(block) else block[0].rows.size
    for (j in 0 until rounds) {
        block.forEachIndexed { n, lift ->
            if (!lift.skipped && j < lift.rows.size) {
                item(key = "$n/$j") { SetRowButton(ui, day, at, n, j, onPick) }
            }
        }
    }
    block.forEach { lift ->
        item(key = "skip/${lift.key}") {
            if (lift.skipped) {
                Note(if (block.size > 1) "${lift.name}: skipped" else "Skipped")
            } else {
                FilledTonalButton(
                    onClick = { onSkip(lift) },
                    modifier = Modifier.fillMaxWidth(),
                    secondaryLabel = if (block.size > 1) ({ Text(lift.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }) else null,
                    label = { Text("Skip today", maxLines = 1) },
                )
            }
        }
    }
    if (next != null && !(withPrimary && primary == StepLogic.Primary.NextStep)) {
        item { FilledTonalButton(onClick = { onStep(at + 1) }, modifier = Modifier.fillMaxWidth(), label = { Text("Next: $next", maxLines = 2, overflow = TextOverflow.Ellipsis) }) }
    }
    if (!(withPrimary && primary == StepLogic.Primary.Finish)) {
        item { FilledTonalButton(onClick = onFinish, modifier = Modifier.fillMaxWidth(), label = { Text("Finish workout", maxLines = 1) }) }
    }
}

/** One set in the list: which it is, what's logged (or, greyed, what it would log), and its tick. */
@Composable
private fun SetRowButton(ui: WatchUi, day: Day, at: Int, n: Int, j: Int, onPick: (Pick?) -> Unit) {
    val lift = day.blocks[at][n]
    val row = lift.rows[j]
    val done = StepLogic.logged(row)
    val name = if (day.blocks[at].size > 1) "${StepLogic.letter(day, at)}${n + 1} · round ${j + 1}" else "Set ${j + 1}"
    val kg = StepLogic.startKg(lift, j)
    val reps = StepLogic.startReps(lift, j)
    SplitCheckboxButton(
        checked = done,
        onCheckedChange = { on ->
            when {
                !on -> ui.logSet(lift, j, null, row.kg)
                reps != null -> ui.logSet(lift, j, reps, kg)
                // Nothing to log it with: on to the lift screen to pick the reps.
                else -> onPick(Pick(at, n, j))
            }
        },
        toggleContentDescription = if (done) "Undo $name" else "Complete $name",
        onContainerClick = { onPick(Pick(at, n, j)) },
        containerClickLabel = "Change it",
        modifier = Modifier.fillMaxWidth(),
        secondaryLabel = {
            Text(
                if (done) StepLogic.setText(row.reps, row.kg) else StepLogic.setText(reps, kg),
                color = if (done) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        },
        label = { Text(name, maxLines = 1) },
    )
}

/** The day's cardio, after the lifts, as the phone's cardio card has it: its name, which exercise it is, and Done;
 *  once ticked, Finish, and a way to untick it. The name is right above, so the button says only "Done". */
@Composable
private fun CardioStep(ui: WatchUi, day: Day, at: Int, onFinish: () -> Unit) {
    val done = day.cardioDone
    EdgeScreen(
        button = if (done) StepLogic.label(day, at, StepLogic.Primary.Finish) else "Done",
        onButton = { if (done) onFinish() else ui.cardio(true) },
    ) {
        Text(
            day.cardio.orEmpty(),
            modifier = Modifier.fillMaxWidth(0.8f),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            if (done) "Done" else "Exercise ${at + 1} of ${StepLogic.steps(day)}",
            style = MaterialTheme.typography.labelMedium,
            color = if (done) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (done) {
            FilledTonalButton(
                onClick = { ui.cardio(false) },
                modifier = Modifier.padding(top = 6.dp),
                label = { Text("Not done yet", maxLines = 1) },
            )
        }
    }
}
