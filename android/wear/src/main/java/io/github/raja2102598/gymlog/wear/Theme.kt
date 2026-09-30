package io.github.raja2102598.gymlog.wear

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/**
 * The phone app's colours in dark mode (public/tokens.css), on the black a watch face wants: the brand orange for the
 * button that does the step, its lighter ink for what's picked, and green for done, so the watch reads as Gym Log.
 */
private val GymColors = ColorScheme(
    primary = Color(0xFFC2410C), // --brand
    primaryDim = Color(0xFF9A3412),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF3A1D0E), // --brand-tint
    onPrimaryContainer = Color(0xFFFFB088), // --brand-tint-ink
    secondary = Color(0xFFFF8A4C), // --brand-text
    secondaryDim = Color(0xFFC2410C),
    onSecondary = Color(0xFF15171B),
    secondaryContainer = Color(0xFF33373E), // --surface-selected
    onSecondaryContainer = Color(0xFFF2F3F5),
    tertiary = Color(0xFF6BD68E), // --success
    tertiaryDim = Color(0xFF3FA863),
    onTertiary = Color(0xFF15171B),
    tertiaryContainer = Color(0xFF173A24), // --success-bg
    onTertiaryContainer = Color(0xFF6BD68E),
    surfaceContainerLow = Color(0xFF1B1D21), // --surface
    surfaceContainer = Color(0xFF2A2D33), // --surface-sunken
    surfaceContainerHigh = Color(0xFF33373E),
    onSurface = Color(0xFFF2F3F5), // --ink
    onSurfaceVariant = Color(0xFFA1A7B0), // --ink-muted
    outline = Color(0xFF7C828C), // --ink-subtle
    outlineVariant = Color(0xFF3A3E45),
    background = Color.Black,
    onBackground = Color(0xFFF2F3F5),
    error = Color(0xFFFF6B5E), // --danger
)

@Composable
fun GymTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = GymColors, content = content)
