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
                    val resolvedNodes = resolveNodes(reroute.newRoute)
                    locationManager.updateDemoRoute(resolvedNodes)
                }
            }
        }

        // Collect active assignment and emergency
        viewModelScope.launch {
            repository.activeAssignment.collect { assignment ->
                _activeAssignment.value = assignment
                if (assignment != null) {
                    val resolved = resolveNodes(assignment.route)
                    locationManager.updateDemoRoute(resolved)
                    if (_currentScreen.value != AppScreen.ActiveTransit) {
                        _currentScreen.value = AppScreen.ActiveTransit
                    }
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
    }

    fun stepDemoForward() {
        val node = locationManager.stepNextDemoNode()
        if (node != null) {
            _statusMessage.value = "Advanced to node " + node.id + " (" + node.displayName + ")"
        }
    }

    fun stepDemoBackward() {
        val node = locationManager.stepPrevDemoNode()
        if (node != null) {
            _statusMessage.value = "Back to node " + node.id + " (" + node.displayName + ")"
        }
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
