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
import kotlinx.coroutines.launch
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

        Surface(
            onClick = { showConfigDialog = true },
            color = TacticalCard,
            shape = RoundedCornerShape(8.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "SERVER: " + AppConfig.baseUrl,
                    color = TacticalTextSecondary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "CONFIGURE",
                    color = EmergencyBlue,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
            }
        }
    }

    if (showConfigDialog) {
        BackendConfigDialog(
            onDismiss = { showConfigDialog = false },
            onApply = { newUrl ->
                viewModel.saveBackendUrl(newUrl)
                showConfigDialog = false
                viewModel.refreshSnapshot()
            },
            onTestConnection = { testUrl ->
                viewModel.testConnection(testUrl)
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
fun BackendConfigDialog(
    onDismiss: () -> Unit,
    onApply: (String) -> Unit,
    onTestConnection: suspend (String) -> Result<String>
) {
    val coroutineScope = rememberCoroutineScope()
    var urlInput by remember { mutableStateOf(AppConfig.baseUrl) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var isTesting by remember { mutableStateOf(false) }
    var testResultMessage by remember { mutableStateOf<String?>(null) }
    var isTestSuccess by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = TacticalSurface,
        title = {
            Text(
                text = "Backend Server Config",
                color = TacticalTextPrimary,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Configure Node.js backend server. Value is persistently saved across app restarts and process recreation.",
                    color = TacticalTextSecondary,
                    fontSize = 12.sp,
                    lineHeight = 16.sp
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Active: " + AppConfig.baseUrl,
                    color = TacticalTextMuted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )

                Spacer(modifier = Modifier.height(12.dp))

                OutlinedTextField(
                    value = urlInput,
                    onValueChange = {
                        urlInput = it
                        validationError = null
                        testResultMessage = null
                    },
                    label = { Text("Server Base URL or Host:Port", color = TacticalTextSecondary) },
                    placeholder = { Text("e.g. 192.168.1.13:4000 or 10.0.2.2:4000", color = TacticalTextMuted) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = TacticalTextPrimary,
                        unfocusedTextColor = TacticalTextPrimary,
                        focusedBorderColor = EmergencyBlue,
                        unfocusedBorderColor = TacticalBorder
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Presets for quick convenience
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AssistChip(
                        onClick = {
                            urlInput = "http://10.0.2.2:4000"
                            validationError = null
                            testResultMessage = null
                        },
                        label = { Text("Emulator", fontSize = 10.sp, fontFamily = FontFamily.Monospace) }
                    )
                    AssistChip(
                        onClick = {
                            urlInput = "http://192.168.1.13:4000"
                            validationError = null
                            testResultMessage = null
                        },
                        label = { Text("PC LAN", fontSize = 10.sp, fontFamily = FontFamily.Monospace) }
                    )
                    AssistChip(
                        onClick = {
                            urlInput = "http://127.0.0.1:4000"
                            validationError = null
                            testResultMessage = null
                        },
                        label = { Text("Localhost", fontSize = 10.sp, fontFamily = FontFamily.Monospace) }
                    )
                }

                if (validationError != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = validationError ?: "",
                        color = EmergencyRed,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }

                if (testResultMessage != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = testResultMessage ?: "",
                        color = if (isTestSuccess) EmergencyGreen else EmergencyRed,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Test Connection Button
                OutlinedButton(
                    onClick = {
                        val valid = AppConfig.validateAndNormalizeUrl(urlInput)
                        if (valid.isFailure) {
                            validationError = valid.exceptionOrNull()?.message ?: "Invalid URL format"
                            return@OutlinedButton
                        }
                        validationError = null
                        isTesting = true
                        testResultMessage = null
                        coroutineScope.launch {
                            val res = onTestConnection(valid.getOrThrow())
                            isTesting = false
                            isTestSuccess = res.isSuccess
                            testResultMessage = if (res.isSuccess) {
                                res.getOrThrow()
                            } else {
                                res.exceptionOrNull()?.message ?: "Connection failed"
                            }
                        }
                    },
                    enabled = !isTesting,
                    border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyBlue),
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (isTesting) {
                        CircularProgressIndicator(
                            color = EmergencyBlue,
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("TESTING...", color = EmergencyBlue, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                    } else {
                        Text("TEST CONNECTION", color = EmergencyBlue, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val valid = AppConfig.validateAndNormalizeUrl(urlInput)
                    if (valid.isSuccess) {
                        onApply(valid.getOrThrow())
                    } else {
                        validationError = valid.exceptionOrNull()?.message ?: "Invalid URL format"
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = EmergencyBlue),
                shape = RoundedCornerShape(6.dp)
            ) {
                Text("SAVE", color = TacticalBg, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace)
            }
        }
    )
}
