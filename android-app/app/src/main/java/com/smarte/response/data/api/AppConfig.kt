package com.smarte.response.data.api

import android.content.Context
import android.content.SharedPreferences

/**
 * Central configuration managing backend endpoints.
 * Defaults to 10.0.2.2:4000 for standard Android Emulator.
 * Can be updated dynamically to connect to physical LAN host (e.g. 192.168.x.x:4000).
 */
object AppConfig {
    private const val PREFS_NAME = "emergency_app_config"
    private const val KEY_HOST = "server_host"
    private const val KEY_PORT = "server_port"

    const val DEFAULT_EMULATOR_HOST = "10.0.2.2"
    const val DEFAULT_PORT = 4000

    var serverHost: String = DEFAULT_EMULATOR_HOST
        private set

    var serverPort: Int = DEFAULT_PORT
        private set

    val baseUrl: String
        get() = "http://$serverHost:$serverPort"

    val wsUrl: String
        get() = "ws://$serverHost:$serverPort/ws"

    fun init(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        serverHost = prefs.getString(KEY_HOST, DEFAULT_EMULATOR_HOST) ?: DEFAULT_EMULATOR_HOST
        serverPort = prefs.getInt(KEY_PORT, DEFAULT_PORT)
    }

    fun updateServerConfig(context: Context, host: String, port: Int) {
        serverHost = host.trim()
        serverPort = port
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_HOST, serverHost)
            .putInt(KEY_PORT, serverPort)
            .apply()
    }
}
