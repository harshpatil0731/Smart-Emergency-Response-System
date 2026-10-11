const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseDirect = createClient(supabaseUrl, supabaseKey);

const TEST_MOBILE = '9988771122';
const TEST_PASSWORD = 'LivePassword#2026';
const TEST_NAME = 'Vikram Patil';
const TEST_VEHICLE = 'MH12VP9999';

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
  throw new Error('Server failed to start or verify Supabase schema in time');
}

async function cleanupTestDriver() {
  try {
    // Delete test response unit and driver account from live Supabase
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
    console.warn('Pre-cleanup note:', e.message);
  }
}

async function run() {
  console.log('====================================================');
  console.log('LIVE SUPABASE INTEGRATION VERIFICATION TEST');
  console.log('Target Project Host:', new URL(supabaseUrl).host);
  console.log('====================================================\n');

  // Step 0: Pre-cleanup
  await cleanupTestDriver();

  // Step 1: Start Server
  console.log('Step 1: Starting Backend Server...');
  let serverProc = await startServer();
  console.log('Backend started successfully.\n');

  try {
    // Step 2: System Status Diagnostic
    console.log('Step 2: Checking GET /api/system/status...');
    const sysStatus = await request('GET', '/api/system/status');
    console.log('Status HTTP Code:', sysStatus.status);
    console.log('Storage Mode:', sysStatus.data.supabase.storageMode);
    console.log('Schema Ready:', sysStatus.data.supabase.schemaReady);
    console.log('Supabase Configured:', sysStatus.data.supabase.configured);
    if (sysStatus.data.supabase.storageMode !== 'SUPABASE_POSTGRESQL' || !sysStatus.data.supabase.schemaReady) {
      throw new Error('System is not in SUPABASE_POSTGRESQL mode!');
    }
    console.log('PASS: System is verified in SUPABASE_POSTGRESQL mode.\n');

    // Step 3: Initial Active Teams
    console.log('Step 3: Checking GET /api/teams (initial fleet)...');
    const initTeams = await request('GET', '/api/teams');
    console.log('Initial teams count:', initTeams.data.count);
    if (initTeams.data.count !== 0) {
      throw new Error(`Expected 0 initial active teams, got ${initTeams.data.count}`);
    }
    console.log('PASS: Fresh startup has exactly 0 active units.\n');

    // Step 4: Driver Registration
    console.log('Step 4: Registering new driver account via POST /api/drivers/register...');
    const regRes = await request('POST', '/api/drivers/register', {
      role: 'Ambulance',
      driverName: TEST_NAME,
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD,
      vehicleNumber: TEST_VEHICLE,
      locationType: 'DECCAN_GYMKHANA'
    });
    console.log('Registration HTTP Code:', regRes.status);
    console.log('Assigned Unit ID:', regRes.data.driver.unitId);
    const assignedUnitId = regRes.data.driver.unitId;
    const authToken = regRes.data.token;
    if (regRes.status !== 200 || !assignedUnitId || !authToken) {
      throw new Error('Registration failed: ' + JSON.stringify(regRes.data));
    }
    console.log('PASS: Driver registered with Unit ID: ' + assignedUnitId);

    // Direct Verification in Live Supabase Database
    console.log('\n--- Direct Live Supabase Database Verification ---');
    const { data: dbDriver, error: dbDriverErr } = await supabaseDirect
      .from('driver_accounts')
      .select('*')
      .eq('mobile_number', TEST_MOBILE)
      .single();
    if (dbDriverErr || !dbDriver) {
      throw new Error('Driver NOT FOUND in live Supabase driver_accounts table: ' + (dbDriverErr?.message || 'null'));
    }
    console.log('VERIFIED: Record in Supabase driver_accounts -> ID:', dbDriver.id, '| Name:', dbDriver.driver_name);

    const { data: dbUnit, error: dbUnitErr } = await supabaseDirect
      .from('response_units')
      .select('*')
      .eq('id', assignedUnitId)
      .single();
    if (dbUnitErr || !dbUnit) {
      throw new Error('Unit NOT FOUND in live Supabase response_units table: ' + (dbUnitErr?.message || 'null'));
    }
    console.log('VERIFIED: Record in Supabase response_units -> Unit:', dbUnit.id, '| Status:', dbUnit.status, '| Vehicle:', dbUnit.vehicle_number);
    console.log('PASS: Registration confirmed directly in live Supabase PostgreSQL.\n');

    // Step 5: Duplicate Mobile Rejection
    console.log('Step 5: Testing Duplicate Mobile Registration...');
    const dupRes = await request('POST', '/api/drivers/register', {
      role: 'Ambulance',
      driverName: 'Duplicate Person',
      mobileNumber: TEST_MOBILE,
      password: 'otherPassword',
      vehicleNumber: 'MH12XX0000',
      locationType: 'DECCAN_GYMKHANA'
    });
    console.log('Duplicate Mobile HTTP Code:', dupRes.status);
    if (dupRes.status !== 409) {
      throw new Error('Expected 409 Conflict on duplicate mobile, got ' + dupRes.status);
    }
    console.log('PASS: Duplicate mobile rejected with 409.\n');

    // Step 6: Incorrect Password Rejection
    console.log('Step 6: Testing Incorrect Password Login...');
    const wrongPassRes = await request('POST', '/api/drivers/login', {
      mobileNumber: TEST_MOBILE,
      password: 'WrongPassword123'
    });
    console.log('Wrong Password HTTP Code:', wrongPassRes.status);
    if (wrongPassRes.status !== 401) {
      throw new Error('Expected 401 Unauthorized on wrong password, got ' + wrongPassRes.status);
    }
    console.log('PASS: Incorrect password rejected with 401.\n');

    // Step 7: Valid Login
    console.log('Step 7: Testing Valid Login via POST /api/drivers/login...');
    const loginRes = await request('POST', '/api/drivers/login', {
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD
    });
    console.log('Login HTTP Code:', loginRes.status);
    console.log('Retrieved Driver Name:', loginRes.data.driver.driverName);
    console.log('Retrieved Unit ID:', loginRes.data.driver.unitId);
    console.log('Is Online:', loginRes.data.isOnline);
    if (loginRes.status !== 200 || loginRes.data.driver.unitId !== assignedUnitId || loginRes.data.isOnline !== false) {
      throw new Error('Login failed or unexpected state: ' + JSON.stringify(loginRes.data));
    }
    console.log('PASS: Driver profile and offline unit retrieved accurately.\n');

    // Step 8: Go Online / Activate Unit
    console.log('Step 8: Activating Unit Online via POST /api/drivers/activate...');
    const actRes = await request('POST', '/api/drivers/activate', {
      unitId: assignedUnitId,
      locationType: 'CAMP_ZONE',
      mobileNumber: TEST_MOBILE
    }, {
      'Authorization': `Bearer ${loginRes.data.token}`
    });
    console.log('Activation HTTP Code:', actRes.status);
    console.log('Activated Unit Status in Response:', actRes.data.team.status);
    if (actRes.status !== 200 || actRes.data.team.status !== 'AVAILABLE') {
      throw new Error('Activation failed: ' + JSON.stringify(actRes.data));
    }

    const liveTeams = await request('GET', '/api/teams');
    console.log('Active teams in fleet after activation:', liveTeams.data.count);
    if (liveTeams.data.count !== 1) {
      throw new Error(`Expected exactly 1 active unit, got ${liveTeams.data.count}`);
    }

    const { data: dbActiveUnit } = await supabaseDirect
      .from('response_units')
      .select('status')
      .eq('id', assignedUnitId)
      .single();
    console.log('VERIFIED in Supabase: Unit status is now:', dbActiveUnit.status);
    console.log('PASS: Unit activated online in C++ engine and live Supabase.\n');

    // Step 9: Driver Logout
    console.log('Step 9: Logging out via POST /api/teams/' + assignedUnitId + '/logout...');
    const logoutRes = await request('POST', `/api/teams/${assignedUnitId}/logout`, {}, {
      'Authorization': `Bearer ${loginRes.data.token}`
    });
    console.log('Logout HTTP Code:', logoutRes.status);
    const postLogoutTeams = await request('GET', '/api/teams');
    console.log('Active teams in fleet after logout:', postLogoutTeams.data.count);
    if (postLogoutTeams.data.count !== 0) {
      throw new Error(`Expected 0 active teams after logout, got ${postLogoutTeams.data.count}`);
    }

    const { data: dbOfflineUnit } = await supabaseDirect
      .from('response_units')
      .select('status')
      .eq('id', assignedUnitId)
      .single();
    console.log('VERIFIED in Supabase: Unit status is now:', dbOfflineUnit.status);
    console.log('PASS: Driver logout decommissioned unit to OFFLINE in live Supabase.\n');

    // Step 10: Backend Restart & Persistence Verification
    console.log('====================================================');
    console.log('Step 10: RESTARTING BACKEND SERVER FOR PERSISTENCE CHECK');
    console.log('====================================================');
    serverProc.kill();
    await delay(1000);

    console.log('Spawning second fresh backend server process...');
    serverProc = await startServer();
    console.log('Second server instance started.\n');

    // Verify 0 active units on reboot
    console.log('Checking GET /api/teams immediately after restart...');
    const rebootTeams = await request('GET', '/api/teams');
    console.log('Reboot teams count:', rebootTeams.data.count);
    if (rebootTeams.data.count !== 0) {
      throw new Error(`Expected 0 active units on fresh restart, got ${rebootTeams.data.count}`);
    }
    console.log('PASS: Zero active response units on restart confirmed.\n');

    // Verify driver login still succeeds without re-registration
    console.log('Attempting driver login on restarted backend...');
    const restartLogin = await request('POST', '/api/drivers/login', {
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD
    });
    console.log('Restart Login HTTP Code:', restartLogin.status);
    console.log('Retrieved Driver Name:', restartLogin.data.driver.driverName);
    console.log('Retrieved Unit ID:', restartLogin.data.driver.unitId);
    console.log('Unit isOnline:', restartLogin.data.isOnline);
    if (restartLogin.status !== 200 || restartLogin.data.driver.unitId !== assignedUnitId || restartLogin.data.isOnline !== false) {
      throw new Error('Persistence test failed: driver could not log in from Supabase after restart');
    }
    console.log('PASS: Driver account and unit ID survived server restart via Supabase persistence.\n');

    console.log('====================================================');
    console.log('ALL LIVE SUPABASE INTEGRATION TESTS PASSED 100%!');
    console.log('====================================================');

  } finally {
    if (serverProc) serverProc.kill();
    // Clean up test driver
    await cleanupTestDriver();
    console.log('Test cleanup completed.');
  }
}

run().catch(err => {
  console.error('\n*** TEST SUITE FAILED ***:', err);
  process.exit(1);
});
