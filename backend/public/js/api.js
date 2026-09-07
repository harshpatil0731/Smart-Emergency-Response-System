/**
 * Emergency Response System - REST API Client
 * Facilitates all HTTP communication with the Node.js / C++ Engine backend.
 */

const Api = {
  baseUrl: window.location.origin,

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {})
      }
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }
      return data;
    } catch (err) {
      console.error(`[API Error] ${options.method || 'GET'} ${endpoint}:`, err);
      throw err;
    }
  },

  // Get full system snapshot (nodes, roads, teams, emergencies, assignments)
  async getState() {
    return this.request('/api/state');
  },

  // Get individual team details & active assignment
  async getTeam(teamId) {
    return this.request(`/api/teams/${encodeURIComponent(teamId)}`);
  },

  // Report an emergency
  async reportEmergency(emergencyData) {
    return this.request('/api/emergencies', {
      method: 'POST',
      body: JSON.stringify(emergencyData)
    });
  },

  // Toggle or set road status ('OPEN' | 'BLOCKED')
  async setRoadStatus(roadId, status) {
    return this.request(`/api/roads/${encodeURIComponent(roadId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  },

  // Update team status ('AVAILABLE' | 'BUSY' | 'OFFLINE')
  async setTeamStatus(teamId, status) {
    return this.request(`/api/teams/${encodeURIComponent(teamId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  },

  // Update team location (GPS / Node ID)
  async setTeamLocation(teamId, nodeId, lat = 0, lon = 0) {
    return this.request(`/api/teams/${encodeURIComponent(teamId)}/location`, {
      method: 'POST',
      body: JSON.stringify({ nodeId, lat, lon })
    });
  },

  // Accept an emergency assignment
  async acceptAssignment(assignmentId) {
    return this.request(`/api/assignments/${encodeURIComponent(assignmentId)}/accept`, {
      method: 'POST'
    });
  },

  // Decline an emergency assignment
  async declineAssignment(assignmentId) {
    return this.request(`/api/assignments/${encodeURIComponent(assignmentId)}/decline`, {
      method: 'POST'
    });
  },

  // Complete an active emergency
  async completeEmergency(emergencyId) {
    return this.request(`/api/emergencies/${encodeURIComponent(emergencyId)}/complete`, {
      method: 'POST'
    });
  }
};

window.Api = Api;
