package com.smarte.response.data.websocket

import android.util.Log
import com.google.gson.Gson
import com.smarte.response.data.api.AppConfig
import com.smarte.response.data.model.ConnectionStatus
import com.smarte.response.data.model.WebSocketEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * Resilient WebSocket Client with auto-reconnection and exponential backoff.
 */
class EmergencyWebSocketClient(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(10, TimeUnit.SECONDS)
        .build(),
    private val gson: Gson = Gson()
) {
    private val TAG = "EmergencyWS"

    private val _connectionStatus = MutableStateFlow(ConnectionStatus.OFFLINE)
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus.asStateFlow()

    private val _events = MutableSharedFlow<WebSocketEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<WebSocketEvent> = _events.asSharedFlow()

    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempts = 0
    private var shouldReconnect = true
    private val scope = CoroutineScope(Dispatchers.IO)

    fun connect() {
        shouldReconnect = true
        reconnectJob?.cancel()
        _connectionStatus.value = ConnectionStatus.CONNECTING

        val request = Request.Builder()
            .url(AppConfig.wsUrl)
            .build()

        Log.d(TAG, "Connecting to WebSocket at ${AppConfig.wsUrl}")
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket Connected successfully")
                reconnectAttempts = 0
                _connectionStatus.value = ConnectionStatus.CONNECTED
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val event = gson.fromJson(text, WebSocketEvent::class.java)
                    if (event != null) {
                        _events.tryEmit(event)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse WebSocket message: $text", e)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WebSocket Closed: code=$code, reason=$reason")
                _connectionStatus.value = ConnectionStatus.OFFLINE
                if (shouldReconnect) {
                    scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket Failure: ${t.message}")
                _connectionStatus.value = ConnectionStatus.OFFLINE
                if (shouldReconnect) {
                    scheduleReconnect()
                }
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            reconnectAttempts++
            val delaySeconds = (1L shl (reconnectAttempts.coerceAtMost(4) - 1)).coerceIn(1L, 16L)
            Log.d(TAG, "Reconnecting WebSocket in ${delaySeconds}s (attempt #$reconnectAttempts)...")
            delay(delaySeconds * 1000L)
            connect()
        }
    }

    fun disconnect() {
        shouldReconnect = false
        reconnectJob?.cancel()
        webSocket?.close(1000, "App closed")
        webSocket = null
        _connectionStatus.value = ConnectionStatus.OFFLINE
    }
}
