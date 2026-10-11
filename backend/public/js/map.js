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

    // Map Basemap & Traffic Overlay State
    this.apiKey = options.apiKey || localStorage.getItem('google_maps_api_key') || '';
    this.activeBaseLayerName = options.defaultLayer || 'dark';
    this.isTrafficEnabled = false;
    this.baseLayers = {};
    this.trafficLayer = null;
    this.currentBaseLayer = null;

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
    this.onLayerChange = options.onLayerChange || null;

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

    // Initialize all Google and Tactical basemaps & traffic layer
    this._initBaseLayers();

    // Set initial active base layer (defaults to 'dark' or option)
    this.setBaseLayer(this.activeBaseLayerName);

    // Add layer groups in order of depth (roads at bottom, routes next, nodes, emergencies, teams on top)
    this.layerRoads.addTo(this.map);
    this.layerRoutes.addTo(this.map);
    this.layerNodes.addTo(this.map);
    this.layerEmergencies.addTo(this.map);
    this.layerTeams.addTo(this.map);

    // If API key is present, attempt background load of Google Maps JS SDK
    if (this.apiKey) {
      this._loadGoogleMapsSdk(this.apiKey);
    }
  }

  _initBaseLayers() {
    const keyParam = this.apiKey ? `&key=${encodeURIComponent(this.apiKey)}` : '';

    // Create a dedicated pane for traffic overlay above base tiles (200) but below vector paths (400)
    if (!this.map.getPane('trafficPane')) {
      const trafficPane = this.map.createPane('trafficPane');
      trafficPane.style.zIndex = '350';
    }

    // 1. Tactical Dark (OpenStreetMap with high-contrast mission-control dark filter - no watermark)
    const darkLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    // 2. Google Satellite Imagery (High-Resolution Aerial)
    const googleSatellite = L.tileLayer(`https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}${keyParam}`, {
      maxZoom: 21,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; <a href="https://maps.google.com">Google Maps</a> Satellite'
    });

    // 3. Google Satellite Hybrid (Satellite Imagery + Street & Location Labels)
    const googleHybrid = L.tileLayer(`https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}${keyParam}`, {
      maxZoom: 21,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; <a href="https://maps.google.com">Google Maps</a> Hybrid'
    });

    // 4. Google Streets (Standard Roadmap)
    const googleStreets = L.tileLayer(`https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}${keyParam}`, {
      maxZoom: 21,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; <a href="https://maps.google.com">Google Maps</a> Streets'
    });

    // 5. Google Terrain (Topography & Relief)
    const googleTerrain = L.tileLayer(`https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}${keyParam}`, {
      maxZoom: 21,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; <a href="https://maps.google.com">Google Maps</a> Terrain'
    });

    this.baseLayers = {
      dark: darkLayer,
      satellite: googleSatellite,
      hybrid: googleHybrid,
      streets: googleStreets,
      terrain: googleTerrain
    };

    // Google Real-Time Traffic Overlay Layer (Live congestion flows on transparent roads)
    this.trafficLayer = L.tileLayer(`https://mt{s}.google.com/vt/lyrs=h,traffic&x={x}&y={y}&z={z}${keyParam}`, {
      maxZoom: 21,
      subdomains: ['0', '1', '2', '3'],
      pane: 'trafficPane',
      opacity: 0.95,
      attribution: '&copy; <a href="https://maps.google.com">Google</a> Live Traffic'
    });
  }

  /**
   * Switch the active base map layer smoothly.
   * @param {string} layerName - 'dark' | 'satellite' | 'hybrid' | 'streets' | 'terrain'
   */
  setBaseLayer(layerName) {
    if (!this.baseLayers[layerName]) {
      console.warn(`[Map] Requested layer '${layerName}' not found. Falling back to 'dark'.`);
      layerName = 'dark';
    }

    if (this.currentBaseLayer && this.map.hasLayer(this.currentBaseLayer)) {
      this.map.removeLayer(this.currentBaseLayer);
    }

    this.currentBaseLayer = this.baseLayers[layerName];
    this.currentBaseLayer.addTo(this.map);
    this.activeBaseLayerName = layerName;

    // Adjust container styling for dark vs satellite high-contrast
    const container = document.getElementById(this.containerId);
    if (container) {
      container.classList.remove('dark-mode', 'satellite-mode');
      if (layerName === 'dark') {
        container.classList.add('dark-mode');
      } else if (layerName === 'satellite' || layerName === 'hybrid') {
        container.classList.add('satellite-mode');
      }
    }

    if (this.onLayerChange) {
      this.onLayerChange(layerName);
    }
  }

  /**
   * Toggle Real-Time Google Traffic Layer overlay on/off.
   * @param {boolean} [enable] - Optional explicit boolean state.
   * @returns {boolean} New traffic active state.
   */
  toggleTraffic(enable) {
    if (typeof enable === 'boolean') {
      this.isTrafficEnabled = enable;
    } else {
      this.isTrafficEnabled = !this.isTrafficEnabled;
    }

    if (this.isTrafficEnabled) {
      if (!this.map.hasLayer(this.trafficLayer)) {
        this.trafficLayer.addTo(this.map);
      }
    } else {
      if (this.map.hasLayer(this.trafficLayer)) {
        this.map.removeLayer(this.trafficLayer);
      }
    }

    return this.isTrafficEnabled;
  }

  /**
   * Configure or update Google Maps API Key at runtime.
   * Reinitializes tile providers with the provided key and persists to localStorage.
   * @param {string} newKey
   */
  setApiKey(newKey) {
    this.apiKey = (newKey || '').trim();
    if (this.apiKey) {
      localStorage.setItem('google_maps_api_key', this.apiKey);
      this._loadGoogleMapsSdk(this.apiKey);
    } else {
      localStorage.removeItem('google_maps_api_key');
    }

    const currentLayer = this.activeBaseLayerName;
    const wasTraffic = this.isTrafficEnabled;

    // Clean up current layers
    if (this.currentBaseLayer && this.map.hasLayer(this.currentBaseLayer)) {
      this.map.removeLayer(this.currentBaseLayer);
    }
    if (this.trafficLayer && this.map.hasLayer(this.trafficLayer)) {
      this.map.removeLayer(this.trafficLayer);
    }

    // Reinitialize base layers with updated API key parameter
    this._initBaseLayers();
    this.setBaseLayer(currentLayer);
    if (wasTraffic) {
      this.toggleTraffic(true);
    }

    console.log(`[Map] Updated Google Maps API Key: ${this.apiKey ? (this.apiKey.substring(0, 6) + '...') : 'Cleared'}`);
  }

  hasApiKey() {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  getActiveBaseLayer() {
    return this.activeBaseLayerName;
  }

  isTrafficActive() {
    return this.isTrafficEnabled;
  }

  _loadGoogleMapsSdk(apiKey) {
    if (!apiKey) return;
    if (window.google && window.google.maps) {
      console.log('[Map] Google Maps JavaScript SDK already active');
      return;
    }
    const scriptId = 'google-maps-js-sdk';
    let script = document.getElementById(scriptId);
    if (script) script.remove();

    script = document.createElement('script');
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,traffic`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      console.log('[Map] Official Google Maps JS Platform SDK loaded successfully.');
    };
    script.onerror = (e) => {
      console.warn('[Map] Note: Google Maps JS SDK load warning (tile layer still operating):', e);
    };
    document.head.appendChild(script);
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
          ${asg.etaMinutes ? `<div class="popup-detail">Estimated ETA: <strong style="color: #00e5ff;">${asg.etaMinutes} min</strong></div>` : ''}
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
    // Only active (non-OFFLINE) response teams belong on the live tactical map
    const activeTeams = (teams || []).filter(t => t && t.status && t.status.toUpperCase() !== 'OFFLINE');
    const activeTeamIds = new Set(activeTeams.map(t => t.id));

    // 1. Remove markers for units that have logged out, gone offline, or are no longer active
    for (const [teamId, marker] of this.teamMarkers.entries()) {
      if (!activeTeamIds.has(teamId)) {
        this.layerTeams.removeLayer(marker);
        this.teamMarkers.delete(teamId);
      }
    }

    // 2. Add or update markers for active units
    activeTeams.forEach((team, index) => {
      const node = this.nodeMap.get(team.nodeId);
      // Determine position from team lat/lon or station node coordinates
      let tLat = (team.lat && team.lat !== 0) ? team.lat : (node ? node.lat : 18.5204);
      let tLon = (team.lon && team.lon !== 0) ? team.lon : (node ? node.lon : 73.8567);

      // Slight radial offset so multiple teams at same station are visible
      if (activeTeams.length > 1) {
        const angle = (index * (2 * Math.PI / activeTeams.length)) - (Math.PI / 2);
        tLat += 0.0018 * Math.sin(angle);
        tLon += 0.0018 * Math.cos(angle);
      }

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

      // Active assignment details
      const asg = (team.activeAssignmentId && assignments)
        ? assignments.find(a => a.id === team.activeAssignmentId)
        : null;

      const missionText = asg
        ? `<span style="color:#00e5ff;">Assigned to ${asg.emergencyId} (${asg.routeDistanceKm} km)</span>`
        : '<span style="color:#10b981;">Standby at Station</span>';

      const driverInfo = team.driverName
        ? `<div class="popup-detail">Driver: <strong>${team.driverName}</strong> ${team.vehicleNumber ? `(${team.vehicleNumber})` : ''}</div>`
        : '';
      const locationText = team.locationName || (team.nodeId ? team.nodeId.replace(/_/g, ' ') : 'N/A');

      const popupHtml = `
        <div class="map-popup team-popup">
          <div class="popup-title"><strong>${iconEmoji} Unit ${team.id}</strong></div>
          <div class="popup-detail">Type: <strong>${team.type}</strong></div>
          <div class="popup-detail">Status: <span class="team-status-pill ${sClass}">${team.status}</span></div>
          ${driverInfo}
          <div class="popup-detail">Location: <strong>${locationText}</strong></div>
          <div class="popup-detail">Mission: ${missionText}</div>
        </div>
      `;

      let marker = this.teamMarkers.get(team.id);
      if (marker) {
        // Update existing marker
        marker.setLatLng([tLat, tLon]);
        marker.setIcon(customIcon);
        marker.setPopupContent(popupHtml);
      } else {
        // Create and register new marker
        marker = L.marker([tLat, tLon], { icon: customIcon, zIndexOffset: 500 });
        marker.bindPopup(popupHtml);
        this.teamMarkers.set(team.id, marker);
        this.layerTeams.addLayer(marker);
      }
    });
  }

  // Remove individual team marker from map when logged out or taken offline
  removeTeamMarker(teamId) {
    const marker = this.teamMarkers.get(teamId);
    if (marker) {
      this.layerTeams.removeLayer(marker);
      this.teamMarkers.delete(teamId);
      console.log(`[Map] Removed marker for unit ${teamId}`);
    }
  }

  // Check whether a team marker currently exists on map
  hasTeamMarker(teamId) {
    return this.teamMarkers.has(teamId);
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
