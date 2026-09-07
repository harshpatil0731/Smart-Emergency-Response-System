package com.smarte.response.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import com.smarte.response.data.model.CityNode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AppLocationManager(private val context: Context) {

    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

    private val _currentLocation = MutableStateFlow<Pair<Double, Double>?>(null)
    val currentLocation: StateFlow<Pair<Double, Double>?> = _currentLocation.asStateFlow()

    private val _currentAccuracy = MutableStateFlow<Float?>(null)
    val currentAccuracy: StateFlow<Float?> = _currentAccuracy.asStateFlow()

    private val _isDemoMode = MutableStateFlow(false)
    val isDemoMode: StateFlow<Boolean> = _isDemoMode.asStateFlow()

    private val _demoNodeIndex = MutableStateFlow(0)
    val demoNodeIndex: StateFlow<Int> = _demoNodeIndex.asStateFlow()

    private var activeRouteNodes: List<CityNode> = emptyList()

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            if (!_isDemoMode.value) {
                _currentLocation.value = Pair(location.latitude, location.longitude)
                _currentAccuracy.value = location.accuracy
            }
        }

        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    @SuppressLint("MissingPermission")
    fun startGpsUpdates() {
        if (_isDemoMode.value) return
        try {
            val hasGps = locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true
            val hasNetwork = locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true

            if (hasGps) {
                locationManager?.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    3000L,
                    5f,
                    locationListener,
                    Looper.getMainLooper()
                )
            } else if (hasNetwork) {
                locationManager?.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    3000L,
                    5f,
                    locationListener,
                    Looper.getMainLooper()
                )
            }

            val lastGps = if (hasGps) locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER) else null
            val lastNet = if (hasNetwork) locationManager?.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) else null
            val best = lastGps ?: lastNet
            if (best != null && _currentLocation.value == null) {
                _currentLocation.value = Pair(best.latitude, best.longitude)
                _currentAccuracy.value = best.accuracy
            }
        } catch (_: SecurityException) {
        } catch (_: Exception) {
        }
    }

    fun stopGpsUpdates() {
        try {
            locationManager?.removeUpdates(locationListener)
        } catch (_: Exception) {}
    }

    fun setDemoMode(enabled: Boolean, routeNodes: List<CityNode> = emptyList()) {
        _isDemoMode.value = enabled
        activeRouteNodes = routeNodes
        _demoNodeIndex.value = 0

        if (enabled) {
            stopGpsUpdates()
            if (routeNodes.isNotEmpty()) {
                val first = routeNodes[0]
                _currentLocation.value = Pair(first.lat, first.lng)
                _currentAccuracy.value = 5.0f
            }
        } else {
            startGpsUpdates()
        }
    }

    fun updateDemoRoute(routeNodes: List<CityNode>) {
        activeRouteNodes = routeNodes
        if (_isDemoMode.value && routeNodes.isNotEmpty()) {
            val idx = _demoNodeIndex.value.coerceIn(0, routeNodes.size - 1)
            val node = routeNodes[idx]
            _currentLocation.value = Pair(node.lat, node.lng)
        }
    }

    fun stepNextDemoNode(): CityNode? {
        if (!_isDemoMode.value || activeRouteNodes.isEmpty()) return null
        val nextIdx = (_demoNodeIndex.value + 1).coerceAtMost(activeRouteNodes.size - 1)
        _demoNodeIndex.value = nextIdx
        val node = activeRouteNodes[nextIdx]
        _currentLocation.value = Pair(node.lat, node.lng)
        _currentAccuracy.value = 3.0f
        return node
    }

    fun stepPrevDemoNode(): CityNode? {
        if (!_isDemoMode.value || activeRouteNodes.isEmpty()) return null
        val prevIdx = (_demoNodeIndex.value - 1).coerceAtLeast(0)
        _demoNodeIndex.value = prevIdx
        val node = activeRouteNodes[prevIdx]
        _currentLocation.value = Pair(node.lat, node.lng)
        _currentAccuracy.value = 3.0f
        return node
    }
}
