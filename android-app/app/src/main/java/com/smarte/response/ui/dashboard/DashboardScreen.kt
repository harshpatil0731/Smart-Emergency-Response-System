package com.smarte.response.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smarte.response.ui.components.StatusBadge
import com.smarte.response.ui.components.TacticalButton
import com.smarte.response.ui.components.TacticalHeader
import com.smarte.response.ui.theme.*
import com.smarte.response.viewmodel.DriverViewModel

@Composable
fun DashboardScreen(viewModel: DriverViewModel) {
    val team by viewModel.selectedTeam.collectAsState()
    val connState by viewModel.connectionState.collectAsState()
    val location by viewModel.locationManager.currentLocation.collectAsState()
    val accuracy by viewModel.locationManager.currentAccuracy.collectAsState()
    val isDemo by viewModel.locationManager.isDemoMode.collectAsState()
    val statusMsg by viewModel.statusMessage.collectAsState()
    val errorMsg by viewModel.errorMessage.collectAsState()

    val currentTeam = team ?: return

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TacticalBg)
    ) {
        TacticalHeader(
            title = "UNIT " + currentTeam.teamId,
            subtitle = currentTeam.displayName,
            connectionState = connState,
            onSettingsClick = { viewModel.logout() }
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                if (statusMsg != null) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = EmergencyGreen.copy(alpha = 0.2f)),
                        border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyGreen),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = statusMsg ?: "",
                            color = EmergencyGreen,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(8.dp),
                            fontFamily = FontFamily.Monospace
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                if (errorMsg != null) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = EmergencyRed.copy(alpha = 0.2f)),
                        border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyRed),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = errorMsg ?: "",
                            color = EmergencyRed,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(8.dp),
                            fontFamily = FontFamily.Monospace
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                // Vehicle status card
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalSurface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("OPERATIONAL STATUS", color = TacticalTextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                                Text(currentTeam.type, color = TacticalTextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            }
                            StatusBadge(status = currentTeam.status)
                        }

                        Divider(color = TacticalBorder, modifier = Modifier.padding(vertical = 12.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("BASE STATION", color = TacticalTextSecondary, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                            Text(currentTeam.station, color = TacticalTextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("TELEMETRY", color = TacticalTextSecondary, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                            val locText = if (location != null) {
                                String.format("%.4f", location!!.first) + ", " + String.format("%.4f", location!!.second)
                            } else {
                                "NO GPS FIX"
                            }
                            Text(locText, color = EmergencyCyan, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))

                // Standby animation/indicator
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalCard),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = if (currentTeam.status == "AVAILABLE") "STANDBY READY" else "UNIT INACTIVE",
                            color = if (currentTeam.status == "AVAILABLE") EmergencyGreen else TacticalTextSecondary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = if (currentTeam.status == "AVAILABLE")
                                "Listening for automated C++ engine dispatches..."
                            else
                                "Switch status to AVAILABLE to accept dispatches.",
                            color = TacticalTextSecondary,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }

            // Bottom action controls
            Column {
                if (currentTeam.status == "AVAILABLE") {
                    TacticalButton(
                        text = "GO OFFLINE",
                        onClick = { viewModel.toggleStatus("OFFLINE") },
                        containerColor = TacticalCard,
                        contentColor = TacticalTextSecondary
                    )
                } else {
                    TacticalButton(
                        text = "GO AVAILABLE",
                        onClick = { viewModel.toggleStatus("AVAILABLE") },
                        containerColor = EmergencyGreen,
                        contentColor = TacticalBg
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedButton(
                    onClick = { viewModel.logout() },
                    
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("SWITCH UNIT / LOGOUT", fontFamily = FontFamily.Monospace)
                }
            }
        }
    }
}
