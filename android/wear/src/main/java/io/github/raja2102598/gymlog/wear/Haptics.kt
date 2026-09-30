package io.github.raja2102598.gymlog.wear

import android.content.Context
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.InputDevice
import android.view.MotionEvent
import android.view.ScrollFeedbackProvider
import android.view.View

/**
 * The light tick for each bezel click on a lift's numbers, the same one Wear OS's own lists give as the bezel moves
 * them (Compose for Wear OS picks these the same way, androidx.wear.compose.foundation.rotary): Wear OS 6's rotary
 * feedback from API 36, Samsung's own bezel tick on a Galaxy Watch before that, and Android's clock tick elsewhere.
 * Each follows the watch's own touch-feedback setting.
 */
class Haptics(private val view: View) {
    private val provider: ScrollFeedbackProvider? =
        if (Build.VERSION.SDK_INT >= 36) ScrollFeedbackProvider.createProvider(view) else null

    fun tick(inputDeviceId: Int) {
        when {
            provider != null && Build.VERSION.SDK_INT >= 36 ->
                provider.onSnapToItem(inputDeviceId, InputDevice.SOURCE_ROTARY_ENCODER, MotionEvent.AXIS_SCROLL)
            galaxyWatch -> view.performHapticFeedback(GALAXY_TICK)
            else -> view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        }
    }

    companion object {
        /** Samsung's rotary "item focus" feedback, which One UI Watch plays for each bezel detent. */
        private const val GALAXY_TICK = 102

        private val galaxyWatch = Build.MANUFACTURER.contains("samsung", ignoreCase = true) && Build.MODEL.startsWith("SM-R")

        /** A bezel (the Galaxy Watch's) rather than a crown: one rotary event per detent. */
        fun lowResRotary(ctx: Context): Boolean = ctx.packageManager.hasSystemFeature("android.hardware.rotaryencoder.lowres")
    }
}
