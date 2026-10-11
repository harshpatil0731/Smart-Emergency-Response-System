const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseDirect = createClient(supabaseUrl, supabaseKey);

const TEST_MOBILE = '9900112233';
const TEST_PASSWORD = 'SecurePassword#2026';
const TEST_NAME = 'EndToEnd Tester';
const TEST_VEHICLE = 'MH12ET1122';
const TEST_EMERGENCY_ID = 'E2E-TEST-EM-001';

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

async function startServer() {
  const proc = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'pipe' });
  proc.stdout.on('data', d => process.stdout.write('[BACKEND] ' + d.toString()));
  proc.stderr.on('data', d => process.stderr.write('[BACKEND-ERR] ' + d.toString()));

  for (let i = 0; i < 30; i++) {
    await delay(500);
    try {
      const res = await request('GET', '/api/system/status');
      if (res.status === 200 && res.data.supabase && res.data.supabase.schemaReady && res.data.ready) {
        return proc;
      }
    } catch (e) {}
  }
  proc.kill();
  throw new Error('Server failed to start and verify live Supabase in time');
}

async function cleanupDedicatedTestData() {
  try {
    // 1. Delete test assignments
    await supabaseDirect.from('assignments').delete().like('id', `%${TEST_EMERGENCY_ID}%`);
    // 2. Delete test emergency
    await supabaseDirect.from('emergencies').delete().eq('id', TEST_EMERGENCY_ID);
    // 3. Find test driver
    const { data: driver } = await supabaseDirect
      .from('driver_accounts')
      .select('id')
      .eq('mobile_number', TEST_MOBILE)
      .maybeSingle();

    if (driver) {
      await supabaseDirect.from('response_units').delete().eq('driver_id', driver.id);
      await supabaseDirect.from('driver_accounts').delete().eq('id', driver.id);
      try {
        await supabaseDirect.auth.admin.deleteUser(driver.id);
      } catch (e) {}
    }
  } catch (e) {
    console.warn('Test cleanup warning:', e.message);
  }
}

async function run() {
  console.log('================================================================');
  console.log('COMPREHENSIVE END-TO-END INTEGRATION TEST SUITE');
  console.log('Target Project Host:', new URL(supabaseUrl).host);
  console.log('Timestamp:', new Date().toISOString());
  console.log('================================================================\n');

  // Pre-cleanup dedicated test records
  await cleanupDedicatedTestData();

  let serverProc = null;
  let wsClient = null;
  const wsMessages = [];
  let assignedUnitId = null;
  let driverAuthToken = null;

  try {
    // -------------------------------------------------------------
    // TEST 1 — CLEAN STARTUP
    // -------------------------------------------------------------
    console.log('>>> [TEST 1 — CLEAN STARTUP]');
    serverProc = await startServer();
    console.log('✓ C++ Engine and Node.js Backend started.');

    const sysStatus = await request('GET', '/api/system/status');
    if (sysStatus.status !== 200) throw new Error('GET /api/system/status failed: ' + sysStatus.status);
    if (!sysStatus.data.supabase.configured || sysStatus.data.supabase.storageMode !== 'SUPABASE_POSTGRESQL') {
      throw new Error('Supabase is not configured in live PostgreSQL mode!');
    }
    console.log('✓ Connected to live Supabase project:', sysStatus.data.supabase.host);
    console.log('✓ Storage Mode:', sysStatus.data.supabase.storageMode);

    const initFleet = await request('GET', '/api/teams');
    if (initFleet.status !== 200 || initFleet.data.count !== 0) {
      throw new Error(`Expected 0 active teams on fresh boot, got: ${initFleet.data.count}`);
    }
    console.log('✓ Zero active units confirmed on startup (fleet count: 0).');

    const ccHtml = await request('GET', '/');
    if (ccHtml.status !== 200) throw new Error('Command Center index.html returned status: ' + ccHtml.status);
    console.log('✓ Command Center loads successfully (HTTP 200).\n');

    // -------------------------------------------------------------
    // TEST 2 — DRIVER REGISTRATION AND LOGIN
    // -------------------------------------------------------------
    console.log('>>> [TEST 2 — DRIVER REGISTRATION AND LOGIN]');
    const regRes = await request('POST', '/api/drivers/register', {
      role: 'Ambulance',
      driverName: TEST_NAME,
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD,
      vehicleNumber: TEST_VEHICLE,
      locationType: 'DECCAN_GYMKHANA'
    });

    if (regRes.status !== 200 || !regRes.data.driver || !regRes.data.driver.unitId) {
      throw new Error('Driver registration failed: ' + JSON.stringify(regRes.data));
    }
    assignedUnitId = regRes.data.driver.unitId;
    driverAuthToken = regRes.data.token;
    console.log(`✓ Driver registered via API. Assigned Unit ID: ${assignedUnitId}`);

    // Verify stored in Supabase
    const { data: dbDriver } = await supabaseDirect
      .from('driver_accounts')
      .select('*')
      .eq('mobile_number', TEST_MOBILE)
      .single();
    if (!dbDriver || dbDriver.driver_name !== TEST_NAME) {
      throw new Error('Driver account record NOT found in live Supabase driver_accounts table');
    }
    const { data: dbUnit } = await supabaseDirect
      .from('response_units')
      .select('*')
      .eq('id', assignedUnitId)
      .single();
    if (!dbUnit || dbUnit.vehicle_number !== TEST_VEHICLE || dbUnit.status !== 'OFFLINE') {
      throw new Error('Unit record NOT found or status not OFFLINE in live Supabase response_units table');
    }
    console.log('✓ Account and Unit verified in live Supabase database.');

    // Duplicate registration check
    const dupRes = await request('POST', '/api/drivers/register', {
      role: 'Ambulance',
      driverName: 'Dup Name',
      mobileNumber: TEST_MOBILE,
      password: 'password',
      vehicleNumber: 'MH12XX9999',
      locationType: 'DECCAN_GYMKHANA'
    });
    if (dupRes.status !== 409) throw new Error('Expected 409 Conflict on duplicate mobile, got: ' + dupRes.status);
    console.log('✓ Duplicate mobile registration rejected with 409 Conflict.');

    // Incorrect password check
    const wrongPassRes = await request('POST', '/api/drivers/login', {
      mobileNumber: TEST_MOBILE,
      password: 'BadPassword#123'
    });
    if (wrongPassRes.status !== 401) throw new Error('Expected 401 Unauthorized on wrong password, got: ' + wrongPassRes.status);
    console.log('✓ Incorrect password rejected with 401 Unauthorized.');

    // Valid login check
    const loginRes = await request('POST', '/api/drivers/login', {
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD
    });
    if (loginRes.status !== 200 || loginRes.data.driver.unitId !== assignedUnitId || loginRes.data.isOnline !== false) {
      throw new Error('Valid login failed or returned invalid unitId/online state');
    }
    console.log('✓ Valid login retrieved saved profile and offline unit.');

    // Confirm driver remains offline before activating shift
    const preActivateFleet = await request('GET', '/api/teams');
    if (preActivateFleet.data.count !== 0) {
      throw new Error('Driver must remain offline before shift activation, but fleet count was: ' + preActivateFleet.data.count);
    }
    console.log('✓ Driver unit remains offline in active fleet prior to shift activation.\n');

    // -------------------------------------------------------------
    // TEST 4 — COMMAND CENTER & WEBSOCKET UPDATES
    // -------------------------------------------------------------
    console.log('>>> [TEST 4 — COMMAND CENTER & WEBSOCKET]');
    // Connect WebSocket
    wsClient = new WebSocket('ws://127.0.0.1:4000/ws');
    await new Promise((resolve, reject) => {
      wsClient.on('open', resolve);
      wsClient.on('error', reject);
    });
    wsClient.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        wsMessages.push(msg);
      } catch (e) {}
    });
    console.log('✓ WebSocket connected to Command Center feed (ws://127.0.0.1:4000/ws).');

    // Activate unit online
    const actRes = await request('POST', '/api/drivers/activate', {
      unitId: assignedUnitId,
      locationType: 'DECCAN_GYMKHANA',
      mobileNumber: TEST_MOBILE
    }, {
      'Authorization': `Bearer ${driverAuthToken}`
    });
    if (actRes.status !== 200 || actRes.data.team.status !== 'AVAILABLE') {
      throw new Error('Failed to activate unit: ' + JSON.stringify(actRes.data));
    }
    console.log(`✓ Unit ${assignedUnitId} activated online at Deccan Gymkhana.`);

    // Wait for WebSocket message
    await delay(300);
    const activeFleet = await request('GET', '/api/teams');
    if (activeFleet.data.count !== 1 || activeFleet.data.teams[0].id !== assignedUnitId) {
      throw new Error('Active fleet did not show the activated unit: ' + JSON.stringify(activeFleet.data));
    }
    console.log('✓ Unit appears in active fleet (Count: 1).');

    const unitMarker = activeFleet.data.teams[0];
    if (unitMarker.nodeId !== 'Deccan_Gymkhana_D' || unitMarker.status !== 'AVAILABLE') {
      throw new Error('Unit marker position or status mismatch: ' + JSON.stringify(unitMarker));
    }
    console.log('✓ Unit marker and status verified on Command Center network (AVAILABLE at Deccan_Gymkhana_D).');

    const foundWsActivation = wsMessages.some(m => m.type === 'SNAPSHOT_UPDATED');
    if (!foundWsActivation) throw new Error('Did not receive SNAPSHOT_UPDATED over WebSocket during activation');
    console.log('✓ Command Center received real-time WebSocket update for unit activation.\n');

    // -------------------------------------------------------------
    // TEST 4B — SECURITY HARDENING: AUTH & OWNERSHIP VALIDATION
    // -------------------------------------------------------------
    console.log('>>> [TEST 4B — SECURITY HARDENING: AUTH & OWNERSHIP VALIDATION]');

    // 1. Unauthenticated request to /status rejected (401)
    const unauthStatus = await request('POST', `/api/teams/${assignedUnitId}/status`, { status: 'BUSY' });
    if (unauthStatus.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated status update, got ${unauthStatus.status}`);
    }
    console.log('✓ Unauthenticated status update rejected with 401 Unauthorized.');

    // 2. Invalid token rejected (401)
    const badTokenStatus = await request('POST', `/api/teams/${assignedUnitId}/status`, { status: 'BUSY' }, {
      'Authorization': 'Bearer invalid.token.payload.signature'
    });
    if (badTokenStatus.status !== 401) {
      throw new Error(`Expected 401 for invalid token status update, got ${badTokenStatus.status}`);
    }
    console.log('✓ Status update with invalid token rejected with 401 Unauthorized.');

    // 3. Unauthenticated location update rejected (401)
    const unauthLoc = await request('POST', `/api/teams/${assignedUnitId}/location`, { lat: 18.5204, lon: 73.8567 });
    if (unauthLoc.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated location update, got ${unauthLoc.status}`);
    }
    console.log('✓ Unauthenticated location update rejected with 401 Unauthorized.');

    // 4. Cross-unit mutation attempt: Create second dummy unit and try mutating with first driver's token
    const regDriver2 = await request('POST', '/api/drivers/register', {
      role: 'Ambulance',
      driverName: 'Other Driver',
      mobileNumber: '9900998877',
      password: 'OtherPassword#2026',
      vehicleNumber: 'MH12ZZ9988',
      locationType: 'CAMP_ZONE'
    });
    if (regDriver2.status === 200) {
      const otherUnitId = regDriver2.data.driver.unitId;

      // Try mutating other unit with driver 1's token -> should be 403 Forbidden
      const crossUnitStatus = await request('POST', `/api/teams/${otherUnitId}/status`, { status: 'BUSY' }, {
        'Authorization': `Bearer ${driverAuthToken}`
      });
      if (crossUnitStatus.status !== 403) {
        throw new Error(`Expected 403 Forbidden for cross-unit status update, got ${crossUnitStatus.status}`);
      }
      console.log('✓ Cross-unit status mutation attempt rejected with 403 Forbidden.');

      const crossUnitLoc = await request('POST', `/api/teams/${otherUnitId}/location`, { lat: 18.5204, lon: 73.8567 }, {
        'Authorization': `Bearer ${driverAuthToken}`
      });
      if (crossUnitLoc.status !== 403) {
        throw new Error(`Expected 403 Forbidden for cross-unit location update, got ${crossUnitLoc.status}`);
      }
      console.log('✓ Cross-unit location update attempt rejected with 403 Forbidden.');

      // Clean up second test driver from Supabase
      try {
        await supabaseDirect.from('response_units').delete().eq('id', otherUnitId);
        await supabaseDirect.from('driver_accounts').delete().eq('id', regDriver2.data.driver.id);
        await supabaseDirect.auth.admin.deleteUser(regDriver2.data.driver.id);
      } catch (e) {}
    }

    // 5. Invalid coordinates rejected (400)
    const badCoordsRes = await request('POST', `/api/teams/${assignedUnitId}/location`, { lat: 999.0, lon: 73.8567 }, {
      'Authorization': `Bearer ${driverAuthToken}`
    });
    if (badCoordsRes.status !== 400) {
      throw new Error(`Expected 400 for out-of-range latitude, got ${badCoordsRes.status}`);
    }
    console.log('✓ Out-of-bounds coordinate update rejected with 400 Bad Request.');

    const zeroCoordsRes = await request('POST', `/api/teams/${assignedUnitId}/location`, { lat: 0, lon: 0 }, {
      'Authorization': `Bearer ${driverAuthToken}`
    });
    if (zeroCoordsRes.status !== 400) {
      throw new Error(`Expected 400 for (0,0) coordinates, got ${zeroCoordsRes.status}`);
    }
    console.log('✓ Zero (0, 0) coordinates rejected with 400 Bad Request.');

    // 6. Authorized valid status & location update succeeds
    const validStatusRes = await request('POST', `/api/teams/${assignedUnitId}/status`, { status: 'BUSY' }, {
      'Authorization': `Bearer ${driverAuthToken}`
    });
    if (validStatusRes.status !== 200) {
      throw new Error(`Expected 200 for valid authorized status update, got ${validStatusRes.status}`);
    }
    console.log('✓ Authorized status update succeeded (BUSY).');

    // Restore to AVAILABLE
    await request('POST', `/api/teams/${assignedUnitId}/status`, { status: 'AVAILABLE' }, {
      'Authorization': `Bearer ${driverAuthToken}`
    });

    const validLocRes = await request('POST', `/api/teams/${assignedUnitId}/location`, { lat: 18.5160, lon: 73.8400 }, {
      'Authorization': `Bearer ${driverAuthToken}`
    });
    if (validLocRes.status !== 200) {
      throw new Error(`Expected 200 for valid authorized location update, got ${validLocRes.status}`);
    }
    console.log('✓ Authorized location update succeeded with valid coordinates.\n');

    // -------------------------------------------------------------
    // TEST 5 — EMERGENCY DISPATCH
    // -------------------------------------------------------------
    console.log('>>> [TEST 5 — EMERGENCY DISPATCH]');
    // Create test emergency at Kothrud (Node Kothrud_H, near Deccan_Gymkhana_D)
    const emRes = await request('POST', '/api/emergencies', {
      id: TEST_EMERGENCY_ID,
      type: 'MEDICAL',
      priority: 'HIGH',
      nodeId: 'Kothrud_H',
      lat: 18.5074,
      lon: 73.8077,
      description: 'Automated E2E Test Medical Emergency',
      injuredCount: 2,
      severity: 3
    });

    if (emRes.status !== 200) throw new Error('Emergency creation failed: ' + JSON.stringify(emRes.data));
    console.log(`✓ Emergency ${TEST_EMERGENCY_ID} created via API.`);

    if (emRes.data.allocatedTeamId !== assignedUnitId) {
      throw new Error(`Expected allocation to ${assignedUnitId}, got: ${emRes.data.allocatedTeamId}`);
    }
    console.log(`✓ Compatible unit selected and allocated by C++ Engine: ${emRes.data.allocatedTeamId}`);

    if (!emRes.data.route || !emRes.data.route.nodeIds || emRes.data.route.nodeIds.length === 0) {
      throw new Error('C++ Dijkstra routing failed: no route nodes returned');
    }
    console.log(`✓ C++ Dijkstra calculated route: [${emRes.data.route.nodeIds.join(' -> ')}]`);
    console.log(`✓ Total Distance: ${emRes.data.route.totalDistanceKm} km | Calculated ETA: ${emRes.data.route.etaMinutes} mins`);

    // Verify persistence in live Supabase
    const { data: dbEm } = await supabaseDirect
      .from('emergencies')
      .select('*')
      .eq('id', TEST_EMERGENCY_ID)
      .single();
    if (!dbEm || dbEm.allocated_team_id !== assignedUnitId || dbEm.status !== 'ASSIGNED') {
      throw new Error('Emergency record mismatch in live Supabase: ' + JSON.stringify(dbEm));
    }
    console.log('✓ Emergency persistence verified in Supabase (status: ASSIGNED).');

    const { data: dbAsg } = await supabaseDirect
      .from('assignments')
      .select('*')
      .eq('emergency_id', TEST_EMERGENCY_ID)
      .single();
    if (!dbAsg || dbAsg.team_id !== assignedUnitId || !Array.isArray(dbAsg.route_nodes)) {
      throw new Error('Assignment record mismatch in live Supabase: ' + JSON.stringify(dbAsg));
    }
    console.log('✓ Assignment persistence verified in Supabase with Dijkstra route nodes array.');

    const foundWsDispatch = wsMessages.some(m => m.eventType === 'EMERGENCY_REPORTED');
    if (!foundWsDispatch) throw new Error('Command Center did not receive EMERGENCY_REPORTED over WebSocket');
    console.log('✓ Command Center received real-time dispatch update over WebSocket.\n');

    // -------------------------------------------------------------
    // TEST 6 — ROAD BLOCKAGE AND REROUTING
    // -------------------------------------------------------------
    console.log('>>> [TEST 6 — ROAD BLOCKAGE AND REROUTING]');
    // Block direct road R_DH (Deccan_Gymkhana_D <-> Kothrud_H)
    const blockRes = await request('POST', '/api/roads/R_DH/status', { status: 'BLOCKED' });
    if (blockRes.status !== 200) throw new Error('Road block request failed: ' + JSON.stringify(blockRes.data));
    console.log('✓ Road R_DH (Deccan <-> Kothrud) set to BLOCKED.');

    if (!blockRes.data.reroute || !blockRes.data.reroute.nodeIds) {
      throw new Error('C++ Engine dynamic reroute failed on road blockage: no alternative route calculated');
    }
    console.log(`✓ C++ Engine dynamically calculated alternative route: [${blockRes.data.reroute.nodeIds.join(' -> ')}]`);
    console.log(`✓ New Distance: ${blockRes.data.reroute.totalDistanceKm} km | Recalculated ETA: ${blockRes.data.reroute.etaMinutes} mins`);

    const foundWsRoadBlock = wsMessages.some(m => m.eventType === 'ROAD_STATUS_CHANGED' && m.status === 'BLOCKED');
    if (!foundWsRoadBlock) throw new Error('Command Center did not receive ROAD_STATUS_CHANGED over WebSocket');
    console.log('✓ Revised route broadcasted to Command Center over WebSocket.');

    // Restore road to OPEN
    const unblockRes = await request('POST', '/api/roads/R_DH/status', { status: 'OPEN' });
    if (unblockRes.status !== 200) throw new Error('Failed to unblock road: ' + JSON.stringify(unblockRes.data));
    console.log('✓ Road R_DH successfully restored to OPEN.\n');

    // -------------------------------------------------------------
    // TEST 7 — PERSISTENCE AND RESTART
    // -------------------------------------------------------------
    console.log('>>> [TEST 7 — PERSISTENCE AND RESTART]');
    // Logout unit before restarting to test offline state
    const logoutRes = await request('POST', `/api/teams/${assignedUnitId}/logout`, {}, {
      'Authorization': `Bearer ${driverAuthToken}`
    });
    if (logoutRes.status !== 200) throw new Error('Logout failed: ' + JSON.stringify(logoutRes.data));
    console.log(`✓ Unit ${assignedUnitId} logged out (persisted OFFLINE).`);

    const postLogoutFleet = await request('GET', '/api/teams');
    if (postLogoutFleet.data.count !== 0) throw new Error('Unit did not disappear from active fleet after logout');
    console.log('✓ Unit disappeared from active fleet after logout.');

    // Restart server
    console.log('Killing backend process and restarting server...');
    if (wsClient) wsClient.close();
    serverProc.kill();
    await delay(1000);

    serverProc = await startServer();
    console.log('✓ Second backend instance spawned.');

    const rebootFleet = await request('GET', '/api/teams');
    if (rebootFleet.data.count !== 0) {
      throw new Error('Expected 0 active teams immediately after restart, got: ' + rebootFleet.data.count);
    }
    console.log('✓ Confirmed 0 active units on reboot: saved units do not automatically become online.');

    const rebootLogin = await request('POST', '/api/drivers/login', {
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD
    });
    if (rebootLogin.status !== 200 || rebootLogin.data.driver.unitId !== assignedUnitId || rebootLogin.data.isOnline !== false) {
      throw new Error('Saved driver login failed on rebooted backend: ' + JSON.stringify(rebootLogin.data));
    }
    console.log('✓ Saved driver account and unit metadata retrieved from Supabase after backend restart.');

    // Check emergency and assignment survived restart
    const { data: rebootEm } = await supabaseDirect
      .from('emergencies')
      .select('*')
      .eq('id', TEST_EMERGENCY_ID)
      .single();
    if (!rebootEm || rebootEm.id !== TEST_EMERGENCY_ID) throw new Error('Emergency not found in Supabase after restart');
    console.log('✓ Persisted emergency record survived restart in live Supabase.');

    const { data: rebootAsg } = await supabaseDirect
      .from('assignments')
      .select('*')
      .eq('emergency_id', TEST_EMERGENCY_ID)
      .single();
    if (!rebootAsg || rebootAsg.emergency_id !== TEST_EMERGENCY_ID) throw new Error('Assignment not found in Supabase after restart');
    console.log('✓ Persisted assignment and Dijkstra route survived restart in live Supabase.\n');

    console.log('================================================================');
    console.log('ALL INTEGRATION TEST SUITES COMPLETED WITH 100% PASS!');
    console.log('================================================================');

  } finally {
    if (wsClient) wsClient.close();
    if (serverProc) serverProc.kill();
    // Safety cleanup of test records only
    await cleanupDedicatedTestData();
    console.log('Dedicated test records cleaned up from live Supabase.');
  }
}

run().catch(err => {
  console.error('\n*** INTEGRATION SUITE FAILED ***:', err);
  process.exit(1);
});
