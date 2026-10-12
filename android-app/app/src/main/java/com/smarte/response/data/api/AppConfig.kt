package com.smarte.response.data.api

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.net.URI

/**
 * Central configuration managing persistent backend endpoints.
 *
 * Persistence Policy:
 * 1. Stored persistently in SharedPreferences ("emergency_app_config").
 * 2. On first launch only, initialized to DEFAULT_EMULATOR_BASE_URL (http://10.0.2.2:4000).
 * 3. Once saved by the user (or on first run), the configured URL is loaded on every launch
 *    and process restart.
 * 4. An existing saved URL is NEVER overwritten during application startup.
 * 5. Flexible for both standard Android Emulator (10.0.2.2:4000) and physical Android
 *    devices connecting to PC LAN (e.g. http://192.168.x.x:4000).
 */
object AppConfig {
    private const val TAG = "AppConfig"
    private const val PREFS_NAME = "emergency_app_config"
    private const val KEY_BASE_URL = "server_base_url"
    private const val KEY_HOST = "server_host"
    private const val KEY_PORT = "server_port"

    const val DEFAULT_PRODUCTION_BASE_URL = "https://smart-emergency-response-system-i8at.onrender.com"
    const val DEFAULT_PRODUCTION_HOST = "smart-emergency-response-system-i8at.onrender.com"
    const val DEFAULT_EMULATOR_HOST = "10.0.2.2"
    const val DEFAULT_PORT = 4000
    const val DEFAULT_EMULATOR_BASE_URL = "http://10.0.2.2:4000"

    @Volatile
    private var _baseUrl: String = DEFAULT_PRODUCTION_BASE_URL

    @Volatile
    private var isInitialized: Boolean = false

    /**
     * Active HTTP REST base URL (e.g. "http://192.168.1.13:4000" or "http://10.0.2.2:4000").
     * Always normalized without trailing slashes.
     */
    val baseUrl: String
        get() = _baseUrl

    /**
     * Active WebSocket endpoint derived dynamically from baseUrl
     * (e.g. "ws://192.168.1.13:4000/ws" or "wss://.../ws").
     */
    val wsUrl: String
        get() = getWsUrlFromBaseUrl(_baseUrl)

    /**
     * Host extracted from active baseUrl for backward compatibility.
     */
    val serverHost: String
        get() {
            return try {
                URI(_baseUrl).host ?: DEFAULT_EMULATOR_HOST
            } catch (e: Exception) {
                DEFAULT_EMULATOR_HOST
            }
        }

    /**
     * Port extracted from active baseUrl for backward compatibility.
     */
    val serverPort: Int
        get() {
            return try {
                val p = URI(_baseUrl).port
                if (p != -1) p else DEFAULT_PORT
            } catch (e: Exception) {
                DEFAULT_PORT
            }
        }

    /**
     * Initializes configuration from persistent storage on application startup.
     * Guaranteed NOT to overwrite a previously saved URL.
     */
    @Synchronized
    fun init(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedUrl = prefs.getString(KEY_BASE_URL, null)

        if (!savedUrl.isNullOrBlank()) {
            val normalized = validateAndNormalizeUrl(savedUrl).getOrDefault(savedUrl.trimEnd('/'))
            _baseUrl = normalized
            Log.i(TAG, "Loaded persisted backend URL: $_baseUrl")
        } else {
            // Check legacy keys from older builds
            val legacyHost = prefs.getString(KEY_HOST, null)
            val legacyPort = prefs.getInt(KEY_PORT, DEFAULT_PORT)
            if (!legacyHost.isNullOrBlank()) {
                val migrated = validateAndNormalizeUrl("$legacyHost:$legacyPort")
                    .getOrDefault("http://$legacyHost:$legacyPort")
                _baseUrl = migrated
                prefs.edit().putString(KEY_BASE_URL, migrated).apply()
                Log.i(TAG, "Migrated legacy host config to: $_baseUrl")
            } else {
                // FIRST LAUNCH ONLY: initialize with production Render URL and persist it
                _baseUrl = DEFAULT_PRODUCTION_BASE_URL
                prefs.edit()
                    .putString(KEY_BASE_URL, DEFAULT_PRODUCTION_BASE_URL)
                    .putString(KEY_HOST, DEFAULT_PRODUCTION_HOST)
                    .putInt(KEY_PORT, 443)
                    .apply()
                Log.i(TAG, "First launch detected: initialized default backend URL: $_baseUrl")
            }
        }
        isInitialized = true
    }

    /**
     * Validates and saves a new backend base URL to persistent storage.
     * Replaces any existing persisted URL.
     *
     * @param context Android context for SharedPreferences access.
     * @param rawInput Host/IP or full URL entered by the user.
     * @return Result containing normalized URL on success, or validation Exception on failure.
     */
    @Synchronized
    fun saveBackendUrl(context: Context, rawInput: String): Result<String> {
        val validation = validateAndNormalizeUrl(rawInput)
        if (validation.isFailure) {
            return validation
        }

        val normalized = validation.getOrThrow()
        _baseUrl = normalized

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_BASE_URL, normalized)
            .putString(KEY_HOST, serverHost)
            .putInt(KEY_PORT, serverPort)
            .apply()

        Log.i(TAG, "Saved new backend URL persistently: $_baseUrl (ws: $wsUrl)")
        return Result.success(normalized)
    }

    /**
     * Backward-compatible update helper for code supplying host and port separately.
     */
    fun updateServerConfig(context: Context, host: String, port: Int): Result<String> {
        return saveBackendUrl(context, "$host:$port")
    }

    /**
     * Validates and normalizes user input into a proper HTTP/HTTPS base URL.
     * Supports:
     * - "192.168.1.13" -> "http://192.168.1.13:4000"
     * - "192.168.1.13:4000" -> "http://192.168.1.13:4000"
     * - "http://192.168.1.13:4000/" -> "http://192.168.1.13:4000"
     * - "10.0.2.2" -> "http://10.0.2.2:4000"
     * - "https://server.domain.com:8443/api" -> "https://server.domain.com:8443/api"
     */
    fun validateAndNormalizeUrl(raw: String): Result<String> {
        val trimmed = raw.trim()
        if (trimmed.isBlank()) {
            return Result.failure(IllegalArgumentException("Backend server address cannot be empty."))
        }

        // Validate protocol if specified, or default to http://
        val withScheme = if (trimmed.contains("://")) {
            if (!trimmed.startsWith("http://", ignoreCase = true) &&
                !trimmed.startsWith("https://", ignoreCase = true)
            ) {
                return Result.failure(IllegalArgumentException("Protocol must be http:// or https://"))
            }
            trimmed
        } else {
            "http://$trimmed"
        }

        // Strip trailing slashes
        var cleaned = withScheme
        while (cleaned.endsWith("/")) {
            cleaned = cleaned.substring(0, cleaned.length - 1)
        }

        return try {
            val uri = URI(cleaned)
            val scheme = uri.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") {
                return Result.failure(IllegalArgumentException("Protocol must be http:// or https://"))
            }

            val host = uri.host
            if (host.isNullOrBlank()) {
                return Result.failure(IllegalArgumentException("Invalid host/IP address: '$cleaned'"))
            }

            val isHttps = scheme == "https"
            val port = when {
                uri.port != -1 -> uri.port
                isHttps -> 443
                host == "10.0.2.2" || host == "localhost" || host == "127.0.0.1" || host.startsWith("192.168.") -> DEFAULT_PORT
                else -> DEFAULT_PORT
            }

            if (port !in 1..65535) {
                return Result.failure(IllegalArgumentException("Port must be between 1 and 65535 (got $port)"))
            }

            val path = if (!uri.path.isNullOrBlank() && uri.path != "/") {
                uri.path.trimEnd('/')
            } else {
                ""
            }

            // Omit default port 443 for HTTPS and 80 for HTTP for clean URL formatting
            val portPart = when {
                isHttps && port == 443 -> ""
                !isHttps && port == 80 -> ""
                else -> ":$port"
            }

            val normalized = "$scheme://$host$portPart$path"
            Result.success(normalized)
        } catch (e: Exception) {
            Result.failure(IllegalArgumentException("Malformed server URL: ${e.localizedMessage ?: e.message}"))
        }
    }

    /**
     * Converts an HTTP/HTTPS URL into its corresponding WS/WSS URL with /ws path.
     */
    fun getWsUrlFromBaseUrl(httpUrl: String): String {
        val clean = httpUrl.trim().trimEnd('/')
        return if (clean.startsWith("https://", ignoreCase = true)) {
            "wss://" + clean.substring(8) + "/ws"
        } else if (clean.startsWith("http://", ignoreCase = true)) {
            "ws://" + clean.substring(7) + "/ws"
        } else {
            "ws://$clean/ws"
        }
    }
}
