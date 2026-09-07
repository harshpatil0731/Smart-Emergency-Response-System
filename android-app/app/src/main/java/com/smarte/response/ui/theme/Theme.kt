package com.smarte.response.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = EmergencyBlue,
    onPrimary = TacticalBg,
    primaryContainer = TacticalCard,
    onPrimaryContainer = TacticalTextPrimary,
    secondary = EmergencyGreen,
    onSecondary = TacticalBg,
    error = EmergencyRed,
    onError = TacticalBg,
    background = TacticalBg,
    onBackground = TacticalTextPrimary,
    surface = TacticalSurface,
    onSurface = TacticalTextPrimary,
    surfaceVariant = TacticalCard,
    onSurfaceVariant = TacticalTextSecondary,
    outline = TacticalBorder
)

@Composable
fun SmartEmergencyTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
