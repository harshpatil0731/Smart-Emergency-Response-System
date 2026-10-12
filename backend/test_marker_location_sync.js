/**
 * ============================================================================
 * TEST SUITE: MAP MARKER LOCATION SYNCHRONIZATION & STALENESS PROTECTION
 * ============================================================================
 *
 * Verifies:
 * 1. Location selection (Deccan Gymkhana -> Shivaji Nagar) updates backend and moves Leaflet marker.
 * 2. Exactly one marker exists per unit (no duplicate markers on position changes).
 * 3. Stale snapshots do not revert newer authoritative coordinates.
 * 4. Stale/unverified background GPS pings do not overwrite chosen fixed station.
 * 5. Live GPS tracking operates and updates marker when in CURRENT_LOCATION mode or transit.
 * 6. Zero modification to live Supabase database records (uses isolated local storage).
 */

const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const storageDir = path.join(__dirname, '.storage_test_loc_sync');
try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch (e) {}

const TEST_PORT = 4097;

// Setup Leaflet mock environment for Node.js
function setupLeafletMock() {
  global.window = global;
  global.L = {
    layerGroup: () => {
      const layers = new Set();
      return {
        layers,
        addTo: () => {},
        clearLayers: () => layers.clear(),
        addLayer: (layer) => layers.add(layer),
        removeLayer: (layer) => layers.delete(layer)
      };
    },
    divIcon: (opts) => ({ ...opts }),
    marker: (latLng, opts) => {
      let pos = latLng;
      let popup = null;
      let icon = opts.icon;
      let zIndexOffset = opts.zIndexOffset || 0;
      return {
        getLatLng: () => pos,
        setLatLng: (p) => { pos = p; },
        setIcon: (i) => { icon = i; },
        bindPopup: (content) => { popup = content; },
        setPopupContent: (content) => { popup = content; },
        getPopupContent: () => popup,
        on: () => {},
        off: () => {}
      };
    },
    polyline: () => ({ bindPopup: () => {}, on: () => {}, off: () => {}, addTo: () => {}, setStyle: () => {} }),
    circleMarker: () => ({ bindPopup: () => {}, on: () => {}, off: () => {}, addTo: () => {} }),
    latLngBounds: () => ({}),
    map: () => ({ getPane: () => null, createPane: () => ({ style: {} }), fitBounds: () => {}, removeLayer: () => {} }),
    tileLayer: () => ({ addTo: () => {}, remove: () => {} })
  };
  global.document = {
    getElementById: () => ({ classList: { remove: () => {}, add: () => {} } }),
    head: { appendChild: () => {} }
  };
  global.localStorage = { getItem: () => '', removeItem: () => {} };
}

setupLeafletMock();

// Load actual CityMapController code
const mapCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'map.js'), 'utf8');
eval(mapCode);
const cityMap = new CityMapController('city-map');

const serverProcess = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(TEST_PORT),
    SUPABASE_URL: '', // Guarantees isolated local storage — live Supabase untouched
    SUPABASE_SERVICE_ROLE_KEY: '',
    STORAGE_DIR: storageDir,
    NODE_ENV: 'test'
  },
  stdio: 'pipe'
});

serverProcess.stdout.on('data', d => {
  const s = d.toString();
  if (s.includes('error') || s.includes('Error')) console.log('[Server OUT]', s.trim());
});
serverProcess.stderr.on('data', d => console.error('[Server ERR]', d.toString().trim()));

function request(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: reqPath,
      method: method,
      headers: {
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {}),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('================================================================');
  console.log('TEST SUITE: AMBULANCE LOCATION CHANGE & MARKER SYNCHRONIZATION');
  console.log('================================================================\n');

  // 1. Wait for server ready
  console.log('Step 1: Waiting for backend server and C++ DS Engine...');
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await delay(300);
    try {
      const st = await request('GET', '/api/system/status');
      if (st.status === 200 && st.data.ready) { ready = true; break; }
    } catch (e) {}
  }
  if (!ready) throw new Error('Server failed to start');
  console.log('✓ Backend ready. Initial map markers count:', cityMap.teamMarkers.size);

  // 2. Connect WebSocket Client (simulating Command Center)
  console.log('\nStep 2: Connecting WebSocket Client...');
  let wsMessages = [];
  let appState = null;

  const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      wsMessages.push(msg);

      if (msg.type === 'INITIAL_STATE' && msg.data) {
        appState = msg.data;
        cityMap.setData(appState);
      } else if (msg.type === 'SNAPSHOT_UPDATED') {
        if (msg.data) {
          appState = msg.data;
          cityMap.setData(appState);
        }
        if (msg.eventType === 'TEAM_LOCATION_UPDATED') {
          cityMap.updateTeamLocation(msg.teamId, msg.lat, msg.lon, msg.nodeId, msg.timestamp);
        } else if (msg.eventType === 'TEAM_REGISTERED' || msg.eventType === 'TEAM_ACTIVATED') {
          const teamInfo = msg.team || {};
          const lat = msg.lat || teamInfo.lat;
          const lon = msg.lon || teamInfo.lon;
          const nodeId = msg.nodeId || teamInfo.nodeId;
          if (lat && lon) {
            cityMap.updateTeamLocation(msg.teamId, lat, lon, nodeId, msg.timestamp);
          }
        } else if (msg.eventType === 'TEAM_LOGGED_OUT') {
          cityMap.removeTeamMarker(msg.teamId);
        }
      }
    } catch (e) {}
  });

  await delay(600);
  console.log('✓ WebSocket connected and listening.');

  try {
    // 3. Register Driver Account at Deccan Gymkhana
    console.log('\nStep 3: Registering Ambulance Driver at Deccan Gymkhana...');
    const regRes = await request('POST', '/api/drivers/register', {
      role: 'Ambulance',
      driverName: 'Ramesh Pawar',
      mobileNumber: '9922334455',
      password: 'SafePassword#1',
      vehicleNumber: 'MH12AB9999',
      locationType: 'DECCAN_GYMKHANA'
    });
    if (regRes.status !== 200 || !regRes.data.success) throw new Error('Registration failed');
    const unitId = regRes.data.driver.unitId;
    const token = regRes.data.token;
    console.log(`✓ Driver registered with Unit ID: ${unitId}`);

    // 4. Activate unit online at Deccan Gymkhana
    console.log('\nStep 4: Activating Unit at Deccan Gymkhana (18.5160, 73.8400)...');
    const act1 = await request('POST', '/api/drivers/activate', {
      locationType: 'DECCAN_GYMKHANA',
      mobileNumber: '9922334455'
    }, { 'Authorization': `Bearer ${token}` });
    if (act1.status !== 200 || !act1.data.success) throw new Error('Activation 1 failed');

    await delay(600);

    console.log(`  Map team markers count: ${cityMap.teamMarkers.size}`);
    if (cityMap.teamMarkers.size !== 1) throw new Error(`Expected exactly 1 marker, got ${cityMap.teamMarkers.size}`);
    const marker1 = cityMap.teamMarkers.get(unitId);
    if (!marker1) throw new Error(`Marker for ${unitId} not found`);

    const pos1 = marker1.getLatLng();
    console.log(`  Marker 1 position: [${pos1[0].toFixed(4)}, ${pos1[1].toFixed(4)}]`);
    if (Math.abs(pos1[0] - 18.5160) > 0.005 || Math.abs(pos1[1] - 73.8400) > 0.005) {
      throw new Error(`Marker position does not match Deccan Gymkhana: ${pos1}`);
    }
    console.log('✓ PASS: Unit active at Deccan Gymkhana with exactly 1 Leaflet marker.');

    // 5. Select a new location: SHIVAJI_NAGAR
    console.log('\nStep 5: Selecting new location SHIVAJI_NAGAR (18.5310, 73.8446)...');
    const act2 = await request('POST', '/api/drivers/activate', {
      locationType: 'SHIVAJI_NAGAR',
      mobileNumber: '9922334455'
    }, { 'Authorization': `Bearer ${token}` });
    if (act2.status !== 200 || !act2.data.success) throw new Error('Activation at Shivaji Nagar failed');

    await delay(600);

    console.log(`  Map team markers count: ${cityMap.teamMarkers.size}`);
    if (cityMap.teamMarkers.size !== 1) {
      throw new Error(`DUPLICATE MARKER DETECTED! Expected 1 marker, found ${cityMap.teamMarkers.size}`);
    }
    const marker2 = cityMap.teamMarkers.get(unitId);
    const pos2 = marker2.getLatLng();
    console.log(`  Marker position after Shivaji Nagar selection: [${pos2[0].toFixed(4)}, ${pos2[1].toFixed(4)}]`);
    console.log(`  Marker popup content contains: ${marker2.getPopupContent().includes('Shivaji Nagar') ? 'Shivaji Nagar' : 'OTHER'}`);

    if (Math.abs(pos2[0] - 18.5310) > 0.005 || Math.abs(pos2[1] - 73.8446) > 0.005) {
      throw new Error(`BUG REPRODUCED: Marker coordinates did not move to Shivaji Nagar! Got: ${pos2}`);
    }
    if (!marker2.getPopupContent().includes('Shivaji Nagar')) {
      throw new Error('Marker popup does not reflect Shivaji Nagar');
    }
    console.log('✓ PASS: Selecting Shivaji Nagar successfully updated coordinates and moved existing Leaflet marker without duplicate markers.');

    // 6. Test Protection Against Stale Snapshots
    console.log('\nStep 6: Verifying stale snapshots do not overwrite newer authoritative coordinates...');
    // Simulate an older snapshot arriving (e.g. from an out-of-order engine event)
    const staleSnapshot = {
      nodes: appState.nodes,
      roads: appState.roads,
      emergencies: [],
      assignments: [],
      teams: [
        {
          id: unitId,
          type: 'AMBULANCE',
          status: 'AVAILABLE',
          nodeId: 'Deccan_Gymkhana_D',
          lat: 18.5160,
          lon: 73.8400,
          updatedAt: 1000 // Very old timestamp
        }
      ]
    };

    cityMap.setData(staleSnapshot);
    const posAfterStale = cityMap.teamMarkers.get(unitId).getLatLng();
    console.log(`  Marker position after stale snapshot: [${posAfterStale[0].toFixed(4)}, ${posAfterStale[1].toFixed(4)}]`);
    if (Math.abs(posAfterStale[0] - 18.5310) > 0.005 || Math.abs(posAfterStale[1] - 73.8446) > 0.005) {
      throw new Error('BUG: Stale snapshot reverted the marker position back to old coordinates!');
    }
    console.log('✓ PASS: Stale snapshot successfully rejected; authoritative coordinates preserved.');

    // 7. Test Protection Against Stale Background GPS Telemetry
    console.log('\nStep 7: Verifying background device GPS telemetry does not overwrite chosen station while on standby...');
    const staleGpsRes = await request('POST', `/api/teams/${unitId}/location`, {
      lat: 18.5160, // Old Deccan coords from background phone GPS
      lon: 73.8400,
      timestamp: Date.now() - 60000 // Older timestamp
    }, { 'Authorization': `Bearer ${token}` });

    console.log('  Stale GPS update response:', staleGpsRes.data);
    await delay(400);

    const posAfterGps = cityMap.teamMarkers.get(unitId).getLatLng();
    console.log(`  Marker position after stale GPS attempt: [${posAfterGps[0].toFixed(4)}, ${posAfterGps[1].toFixed(4)}]`);
    if (Math.abs(posAfterGps[0] - 18.5310) > 0.005 || Math.abs(posAfterGps[1] - 73.8446) > 0.005) {
      throw new Error('BUG: Background GPS ping overwrote the chosen Shivaji Nagar station coordinates!');
    }
    console.log('✓ PASS: Unverified background GPS pings do not overwrite chosen station.');

    // 8. Test Live GPS Tracking when CURRENT_LOCATION mode is selected
    console.log('\nStep 8: Testing live GPS tracking in CURRENT_LOCATION mode...');
    const liveLat = 18.5280;
    const liveLon = 18.5280 ? 73.8390 : 73.8390; // FC Road coords
    const liveActivate = await request('POST', '/api/drivers/activate', {
      locationType: 'CURRENT_LOCATION',
      mobileNumber: '9922334455',
      lat: liveLat,
      lon: liveLon
    }, { 'Authorization': `Bearer ${token}` });
    if (liveActivate.status !== 200 || !liveActivate.data.success) throw new Error('Live activation failed');

    await delay(600);

    const posLive1 = cityMap.teamMarkers.get(unitId).getLatLng();
    console.log(`  Marker pos in CURRENT_LOCATION mode: [${posLive1[0].toFixed(4)}, ${posLive1[1].toFixed(4)}]`);
    if (Math.abs(posLive1[0] - liveLat) > 0.005 || Math.abs(posLive1[1] - liveLon) > 0.005) {
      throw new Error('Live coordinates were not applied in CURRENT_LOCATION mode');
    }

    // Now send a new live GPS ping (vehicle moving)
    const movingLat = 18.5204;
    const movingLon = 73.8567; // Hospital_A coords
    const moveRes = await request('POST', `/api/teams/${unitId}/location`, {
      lat: movingLat,
      lon: movingLon,
      timestamp: Date.now() + 1000
    }, { 'Authorization': `Bearer ${token}` });

    await delay(600);

    const posLive2 = cityMap.teamMarkers.get(unitId).getLatLng();
    console.log(`  Marker pos after live movement: [${posLive2[0].toFixed(4)}, ${posLive2[1].toFixed(4)}]`);
    if (Math.abs(posLive2[0] - movingLat) > 0.005 || Math.abs(posLive2[1] - movingLon) > 0.005) {
      throw new Error('Live GPS tracking failed to move marker in CURRENT_LOCATION mode');
    }
    console.log('✓ PASS: Live GPS tracking operates and smoothly updates marker position.');

    // 9. Clean Logout & Marker Removal
    console.log('\nStep 9: Testing clean logout and marker removal...');
    const logoutRes = await request('POST', `/api/teams/${unitId}/logout`, {}, {
      'Authorization': `Bearer ${token}`
    });
    if (logoutRes.status !== 200) throw new Error('Logout failed');

    await delay(600);

    console.log(`  Map team markers count after logout: ${cityMap.teamMarkers.size}`);
    if (cityMap.teamMarkers.size !== 0) throw new Error('Marker was not removed upon logout');
    console.log('✓ PASS: Marker cleanly removed upon logout.');

    console.log('\n================================================================');
    console.log('ALL LOCATION SYNCHRONIZATION & STALENESS TESTS PASSED (100%)!');
    console.log('================================================================\n');

  } finally {
    ws.close();
    serverProcess.kill();
    try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(path.join(__dirname, 'scratch_test_location.js'), { force: true }); } catch (e) {}
  }
}

run().catch(err => {
  console.error('\n*** TEST FAILED ***:', err);
  serverProcess.kill();
  process.exit(1);
});
