/**
 * Emergency Response System - Resilient WebSocket Client
 * Connects to ws://<host>/ws with auto-reconnection and event dispatching.
 */

class RealtimeSocket {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 10000;
    this.baseReconnectDelay = 1000;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.status = 'connecting'; // 'connected' | 'connecting' | 'offline'
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this._setStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected to Emergency Response Bus');
        this.reconnectAttempts = 0;
        this._setStatus('connected');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this._notifyListeners(payload);
        } catch (err) {
          console.error('[WebSocket] Malformed message received:', event.data, err);
        }
      };

      this.ws.onclose = () => {
        console.warn('[WebSocket] Connection closed. Scheduling reconnect...');
        this._setStatus('connecting');
        this._scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WebSocket] Socket error:', err);
        this._setStatus('offline');
        this.ws.close();
      };
    } catch (err) {
      console.error('[WebSocket] Connection setup failed:', err);
      this._setStatus('offline');
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.baseReconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.maxReconnectDelay);
    console.log(`[WebSocket] Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  _setStatus(newStatus) {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this.statusListeners.forEach((fn) => {
      try { fn(newStatus); } catch (e) { console.error(e); }
    });
  }

  _notifyListeners(payload) {
    this.listeners.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }

  onMessage(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onStatus(callback) {
    this.statusListeners.add(callback);
    // Send current status immediately
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this._setStatus('offline');
  }
}

window.socketClient = new RealtimeSocket();
