const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseDirect = createClient(supabaseUrl, supabaseKey);

const TEST_MOBILE_1 = '9911001101';
const TEST_MOBILE_2 = '9911001102';
const TEST_PASS = 'TestPass#2026';

function request(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4000,
      path: reqPath,
      method: method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
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

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Minimal Leaflet mock to run the real CityMapController in Node.js
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
      let popup = null;
      let pos = latLng;
      let icon = opts.icon;
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
    polyline: () => ({
      bindPopup: () => {},
      on: () => {},
      off: () => {},
      addTo: () => {},
      setStyle: () => {}
    }),
    circleMarker: () => ({
      bindPopup: () => {},
      on: () => {},
      off: () => {},
      addTo: () => {}
    }),
    latLngBounds: () => ({}),
    map: () => ({
      getPane: () => null,
      createPane: () => ({ style: {} }),
      fitBounds: () => {},
      removeLayer: () => {}
    }),
    tileLayer: () => ({ addTo: () => {}, remove: () => {} })
  };
  global.document = {
    getElementById: () => ({ classList: { remove: () => {}, add: () => {} } }),
    head: { appendChild: () => {} }
  };
  global.localStorage = {
    getItem: () => '',
    removeItem: () => {}
  };
}

async function cleanupTestDrivers() {
  try {
    for (const mobile of [TEST_MOBILE_1, TEST_MOBILE_2]) {
      const { data: driver } = await supabaseDirect
        .from('driver_accounts')
        .select('id')
        .eq('mobile_number', mobile)
        .maybeSingle();

      if (driver) {
        await supabaseDirect.from('response_units').delete().eq('driver_id', driver.id);
        await supabaseDirect.from('driver_accounts').delete().eq('id', driver.id);
        try {
          await supabaseDirect.auth.admin.deleteUser(driver.id);
        } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('[Cleanup Warning]', e.message);
  }
}

async function run() {
  console.log('================================================================');
  console.log('TEST SUITE: UNIT LOGOUT / OFFLINE MAP MARKER LIFECYCLE');
  console.log('================================================================\n');

  setupLeafletMock();

  // Load actual CityMapController code
  const mapCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'map.js'), 'utf8');
  eval(mapCode); // Evaluates CityMapController class into scope
  const cityMap = new CityMapController('city-map');

  // Clean prior test data
  await cleanupTestDrivers();

  // 1. Spawn backend server
  console.log('Step 1: Starting Node.js backend and C++ DSA Engine...');
  const serverProc = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'pipe' });
  serverProc.stdout.on('data', d => console.log('  [Server OUT]', d.toString().trim()));
  serverProc.stderr.on('data', d => console.error('  [Server ERR]', d.toString().trim()));

  // Wait for server ready
  let serverReady = false;
  for (let i = 0; i < 40; i++) {
    await delay(500);
    try {
      const st = await request('GET', '/api/system/status');
      if (st.status === 200 && st.data.ready) {
        serverReady = true;
        break;
      }
    } catch (e) {}
  }
  if (!serverReady) throw new Error('Backend failed to boot and signal ready state');
  console.log('✓ Backend ready. Initial active fleet count is 0.\n');

  // 2. Connect WebSocket Client (simulating Command Center)
  console.log('Step 2: Connecting WebSocket Client to Command Center bus...');
  let wsMessages = [];
  let appState = null;

  const ws = new WebSocket('ws://127.0.0.1:4000/ws');
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      wsMessages.push(msg);
      console.log('  [WS Message Received]', msg.type, msg.eventType || '', 'Teams in snapshot:', msg.data?.teams?.map(t => ({ id: t.id, status: t.status })));

      if (msg.type === 'INITIAL_STATE' && msg.data) {
        appState = msg.data;
        cityMap.setData(appState);
      } else if (msg.type === 'SNAPSHOT_UPDATED') {
        if (msg.data) {
          appState = msg.data;
          cityMap.setData(appState);
        }
        if (msg.eventType === 'TEAM_LOGGED_OUT') {
          cityMap.removeTeamMarker(msg.teamId);
        } else if (msg.eventType === 'TEAM_STATUS_CHANGED' && msg.status === 'OFFLINE') {
          cityMap.removeTeamMarker(msg.teamId);
        }
      }
    } catch (e) {
      console.error('WS Parse error:', e);
    }
  });

  await delay(1000);
  console.log('✓ WebSocket connected. Initial map team markers count:', cityMap.teamMarkers.size);
  if (cityMap.teamMarkers.size !== 0) throw new Error('Expected 0 map markers on initial load');

  let unit1Id = null;
  let unit2Id = null;
  let token1 = null;
  let token2 = null;

  try {
    // 3. Register and activate Unit 1 (Ambulance)
    console.log('\nStep 3: Registering and activating Unit 1 (Ambulance)...');
    const reg1 = await request('POST', '/api/drivers/register', {
      role: 'Ambulance',
      driverName: 'Driver Alpha',
      mobileNumber: TEST_MOBILE_1,
      password: TEST_PASS,
      vehicleNumber: 'MH12AA1111',
      locationType: 'DECCAN_GYMKHANA'
    });
    unit1Id = reg1.data.driver.unitId;
    token1 = reg1.data.token;

    await request('POST', '/api/drivers/activate', {
      locationType: 'DECCAN_GYMKHANA',
      mobileNumber: TEST_MOBILE_1
    }, { 'Authorization': `Bearer ${token1}` });

    await delay(600);
    console.log(`✓ Unit 1 (${unit1Id}) activated at Deccan Gymkhana.`);
    console.log(`  Map markers count: ${cityMap.teamMarkers.size} | Marker exists for ${unit1Id}: ${cityMap.hasTeamMarker(unit1Id)}`);
    if (!cityMap.hasTeamMarker(unit1Id)) throw new Error(`Marker for ${unit1Id} not created on map`);

    // 4. Register and activate Unit 2 (Fire Brigade)
    console.log('\nStep 4: Registering and activating Unit 2 (Fire Brigade)...');
    const reg2 = await request('POST', '/api/drivers/register', {
      role: 'Fire Brigade',
      driverName: 'Driver Bravo',
      mobileNumber: TEST_MOBILE_2,
      password: TEST_PASS,
      vehicleNumber: 'MH12BB2222',
      locationType: 'SHIVAJI_NAGAR'
    });
    unit2Id = reg2.data.driver.unitId;
    token2 = reg2.data.token;

    await request('POST', '/api/drivers/activate', {
      locationType: 'SHIVAJI_NAGAR',
      mobileNumber: TEST_MOBILE_2
    }, { 'Authorization': `Bearer ${token2}` });

    await delay(600);
    console.log(`✓ Unit 2 (${unit2Id}) activated at Shivaji Nagar.`);
    console.log(`  Map markers count: ${cityMap.teamMarkers.size}`);
    console.log(`  Marker exists for ${unit1Id}: ${cityMap.hasTeamMarker(unit1Id)} | Marker exists for ${unit2Id}: ${cityMap.hasTeamMarker(unit2Id)}`);

    if (cityMap.teamMarkers.size !== 2 || !cityMap.hasTeamMarker(unit1Id) || !cityMap.hasTeamMarker(unit2Id)) {
      throw new Error('Both unit markers should be visible on map');
    }

    // 5. Unit 1 logs out
    console.log(`\nStep 5: Logging out Unit 1 (${unit1Id})...`);
    const logoutRes = await request('POST', `/api/teams/${unit1Id}/logout`, {}, {
      'Authorization': `Bearer ${token1}`
    });
    if (logoutRes.status !== 200) throw new Error('Logout request failed: ' + JSON.stringify(logoutRes.data));

    await delay(600);

    console.log(`✓ Unit 1 logged out. Verifying map marker state:`);
    console.log(`  Map markers count: ${cityMap.teamMarkers.size}`);
    console.log(`  Has Unit 1 (${unit1Id}) marker: ${cityMap.hasTeamMarker(unit1Id)}`);
    console.log(`  Has Unit 2 (${unit2Id}) marker: ${cityMap.hasTeamMarker(unit2Id)}`);

    if (cityMap.hasTeamMarker(unit1Id)) {
      throw new Error(`FAILURE: Marker for logged out unit ${unit1Id} is STILL present on map!`);
    }
    if (!cityMap.hasTeamMarker(unit2Id)) {
      throw new Error(`FAILURE: Active unit ${unit2Id} marker was incorrectly removed!`);
    }
    if (cityMap.teamMarkers.size !== 1) {
      throw new Error(`FAILURE: Expected exactly 1 marker on map, found: ${cityMap.teamMarkers.size}`);
    }
    console.log('✓ PASS: Unit 1 marker immediately disappeared; Unit 2 marker remains intact.');

    // 6. Unit 1 logs in and activates shift again
    console.log(`\nStep 6: Re-activating Unit 1 (${unit1Id}) online at Deccan Gymkhana...`);
    const login1 = await request('POST', '/api/drivers/login', {
      mobileNumber: TEST_MOBILE_1,
      password: TEST_PASS
    });
    token1 = login1.data.token;

    await request('POST', '/api/drivers/activate', {
      locationType: 'DECCAN_GYMKHANA',
      mobileNumber: TEST_MOBILE_1
    }, { 'Authorization': `Bearer ${token1}` });

    await delay(600);

    console.log(`✓ Unit 1 reactivated. Verifying map markers:`);
    console.log(`  Map markers count: ${cityMap.teamMarkers.size}`);
    console.log(`  Has Unit 1 (${unit1Id}) marker: ${cityMap.hasTeamMarker(unit1Id)}`);
    console.log(`  Has Unit 2 (${unit2Id}) marker: ${cityMap.hasTeamMarker(unit2Id)}`);

    if (!cityMap.hasTeamMarker(unit1Id) || !cityMap.hasTeamMarker(unit2Id) || cityMap.teamMarkers.size !== 2) {
      throw new Error('FAILURE: Returning unit did not recreate its marker alongside existing active unit');
    }
    console.log('✓ PASS: Returning unit marker successfully returned to the map alongside Unit 2.');

    // 7. Repeat without restarting Node.js: Take Unit 2 OFFLINE via status endpoint
    console.log(`\nStep 7: Taking Unit 2 (${unit2Id}) OFFLINE via status update (without restarting Node.js)...`);
    const statusRes = await request('POST', `/api/teams/${unit2Id}/status`, { status: 'OFFLINE' }, {
      'Authorization': `Bearer ${token2}`
    });
    if (statusRes.status !== 200) throw new Error('Status update failed: ' + JSON.stringify(statusRes.data));

    await delay(600);

    console.log(`✓ Unit 2 set to OFFLINE. Verifying map markers:`);
    console.log(`  Map markers count: ${cityMap.teamMarkers.size}`);
    console.log(`  Has Unit 1 (${unit1Id}) marker: ${cityMap.hasTeamMarker(unit1Id)}`);
    console.log(`  Has Unit 2 (${unit2Id}) marker: ${cityMap.hasTeamMarker(unit2Id)}`);

    if (cityMap.hasTeamMarker(unit2Id)) {
      throw new Error(`FAILURE: Unit 2 marker still visible after being taken OFFLINE!`);
    }
    if (!cityMap.hasTeamMarker(unit1Id)) {
      throw new Error(`FAILURE: Unit 1 marker was unexpectedly removed!`);
    }
    console.log('✓ PASS: Taking unit offline immediately removed its marker while other active unit stayed visible.');

    // 8. Test WebSocket reconnection and fresh snapshot handling
    console.log('\nStep 8: Testing WebSocket reconnection and fresh snapshot hydration...');
    // Create second client and request fresh snapshot
    const cityMap2 = new CityMapController('city-map');
    const freshState = await request('GET', '/api/state');
    cityMap2.setData(freshState.data);

    console.log(`✓ Fresh snapshot parsed by second map controller.`);
    console.log(`  Map 2 markers count: ${cityMap2.teamMarkers.size}`);
    console.log(`  Map 2 has Unit 1 (${unit1Id}): ${cityMap2.hasTeamMarker(unit1Id)}`);
    console.log(`  Map 2 has Unit 2 (${unit2Id}): ${cityMap2.hasTeamMarker(unit2Id)}`);

    if (cityMap2.hasTeamMarker(unit2Id)) {
      throw new Error('FAILURE: Fresh snapshot incorrectly rendered offline unit 2 marker!');
    }
    if (!cityMap2.hasTeamMarker(unit1Id)) {
      throw new Error('FAILURE: Fresh snapshot did not render active unit 1 marker!');
    }
    console.log('✓ PASS: Fresh snapshots and reconnects accurately hydrate only active units.');

    console.log('\n================================================================');
    console.log('ALL MAP MARKER LIFECYCLE TESTS PASSED (100%)!');
    console.log('================================================================');

  } finally {
    ws.close();
    serverProc.kill();
    await cleanupTestDrivers();
    console.log('Cleaned up dedicated test driver records.');
  }
}

run().catch(err => {
  console.error('\n*** TEST FAILED ***:', err);
  process.exit(1);
});
