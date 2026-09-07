package com.smarte.response.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smarte.response.data.api.AppConfig
import com.smarte.response.data.model.ResponseTeam
import com.smarte.response.ui.components.ConnectionIndicator
import com.smarte.response.ui.components.StatusBadge
import com.smarte.response.ui.theme.*
import com.smarte.response.viewmodel.DriverViewModel

@Composable
fun LoginScreen(viewModel: DriverViewModel) {
    val context = LocalContext.current
    val allTeams by viewModel.allTeams.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val connState by viewModel.connectionState.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()

    var showConfigDialog by remember { mutableStateOf(false) }

    val displayTeams = if (allTeams.isNotEmpty()) allTeams else listOf(
        ResponseTeam("A01", "AMBULANCE", "AVAILABLE", "HOSPITAL", null, 18.5204, 73.8567, "A01 - ALS Unit", "HOSPITAL"),
        ResponseTeam("A02", "AMBULANCE", "AVAILABLE", "FIRE_STATION", null, 18.5314, 73.8446, "A02 - BLS Unit", "FIRE_STATION"),
        ResponseTeam("F01", "FIRE", "AVAILABLE", "FIRE_STATION", null, 18.5314, 73.8446, "F01 - Heavy Tender", "FIRE_STATION"),
        ResponseTeam("R01", "RESCUE", "AVAILABLE", "POLICE_HQ", null, 18.5158, 73.8312, "R01 - Quick Response", "POLICE_HQ")
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TacticalBg)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "EMERGENCY UNIT LOGIN",
                    color = TacticalTextPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
                Text(
                    text = "SELECT VEHICLE IDENTIFIER",
                    color = TacticalTextSecondary,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace
                )
            }
            IconButton(onClick = { showConfigDialog = true }) {
                Text("CONFIG", fontSize = 11.sp, color = TacticalTextSecondary, fontFamily = FontFamily.Monospace)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            ConnectionIndicator(state = connState)
            Button(
                onClick = { viewModel.refreshSnapshot() },
                colors = ButtonDefaults.buttonColors(containerColor = TacticalCard),
                shape = RoundedCornerShape(6.dp),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text("REFRESH", color = EmergencyBlue, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            }
        }

        if (errorMessage != null) {
            Spacer(modifier = Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = EmergencyRedDark.copy(alpha = 0.2f)),
                border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyRed),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = errorMessage ?: "",
                    color = EmergencyRed,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(8.dp),
                    fontFamily = FontFamily.Monospace
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        if (isLoading) {
            CircularProgressIndicator(color = EmergencyBlue)
            Spacer(modifier = Modifier.height(16.dp))
        }

        Text(
            text = "AVAILABLE SQUAD UNITS",
            color = TacticalTextSecondary,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(12.dp))

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.weight(1f)
        ) {
            items(displayTeams) { team ->
                UnitLoginCard(team = team, onClick = { viewModel.selectTeam(team.teamId) })
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Connected: " + AppConfig.baseUrl,
            color = TacticalTextMuted,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            textAlign = TextAlign.Center
        )
    }

    if (showConfigDialog) {
        BackendConfigDialog(
            onDismiss = { showConfigDialog = false },
            onApply = { newHost ->
                AppConfig.updateServerConfig(context, newHost, AppConfig.DEFAULT_PORT)
                showConfigDialog = false
                viewModel.refreshSnapshot()
            }
        )
    }
}

@Composable
fun UnitLoginCard(team: ResponseTeam, onClick: () -> Unit) {
    val typeColor = when (team.type.uppercase()) {
        "AMBULANCE" -> EmergencyBlue
        "FIRE" -> EmergencyRed
        "RESCUE" -> EmergencyOrange
        else -> TacticalTextPrimary
    }

    val typeIcon = team.typeIcon

    Card(
        colors = CardDefaults.cardColors(containerColor = TacticalSurface),
        border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(140.dp)
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = team.teamId,
                    color = typeColor,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = FontFamily.Monospace
                )
                Text(text = typeIcon, fontSize = 14.sp, color = TacticalTextSecondary, fontFamily = FontFamily.Monospace)
            }

            Column {
                Text(
                    text = team.displayName,
                    color = TacticalTextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1
                )
                Text(
                    text = "BASE: " + team.station,
                    color = TacticalTextSecondary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                StatusBadge(status = team.status)
            }
        }
    }
}

@Composable
fun BackendConfigDialog(onDismiss: () -> Unit, onApply: (String) -> Unit) {
    var hostInput by remember { mutableStateOf(AppConfig.serverHost) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = TacticalSurface,
        title = {
            Text("Backend Host Config", color = TacticalTextPrimary, fontFamily = FontFamily.Monospace)
        },
        text = {
            Column {
                Text(
                    "Set IP or host for backend server (e.g. 10.0.2.2 for emulator, 192.168.x.x for physical device):",
                    color = TacticalTextSecondary,
                    fontSize = 13.sp
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = hostInput,
                    onValueChange = { hostInput = it },
                    label = { Text("Server Host / IP", color = TacticalTextSecondary) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = TacticalTextPrimary,
                        unfocusedTextColor = TacticalTextPrimary,
                        focusedBorderColor = EmergencyBlue,
                        unfocusedBorderColor = TacticalBorder
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onApply(hostInput.trim()) },
                colors = ButtonDefaults.buttonColors(containerColor = EmergencyBlue)
            ) {
                Text("SAVE", color = TacticalBg, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", color = TacticalTextSecondary)
            }
        }
    )
}
