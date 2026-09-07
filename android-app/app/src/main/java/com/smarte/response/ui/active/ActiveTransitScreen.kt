package com.smarte.response.ui.active

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smarte.response.data.model.CityNode
import com.smarte.response.ui.components.TacticalButton
import com.smarte.response.ui.components.TacticalHeader
import com.smarte.response.ui.theme.*
import com.smarte.response.viewmodel.DriverViewModel

@Composable
fun ActiveTransitScreen(viewModel: DriverViewModel) {
    val context = LocalContext.current
    val team by viewModel.selectedTeam.collectAsState()
    val connState by viewModel.connectionState.collectAsState()
    val emergency by viewModel.activeEmergency.collectAsState()
    val assignment by viewModel.activeAssignment.collectAsState()
    val rerouteAlert by viewModel.rerouteAlert.collectAsState()
    val isDemo by viewModel.locationManager.isDemoMode.collectAsState()
    val demoIdx by viewModel.locationManager.demoNodeIndex.collectAsState()
    val location by viewModel.locationManager.currentLocation.collectAsState()
    val statusMsg by viewModel.statusMessage.collectAsState()
    val errorMsg by viewModel.errorMessage.collectAsState()

    val currentTeam = team ?: return
    val currentAssignment = assignment
    val routeNodeIds = currentAssignment?.route ?: emptyList()
    val resolvedNodes = remember(routeNodeIds) { viewModel.resolveNodes(routeNodeIds) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TacticalBg)
    ) {
        TacticalHeader(
            title = "MISSION IN PROGRESS",
            subtitle = "UNIT " + currentTeam.teamId + " - EN ROUTE",
            connectionState = connState
        )

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Dynamic Reroute Alert Banner
            if (rerouteAlert != null) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = EmergencyYellow.copy(alpha = 0.2f)),
                        border = androidx.compose.foundation.BorderStroke(2.dp, EmergencyYellow),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "DYNAMIC ROUTE RECALCULATED",
                                    color = EmergencyYellow,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace
                                )
                                TextButton(onClick = { viewModel.dismissRerouteAlert() }) {
                                    Text("DISMISS", color = TacticalTextPrimary, fontSize = 11.sp)
                                }
                            }
                            Text(
                                text = "Blockage detected on road. C++ Engine dynamically calculated new optimal route avoiding incident.",
                                color = TacticalTextPrimary,
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "New ETA: " + (rerouteAlert?.newEta ?: 0) + " min | Dist: " + String.format("%.2f", rerouteAlert?.newDistance ?: 0.0) + " km",
                                color = EmergencyCyan,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }

            // Incident Brief Card
            item {
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
                            val incidentNum = emergency?.id ?: currentAssignment?.emergencyId ?: "ACTIVE"
                            Text(
                                text = "INCIDENT #" + incidentNum,
                                color = EmergencyRed,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(
                                text = emergency?.type ?: "EMERGENCY",
                                color = TacticalTextSecondary,
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }

                        Divider(color = TacticalBorder, modifier = Modifier.padding(vertical = 10.dp))

                        Text(
                            text = emergency?.description ?: "Responding to assigned incident per C++ dispatch.",
                            color = TacticalTextPrimary,
                            fontSize = 14.sp
                        )

                        Spacer(modifier = Modifier.height(10.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column {
                                Text("ESTIMATED DISTANCE", color = TacticalTextSecondary, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                                Text(String.format("%.2f", currentAssignment?.distance ?: 0.0) + " km", color = EmergencyGreen, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            }
                            Column {
                                Text("ESTIMATED ETA", color = TacticalTextSecondary, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                                Text((currentAssignment?.etaMinutes?.toString() ?: "--") + " min", color = EmergencyCyan, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            }
                            Column {
                                Text("SEVERITY", color = TacticalTextSecondary, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                                Text((emergency?.severity ?: 3).toString(), color = EmergencyRed, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }
                }
            }

            // Google Maps Open Navigation Intent
            item {
                TacticalButton(
                    text = "OPEN NAVIGATION IN MAPS",
                    onClick = {
                        val targetNode = resolvedNodes.lastOrNull()
                        val lat = emergency?.lat ?: targetNode?.lat ?: 18.5204
                        val lng = emergency?.lon ?: targetNode?.lon ?: 73.8567
                        val gmmIntentUri = Uri.parse("google.navigation:q=" + lat + "," + lng + "&mode=d")
                        val mapIntent = Intent(Intent.ACTION_VIEW, gmmIntentUri)
                        mapIntent.setPackage("com.google.android.apps.maps")
                        if (mapIntent.resolveActivity(context.packageManager) != null) {
                            context.startActivity(mapIntent)
                        } else {
                            val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse("geo:" + lat + "," + lng + "?q=" + lat + "," + lng))
                            context.startActivity(fallbackIntent)
                        }
                    },
                    containerColor = EmergencyBlue,
                    contentColor = TacticalBg
                )
            }

            // C++ Dijkstra Optimal Route Node Sequence
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalSurface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "OPTIMIZED ROUTE (C++ DIJKSTRA)",
                            color = TacticalTextSecondary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                        Spacer(modifier = Modifier.height(10.dp))

                        resolvedNodes.forEachIndexed { index, node ->
                            val isCurrent = isDemo && demoIdx == index
                            val isOrigin = index == 0
                            val isDestination = index == resolvedNodes.size - 1

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .clip(CircleShape)
                                        .background(
                                            when {
                                                isCurrent -> EmergencyYellow
                                                isDestination -> EmergencyRed
                                                isOrigin -> EmergencyGreen
                                                else -> TacticalBorder
                                            }
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = (index + 1).toString(),
                                        color = TacticalBg,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }

                                Spacer(modifier = Modifier.width(12.dp))

                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = node.id + " - " + node.displayName,
                                        color = if (isCurrent) EmergencyYellow else TacticalTextPrimary,
                                        fontSize = 13.sp,
                                        fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                                        fontFamily = FontFamily.Monospace
                                    )
                                    Text(
                                        text = String.format("%.4f", node.lat) + ", " + String.format("%.4f", node.lon),
                                        color = TacticalTextSecondary,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }

                                if (isCurrent) {
                                    Text("CURRENT", color = EmergencyYellow, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                                } else if (isDestination) {
                                    Text("DEST", color = EmergencyRed, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                                }
                            }

                            if (index < resolvedNodes.size - 1) {
                                Box(
                                    modifier = Modifier
                                        .padding(start = 11.dp)
                                        .width(2.dp)
                                        .height(14.dp)
                                        .background(TacticalBorder)
                                )
                            }
                        }
                    }
                }
            }

            // Demo Location Simulator Controls
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalCard),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "SIMULATOR: DEMO LOCATION MODE",
                                color = TacticalTextSecondary,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            Switch(
                                checked = isDemo,
                                onCheckedChange = { viewModel.setDemoMode(it) }
                            )
                        }

                        if (isDemo) {
                            Spacer(modifier = Modifier.height(10.dp))
                            Text(
                                text = "Step vehicle position through the C++ route nodes to simulate transit telemetry for Operator Dashboard:",
                                color = TacticalTextSecondary,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Button(
                                    onClick = { viewModel.stepDemoBackward() },
                                    enabled = demoIdx > 0,
                                    colors = ButtonDefaults.buttonColors(containerColor = TacticalBorder),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("PREV NODE", fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                                }
                                Button(
                                    onClick = { viewModel.stepDemoForward() },
                                    enabled = demoIdx < resolvedNodes.size - 1,
                                    colors = ButtonDefaults.buttonColors(containerColor = EmergencyCyan),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("NEXT NODE", color = TacticalBg, fontSize = 12.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                                }
                            }
                        }
                    }
                }
            }

            // Complete Emergency Button
            item {
                Spacer(modifier = Modifier.height(8.dp))
                TacticalButton(
                    text = "MISSION COMPLETE / RESOLVED",
                    onClick = {
                        val eId = emergency?.id ?: currentAssignment?.emergencyId ?: ""
                        if (eId.isNotEmpty()) {
                            viewModel.completeEmergency(eId)
                        }
                    },
                    containerColor = EmergencyGreen,
                    contentColor = TacticalBg
                )
                Spacer(modifier = Modifier.height(20.dp))
            }
        }
    }
}
