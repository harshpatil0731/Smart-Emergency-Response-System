package com.smarte.response.data.repository

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.smarte.response.data.api.AppConfig
import com.smarte.response.data.api.EmergencyApiClient
import com.smarte.response.data.model.Assignment
import com.smarte.response.data.model.CityNode
import com.smarte.response.data.model.ConnectionStatus
import com.smarte.response.data.model.Emergency
import com.smarte.response.data.model.RerouteData
import com.smarte.response.data.model.ResponseTeam
import com.smarte.response.data.model.SnapshotResponse
import com.smarte.response.data.model.WebSocketEvent
import com.smarte.response.data.websocket.EmergencyWebSocketClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Repository orchestrating state, API calls, WebSocket events, and local team persistence.
 */
class EmergencyRepository(
    private val context: Context,
    private val apiClient: EmergencyApiClient = EmergencyApiClient(),
    val webSocketClient: EmergencyWebSocketClient = EmergencyWebSocketClient()
) {
    private val TAG = "EmergencyRepo"
    private val prefs: SharedPreferences = context.getSharedPreferences("team_prefs", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(Dispatchers.IO)

    // Current Selected Team ID
    private val _currentTeamId = MutableStateFlow<String?>(prefs.getString("selected_team_id", null))
    val currentTeamId: StateFlow<String?> = _currentTeamId.asStateFlow()

    // Authenticated Driver Account Profile
    private val _driverAccount = MutableStateFlow<com.smarte.response.data.model.DriverAccount?>(loadSavedDriverAccount())
    val driverAccount: StateFlow<com.smarte.response.data.model.DriverAccount?> = _driverAccount.asStateFlow()

    private fun loadSavedDriverAccount(): com.smarte.response.data.model.DriverAccount? {
        val mobile = prefs.getString("driver_mobile", null) ?: return null
        val name = prefs.getString("driver_name", "") ?: ""
        val role = prefs.getString("driver_role", "") ?: ""
        val roleDisplay = prefs.getString("driver_role_display", "") ?: ""
        val vehicle = prefs.getString("driver_vehicle", "") ?: ""
        val unit = prefs.getString("driver_unit", "") ?: ""
        return com.smarte.response.data.model.DriverAccount(
            mobileNumber = mobile,
            driverName = name,
            role = role,
            roleDisplay = roleDisplay,
            vehicleNumber = vehicle,
            unitId = unit
        )
    }

    fun saveDriverAccount(account: com.smarte.response.data.model.DriverAccount, token: String? = null) {
        val editor = prefs.edit()
            .putString("driver_mobile", account.mobileNumber)
            .putString("driver_name", account.driverName)
            .putString("driver_role", account.role)
            .putString("driver_role_display", account.roleDisplay)
            .putString("driver_vehicle", account.vehicleNumber)
            .putString("driver_unit", account.unitId)
        if (!token.isNullOrBlank()) {
            editor.putString("auth_token", token)
            apiClient.setAuthToken(token)
        }
        editor.apply()
        _driverAccount.value = account
    }

    fun clearSavedDriverAccount() {
        prefs.edit()
            .remove("driver_mobile")
            .remove("driver_name")
            .remove("driver_role")
            .remove("driver_role_display")
            .remove("driver_vehicle")
            .remove("driver_unit")
            .remove("auth_token")
            .apply()
        apiClient.setAuthToken(null)
        _driverAccount.value = null
    }

    // Current Team Details
    private val _team = MutableStateFlow<ResponseTeam?>(null)
    val team: StateFlow<ResponseTeam?> = _team.asStateFlow()
    val activeTeam: StateFlow<ResponseTeam?> = _team.asStateFlow()

    // Active Assignment Details
    private val _activeAssignment = MutableStateFlow<Assignment?>(null)
    val activeAssignment: StateFlow<Assignment?> = _activeAssignment.asStateFlow()

    // Active Emergency Details
    private val _activeEmergency = MutableStateFlow<Emergency?>(null)
    val activeEmergency: StateFlow<Emergency?> = _activeEmergency.asStateFlow()

    // Incoming Assignment Alert (When a new emergency is offered to this team)
    private val _incomingAssignment = MutableStateFlow<Assignment?>(null)
    val incomingAssignment: StateFlow<Assignment?> = _incomingAssignment.asStateFlow()
    val pendingAssignment: StateFlow<Assignment?> = _incomingAssignment.asStateFlow()

    // Dynamic Reroute Alert
    private val _rerouteAlert = MutableStateFlow<RerouteData?>(null)
    val rerouteAlert: StateFlow<RerouteData?> = _rerouteAlert.asStateFlow()
    val rerouteEvent: StateFlow<RerouteData?> = _rerouteAlert.asStateFlow()

    // All available teams from city snapshot
    private val _availableTeams = MutableStateFlow<List<ResponseTeam>>(emptyList())
    val availableTeams: StateFlow<List<ResponseTeam>> = _availableTeams.asStateFlow()

    // All city nodes
    private val _allNodes = MutableStateFlow<List<CityNode>>(emptyList())
    val allNodes: StateFlow<List<CityNode>> = _allNodes.asStateFlow()

    val connectionStatus: StateFlow<ConnectionStatus> = webSocketClient.connectionStatus

    init {
        // Guarantee persistent configuration is loaded
        AppConfig.init(context)

        // Restore auth token for secure authenticated requests
        val savedToken = prefs.getString("auth_token", null)
        if (!savedToken.isNullOrBlank()) {
            apiClient.setAuthToken(savedToken)
        }

        // Collect WebSocket events
        scope.launch {
            webSocketClient.events.collect { event ->
                handleWebSocketEvent(event)
            }
        }

        // On connection re-establishment, reconcile state
        scope.launch {
            webSocketClient.connectionStatus.collect { status ->
                if (status == ConnectionStatus.CONNECTED) {
                    refreshState()
                }
            }
        }
    }

    suspend fun refreshSnapshot(): SnapshotResponse? {
        val res = apiClient.getState()
        return if (res.isSuccess) {
            val snapshot = res.getOrNull()
            if (snapshot != null) {
                snapshot.teams?.let { _availableTeams.value = it }
                snapshot.nodes?.let { _allNodes.value = it }
                val teamId = _currentTeamId.value
                if (teamId != null) {
                    snapshot.teams?.find { it.id == teamId }?.let { _team.value = it }
                    val asg = snapshot.assignments?.find {
                        it.teamId == teamId && (it.status == "OFFERED" || it.status == "ACCEPTED" || it.status == "ASSIGNED")
                    }
                    _activeAssignment.value = asg
                    if (asg != null) {
                        _activeEmergency.value = snapshot.emergencies?.find { it.id == asg.emergencyId }
                        if (asg.status == "OFFERED") _incomingAssignment.value = asg
                    }
                }
            }
            snapshot
        } else null
    }

    suspend fun registerDriverAccount(requestData: com.smarte.response.data.model.DriverRegisterRequest): Result<com.smarte.response.data.model.DriverAuthResponse> {
        val res = apiClient.registerDriverAccount(requestData)
        return if (res.isSuccess) {
            val authResp = res.getOrNull()
            val driver = authResp?.driver
            if (driver != null) {
                saveDriverAccount(driver, authResp.token)
                Result.success(authResp)
            } else {
                Result.failure(Exception("Driver account creation failed"))
            }
        } else {
            Result.failure(res.exceptionOrNull() ?: Exception("Failed to register driver"))
        }
    }

    suspend fun loginDriver(requestData: com.smarte.response.data.model.DriverLoginRequest): Result<com.smarte.response.data.model.DriverAuthResponse> {
        val res = apiClient.loginDriver(requestData)
        return if (res.isSuccess) {
            val authResp = res.getOrNull()
            val driver = authResp?.driver
            if (driver != null) {
                saveDriverAccount(driver, authResp.token)
                if (authResp.isOnline && authResp.team != null) {
                    _currentTeamId.value = authResp.team.id
                    prefs.edit().putString("selected_team_id", authResp.team.id).apply()
                    _team.value = authResp.team
                    webSocketClient.connect()
                    refreshSnapshot()
                }
                Result.success(authResp)
            } else {
                Result.failure(Exception("Driver login failed"))
            }
        } else {
            Result.failure(res.exceptionOrNull() ?: Exception("Failed to login"))
        }
    }

    suspend fun activateDriverUnit(
        locationType: String,
        lat: Double? = null,
        lon: Double? = null
    ): Result<ResponseTeam> {
        val driver = _driverAccount.value ?: return Result.failure(Exception("No active driver account"))
        val req = com.smarte.response.data.model.DriverActivateRequest(
            mobileNumber = driver.mobileNumber,
            unitId = driver.unitId,
            locationType = locationType,
            lat = lat,
            lon = lon
        )
        val res = apiClient.activateDriver(req)
        return if (res.isSuccess) {
            val team = res.getOrNull()?.team
            if (team != null) {
                _currentTeamId.value = team.id
                prefs.edit().putString("selected_team_id", team.id).apply()
                _team.value = team
                webSocketClient.connect()
                refreshSnapshot()
                Result.success(team)
            } else {
                Result.failure(Exception("Activation did not return team details"))
            }
        } else {
            Result.failure(res.exceptionOrNull() ?: Exception("Failed to activate unit"))
        }
    }

    suspend fun registerTeam(requestData: com.smarte.response.data.model.RegisterTeamRequest): Result<ResponseTeam> {
        val res = apiClient.registerTeam(requestData)
        return if (res.isSuccess) {
            val regResp = res.getOrNull()
            val team = regResp?.team
            if (team != null) {
                _currentTeamId.value = team.id
                prefs.edit().putString("selected_team_id", team.id).apply()
                _team.value = team
                webSocketClient.connect()
                refreshSnapshot()
                Result.success(team)
            } else {
                Result.failure(Exception("Registration did not return team details"))
            }
        } else {
            Result.failure(res.exceptionOrNull() ?: Exception("Failed to register unit"))
        }
    }

    suspend fun selectTeam(teamId: String): Boolean {
        _currentTeamId.value = teamId
        prefs.edit().putString("selected_team_id", teamId).apply()
        webSocketClient.connect()
        refreshState()
        return _team.value != null || _availableTeams.value.any { it.id == teamId }
    }

    fun logout() {
        val teamId = _currentTeamId.value
        if (teamId != null) {
            scope.launch {
                try {
                    apiClient.logoutTeam(teamId)
                } catch (e: Exception) {
                    Log.w(TAG, "Remote logout warning: " + e.message)
                }
            }
        }
        _currentTeamId.value = null
        prefs.edit().remove("selected_team_id").apply()
        _team.value = null
        _activeAssignment.value = null
        _activeEmergency.value = null
        _incomingAssignment.value = null
        _rerouteAlert.value = null
        webSocketClient.disconnect()
    }

    suspend fun testServerConnection(url: String): Result<String> {
        return apiClient.testConnection(url)
    }

    fun updateBackendUrl(newUrl: String): Result<String> {
        val res = AppConfig.saveBackendUrl(context, newUrl)
        if (res.isSuccess) {
            // Reconnect WebSocket to the newly configured URL if currently in use
            if (_currentTeamId.value != null || webSocketClient.connectionStatus.value != ConnectionStatus.OFFLINE) {
                webSocketClient.disconnect()
                webSocketClient.connect()
            }
            scope.launch {
                refreshSnapshot()
            }
        }
        return res
    }

    suspend fun refreshState() {
        val teamId = _currentTeamId.value
        apiClient.getState().onSuccess { snapshot ->
            snapshot.teams?.let { _availableTeams.value = it }
            snapshot.nodes?.let { _allNodes.value = it }

            if (teamId != null) {
                val currentT = snapshot.teams?.find { it.id == teamId }
                if (currentT != null) {
                    _team.value = currentT
                }

                val asg = snapshot.assignments?.find {
                    it.teamId == teamId && (it.status == "OFFERED" || it.status == "ACCEPTED" || it.status == "ASSIGNED")
                }
                _activeAssignment.value = asg

                if (asg != null) {
                    val em = snapshot.emergencies?.find { it.id == asg.emergencyId }
                    _activeEmergency.value = em

                    if (asg.status == "OFFERED" && _team.value?.status != "BUSY") {
                        _incomingAssignment.value = asg
                    } else if (asg.status == "ACCEPTED") {
                        _incomingAssignment.value = null
                    }
                } else {
                    _activeEmergency.value = null
                    _incomingAssignment.value = null
                }
            }
        }.onFailure { e ->
            Log.e(TAG, "Error fetching state snapshot: " + e.message)
        }
    }

    private fun handleWebSocketEvent(event: WebSocketEvent) {
        val myTeamId = _currentTeamId.value ?: return

        if (event.type == "SNAPSHOT_UPDATED" && event.data != null) {
            val snapshot = event.data
            snapshot.teams?.let { _availableTeams.value = it }
            snapshot.nodes?.let { _allNodes.value = it }

            val myTeam = snapshot.teams?.find { it.id == myTeamId }
            if (myTeam != null) {
                _team.value = myTeam
            }

            val asg = snapshot.assignments?.find {
                it.teamId == myTeamId && (it.status == "OFFERED" || it.status == "ACCEPTED" || it.status == "ASSIGNED")
            }
            _activeAssignment.value = asg

            if (asg != null) {
                val em = snapshot.emergencies?.find { it.id == asg.emergencyId }
                _activeEmergency.value = em
                if (asg.status == "OFFERED") {
                    _incomingAssignment.value = asg
                } else if (asg.status == "ACCEPTED") {
                    _incomingAssignment.value = null
                }
            } else {
                _activeEmergency.value = null
                _incomingAssignment.value = null
            }
        }

        when (event.eventType) {
            "EMERGENCY_REPORTED" -> {
                if (event.allocatedTeamId == myTeamId) {
                    scope.launch { refreshState() }
                }
            }
            "ROAD_STATUS_CHANGED" -> {
                if (event.reroute != null && _activeAssignment.value != null) {
                    val newReroute = event.reroute
                    if (newReroute.nodeIds.isNotEmpty()) {
                        val cur = _activeAssignment.value
                        if (cur != null) {
                            _activeAssignment.value = cur.copy(
                                routeDistanceKm = newReroute.totalDistanceKm,
                                routeNodes = newReroute.nodeIds,
                                etaMinutes = newReroute.etaMinutes
                            )
                        }
                        _rerouteAlert.value = newReroute
                    }
                }
            }
            "ASSIGNMENT_DECLINED" -> {
                if (event.teamId == myTeamId || _incomingAssignment.value?.id == event.assignmentId) {
                    _incomingAssignment.value = null
                    scope.launch { refreshState() }
                }
            }
            "ASSIGNMENT_ACCEPTED" -> {
                if (event.teamId == myTeamId || _incomingAssignment.value?.id == event.assignmentId) {
                    _incomingAssignment.value = null
                    scope.launch { refreshState() }
                }
            }
            "EMERGENCY_COMPLETED" -> {
                if (_activeEmergency.value?.id == event.emergencyId) {
                    _activeAssignment.value = null
                    _activeEmergency.value = null
                    _incomingAssignment.value = null
                    _rerouteAlert.value = null
                    scope.launch { refreshState() }
                }
            }
        }
    }

    suspend fun updateStatus(status: String): Boolean {
        val teamId = _currentTeamId.value ?: return false
        val res = apiClient.updateTeamStatus(teamId, status)
        if (res.isSuccess) {
            refreshState()
            return true
        }
        return false
    }

    suspend fun sendLocationUpdate(lat: Double, lon: Double): Boolean {
        val teamId = _currentTeamId.value ?: return false
        val nodeId = _team.value?.nodeId ?: "N1"
        val res = apiClient.updateTeamLocation(teamId, nodeId, lat, lon)
        return res.isSuccess
    }

    suspend fun acceptAssignment(assignmentId: String): Boolean {
        val res = apiClient.acceptAssignment(assignmentId)
        if (res.isSuccess) {
            _incomingAssignment.value = null
            refreshState()
            return true
        }
        return false
    }

    suspend fun declineAssignment(assignmentId: String, reason: String = "Driver unavailable"): Boolean {
        val res = apiClient.declineAssignment(assignmentId, reason)
        if (res.isSuccess) {
            _incomingAssignment.value = null
            refreshState()
            return true
        }
        return false
    }

    suspend fun completeEmergency(emergencyId: String): Boolean {
        val res = apiClient.completeEmergency(emergencyId)
        if (res.isSuccess) {
            _activeAssignment.value = null
            _activeEmergency.value = null
            _incomingAssignment.value = null
            _rerouteAlert.value = null
            refreshState()
            return true
        }
        return false
    }

    fun dismissIncomingAlert() {
        _incomingAssignment.value = null
    }

    fun dismissRerouteAlert() {
        _rerouteAlert.value = null
    }

    fun destroy() {
        webSocketClient.disconnect()
    }
}
