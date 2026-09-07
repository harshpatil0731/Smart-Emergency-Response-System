/**
 * Emergency Response System - Operator Dashboard Controller
 * Orchestrates real-time state, UI event handling, dynamic rerouting alerts,
 * triage queue updates, and fleet telemetry.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const connectionBadge = document.getElementById('connection-badge');
  const clockDisplay = document.getElementById('clock-display');
  const statActive = document.getElementById('stat-active');
  const statQueued = document.getElementById('stat-queued');
  const statDispatched = document.getElementById('stat-dispatched');
  const statResolved = document.getElementById('stat-resolved');

  const dispatchForm = document.getElementById('dispatch-form');
  const inputType = document.getElementById('em-type');
  const inputSeverity = document.getElementById('em-severity');
  const inputPriority = document.getElementById('em-priority');
  const selectNode = document.getElementById('em-node');
  const inputInjured = document.getElementById('em-injured');
  const inputLat = document.getElementById('em-lat');
  const inputLon = document.getElementById('em-lon');

  const roadListContainer = document.getElementById('road-list-container');
  const rerouteBanner = document.getElementById('reroute-banner');
  const rerouteText = document.getElementById('reroute-text');
  const reroutePath = document.getElementById('reroute-path');
  const rerouteCloseBtn = document.getElementById('reroute-close-btn');

  const queueTableBody = document.getElementById('queue-table-body');
  const fleetCardsContainer = document.getElementById('fleet-cards-container');
  const eventLogBox = document.getElementById('event-log-box');

  // Application State
  let appState = {
    nodes: [],
    roads: [],
    teams: [],
    emergencies: [],
    assignments: []
  };

  let rerouteTimer = null;

  // Initialize Real Leaflet Map Controller (Phase 2.2.1)
  const cityMap = new CityMapController('city-map', {
    onRoadToggle: async (roadId, nextStatus) => {
      addLogEntry('info', `Operator toggled road ${roadId} to ${nextStatus}`);
      try {
        await Api.setRoadStatus(roadId, nextStatus);
      } catch (err) {
        addLogEntry('danger', `Failed to toggle road ${roadId}: ${err.message}`);
      }
    },
    onNodeSelect: (node) => {
      if (selectNode) {
        selectNode.value = node.id;
        inputLat.value = node.lat.toFixed(4);
        inputLon.value = node.lon.toFixed(4);
        addLogEntry('info', `Selected node ${node.id} on map`);
      }
    },
    onEmergencyResolve: async (emId) => {
      try {
        await Api.completeEmergency(emId);
        addLogEntry('success', `Incident ${emId} marked resolved.`);
      } catch (err) {
        addLogEntry('danger', `Failed to resolve incident ${emId}: ${err.message}`);
      }
    }
  });

  // Global helper for popups
  window.dashboard = {
    selectNode: (nodeId) => {
      const node = appState.nodes.find(n => n.id === nodeId);
      if (node && selectNode) {
        selectNode.value = node.id;
        inputLat.value = node.lat.toFixed(4);
        inputLon.value = node.lon.toFixed(4);
        addLogEntry('info', `Selected node ${node.id} from map popup`);
      }
    }
  };

  // Clock Update
  function updateClock() {
    const now = new Date();
    clockDisplay.textContent = now.toLocaleTimeString('en-US', { hour12: false }) + ' UTC';
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Audit / Event Log Helper
  function addLogEntry(type, message) {
    const entry = document.createElement('div');
    entry.className = 'event-log-entry';

    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const tagClass = type || 'info';
    const tagLabel = tagClass.toUpperCase();

    entry.innerHTML = `
      <span class="event-time">[${time}]</span>
      <span class="event-type-tag ${tagClass}">[${tagLabel}]</span>
      <span>${escapeHtml(message)}</span>
    `;

    eventLogBox.appendChild(entry);
    eventLogBox.scrollTop = eventLogBox.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Trigger Dynamic Reroute Alert
  function triggerRerouteAlert(roadId, rerouteData, oldRouteNodes = []) {
    if (!rerouteData || !rerouteData.nodeIds) return;

    const newPathStr = rerouteData.nodeIds.map(id => id.replace(/_/g, ' ')).join(' &rarr; ');
    const oldPathStr = (oldRouteNodes && oldRouteNodes.length > 0)
      ? oldRouteNodes.map(id => id.replace(/_/g, ' ')).join(' &rarr; ')
      : 'Previous active path';

    rerouteText.innerHTML = `
      <strong>⚠ ROUTE BLOCKED:</strong> Road <code>${roadId}</code> blocked.<br>
      <span style="font-size: 0.76rem; color: #f1f5f9;">Dijkstra recalculated route from vehicle's current position.</span><br>
      <span style="font-size: 0.72rem; color: #94a3b8; text-decoration: line-through;">Old: ${oldPathStr}</span>
    `;
    reroutePath.innerHTML = `New C++ Route: <strong>${newPathStr}</strong> (Revised Distance: <strong>${rerouteData.totalDistanceKm} km</strong>)`;

    rerouteBanner.classList.add('show');
    addLogEntry('warn', `Dynamic Reroute Triggered! Old: [${oldRouteNodes.join(' -> ')}] -> New: [${rerouteData.nodeIds.join(' -> ')}] (${rerouteData.totalDistanceKm} km)`);

    if (rerouteTimer) clearTimeout(rerouteTimer);
    rerouteTimer = setTimeout(() => {
      rerouteBanner.classList.remove('show');
    }, 14000);
  }

  rerouteCloseBtn.addEventListener('click', () => {
    rerouteBanner.classList.remove('show');
    if (rerouteTimer) clearTimeout(rerouteTimer);
  });

  // Render Functions
  function updateMetrics() {
    const active = appState.emergencies.filter(e => e.status !== 'COMPLETED').length;
    const queued = appState.emergencies.filter(e => e.status === 'PENDING').length;
    const dispatched = appState.teams.filter(t => t.status === 'BUSY').length;
    const resolved = appState.emergencies.filter(e => e.status === 'COMPLETED').length;

    statActive.textContent = active;
    statQueued.textContent = queued;
    statDispatched.textContent = dispatched;
    statResolved.textContent = resolved;
  }

  function populateNodeSelector() {
    if (!selectNode) return;
    const currentVal = selectNode.value;
    selectNode.innerHTML = '<option value="">-- Select Destination Node --</option>';

    appState.nodes.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = `${n.id.replace(/_/g, ' ')} (${n.lat.toFixed(3)}, ${n.lon.toFixed(3)})`;
      selectNode.appendChild(opt);
    });

    if (currentVal && appState.nodes.some(n => n.id === currentVal)) {
      selectNode.value = currentVal;
    } else if (appState.nodes.length > 0) {
      selectNode.value = appState.nodes[0].id;
      inputLat.value = appState.nodes[0].lat.toFixed(4);
      inputLon.value = appState.nodes[0].lon.toFixed(4);
    }
  }

  selectNode.addEventListener('change', () => {
    const n = appState.nodes.find(item => item.id === selectNode.value);
    if (n) {
      inputLat.value = n.lat.toFixed(4);
      inputLon.value = n.lon.toFixed(4);
    }
  });

  function renderRoadControls() {
    roadListContainer.innerHTML = '';
    if (appState.roads.length === 0) {
      roadListContainer.innerHTML = '<div class="empty-state">No roads configured</div>';
      return;
    }

    appState.roads.forEach(road => {
      const isBlocked = road.status === 'BLOCKED';
      const item = document.createElement('div');
      item.className = 'road-item';
      item.innerHTML = `
        <div class="road-info">
          <span class="road-name">${road.id} (${road.distanceKm} km)</span>
          <span class="road-endpoints">${road.u.replace(/_/g, ' ')} &harr; ${road.v.replace(/_/g, ' ')}</span>
        </div>
        <button class="road-toggle-btn ${isBlocked ? 'is-blocked' : 'is-open'}" data-road="${road.id}">
          ${isBlocked ? 'BLOCKED ⛔' : 'OPEN 🟢'}
        </button>
      `;

      const btn = item.querySelector('.road-toggle-btn');
      btn.addEventListener('click', async () => {
        const nextStatus = isBlocked ? 'OPEN' : 'BLOCKED';
        btn.disabled = true;
        try {
          await Api.setRoadStatus(road.id, nextStatus);
        } catch (err) {
          addLogEntry('danger', `Failed to toggle road ${road.id}: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      });

      roadListContainer.appendChild(item);
    });
  }

  function renderTriageQueue() {
    queueTableBody.innerHTML = '';

    const priorityOrder = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    // Sort emergencies by priority (highest first), then severity
    const sorted = [...appState.emergencies].sort((a, b) => {
      // Completed at the bottom
      if (a.status === 'COMPLETED' && b.status !== 'COMPLETED') return 1;
      if (a.status !== 'COMPLETED' && b.status === 'COMPLETED') return -1;
      const pa = priorityOrder[a.priority] || 0;
      const pb = priorityOrder[b.priority] || 0;
      if (pb !== pa) return pb - pa;
      return (b.severity || 0) - (a.severity || 0);
    });

    if (sorted.length === 0) {
      queueTableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No incidents logged</td></tr>';
      return;
    }

    sorted.forEach(em => {
      const tr = document.createElement('tr');
      const pClass = (em.priority || 'low').toLowerCase();
      const sClass = (em.status || 'pending').toLowerCase();

      // Find active assignment if any
      const asg = appState.assignments.find(a => a.emergencyId === em.id && a.status !== 'COMPLETED');
      const assignedUnit = asg ? `<span style="color:var(--accent-cyan); font-weight:bold;">${asg.teamId}</span>` : '<span style="color:var(--text-muted);">&mdash;</span>';

      const actionBtn = (em.status !== 'COMPLETED')
        ? `<button class="btn-mini complete" data-id="${em.id}">Resolve</button>`
        : `<span style="color:var(--accent-green); font-size:0.7rem; font-family:var(--font-mono);">&check; Done</span>`;

      tr.innerHTML = `
        <td style="font-family:var(--font-mono); font-weight:bold;">${em.id}</td>
        <td>${em.type}</td>
        <td>${em.nodeId.replace(/_/g, ' ')}</td>
        <td><span class="badge-priority ${pClass}">${em.priority} (S${em.severity})</span></td>
        <td>${assignedUnit}</td>
        <td>${actionBtn}</td>
      `;

      const resolveBtn = tr.querySelector('.btn-mini.complete');
      if (resolveBtn) {
        resolveBtn.addEventListener('click', async () => {
          resolveBtn.disabled = true;
          try {
            await Api.completeEmergency(em.id);
            addLogEntry('success', `Incident ${em.id} resolved by operator.`);
          } catch (err) {
            addLogEntry('danger', `Failed to resolve incident ${em.id}: ${err.message}`);
            resolveBtn.disabled = false;
          }
        });
      }

      queueTableBody.appendChild(tr);
    });
  }

  function renderFleetStatus() {
    fleetCardsContainer.innerHTML = '';
    if (appState.teams.length === 0) {
      fleetCardsContainer.innerHTML = '<div class="empty-state">No units registered</div>';
      return;
    }

    appState.teams.forEach(team => {
      const card = document.createElement('div');
      card.className = 'team-card';

      let icon = '🚑';
      if (team.type === 'FIRE_BRIGADE') icon = '🚒';
      if (team.type === 'RESCUE_TEAM') icon = '🛟';

      const sClass = (team.status || 'available').toLowerCase();

      // Find active assignment
      const asg = (team.activeAssignmentId && appState.assignments)
        ? appState.assignments.find(a => a.id === team.activeAssignmentId)
        : null;

      const missionInfo = asg
        ? `<span style="color:var(--accent-cyan);">Mission ${asg.emergencyId} (${asg.routeDistanceKm}km)</span>`
        : '<span style="color:var(--text-muted);">Standby at station</span>';

      card.innerHTML = `
        <div class="team-card-header">
          <span class="team-id-name">${icon} ${team.id}</span>
          <span class="team-status-pill ${sClass}">${team.status}</span>
        </div>
        <div class="team-details">
          <div><strong>Station:</strong> ${team.nodeId.replace(/_/g, ' ')}</div>
          <div><strong>Status:</strong> ${missionInfo}</div>
        </div>
        <div class="team-actions">
          <button class="btn-mini status-toggle" data-team="${team.id}">
            ${team.status === 'OFFLINE' ? 'Activate' : 'Set Standby'}
          </button>
        </div>
      `;

      const toggleBtn = card.querySelector('.status-toggle');
      toggleBtn.addEventListener('click', async () => {
        const nextStatus = team.status === 'OFFLINE' ? 'AVAILABLE' : 'OFFLINE';
        try {
          await Api.setTeamStatus(team.id, nextStatus);
          addLogEntry('info', `Unit ${team.id} status changed to ${nextStatus}`);
        } catch (err) {
          addLogEntry('danger', `Failed to update unit ${team.id} status: ${err.message}`);
        }
      });

      fleetCardsContainer.appendChild(card);
    });
  }

  function renderAll() {
    updateMetrics();
    renderRoadControls();
    renderTriageQueue();
    renderFleetStatus();
    if (cityMap) cityMap.setData(appState);
  }

  // Dispatch Form Submission
  dispatchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = inputType.value;
    const severity = parseInt(inputSeverity.value, 10);
    const priority = inputPriority.value;
    const nodeId = selectNode.value;
    const injuredCount = parseInt(inputInjured.value, 10);
    const lat = parseFloat(inputLat.value) || 0;
    const lon = parseFloat(inputLon.value) || 0;

    if (!nodeId) {
      alert('Please select a destination graph node.');
      return;
    }

    const payload = {
      type,
      priority,
      severity,
      nodeId,
      injuredCount,
      lat,
      lon
    };

    const submitBtn = dispatchForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Allocating Unit...';

    try {
      addLogEntry('info', `Transmitting Emergency Intake [${priority} ${type}] at ${nodeId}...`);
      const result = await Api.reportEmergency(payload);

      if (result.allocatedTeamId) {
        addLogEntry('success', `Triage Success: Dispatched Unit ${result.allocatedTeamId} (Distance: ${result.distanceKm} km)`);
      } else {
        addLogEntry('warn', `Emergency queued in Priority Heap. All compatible units are currently BUSY.`);
      }

      // Reset form fields
      inputInjured.value = 1;
    } catch (err) {
      addLogEntry('danger', `Emergency Dispatch Error: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🚨</span> DISPATCH EMERGENCY';
    }
  });

  // WebSocket Connection Handling
  socketClient.onStatus((status) => {
    connectionBadge.className = `connection-badge ${status}`;
    if (status === 'connected') {
      connectionBadge.innerHTML = '<span class="pulse-dot"></span> LIVE BUS CONNECTED';
      addLogEntry('success', 'Connected to Emergency WebSocket Bus.');
    } else if (status === 'connecting') {
      connectionBadge.innerHTML = '<span class="pulse-dot"></span> RECONNECTING...';
    } else {
      connectionBadge.innerHTML = '<span class="pulse-dot"></span> OFFLINE';
      addLogEntry('danger', 'Lost connection to Emergency WebSocket Bus.');
    }
  });

  socketClient.onMessage((msg) => {
    if (msg.type === 'INITIAL_STATE') {
      if (msg.data) {
        appState = msg.data;
        populateNodeSelector();
        renderAll();
        addLogEntry('info', `System snapshot loaded: ${appState.nodes.length} nodes, ${appState.roads.length} roads, ${appState.teams.length} teams.`);
      }
    } else if (msg.type === 'SNAPSHOT_UPDATED') {
      // Capture prior active route for alert comparison
      let oldRouteNodes = [];
      if (msg.eventType === 'ROAD_STATUS_CHANGED' && msg.reroute) {
        if (appState.assignments && appState.assignments.length > 0) {
          const activeAsg = appState.assignments.find(a => a.status !== 'COMPLETED' && a.routeNodes);
          if (activeAsg) oldRouteNodes = [...activeAsg.routeNodes];
        }
      }

      if (msg.data) {
        appState = msg.data;
        renderAll();
      }

      // Handle specific event notifications
      if (msg.eventType === 'ROAD_STATUS_CHANGED') {
        addLogEntry('warn', `Road ${msg.roadId} updated to ${msg.status}`);
        if (msg.reroute) {
          if (cityMap) cityMap.highlightReroute(msg.reroute);
          triggerRerouteAlert(msg.roadId, msg.reroute, oldRouteNodes);
        }
      } else if (msg.eventType === 'TEAM_LOCATION_UPDATED') {
        addLogEntry('info', `Unit ${msg.teamId} moved (Node: ${msg.nodeId || 'transit'})`);
        if (cityMap) cityMap.updateTeamLocation(msg.teamId, msg.lat, msg.lon, msg.nodeId);
      } else if (msg.eventType === 'EMERGENCY_REPORTED') {
        if (msg.allocatedTeamId) {
          addLogEntry('success', `Emergency ${msg.emergencyId} assigned to Unit ${msg.allocatedTeamId}`);
        } else {
          addLogEntry('warn', `Emergency ${msg.emergencyId} queued in Binary Heap (No units available)`);
        }
      } else if (msg.eventType === 'ASSIGNMENT_ACCEPTED') {
        addLogEntry('info', `Assignment ${msg.assignmentId} accepted by unit.`);
      } else if (msg.eventType === 'ASSIGNMENT_DECLINED') {
        addLogEntry('warn', `Assignment ${msg.assignmentId} declined! Unit freed, incident requeued in Heap.`);
      } else if (msg.eventType === 'EMERGENCY_COMPLETED') {
        addLogEntry('success', `Emergency ${msg.emergencyId} marked COMPLETED.`);
      }
    } else if (msg.type === 'ENGINE_EVENT') {
      if (msg.data && msg.data.notifications) {
        msg.data.notifications.forEach(note => {
          addLogEntry('info', `[C++ Engine] ${note}`);
        });
      }
    }
  });

  // Connect WebSocket
  socketClient.connect();

  // Initial REST fetch fallback
  Api.getState()
    .then(data => {
      if (data && data.nodes) {
        appState = data;
        populateNodeSelector();
        renderAll();
      }
    })
    .catch(err => {
      console.warn('Initial REST fetch waiting for backend server:', err.message);
    });
});
