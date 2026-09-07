package com.smarte.response.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smarte.response.data.model.ConnectionStatus
import com.smarte.response.ui.theme.*

@Composable
fun TacticalHeader(
    title: String,
    subtitle: String? = null,
    connectionState: ConnectionStatus = ConnectionStatus.OFFLINE,
    onSettingsClick: (() -> Unit)? = null
) {
    Surface(
        color = TacticalSurface,
        border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = title,
                    color = TacticalTextPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        color = TacticalTextSecondary,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                ConnectionIndicator(state = connectionState)
                if (onSettingsClick != null) {
                    Spacer(modifier = Modifier.width(8.dp))
                    IconButton(onClick = onSettingsClick) {
                        Text("CONFIG", fontSize = 11.sp, color = TacticalTextSecondary, fontFamily = FontFamily.Monospace)
                    }
                }
            }
        }
    }
}

@Composable
fun ConnectionIndicator(state: ConnectionStatus) {
    val (color: Color, label: String) = when (state) {
        ConnectionStatus.CONNECTED -> Pair(EmergencyGreen, "WS LIVE")
        ConnectionStatus.CONNECTING -> Pair(EmergencyYellow, "CONNECTING")
        ConnectionStatus.OFFLINE -> Pair(EmergencyRed, "OFFLINE")
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(TacticalCard)
            .border(1.dp, TacticalBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(color)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = label,
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace
        )
    }
}

@Composable
fun StatusBadge(status: String) {
    val (bgColor, textColor) = when (status.uppercase()) {
        "AVAILABLE" -> Pair(StatusAvailable.copy(alpha = 0.2f), EmergencyGreen)
        "BUSY" -> Pair(StatusBusy.copy(alpha = 0.2f), EmergencyRed)
        "EN_ROUTE", "ASSIGNED" -> Pair(EmergencyOrange.copy(alpha = 0.2f), EmergencyOrange)
        else -> Pair(StatusOffline.copy(alpha = 0.2f), TacticalTextSecondary)
    }

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bgColor)
            .border(1.dp, textColor.copy(alpha = 0.6f), RoundedCornerShape(6.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(
            text = status.uppercase(),
            color = textColor,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace
        )
    }
}

@Composable
fun TacticalButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    containerColor: Color = EmergencyBlue,
    contentColor: Color = TacticalBg,
    minHeight: Int = 56
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = containerColor,
            contentColor = contentColor,
            disabledContainerColor = TacticalBorder,
            disabledContentColor = TacticalTextMuted
        ),
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = minHeight.dp)
    ) {
        Text(
            text = text,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            letterSpacing = 1.sp
        )
    }
}
