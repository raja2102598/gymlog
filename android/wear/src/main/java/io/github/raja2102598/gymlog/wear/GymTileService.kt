package io.github.raja2102598.gymlog.wear

import android.content.ComponentName
import android.content.Context
import android.util.Log
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement
import androidx.wear.protolayout.ModifiersBuilders.Clickable
import androidx.wear.protolayout.TimelineBuilders.Timeline
import androidx.wear.protolayout.TypeBuilders.StringLayoutConstraint
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicInstant
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicInt32
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicString
import androidx.wear.protolayout.layout.column
import androidx.wear.protolayout.material3.ColorScheme
import androidx.wear.protolayout.material3.MaterialScope
import androidx.wear.protolayout.material3.Typography
import androidx.wear.protolayout.material3.primaryLayout
import androidx.wear.protolayout.material3.text
import androidx.wear.protolayout.material3.textEdgeButton
import androidx.wear.protolayout.modifiers.clickable
import androidx.wear.protolayout.types.LayoutString
import androidx.wear.protolayout.types.argb
import androidx.wear.protolayout.types.layoutString
import androidx.wear.tiles.Material3TileService
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import androidx.wear.tiles.tile
import java.time.Instant
import java.time.ZoneId
import kotlin.time.Duration.Companion.milliseconds

/**
 * Gym Log's tile, a swipe from the watch face (docs/watch.md): during a workout, its session, the clock or the rest
 * counting down, and the next set; otherwise today's session and Start. A tap opens the app. The words are TileLogic's;
 * the clock and the countdown tick on the watch's own, as ProtoLayout's dynamic time, so the tile needs nothing from
 * the app to keep them going. It's asked for again whenever the watch's state changes (WatchRepo), and every few
 * minutes (TileLogic.freshMs).
 */
class GymTileService : Material3TileService(allowDynamicTheme = false, defaultColorScheme = COLORS) {
    override suspend fun MaterialScope.tileResponse(requestParams: RequestBuilders.TileRequest): Tile {
        val ctx = this@GymTileService
        val snap = WatchRepo.load(ctx)
        val now = System.currentTimeMillis()
        val zone = ZoneId.systemDefault()
        val face = TileLogic.face(snap.parsed, snap.state, StateLogic.dateOf(now, zone), now)
        return tile(timeline = Timeline.fromLayoutElement(layout(face, now, open(ctx))), freshness = TileLogic.freshMs(face, now, zone).milliseconds)
    }

    companion object {
        private const val TAG = "GymLogWatch"

        /** The phone app's colours in dark mode, as the app's own (Theme.kt): the brand orange for the button. The tile's
         *  preview image is drawn with them too. */
        internal val COLORS = ColorScheme(
            primary = 0xFFC2410C.argb,
            onPrimary = 0xFFFFFFFF.argb,
            primaryContainer = 0xFF3A1D0E.argb,
            onPrimaryContainer = 0xFFFFB088.argb,
            secondary = 0xFFFF8A4C.argb,
            onSecondary = 0xFF15171B.argb,
            tertiary = 0xFF6BD68E.argb,
            onTertiary = 0xFF15171B.argb,
            surfaceContainerLow = 0xFF1B1D21.argb,
            surfaceContainer = 0xFF2A2D33.argb,
            surfaceContainerHigh = 0xFF33373E.argb,
            onSurface = 0xFFF2F3F5.argb,
            onSurfaceVariant = 0xFFA1A7B0.argb,
            outline = 0xFF7C828C.argb,
            background = 0xFF000000.argb,
            onBackground = 0xFFF2F3F5.argb,
            error = 0xFFFF6B5E.argb,
        )

        /** Asks the watch for the tile again: its state changed. Throttled by the system to about once a minute. */
        fun update(ctx: Context) {
            try {
                TileService.getUpdater(ctx).requestUpdate(GymTileService::class.java)
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't ask for the tile again", e)
            }
        }

        /** Opens the app where it was. */
        fun open(ctx: Context): Clickable = clickable(ActionBuilders.launchAction(ComponentName(ctx, MainActivity::class.java)))

        /** The tile for `face` (TileLogic) as of `now`. */
        fun MaterialScope.layout(face: TileLogic.Face, now: Long, open: Clickable): LayoutElement =
            when (face) {
                is TileLogic.Live -> primaryLayout(
                    titleSlot = { text(face.title.layoutString) },
                    mainSlot = {
                        column(
                            text(label(face, now), typography = Typography.LABEL_MEDIUM, color = colorScheme.secondary),
                            text(time(face, now), typography = Typography.NUMERAL_MEDIUM, color = colorScheme.onSurface),
                            text(face.next.layoutString, typography = Typography.BODY_SMALL, color = colorScheme.onSurfaceVariant, maxLines = 2),
                            width = expand(),
                            horizontalAlignment = HORIZONTAL_ALIGN_CENTER,
                        )
                    },
                    bottomSlot = { textEdgeButton(onClick = open) { text(face.button.layoutString) } },
                    onClick = open,
                )
                is TileLogic.Idle -> primaryLayout(
                    titleSlot = { text(face.heading.layoutString) },
                    mainSlot = {
                        column(
                            *listOfNotNull(
                                face.title.takeIf { it.isNotEmpty() }?.let { text(it.layoutString, typography = Typography.TITLE_LARGE, color = colorScheme.onSurface, maxLines = 2) },
                                text(face.line.layoutString, typography = Typography.BODY_MEDIUM, color = colorScheme.onSurfaceVariant, maxLines = 3),
                            ).toTypedArray(),
                            width = expand(),
                            horizontalAlignment = HORIZONTAL_ALIGN_CENTER,
                        )
                    },
                    bottomSlot = { textEdgeButton(onClick = open) { text(face.button.layoutString) } },
                    onClick = open,
                )
            }

        /** The watch's time as the renderer has it, a second at a time. */
        private val ticking = DynamicInstant.platformTimeWithSecondsPrecision()
        private val TWO = DynamicInt32.IntFormatter.Builder().setMinIntegerDigits(2).build()

        /** The workout's clock counting up from where it stands at `at`; null when paused, when it stays there. */
        private fun clock(run: Run, at: Long): DynamicString? {
            if (run.pausedAt != null) return null
            val zero = DynamicInstant.withSecondsPrecision(Instant.ofEpochMilli(at - TimerLogic.runMs(run, at)))
            val sec = zero.durationUntil(ticking).toIntSeconds()
            val h = sec.div(3600)
            val short = sec.rem(3600).div(60).format().concat(colon()).concat(sec.rem(60).format(TWO))
            val long = h.format().concat(colon()).concat(sec.rem(3600).div(60).format(TWO)).concat(colon()).concat(sec.rem(60).format(TWO))
            return DynamicString.onCondition(h.gt(0)).use(long).elseUse(short)
        }

        /** Seconds left in a rest ending at `endAt`, as the renderer counts them. */
        private fun left(endAt: Long): DynamicInt32 =
            ticking.durationUntil(DynamicInstant.withSecondsPrecision(Instant.ofEpochMilli(endAt))).toIntSeconds()

        private fun colon() = DynamicString.constant(":")

        /** The time: the rest counting down, then the workout's clock once it's over; the clock alone otherwise. */
        private fun time(face: TileLogic.Live, at: Long): LayoutString {
            val static = TileLogic.time(face, at)
            val clock = clock(face.run, at)
            val fits = StringLayoutConstraint.Builder("00:00:00").build()
            val dynamic = when {
                TileLogic.resting(face, at) -> {
                    val sec = left(face.rest!!.endAt)
                    val rest = sec.div(60).format().concat(colon()).concat(sec.rem(60).format(TWO))
                    DynamicString.onCondition(sec.gt(0)).use(rest).elseUse(clock ?: DynamicString.constant(TimerLogic.clock(TimerLogic.runSec(face.run, at))))
                }
                face.rest == null -> clock
                else -> null
            }
            return if (dynamic == null) static.layoutString else LayoutString(static, dynamic, fits)
        }

        /** Its word, which turns from Rest to the clock's once the rest is over. */
        private fun label(face: TileLogic.Live, at: Long): LayoutString {
            val static = TileLogic.label(face, at)
            if (!TileLogic.resting(face, at)) return static.layoutString
            val after = TileLogic.label(face.copy(rest = null), at)
            val dynamic = DynamicString.onCondition(left(face.rest!!.endAt).gt(0)).use(DynamicString.constant(static)).elseUse(DynamicString.constant(after))
            return LayoutString(static, dynamic, StringLayoutConstraint.Builder("Workout").build())
        }
    }
}
