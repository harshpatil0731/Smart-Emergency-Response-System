package com.smarte.response.ui.login

import android.Manifest
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import com.smarte.response.data.api.AppConfig
import com.smarte.response.data.model.ResponseTeam
import com.smarte.response.ui.components.ConnectionIndicator
import com.smarte.response.ui.components.StatusBadge
import com.smarte.response.ui.theme.*
import com.smarte.response.viewmodel.AuthStage
import com.smarte.response.viewmodel.DriverViewModel

enum class LocationOption(val key: String, val displayName: String, val description: String) {
    CURRENT_LOCATION("CURRENT_LOCATION", "Current Location", "Live device GPS coordinates"),
    DECCAN_GYMKHANA("DECCAN_GYMKHANA", "Deccan Gymkhana", "Fixed demo coords: 18.5160, 73.8400"),
    SHIVAJI_NAGAR("SHIVAJI_NAGAR", "Shivaji Nagar", "Fixed demo coords: 18.5310, 73.8446"),
    CAMP_ZONE("CAMP_ZONE", "Camp Zone", "Fixed demo coords: 18.5130, 73.8780")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(viewModel: DriverViewModel) {
    val context = LocalContext.current
    val allTeams by viewModel.allTeams.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val connState by viewModel.connectionState.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()
    val statusMessage by viewModel.statusMessage.collectAsState()

    val authStage by viewModel.authStage.collectAsState()
    val savedDriver by viewModel.driverAccount.collectAsState()

    var showConfigDialog by remember { mutableStateOf(false) }

    // --- Login Form State ---
    var loginMobile by remember { mutableStateOf(savedDriver?.mobileNumber ?: "") }
    var loginPassword by remember { mutableStateOf("") }
    var loginPasswordVisible by remember { mutableStateOf(false) }

    // Synchronize loginMobile if saved driver updates
    LaunchedEffect(savedDriver) {
        if (loginMobile.isEmpty() && savedDriver != null) {
            loginMobile = savedDriver!!.mobileNumber
        }
    }

    // --- Registration Form State ---
    var regRole by remember { mutableStateOf("Ambulance") }
    var regRoleExpanded by remember { mutableStateOf(false) }
    val roles = listOf("Ambulance", "Fire Brigade", "Rescue Team")

    var regDriverName by remember { mutableStateOf("") }
    var regMobile by remember { mutableStateOf("") }
    var regPassword by remember { mutableStateOf("") }
    var regPasswordVisible by remember { mutableStateOf(false) }
    var regConfirmPassword by remember { mutableStateOf("") }
    var regConfirmPasswordVisible by remember { mutableStateOf(false) }
    var regVehicleNumber by remember { mutableStateOf("") }
    var regSelectedLocation by remember { mutableStateOf(LocationOption.DECCAN_GYMKHANA) }
    var regLocationDropdownExpanded by remember { mutableStateOf(false) }

    // --- Location Selection / Activation State (for subsequent login) ---
    var selectedLocation by remember { mutableStateOf(LocationOption.DECCAN_GYMKHANA) }
    var locationDropdownExpanded by remember { mutableStateOf(false) }

    var gpsStatusMessage by remember { mutableStateOf<String?>(null) }
    var currentGpsCoords by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    var isFetchingGps by remember { mutableStateOf(false) }

    val isCurrentLocationActive = (authStage == AuthStage.REGISTER && regSelectedLocation == LocationOption.CURRENT_LOCATION) ||
            (authStage == AuthStage.SELECT_LOCATION && selectedLocation == LocationOption.CURRENT_LOCATION)

    // Location Permission Launcher
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false

        if (fineGranted || coarseGranted) {
            isFetchingGps = true
            viewModel.locationManager.startGpsUpdates()
            val best = viewModel.locationManager.getBestLastKnownLocation()
            if (best != null && best.first != 0.0 && best.second != 0.0) {
                currentGpsCoords = best
                gpsStatusMessage = "GPS Acquired: ${String.format("%.4f", best.first)}, ${String.format("%.4f", best.second)}"
            } else {
                gpsStatusMessage = "Waiting for live GPS satellite lock..."
            }
            isFetchingGps = false
        } else {
            gpsStatusMessage = "Location permission denied. Cannot use Current Location."
            Toast.makeText(context, "Location permission required for Current Location", Toast.LENGTH_SHORT).show()
        }
    }

    // Effect to start GPS listener if Current Location is selected in REGISTER or SELECT_LOCATION stage
    LaunchedEffect(isCurrentLocationActive) {
        if (isCurrentLocationActive) {
            if (!viewModel.locationManager.hasLocationPermission()) {
                locationPermissionLauncher.launch(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    )
                )
            } else {
                viewModel.locationManager.startGpsUpdates()
                val best = viewModel.locationManager.getBestLastKnownLocation()
                if (best != null && best.first != 0.0 && best.second != 0.0) {
                    currentGpsCoords = best
                    gpsStatusMessage = "GPS Acquired: ${String.format("%.4f", best.first)}, ${String.format("%.4f", best.second)}"
                } else {
                    gpsStatusMessage = "Waiting for live GPS fix..."
                }
            }
        } else {
            gpsStatusMessage = null
            currentGpsCoords = null
        }
    }

    // Listen to live GPS from locationManager when on Current Location
    val liveGps by viewModel.locationManager.currentLocation.collectAsState()
    LaunchedEffect(liveGps, isCurrentLocationActive) {
        if (isCurrentLocationActive && liveGps != null) {
            currentGpsCoords = liveGps
            gpsStatusMessage = "GPS Acquired: ${String.format("%.4f", liveGps!!.first)}, ${String.format("%.4f", liveGps!!.second)}"
        }
    }

    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TacticalBg)
            .padding(16.dp)
            .verticalScroll(scrollState),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // --- Top Bar Header ---
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                val headerTitle = when (authStage) {
                    AuthStage.LOGIN -> "DRIVER LOGIN"
                    AuthStage.REGISTER -> "NEW DRIVER SIGN-UP"
                    AuthStage.SELECT_LOCATION -> "START SHIFT"
                }
                val headerSub = when (authStage) {
                    AuthStage.LOGIN -> "ENTER MOBILE NUMBER & PASSWORD"
                    AuthStage.REGISTER -> "CREATE RESPONSE DRIVER ACCOUNT"
                    AuthStage.SELECT_LOCATION -> "VERIFY PROFILE & GO ONLINE"
                }
                Text(
                    text = headerTitle,
                    color = TacticalTextPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
                Text(
                    text = headerSub,
                    color = TacticalTextSecondary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }
            IconButton(onClick = { showConfigDialog = true }) {
                Text("CONFIG", fontSize = 11.sp, color = TacticalTextSecondary, fontFamily = FontFamily.Monospace)
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Connection & Refresh Status
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

        // Error message banner
        if (errorMessage != null) {
            Spacer(modifier = Modifier.height(10.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = EmergencyRedDark.copy(alpha = 0.2f)),
                border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyRed),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = errorMessage ?: "",
                    color = EmergencyRed,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(10.dp),
                    fontFamily = FontFamily.Monospace
                )
            }
        }

        // Status message banner
        if (statusMessage != null && errorMessage == null) {
            Spacer(modifier = Modifier.height(10.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = EmergencyGreen.copy(alpha = 0.15f)),
                border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyGreen),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = statusMessage ?: "",
                    color = EmergencyGreen,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(10.dp),
                    fontFamily = FontFamily.Monospace
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // --- AUTH STAGES ---
        when (authStage) {
            AuthStage.LOGIN -> {
                // ==========================
                // 1. DRIVER LOGIN CARD
                // ==========================
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalSurface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "DRIVER CREDENTIALS",
                            color = EmergencyBlue,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )

                        // Mobile Number Input
                        OutlinedTextField(
                            value = loginMobile,
                            onValueChange = { loginMobile = it },
                            label = { Text("Mobile Number", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                            placeholder = { Text("e.g. 9876543210", color = TacticalTextSecondary.copy(alpha = 0.5f)) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TacticalTextPrimary,
                                unfocusedTextColor = TacticalTextPrimary,
                                focusedBorderColor = EmergencyBlue,
                                unfocusedBorderColor = TacticalBorder,
                                focusedContainerColor = TacticalCard,
                                unfocusedContainerColor = TacticalCard
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        // Password Input
                        OutlinedTextField(
                            value = loginPassword,
                            onValueChange = { loginPassword = it },
                            label = { Text("Password", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                            placeholder = { Text("Enter driver password", color = TacticalTextSecondary.copy(alpha = 0.5f)) },
                            singleLine = true,
                            visualTransformation = if (loginPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            trailingIcon = {
                                TextButton(onClick = { loginPasswordVisible = !loginPasswordVisible }) {
                                    Text(
                                        text = if (loginPasswordVisible) "HIDE" else "SHOW",
                                        color = TacticalTextSecondary,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TacticalTextPrimary,
                                unfocusedTextColor = TacticalTextPrimary,
                                focusedBorderColor = EmergencyBlue,
                                unfocusedBorderColor = TacticalBorder,
                                focusedContainerColor = TacticalCard,
                                unfocusedContainerColor = TacticalCard
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        // Login Action Button
                        Button(
                            onClick = {
                                val trimmedMobile = loginMobile.trim()
                                val trimmedPass = loginPassword.trim()
                                if (trimmedMobile.length < 8) {
                                    Toast.makeText(context, "Please enter a valid mobile number", Toast.LENGTH_SHORT).show()
                                    return@Button
                                }
                                if (trimmedPass.isEmpty()) {
                                    Toast.makeText(context, "Please enter your password", Toast.LENGTH_SHORT).show()
                                    return@Button
                                }
                                viewModel.loginDriver(trimmedMobile, trimmedPass)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = EmergencyBlue),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp),
                            enabled = !isLoading
                        ) {
                            if (isLoading) {
                                CircularProgressIndicator(color = TacticalBg, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("LOGGING IN...", color = TacticalBg, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            } else {
                                Text("LOGIN", color = TacticalBg, fontWeight = FontWeight.Bold, fontSize = 14.sp, fontFamily = FontFamily.Monospace)
                            }
                        }

                        // Switch to Register
                        HorizontalDivider(color = TacticalBorder, modifier = Modifier.padding(vertical = 4.dp))

                        OutlinedButton(
                            onClick = { viewModel.setAuthStage(AuthStage.REGISTER) },
                            border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = "FIRST TIME? CREATE DRIVER ACCOUNT",
                                color = TacticalTextPrimary,
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }

            AuthStage.REGISTER -> {
                // ==========================
                // 2. DRIVER REGISTRATION CARD
                // ==========================
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalSurface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "NEW DRIVER REGISTRATION",
                            color = EmergencyBlue,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )

                        // 1. Role Selection Dropdown
                        ExposedDropdownMenuBox(
                            expanded = regRoleExpanded,
                            onExpandedChange = { regRoleExpanded = !regRoleExpanded }
                        ) {
                            OutlinedTextField(
                                value = regRole,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Response Role", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = regRoleExpanded) },
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = TacticalTextPrimary,
                                    unfocusedTextColor = TacticalTextPrimary,
                                    focusedBorderColor = EmergencyBlue,
                                    unfocusedBorderColor = TacticalBorder,
                                    focusedContainerColor = TacticalCard,
                                    unfocusedContainerColor = TacticalCard
                                ),
                                modifier = Modifier
                                    .menuAnchor()
                                    .fillMaxWidth()
                            )
                            ExposedDropdownMenu(
                                expanded = regRoleExpanded,
                                onDismissRequest = { regRoleExpanded = false },
                                modifier = Modifier.background(TacticalCard)
                            ) {
                                roles.forEach { role ->
                                    DropdownMenuItem(
                                        text = { Text(role, color = TacticalTextPrimary, fontFamily = FontFamily.Monospace) },
                                        onClick = {
                                            regRole = role
                                            regRoleExpanded = false
                                        }
                                    )
                                }
                            }
                        }

                        // 2. Driver Name Input
                        OutlinedTextField(
                            value = regDriverName,
                            onValueChange = { regDriverName = it },
                            label = { Text("Driver Full Name", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                            placeholder = { Text("e.g. Rahul Sharma", color = TacticalTextSecondary.copy(alpha = 0.5f)) },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TacticalTextPrimary,
                                unfocusedTextColor = TacticalTextPrimary,
                                focusedBorderColor = EmergencyBlue,
                                unfocusedBorderColor = TacticalBorder,
                                focusedContainerColor = TacticalCard,
                                unfocusedContainerColor = TacticalCard
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        // 3. Mobile Number Input
                        OutlinedTextField(
                            value = regMobile,
                            onValueChange = { regMobile = it },
                            label = { Text("Mobile Number (Unique Login ID)", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                            placeholder = { Text("e.g. 9876543210", color = TacticalTextSecondary.copy(alpha = 0.5f)) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TacticalTextPrimary,
                                unfocusedTextColor = TacticalTextPrimary,
                                focusedBorderColor = EmergencyBlue,
                                unfocusedBorderColor = TacticalBorder,
                                focusedContainerColor = TacticalCard,
                                unfocusedContainerColor = TacticalCard
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        // 4. Password Input
                        OutlinedTextField(
                            value = regPassword,
                            onValueChange = { regPassword = it },
                            label = { Text("Create Password (min 4 chars)", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                            singleLine = true,
                            visualTransformation = if (regPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            trailingIcon = {
                                TextButton(onClick = { regPasswordVisible = !regPasswordVisible }) {
                                    Text(
                                        text = if (regPasswordVisible) "HIDE" else "SHOW",
                                        color = TacticalTextSecondary,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TacticalTextPrimary,
                                unfocusedTextColor = TacticalTextPrimary,
                                focusedBorderColor = EmergencyBlue,
                                unfocusedBorderColor = TacticalBorder,
                                focusedContainerColor = TacticalCard,
                                unfocusedContainerColor = TacticalCard
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        // 4b. Confirm Password Input
                        OutlinedTextField(
                            value = regConfirmPassword,
                            onValueChange = { regConfirmPassword = it },
                            label = { Text("Confirm Password", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                            singleLine = true,
                            visualTransformation = if (regConfirmPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            trailingIcon = {
                                TextButton(onClick = { regConfirmPasswordVisible = !regConfirmPasswordVisible }) {
                                    Text(
                                        text = if (regConfirmPasswordVisible) "HIDE" else "SHOW",
                                        color = TacticalTextSecondary,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TacticalTextPrimary,
                                unfocusedTextColor = TacticalTextPrimary,
                                focusedBorderColor = EmergencyBlue,
                                unfocusedBorderColor = TacticalBorder,
                                focusedContainerColor = TacticalCard,
                                unfocusedContainerColor = TacticalCard
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        // 5. Vehicle Number Input
                        OutlinedTextField(
                            value = regVehicleNumber,
                            onValueChange = { regVehicleNumber = it.uppercase() },
                            label = { Text("Vehicle Plate Number", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                            placeholder = { Text("e.g. MH12AB1234", color = TacticalTextSecondary.copy(alpha = 0.5f)) },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TacticalTextPrimary,
                                unfocusedTextColor = TacticalTextPrimary,
                                focusedBorderColor = EmergencyBlue,
                                unfocusedBorderColor = TacticalBorder,
                                focusedContainerColor = TacticalCard,
                                unfocusedContainerColor = TacticalCard
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        // 6. Starting Location Dropdown
                        ExposedDropdownMenuBox(
                            expanded = regLocationDropdownExpanded,
                            onExpandedChange = { regLocationDropdownExpanded = !regLocationDropdownExpanded }
                        ) {
                            OutlinedTextField(
                                value = regSelectedLocation.displayName,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Initial Starting Location", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = regLocationDropdownExpanded) },
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = TacticalTextPrimary,
                                    unfocusedTextColor = TacticalTextPrimary,
                                    focusedBorderColor = EmergencyBlue,
                                    unfocusedBorderColor = TacticalBorder,
                                    focusedContainerColor = TacticalCard,
                                    unfocusedContainerColor = TacticalCard
                                ),
                                modifier = Modifier
                                    .menuAnchor()
                                    .fillMaxWidth()
                            )
                            ExposedDropdownMenu(
                                expanded = regLocationDropdownExpanded,
                                onDismissRequest = { regLocationDropdownExpanded = false },
                                modifier = Modifier.background(TacticalCard)
                            ) {
                                LocationOption.values().forEach { option ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(option.displayName, color = TacticalTextPrimary, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                                                Text(option.description, color = TacticalTextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                                            }
                                        },
                                        onClick = {
                                            regSelectedLocation = option
                                            regLocationDropdownExpanded = false
                                        }
                                    )
                                }
                            }
                        }

                        // Live GPS feedback if Current Location selected in registration
                        if (regSelectedLocation == LocationOption.CURRENT_LOCATION) {
                            Surface(
                                color = TacticalCard,
                                shape = RoundedCornerShape(8.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, if (currentGpsCoords != null) EmergencyGreen else EmergencyYellow)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = if (currentGpsCoords != null) "📍" else "⏳",
                                        fontSize = 16.sp
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = gpsStatusMessage ?: "Acquiring live GPS fix...",
                                        color = if (currentGpsCoords != null) EmergencyGreen else EmergencyYellow,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            }
                        }

                        // Info pill regarding auto Unit ID
                        Surface(
                            color = TacticalCard,
                            shape = RoundedCornerShape(6.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(text = "ℹ️", fontSize = 14.sp)
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "A unique Unit ID (e.g. AMB-01, FIR-01, RES-01) will be assigned automatically upon sign-up.",
                                    color = TacticalTextSecondary,
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }

                        // Register Button
                        Button(
                            onClick = {
                                val trimmedName = regDriverName.trim()
                                val trimmedMobile = regMobile.trim()
                                val trimmedPass = regPassword.trim()
                                val trimmedConfirmPass = regConfirmPassword.trim()
                                val trimmedVehicle = regVehicleNumber.trim()

                                if (trimmedName.length < 2) {
                                    Toast.makeText(context, "Enter valid driver name (at least 2 characters)", Toast.LENGTH_SHORT).show()
                                    return@Button
                                }
                                if (trimmedMobile.length < 8) {
                                    Toast.makeText(context, "Enter valid mobile number (at least 8 digits)", Toast.LENGTH_SHORT).show()
                                    return@Button
                                }
                                if (trimmedPass.length < 4) {
                                    Toast.makeText(context, "Password must be at least 4 characters", Toast.LENGTH_SHORT).show()
                                    return@Button
                                }
                                if (trimmedPass != trimmedConfirmPass) {
                                    Toast.makeText(context, "Passwords do not match", Toast.LENGTH_SHORT).show()
                                    return@Button
                                }
                                if (trimmedVehicle.length < 4) {
                                    Toast.makeText(context, "Enter valid vehicle number (e.g. MH12AB1234)", Toast.LENGTH_SHORT).show()
                                    return@Button
                                }

                                if (regSelectedLocation == LocationOption.CURRENT_LOCATION) {
                                    val coords = currentGpsCoords
                                    if (coords == null || coords.first == 0.0 || coords.second == 0.0) {
                                        Toast.makeText(context, "GPS location unavailable. Please enable device GPS or select a demo location.", Toast.LENGTH_LONG).show()
                                        return@Button
                                    }
                                    viewModel.registerDriverAccount(
                                        role = regRole,
                                        driverName = trimmedName,
                                        mobileNumber = trimmedMobile,
                                        password = trimmedPass,
                                        confirmPassword = trimmedConfirmPass,
                                        vehicleNumber = trimmedVehicle,
                                        locationType = regSelectedLocation.key,
                                        gpsLat = coords.first,
                                        gpsLon = coords.second
                                    )
                                } else {
                                    viewModel.registerDriverAccount(
                                        role = regRole,
                                        driverName = trimmedName,
                                        mobileNumber = trimmedMobile,
                                        password = trimmedPass,
                                        confirmPassword = trimmedConfirmPass,
                                        vehicleNumber = trimmedVehicle,
                                        locationType = regSelectedLocation.key
                                    )
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = EmergencyBlue),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp),
                            enabled = !isLoading
                        ) {
                            if (isLoading) {
                                CircularProgressIndicator(color = TacticalBg, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("CREATING ACCOUNT...", color = TacticalBg, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            } else {
                                Text("REGISTER ACCOUNT", color = TacticalBg, fontWeight = FontWeight.Bold, fontSize = 14.sp, fontFamily = FontFamily.Monospace)
                            }
                        }

                        // Back to login
                        HorizontalDivider(color = TacticalBorder, modifier = Modifier.padding(vertical = 4.dp))

                        TextButton(
                            onClick = { viewModel.setAuthStage(AuthStage.LOGIN) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = "ALREADY REGISTERED? LOG IN",
                                color = TacticalTextSecondary,
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }

            AuthStage.SELECT_LOCATION -> {
                // ==========================
                // 3. RETRIEVED PROFILE & LOCATION ACTIVATION CARD
                // ==========================
                savedDriver?.let { driver ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = TacticalSurface),
                        border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyBlue.copy(alpha = 0.5f)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "AUTHENTICATED DRIVER PROFILE",
                                    color = EmergencyBlue,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace
                                )
                                TextButton(
                                    onClick = { viewModel.switchAccount() },
                                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)
                                ) {
                                    Text("SWITCH ACCOUNT", color = EmergencyYellow, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = driver.driverName,
                                        color = TacticalTextPrimary,
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        fontFamily = FontFamily.Monospace
                                    )
                                    Text(
                                        text = "${driver.roleDisplay} • ${driver.vehicleNumber}",
                                        color = TacticalTextSecondary,
                                        fontSize = 12.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                    Text(
                                        text = "Mobile: ${driver.mobileNumber}",
                                        color = TacticalTextMuted,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }

                                Surface(
                                    color = EmergencyBlue.copy(alpha = 0.2f),
                                    shape = RoundedCornerShape(6.dp),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, EmergencyBlue)
                                ) {
                                    Text(
                                        text = driver.unitId,
                                        color = EmergencyBlue,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 16.sp,
                                        fontFamily = FontFamily.Monospace,
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))
                }

                // Location Selection & Duty Activation Card
                Card(
                    colors = CardDefaults.cardColors(containerColor = TacticalSurface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "SET INITIAL LOCATION & GO ONLINE",
                            color = TacticalTextPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )

                        Text(
                            text = "Select your starting dispatch node or live GPS coordinates to activate your unit in the emergency network.",
                            color = TacticalTextSecondary,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace
                        )

                        // Location Selection Dropdown
                        ExposedDropdownMenuBox(
                            expanded = locationDropdownExpanded,
                            onExpandedChange = { locationDropdownExpanded = !locationDropdownExpanded }
                        ) {
                            OutlinedTextField(
                                value = selectedLocation.displayName,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Starting Location", color = TacticalTextSecondary, fontFamily = FontFamily.Monospace) },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = locationDropdownExpanded) },
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = TacticalTextPrimary,
                                    unfocusedTextColor = TacticalTextPrimary,
                                    focusedBorderColor = EmergencyBlue,
                                    unfocusedBorderColor = TacticalBorder,
                                    focusedContainerColor = TacticalCard,
                                    unfocusedContainerColor = TacticalCard
                                ),
                                modifier = Modifier
                                    .menuAnchor()
                                    .fillMaxWidth()
                            )
                            ExposedDropdownMenu(
                                expanded = locationDropdownExpanded,
                                onDismissRequest = { locationDropdownExpanded = false },
                                modifier = Modifier.background(TacticalCard)
                            ) {
                                LocationOption.values().forEach { option ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(option.displayName, color = TacticalTextPrimary, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                                                Text(option.description, color = TacticalTextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                                            }
                                        },
                                        onClick = {
                                            selectedLocation = option
                                            locationDropdownExpanded = false
                                        }
                                    )
                                }
                            }
                        }

                        // GPS live status feedback
                        if (selectedLocation == LocationOption.CURRENT_LOCATION) {
                            Surface(
                                color = TacticalCard,
                                shape = RoundedCornerShape(8.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, if (currentGpsCoords != null) EmergencyGreen else EmergencyYellow)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = if (currentGpsCoords != null) "📍" else "⏳",
                                        fontSize = 16.sp
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = gpsStatusMessage ?: "Acquiring live GPS fix...",
                                        color = if (currentGpsCoords != null) EmergencyGreen else EmergencyYellow,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                            }
                        }

                        // Activate / Go Online Button
                        Button(
                            onClick = {
                                if (selectedLocation == LocationOption.CURRENT_LOCATION) {
                                    val coords = currentGpsCoords
                                    if (coords == null || coords.first == 0.0 || coords.second == 0.0) {
                                        Toast.makeText(context, "GPS location unavailable. Please enable device GPS or select a demo location.", Toast.LENGTH_LONG).show()
                                        return@Button
                                    }
                                    viewModel.activateUnitAndGoOnline(
                                        locationType = selectedLocation.key,
                                        gpsLat = coords.first,
                                        gpsLon = coords.second
                                    )
                                } else {
                                    viewModel.activateUnitAndGoOnline(
                                        locationType = selectedLocation.key
                                    )
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = EmergencyGreen),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp),
                            enabled = !isLoading
                        ) {
                            if (isLoading) {
                                CircularProgressIndicator(color = TacticalBg, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("ACTIVATING UNIT...", color = TacticalBg, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            } else {
                                Text("GO ONLINE & START DUTY", color = TacticalBg, fontWeight = FontWeight.Bold, fontSize = 14.sp, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }
                }
            }
        }

        // --- Active Fleet in System Section ---
        if (allTeams.isNotEmpty()) {
            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "ACTIVE UNITS IN FLEET (${allTeams.size})",
                color = TacticalTextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(8.dp))

            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                allTeams.forEach { team ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = TacticalCard),
                        border = androidx.compose.foundation.BorderStroke(1.dp, TacticalBorder),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.selectTeam(team.teamId) }
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = team.teamId + if (!team.driverName.isNullOrBlank()) " - ${team.driverName}" else "",
                                    color = EmergencyBlue,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                                Text(
                                    text = "${team.typeDisplayName} • ${team.station}",
                                    color = TacticalTextSecondary,
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                            StatusBadge(status = team.status)
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        // Server URL Footer Pill
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
