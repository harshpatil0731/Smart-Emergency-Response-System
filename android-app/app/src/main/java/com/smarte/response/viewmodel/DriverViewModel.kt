package com.smarte.response.viewmodel

import android.app.Application
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.smarte.response.data.api.AppConfig
import com.smarte.response.data.model.*
import com.smarte.response.data.repository.EmergencyRepository
import com.smarte.response.location.AppLocationManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

sealed class AppScreen {
    object Login : AppScreen()
    object Dashboard : AppScreen()
    object ActiveTransit : AppScreen()
}

class DriverViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = EmergencyRepository(application.applicationContext)
    val locationManager = AppLocationManager(application.applicationContext)

    // UI States
    private val _currentScreen = MutableStateFlow<AppScreen>(AppScreen.Login)
    val currentScreen: StateFlow<AppScreen> = _currentScreen.asStateFlow()

    private val _selectedTeam = MutableStateFlow<ResponseTeam?>(null)
    val selectedTeam: StateFlow<ResponseTeam?> = _selectedTeam.asStateFlow()

    private val _allTeams = MutableStateFlow<List<ResponseTeam>>(emptyList())
    val allTeams: StateFlow<List<ResponseTeam>> = _allTeams.asStateFlow()

    private val _cityGraph = MutableStateFlow<List<CityNode>>(emptyList())
    val cityGraph: StateFlow<List<CityNode>> = _cityGraph.asStateFlow()

    private val _activeEmergency = MutableStateFlow<Emergency?>(null)
    val activeEmergency: StateFlow<Emergency?> = _activeEmergency.asStateFlow()

    private val _activeAssignment = MutableStateFlow<Assignment?>(null)
    val activeAssignment: StateFlow<Assignment?> = _activeAssignment.asStateFlow()

    private val _pendingAssignment = MutableStateFlow<Assignment?>(null)
    val pendingAssignment: StateFlow<Assignment?> = _pendingAssignment.asStateFlow()

    private val _rerouteAlert = MutableStateFlow<RerouteData?>(null)
    val rerouteAlert: StateFlow<RerouteData?> = _rerouteAlert.asStateFlow()

    private val _statusMessage = MutableStateFlow<String?>(null)
    val statusMessage: StateFlow<String?> = _statusMessage.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    val connectionState: StateFlow<ConnectionStatus> = repository.connectionStatus

    private var locationSyncJob: Job? = null
    private var currentAssignmentId: String? = null
    private var baselineRouteDistance: Double? = null
    private var baselineEtaMinutes: Int? = null

    init {
        // Collect team updates from repository
        viewModelScope.launch {
            repository.activeTeam.collect { team ->
                _selectedTeam.value = team
                if (team != null) {
                    if (team.status == "ASSIGNED" || team.status == "EN_ROUTE" || team.status == "BUSY") {
                        if (_currentScreen.value != AppScreen.ActiveTransit && repository.activeAssignment.value != null) {
                            _currentScreen.value = AppScreen.ActiveTransit
                        }
                    } else if (_currentScreen.value == AppScreen.ActiveTransit && repository.activeAssignment.value == null) {
                        _currentScreen.value = AppScreen.Dashboard
                    }
                }
            }
        }

        // Collect pending incoming assignment
        viewModelScope.launch {
            repository.pendingAssignment.collect { assignment ->
                _pendingAssignment.value = assignment
                if (assignment != null) {
                    triggerAlertFeedback()
                }
            }
        }

        // Collect reroute alerts
        viewModelScope.launch {
            repository.rerouteEvent.collect { reroute ->
                _rerouteAlert.value = reroute
                if (reroute != null) {
                    triggerAlertFeedback()
                    baselineRouteDistance = reroute.newDistance
                    baselineEtaMinutes = reroute.newEta
                    val resolvedNodes = resolveNodes(reroute.newRoute)
                    locationManager.updateDemoRoute(resolvedNodes)
                    if (locationManager.isDemoMode.value) {
                        updateRemainingTransitMetrics(locationManager.demoNodeIndex.value)
                    }
                }
            }
        }

        // Collect active assignment and emergency
        viewModelScope.launch {
            repository.activeAssignment.collect { assignment ->
                _activeAssignment.value = assignment
                if (assignment != null) {
                    if (baselineRouteDistance == null || currentAssignmentId != assignment.id) {
                        currentAssignmentId = assignment.id
                        baselineRouteDistance = assignment.routeDistanceKm
                        baselineEtaMinutes = assignment.etaMinutes
                    }
                    val resolved = resolveNodes(assignment.route)
                    locationManager.updateDemoRoute(resolved)
                    if (locationManager.isDemoMode.value) {
                        updateRemainingTransitMetrics(locationManager.demoNodeIndex.value)
                    }
                    if (_currentScreen.value != AppScreen.ActiveTransit) {
                        _currentScreen.value = AppScreen.ActiveTransit
                    }
                } else {
                    currentAssignmentId = null
                    baselineRouteDistance = null
                    baselineEtaMinutes = null
                }
            }
        }

        viewModelScope.launch {
            repository.activeEmergency.collect { emergency ->
                _activeEmergency.value = emergency
            }
        }

        // Collect location updates to send to backend
        viewModelScope.launch {
            locationManager.currentLocation.collect { loc ->
                val team = _selectedTeam.value
                if (team != null && loc != null) {
                    repository.sendLocationUpdate(loc.first, loc.second)
                }
            }
        }

        // Refresh initial snapshot
        refreshSnapshot()
    }

    fun refreshSnapshot() {
        viewModelScope.launch {
            _isLoading.value = true
            val snapshot = repository.refreshSnapshot()
            if (snapshot != null) {
                snapshot.teams?.let { _allTeams.value = it }
                snapshot.nodes?.let { _cityGraph.value = it }
            }
            _isLoading.value = false
        }
    }

    suspend fun testConnection(url: String): Result<String> {
        return repository.testServerConnection(url)
    }

    fun saveBackendUrl(url: String): Result<String> {
        val result = repository.updateBackendUrl(url)
        if (result.isSuccess) {
            _statusMessage.value = "Backend configured: ${AppConfig.baseUrl}"
            _errorMessage.value = null
        } else {
            _errorMessage.value = result.exceptionOrNull()?.message ?: "Failed to save backend URL"
        }
        return result
    }

    fun selectTeam(teamId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val success = repository.selectTeam(teamId)
            if (success) {
                val team = repository.activeTeam.value
                _selectedTeam.value = team
                if (team?.status == "ASSIGNED" || team?.status == "EN_ROUTE") {
                    _currentScreen.value = AppScreen.ActiveTransit
                } else {
                    _currentScreen.value = AppScreen.Dashboard
                }
                locationManager.startGpsUpdates()
                startLocationSyncLoop()
            } else {
                _errorMessage.value = "Failed to load details for unit " + teamId
            }
            _isLoading.value = false
        }
    }

    fun logout() {
        locationSyncJob?.cancel()
        locationManager.stopGpsUpdates()
        repository.logout()
        currentAssignmentId = null
        baselineRouteDistance = null
        baselineEtaMinutes = null
        _selectedTeam.value = null
        _activeAssignment.value = null
        _activeEmergency.value = null
        _pendingAssignment.value = null
        _currentScreen.value = AppScreen.Login
    }

    fun toggleStatus(newStatus: String) {
        val teamId = _selectedTeam.value?.teamId ?: return
        viewModelScope.launch {
            _isLoading.value = true
            val success = repository.updateStatus(newStatus)
            if (success) {
                _statusMessage.value = "Status updated to " + newStatus
            } else {
                _errorMessage.value = "Failed to update status"
            }
            _isLoading.value = false
        }
    }

    fun acceptAssignment(assignmentId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val success = repository.acceptAssignment(assignmentId)
            if (success) {
                _currentScreen.value = AppScreen.ActiveTransit
                _statusMessage.value = "Assignment accepted"
                val nodes = resolveNodes(_activeAssignment.value?.route ?: emptyList())
                locationManager.updateDemoRoute(nodes)
            } else {
                _errorMessage.value = "Failed to accept assignment"
            }
            _isLoading.value = false
        }
    }

    fun declineAssignment(assignmentId: String, reason: String = "Driver unavailable") {
        viewModelScope.launch {
            _isLoading.value = true
            val success = repository.declineAssignment(assignmentId, reason)
            if (success) {
                _statusMessage.value = "Assignment declined"
            } else {
                _errorMessage.value = "Failed to decline assignment"
            }
            _isLoading.value = false
        }
    }

    fun completeEmergency(emergencyId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val success = repository.completeEmergency(emergencyId)
            if (success) {
                _statusMessage.value = "Emergency successfully resolved"
                _currentScreen.value = AppScreen.Dashboard
                currentAssignmentId = null
                baselineRouteDistance = null
                baselineEtaMinutes = null
                locationManager.setDemoMode(false)
            } else {
                _errorMessage.value = "Failed to complete emergency"
            }
            _isLoading.value = false
        }
    }

    fun dismissRerouteAlert() {
        _rerouteAlert.value = null
    }

    fun clearMessages() {
        _statusMessage.value = null
        _errorMessage.value = null
    }

    fun setDemoMode(enabled: Boolean) {
        val routeNodes = resolveNodes(_activeAssignment.value?.route ?: emptyList())
        locationManager.setDemoMode(enabled, routeNodes)
        if (enabled) {
            updateRemainingTransitMetrics(0)
        } else {
            val cur = _activeAssignment.value
            val baseDist = baselineRouteDistance
            val baseEta = baselineEtaMinutes
            if (cur != null && baseDist != null && baseEta != null) {
                _activeAssignment.value = cur.copy(
                    routeDistanceKm = baseDist,
                    etaMinutes = baseEta
                )
            }
        }
    }

    fun stepDemoForward() {
        val node = locationManager.stepNextDemoNode()
        if (node != null) {
            updateRemainingTransitMetrics(locationManager.demoNodeIndex.value)
            _statusMessage.value = "Advanced to node " + node.id + " (" + node.displayName + ")"
        }
    }

    fun stepDemoBackward() {
        val node = locationManager.stepPrevDemoNode()
        if (node != null) {
            updateRemainingTransitMetrics(locationManager.demoNodeIndex.value)
            _statusMessage.value = "Back to node " + node.id + " (" + node.displayName + ")"
        }
    }

    private fun updateRemainingTransitMetrics(currentIndex: Int) {
        val curAsg = _activeAssignment.value ?: return
        val routeNodes = resolveNodes(curAsg.route)
        if (routeNodes.isEmpty()) return

        val fullDist = baselineRouteDistance ?: curAsg.routeDistanceKm
        val teamType = _selectedTeam.value?.type

        val (remDist, remEta) = calculateRemainingDistanceAndEta(
            nodes = routeNodes,
            currentIndex = currentIndex,
            fullDistance = fullDist,
            teamType = teamType
        )

        _activeAssignment.value = curAsg.copy(
            routeDistanceKm = remDist,
            etaMinutes = remEta
        )
    }

    private fun calculateRemainingDistanceAndEta(
        nodes: List<CityNode>,
        currentIndex: Int,
        fullDistance: Double,
        teamType: String?
    ): Pair<Double, Int> {
        if (nodes.isEmpty() || currentIndex >= nodes.size - 1) {
            return Pair(0.0, 0)
        }
        if (currentIndex <= 0) {
            val speed = getSpeedForTeam(teamType)
            val eta = baselineEtaMinutes ?: Math.max(1, Math.ceil((fullDistance * 1.1 / speed) * 60.0).toInt())
            return Pair(fullDistance, eta)
        }

        val segmentLengths = mutableListOf<Double>()
        var totalHaversine = 0.0
        for (i in 0 until nodes.size - 1) {
            val dist = haversineDistanceKm(nodes[i].lat, nodes[i].lon, nodes[i + 1].lat, nodes[i + 1].lon)
            segmentLengths.add(dist)
            totalHaversine += dist
        }

        val scale = if (totalHaversine > 0.001 && fullDistance > 0.0) fullDistance / totalHaversine else 1.0

        var remainingDist = 0.0
        for (i in currentIndex until segmentLengths.size) {
            remainingDist += segmentLengths[i] * scale
        }

        val speed = getSpeedForTeam(teamType)
        val remainingEta = if (remainingDist <= 0.05) 0 else Math.max(1, Math.ceil((remainingDist * 1.1 / speed) * 60.0).toInt())
        val roundedDist = Math.round(remainingDist * 100.0) / 100.0
        return Pair(roundedDist, remainingEta)
    }

    private fun getSpeedForTeam(teamType: String?): Double {
        return when (teamType?.uppercase()) {
            "FIRE_BRIGADE", "FIRE" -> 40.0
            "RESCUE_TEAM", "RESCUE" -> 42.0
            else -> 50.0
        }
    }

    private fun haversineDistanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
        val c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return r * c
    }

    fun resolveNodes(nodeIds: List<String>): List<CityNode> {
        val graph = _cityGraph.value
        val map = graph.associateBy { it.id }
        return nodeIds.mapNotNull { map[it] ?: CityNode(it, it, 0.0, 0.0) }
    }

    private fun startLocationSyncLoop() {
        locationSyncJob?.cancel()
        locationSyncJob = viewModelScope.launch {
            while (true) {
                delay(3000L)
                val loc = locationManager.currentLocation.value
                if (loc != null && _selectedTeam.value != null) {
                    repository.sendLocationUpdate(loc.first, loc.second)
                }
            }
        }
    }

    private fun triggerAlertFeedback() {
        try {
            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val ringtone = RingtoneManager.getRingtone(getApplication(), alarmUri)
            ringtone?.play()

            val ctx = getApplication<Application>()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = ctx.getSystemService(VibratorManager::class.java)
                vibratorManager?.defaultVibrator?.vibrate(
                    VibrationEffect.createWaveform(longArrayOf(0, 300, 200, 300), -1)
                )
            } else {
                @Suppress("DEPRECATION")
                val vibrator = ctx.getSystemService(Vibrator::class.java)
                vibrator?.vibrate(longArrayOf(0, 300, 200, 300), -1)
            }
        } catch (_: Exception) {}
    }

    override fun onCleared() {
        super.onCleared()
        locationSyncJob?.cancel()
        locationManager.stopGpsUpdates()
        repository.destroy()
    }
}
