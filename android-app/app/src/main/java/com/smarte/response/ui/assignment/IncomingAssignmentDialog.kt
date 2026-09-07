package com.smarte.response.ui.assignment

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.smarte.response.data.model.Assignment
import com.smarte.response.ui.components.TacticalButton
import com.smarte.response.ui.theme.*

@Composable
fun IncomingAssignmentDialog(
    assignment: Assignment,
    onAccept: () -> Unit,
    onDecline: () -> Unit
) {
    Dialog(
        onDismissRequest = { /* Force explicit decision */ },
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = TacticalSurface,
            border = androidx.compose.foundation.BorderStroke(2.dp, EmergencyRed),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Flashing emergency banner
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(EmergencyRedDark)
                        .padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "DISPATCH ALERT",
                        color = TacticalTextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = FontFamily.Monospace,
                        letterSpacing = 1.sp
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "MISSION ID: " + assignment.assignmentId,
                    color = TacticalTextSecondary,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace
                )

                Text(
                    text = "INCIDENT #" + assignment.emergencyId,
                    color = EmergencyYellow,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )

                Spacer(modifier = Modifier.height(14.dp))

                // Route details card
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalCard),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("OPTIMIZED DISTANCE", color = TacticalTextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                            Text(String.format("%.2f", assignment.distance) + " km", color = EmergencyGreen, fontSize = 13.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                        }

                        Spacer(modifier = Modifier.height(6.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("ESTIMATED ETA", color = TacticalTextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                            Text("" + assignment.etaMinutes + " min", color = EmergencyCyan, fontSize = 13.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Text(
                            text = "C++ DIJKSTRA ROUTE:",
                            color = TacticalTextMuted,
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace
                        )
                        Text(
                            text = assignment.route.joinToString(" -> "),
                            color = TacticalTextPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))

                // Actions: Big tactile buttons
                TacticalButton(
                    text = "ACCEPT MISSION",
                    onClick = onAccept,
                    containerColor = EmergencyGreen,
                    contentColor = TacticalBg
                )

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedButton(
                    onClick = onDecline,
                    
                    border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyRed),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                ) {
                    Text(
                        text = "DECLINE / REQUEUE",
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }
        }
    }
}
