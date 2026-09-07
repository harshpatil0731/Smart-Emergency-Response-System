/**
 * Emergency Response System - Leaflet Map Controller
 * Phase 2.2.1 Real Map Visualization Layer
 *
 * Visualizes the Pune urban network using OpenStreetMap tiles and Leaflet.js.
 * Displays real geographic coordinates of nodes, roads, active C++ Dijkstra routes,
 * emergency hazard pins, and moving response vehicles.
 *
 * CRITICAL ARCHITECTURAL GUARANTEE:
 * - NO OSRM or external routing engine is used.
 * - The C++ engine is the sole authority for triage, allocation, and Dijkstra routes.
 * - The map strictly renders the ordered node sequences computed by the C++ engine.
 */

class CityMapController {
  constructor(containerId = 'city-map', options = {}) {
    this.containerId = containerId;
    this.map = null;
    this.options = options;

    // Feature Layer Groups for clean layer isolation
    this.layerRoads = L.layerGroup();
    this.layerRoutes = L.layerGroup();
    this.layerNodes = L.layerGroup();
    this.layerEmergencies = L.layerGroup();
    this.layerTeams = L.layerGroup();

    // Internal indexed cache
    this.nodeMap = new Map(); // id -> { id, lat, lon }
    this.teamMarkers = new Map(); // teamId -> L.marker
    this.roadPolylines = new Map(); // roadId -> L.polyline
    this.routePolylines = new Map(); // asgId -> L.polyline
    this.emergencyMarkers = new Map(); // emId -> L.marker

    this.isInitialFitDone = false;
    this.onRoadToggle = options.onRoadToggle || null;
    this.onNodeSelect = options.onNodeSelect || null;
    this.onEmergencyResolve = options.onEmergencyResolve || null;

    this.initMap();
  }

  initMap() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`[Map] Container #${this.containerId} not found`);
      return;
    }

    // Default center Pune: [18.5204, 73.8567]
    this.map = L.map(this.containerId, {
      center: [18.5204, 73.8567],
      zoom: 13,
      zoomControl: true,
      attributionControl: true
    });

    // OpenStreetMap Standard Tiles with dark tactical styling via CSS
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    // Add layer groups in order of depth (roads at bottom, routes next, nodes, emergencies, teams on top)
    this.layerRoads.addTo(this.map);
    this.layerRoutes.addTo(this.map);
    this.layerNodes.addTo(this.map);
    this.layerEmergencies.addTo(this.map);
    this.layerTeams.addTo(this.map);
  }

  // Update entire map state from snapshot
  setData(snapshot) {
    if (!snapshot) return;

    // 1. Cache nodes
    this.nodeMap.clear();
    (snapshot.nodes || []).forEach(n => this.nodeMap.set(n.id, n));

    // 2. Render Graph Nodes
    this._renderNodes(snapshot.nodes || []);

    // 3. Render Roads (Logical graph edges)
    this._renderRoads(snapshot.roads || []);

    // 4. Render Active C++ Dijkstra Routes
    this._renderRoutes(snapshot.assignments || []);

    // 5. Render Emergencies
    this._renderEmergencies(snapshot.emergencies || [], snapshot.assignments || []);

    // 6. Render Response Teams (Vehicles)
    this._renderTeams(snapshot.teams || [], snapshot.assignments || []);

    // 7. Auto-fit bounds on initial load
    if (!this.isInitialFitDone && snapshot.nodes && snapshot.nodes.length > 0) {
      const latLngs = snapshot.nodes.map(n => [n.lat, n.lon]);
      const bounds = L.latLngBounds(latLngs);
      this.map.fitBounds(bounds, { padding: [50, 50] });
      this.isInitialFitDone = true;
    }
  }

  _renderNodes(nodes) {
    this.layerNodes.clearLayers();

    nodes.forEach(node => {
      const isHospital = node.id.toLowerCase().includes('hospital') || node.id.includes('Hospital_A');
      const iconHtml = isHospital
        ? `<div class="node-marker-icon hospital"><span class="node-symbol">🏥</span><span class="node-marker-label">${node.id.replace(/_/g, ' ')}</span></div>`
        : `<div class="node-marker-icon station"><span class="node-dot"></span><span class="node-marker-label">${node.id.replace(/_/g, ' ')}</span></div>`;

      const customIcon = L.divIcon({
        className: 'custom-node-icon',
        html: iconHtml,
        iconSize: [120, 30],
        iconAnchor: [60, 15]
      });

      const marker = L.marker([node.lat, node.lon], { icon: customIcon });

      const popupHtml = `
        <div class="map-popup node-popup">
          <div class="popup-title"><strong>${node.id.replace(/_/g, ' ')}</strong></div>
          <div class="popup-detail">Node ID: <code>${node.id}</code></div>
          <div class="popup-detail">GPS: ${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}</div>
          <button class="popup-btn select-node-btn" data-node="${node.id}">Select for Dispatch</button>
        </div>
      `;
      marker.bindPopup(popupHtml);

      marker.on('popupopen', () => {
        const btn = document.querySelector(`.select-node-btn[data-node="${node.id}"]`);
        if (btn && this.onNodeSelect) {
          btn.onclick = () => {
            this.onNodeSelect(node);
            marker.closePopup();
          };
        }
      });

      this.layerNodes.addLayer(marker);
    });
  }

  _renderRoads(roads) {
    this.layerRoads.clearLayers();
    this.roadPolylines.clear();

    roads.forEach(road => {
      const uNode = this.nodeMap.get(road.u);
      const vNode = this.nodeMap.get(road.v);
      if (!uNode || !vNode) return;

      const isBlocked = road.status === 'BLOCKED';
      const latLngs = [
        [uNode.lat, uNode.lon],
        [vNode.lat, vNode.lon]
      ];

      const polyline = L.polyline(latLngs, {
        color: isBlocked ? '#ef4444' : '#10b981',
        weight: isBlocked ? 4 : 4,
        opacity: isBlocked ? 0.9 : 0.75,
        dashArray: isBlocked ? '8, 6' : null,
        className: `map-road-edge ${isBlocked ? 'road-blocked' : 'road-open'}`
      });

      // Road Popup & Interaction
      const popupHtml = `
        <div class="map-popup road-popup">
          <div class="popup-title"><strong>Road ${road.id}</strong></div>
          <div class="popup-detail">Endpoints: ${road.u.replace(/_/g, ' ')} &harr; ${road.v.replace(/_/g, ' ')}</div>
          <div class="popup-detail">Distance: <strong>${road.distanceKm} km</strong></div>
          <div class="popup-detail">Status: <span class="badge-status ${isBlocked ? 'blocked' : 'open'}" style="color:${isBlocked ? '#ef4444' : '#10b981'}; font-weight:bold;">${road.status}</span></div>
          <button class="popup-btn road-toggle-action-btn ${isBlocked ? 'unblock-btn' : 'block-btn'}" data-road="${road.id}">
            ${isBlocked ? '🔓 UNBLOCK ROAD' : '⛔ BLOCK ROAD'}
          </button>
        </div>
      `;
      polyline.bindPopup(popupHtml);

      polyline.on('popupopen', () => {
        const btn = document.querySelector(`.road-toggle-action-btn[data-road="${road.id}"]`);
        if (btn && this.onRoadToggle) {
          btn.onclick = () => {
            const nextStatus = isBlocked ? 'OPEN' : 'BLOCKED';
            this.onRoadToggle(road.id, nextStatus);
            polyline.closePopup();
          };
        }
      });

      this.roadPolylines.set(road.id, polyline);
      this.layerRoads.addLayer(polyline);
    });
  }

  /**
   * Render active routes strictly calculated by the C++ Dijkstra engine.
   * Converts each route node ID to lat/lon in the exact order returned by the C++ engine.
   */
  _renderRoutes(assignments) {
    this.layerRoutes.clearLayers();
    this.routePolylines.clear();

    assignments.forEach(asg => {
      if (asg.status === 'COMPLETED' || !asg.routeNodes || asg.routeNodes.length < 2) return;

      // Extract ordered coordinates from the C++ Dijkstra route
      const latLngs = [];
      for (const nodeId of asg.routeNodes) {
        const node = this.nodeMap.get(nodeId);
        if (node) {
          latLngs.push([node.lat, node.lon]);
        }
      }

      if (latLngs.length < 2) return;

      // Draw prominent animated polyline along C++ route
      const routePolyline = L.polyline(latLngs, {
        color: '#00e5ff',
        weight: 6,
        opacity: 0.95,
        dashArray: '10, 8',
        className: 'active-cplusplus-dijkstra-route'
      });

      const pathText = asg.routeNodes.map(id => id.replace(/_/g, ' ')).join(' &rarr; ');
      const popupHtml = `
        <div class="map-popup route-popup">
          <div class="popup-title" style="color: #00e5ff;"><strong>C++ Dijkstra Route</strong></div>
          <div class="popup-detail">Assignment ID: <code>${asg.id}</code></div>
          <div class="popup-detail">Dispatched Unit: <strong>${asg.teamId}</strong> &rarr; Incident: <strong>${asg.emergencyId}</strong></div>
          <div class="popup-detail">Shortest Path Distance: <strong>${asg.routeDistanceKm} km</strong></div>
          <div class="popup-detail" style="margin-top: 4px; font-size: 0.72rem; color: #94a3b8;">
            <strong>Path:</strong><br>${pathText}
          </div>
        </div>
      `;
      routePolyline.bindPopup(popupHtml);

      this.routePolylines.set(asg.id, routePolyline);
      this.layerRoutes.addLayer(routePolyline);
    });
  }

  _renderEmergencies(emergencies, assignments) {
    this.layerEmergencies.clearLayers();
    this.emergencyMarkers.clear();

    emergencies.forEach((em, index) => {
      if (em.status === 'COMPLETED') return;

      const node = this.nodeMap.get(em.nodeId);
      if (!node) return;

      // Small deterministic offset if multiple markers at same node
      const offsetLat = (index % 3 - 1) * 0.0015;
      const offsetLon = ((index + 1) % 3 - 1) * 0.0015;
      const emLat = (em.lat && em.lat !== 0) ? em.lat : node.lat + offsetLat;
      const emLon = (em.lon && em.lon !== 0) ? em.lon : node.lon + offsetLon;

      let iconSymbol = '🚨';
      if (em.type === 'FIRE') iconSymbol = '🔥';
      if (em.type === 'MEDICAL') iconSymbol = '🏥';
      if (em.type === 'FLOOD') iconSymbol = '🌊';
      if (em.type === 'BUILDING_COLLAPSE') iconSymbol = '🏚️';
      if (em.type === 'ACCIDENT') iconSymbol = '💥';

      const pClass = (em.priority || 'high').toLowerCase();
      const iconHtml = `
        <div class="emergency-marker-icon priority-${pClass}">
          <div class="hazard-pulse-ring"></div>
          <span class="hazard-symbol">${iconSymbol}</span>
          <span class="hazard-badge">${em.id}</span>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-emergency-icon',
        html: iconHtml,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });

      const marker = L.marker([emLat, emLon], { icon: customIcon });

      // Find active assignment
      const asg = assignments.find(a => a.emergencyId === em.id && a.status !== 'COMPLETED');
      const assignedText = asg ? `<span style="color:#00e5ff; font-weight:bold;">${asg.teamId} (ASG: ${asg.id})</span>` : '<em>Queued in Priority Heap</em>';

      const popupHtml = `
        <div class="map-popup emergency-popup">
          <div class="popup-title" style="color: #ef4444;"><strong>🚨 Incident ${em.id} (${em.type})</strong></div>
          <div class="popup-detail">Priority: <span class="badge-priority ${pClass}">${em.priority} (Severity: ${em.severity}/5)</span></div>
          <div class="popup-detail">Location: <strong>${em.nodeId.replace(/_/g, ' ')}</strong></div>
          <div class="popup-detail">Casualties / Injured: <strong>${em.injured || 0}</strong></div>
          <div class="popup-detail">Assigned Unit: ${assignedText}</div>
          <button class="popup-btn resolve-em-btn" data-id="${em.id}">✓ Resolve Incident</button>
        </div>
      `;
      marker.bindPopup(popupHtml);

      marker.on('popupopen', () => {
        const btn = document.querySelector(`.resolve-em-btn[data-id="${em.id}"]`);
        if (btn && this.onEmergencyResolve) {
          btn.onclick = () => {
            this.onEmergencyResolve(em.id);
            marker.closePopup();
          };
        }
      });

      this.emergencyMarkers.set(em.id, marker);
      this.layerEmergencies.addLayer(marker);
    });
  }

  _renderTeams(teams, assignments) {
    this.layerTeams.clearLayers();
    this.teamMarkers.clear();

    teams.forEach((team, index) => {
      const node = this.nodeMap.get(team.nodeId);
      // Determine position from team lat/lon or station node coordinates
      let tLat = (team.lat && team.lat !== 0) ? team.lat : (node ? node.lat : 18.5204);
      let tLon = (team.lon && team.lon !== 0) ? team.lon : (node ? node.lon : 73.8567);

      // Slight radial offset so multiple teams at same station are visible
      const angle = (index * (2 * Math.PI / teams.length)) - (Math.PI / 2);
      tLat += 0.0018 * Math.sin(angle);
      tLon += 0.0018 * Math.cos(angle);

      let iconEmoji = '🚑';
      if (team.type === 'FIRE_BRIGADE') iconEmoji = '🚒';
      if (team.type === 'RESCUE_TEAM') iconEmoji = '🛟';

      const sClass = (team.status || 'available').toLowerCase();

      const iconHtml = `
        <div class="vehicle-marker-icon status-${sClass}" data-team="${team.id}">
          <span class="vehicle-emoji">${iconEmoji}</span>
          <span class="vehicle-tag">${team.id}</span>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-vehicle-icon',
        html: iconHtml,
        iconSize: [44, 28],
        iconAnchor: [22, 14]
      });

      const marker = L.marker([tLat, tLon], { icon: customIcon, zIndexOffset: 500 });

      // Active assignment details
      const asg = (team.activeAssignmentId && assignments)
        ? assignments.find(a => a.id === team.activeAssignmentId)
        : null;

      const missionText = asg
        ? `<span style="color:#00e5ff;">Assigned to ${asg.emergencyId} (${asg.routeDistanceKm} km)</span>`
        : '<span style="color:#10b981;">Standby at Station</span>';

      const popupHtml = `
        <div class="map-popup team-popup">
          <div class="popup-title"><strong>${iconEmoji} Unit ${team.id}</strong></div>
          <div class="popup-detail">Type: <strong>${team.type}</strong></div>
          <div class="popup-detail">Status: <span class="team-status-pill ${sClass}">${team.status}</span></div>
          <div class="popup-detail">Station Node: <strong>${team.nodeId ? team.nodeId.replace(/_/g, ' ') : 'N/A'}</strong></div>
          <div class="popup-detail">Mission: ${missionText}</div>
        </div>
      `;
      marker.bindPopup(popupHtml);

      this.teamMarkers.set(team.id, marker);
      this.layerTeams.addLayer(marker);
    });
  }

  // Update vehicle position dynamically on WebSocket event without reloading map
  updateTeamLocation(teamId, lat, lon, nodeId) {
    const marker = this.teamMarkers.get(teamId);
    if (!marker) return;

    let targetLat = lat;
    let targetLon = lon;

    if ((!targetLat || !targetLon) && nodeId && this.nodeMap.has(nodeId)) {
      const node = this.nodeMap.get(nodeId);
      targetLat = node.lat;
      targetLon = node.lon;
    }

    if (targetLat && targetLon) {
      marker.setLatLng([targetLat, targetLon]);
      console.log(`[Map] Moved unit ${teamId} to [${targetLat}, ${targetLon}]`);
    }
  }

  // Animate dynamic reroute visualization
  highlightReroute(rerouteData) {
    if (!rerouteData || !rerouteData.nodeIds) return;

    const latLngs = [];
    for (const nodeId of rerouteData.nodeIds) {
      const node = this.nodeMap.get(nodeId);
      if (node) latLngs.push([node.lat, node.lon]);
    }

    if (latLngs.length < 2) return;

    // Create a temporary flash polyline to highlight the reroute
    const flashPolyline = L.polyline(latLngs, {
      color: '#ffea00',
      weight: 8,
      opacity: 1,
      dashArray: '12, 6',
      className: 'reroute-flash-animation'
    }).addTo(this.map);

    setTimeout(() => {
      this.map.removeLayer(flashPolyline);
    }, 4000);
  }
}

window.CityMapController = CityMapController;
