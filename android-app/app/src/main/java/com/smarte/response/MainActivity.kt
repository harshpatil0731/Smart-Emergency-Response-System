package com.smarte.response

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.smarte.response.ui.active.ActiveTransitScreen
import com.smarte.response.ui.assignment.IncomingAssignmentDialog
import com.smarte.response.ui.dashboard.DashboardScreen
import com.smarte.response.ui.login.LoginScreen
import com.smarte.response.ui.theme.SmartEmergencyTheme
import com.smarte.response.viewmodel.AppScreen
import com.smarte.response.viewmodel.DriverViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: DriverViewModel by viewModels()

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) {
            viewModel.locationManager.startGpsUpdates()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestPermissionsIfNeeded()

        setContent {
            SmartEmergencyTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainAppContent(viewModel = viewModel)
                }
            }
        }
    }

    private fun requestPermissionsIfNeeded() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            locationPermissionLauncher.launch(needed.toTypedArray())
        } else {
            viewModel.locationManager.startGpsUpdates()
        }
    }
}

@Composable
fun MainAppContent(viewModel: DriverViewModel) {
    val currentScreen by viewModel.currentScreen.collectAsState()
    val pendingAssignment by viewModel.pendingAssignment.collectAsState()

    when (currentScreen) {
        AppScreen.Login -> LoginScreen(viewModel = viewModel)
        AppScreen.Dashboard -> DashboardScreen(viewModel = viewModel)
        AppScreen.ActiveTransit -> ActiveTransitScreen(viewModel = viewModel)
    }

    // Modal incoming assignment alert overlay
    if (pendingAssignment != null) {
        IncomingAssignmentDialog(
            assignment = pendingAssignment!!,
            onAccept = { viewModel.acceptAssignment(pendingAssignment!!.assignmentId) },
            onDecline = { viewModel.declineAssignment(pendingAssignment!!.assignmentId) }
        )
    }
}
