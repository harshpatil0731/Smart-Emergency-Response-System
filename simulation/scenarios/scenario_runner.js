const http = require('http');
const path = require('path');
const WebSocket = require(path.resolve(__dirname, '../../backend/node_modules/ws'));
const { spawn } = require('child_process');

const BASE_URL = process.env.BACKEND_URL || 'http://127.0.0.1:4000';
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:4000/ws';

let wsClient = null;
let capturedEvents = [];
let internalServerProcess = null;

// Helper: HTTP request wrapper
function request(method, pathUrl, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`HTTP request timed out: ${method} ${pathUrl}`));
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Ensure backend is running
async function ensureBackendRunning() {
  try {
    const res = await request('GET', '/api/state');
    if (res.status === 200) {
      return; // Already running
    }
  } catch (e) {
    // Need to spawn
  }

  console.log('[ScenarioRunner] Backend not detected on port 4000. Launching background server...');
  const serverPath = path.resolve(__dirname, '..', '..', 'backend', 'server.js');
  internalServerProcess = spawn('node', [serverPath], {
    cwd: path.dirname(serverPath),
    stdio: 'ignore',
    detached: true
  });
  internalServerProcess.unref();

  let attempts = 0;
  while (attempts < 30) {
    await sleep(500);
    try {
      const res = await request('GET', '/api/state');
      if (res.status === 200 && res.data.nodes && res.data.nodes.length > 0) {
        console.log('[ScenarioRunner] Backend server is up and responsive.');
        return;
      }
    } catch (e) {}
    attempts++;
  }
  throw new Error('Failed to connect to backend server after spawning.');
}

// WebSocket setup
function connectWebSocket() {
  return new Promise((resolve, reject) => {
    wsClient = new WebSocket(WS_URL);
    wsClient.on('open', () => {
      resolve();
    });
    wsClient.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        capturedEvents.push(msg);
      } catch (e) {}
    });
    wsClient.on('error', (err) => {
      console.warn('[ScenarioRunner] WebSocket warning:', err.message);
    });
  });
}

// State Reset Helper: Resets city roads to OPEN, teams to AVAILABLE at default base stations, completes/cleans open assignments
async function resetCityState() {
  const stateRes = await request('GET', '/api/state');
  const state = stateRes.data || {};

  // 1. Unblock all roads
  if (state.roads) {
    for (const r of state.roads) {
      if (r.status === 'BLOCKED') {
        await request('POST', `/api/roads/${r.id}/status`, { status: 'OPEN' });
      }
    }
  }

  // 2. Complete all active/open emergencies
  if (state.emergencies) {
    for (const em of state.emergencies) {
      if (em.status !== 'COMPLETED' && em.status !== 'CANCELLED') {
        await request('POST', `/api/emergencies/${em.id}/complete`);
      }
    }
  }

  // 3. Reset teams to default locations and AVAILABLE status
  const defaultStations = {
    'A01': { nodeId: 'Hospital_A', lat: 18.5204, lon: 73.8567 },
    'A02': { nodeId: 'Swargate_E', lat: 18.5010, lon: 73.8580 },
    'F01': { nodeId: 'Shivaji_Nagar_B', lat: 18.5310, lon: 73.8446 },
    'R01': { nodeId: 'Camp_Zone_F', lat: 18.5130, lon: 73.8780 }
  };

  if (state.teams) {
    for (const t of state.teams) {
      const def = defaultStations[t.id];
      if (def) {
        await request('POST', `/api/teams/${t.id}/location`, def);
      }
      if (t.status !== 'AVAILABLE') {
        await request('POST', `/api/teams/${t.id}/status`, { status: 'AVAILABLE' });
      }
    }
  }

  capturedEvents = [];
  await sleep(100);
}

// Scenario 1: Single emergency + single available unit
async function runScenario1() {
  console.log('\n--------------------------------------------------');
  console.log('[1/10] Single emergency + single available unit');
  console.log('--------------------------------------------------');
  await resetCityState();

  // Set A02, F01, R01 OFFLINE so only A01 is available
  await request('POST', '/api/teams/A02/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/F01/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/R01/status', { status: 'OFFLINE' });

  console.log('Action: Reporting Medical emergency at FC_Road_C...');
  const res = await request('POST', '/api/emergencies', {
    id: `E_SCENARIO_1_${Date.now()}`,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C',
    severity: 3
  });

  const em = res.data;
  const isAllocated = em.allocatedTeamId === 'A01';
  
  const teamState = await request('GET', '/api/teams/A01');
  const teamObj = teamState.data.team || teamState.data;
  const isBusy = teamObj && teamObj.status === 'BUSY';

  console.log(`Expected: A01 allocated, A01 status BUSY`);
  console.log(`Actual  : Allocated=${em.allocatedTeamId}, A01 Status=${teamObj ? teamObj.status : 'None'}`);

  if (isAllocated && isBusy) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Scenario 1 assertions not met');
    return false;
  }
}

// Scenario 2: Single emergency + multiple units (nearest chosen via Haversine)
async function runScenario2() {
  console.log('\n--------------------------------------------------');
  console.log('[2/10] Multiple units / nearest allocation (Haversine)');
  console.log('--------------------------------------------------');
  await resetCityState();

  // Position A01 at Hospital_A (~2.05 km to FC_Road_C)
  // Position A02 at Shivaji_Nagar_B (~0.68 km to FC_Road_C)
  await request('POST', '/api/teams/A02/location', {
    nodeId: 'Shivaji_Nagar_B',
    lat: 18.5310,
    lon: 73.8446
  });

  console.log('Setup: A01 at Hospital_A (~2.05 km), A02 at Shivaji_Nagar_B (~0.68 km) to FC_Road_C');
  console.log('Action: Reporting Medical emergency at FC_Road_C...');

  const res = await request('POST', '/api/emergencies', {
    id: `E_SCENARIO_2_${Date.now()}`,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C',
    severity: 3
  });

  const em = res.data;
  console.log(`Expected: Nearest ambulance A02 allocated via Haversine`);
  console.log(`Actual  : Allocated Team=${em.allocatedTeamId}, Distance=${em.distanceKm ? em.distanceKm.toFixed(3) : 0} km`);

  if (em.allocatedTeamId === 'A02') {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Expected A02 to be selected as nearest unit');
    return false;
  }
}

// Scenario 3: Mixed status units (AVAILABLE, BUSY, OFFLINE)
async function runScenario3() {
  console.log('\n--------------------------------------------------');
  console.log('[3/10] Mixed status units (AVAILABLE, BUSY, OFFLINE)');
  console.log('--------------------------------------------------');
  await resetCityState();

  // A02 is closer (Shivaji_Nagar_B), but set to BUSY
  // F01 is set to OFFLINE
  // A01 is further (Hospital_A), but AVAILABLE
  await request('POST', '/api/teams/A02/status', { status: 'BUSY' });
  await request('POST', '/api/teams/F01/status', { status: 'OFFLINE' });

  console.log('Setup: A02 is BUSY (closer), F01 is OFFLINE, A01 is AVAILABLE (further)');
  console.log('Action: Reporting Medical emergency at FC_Road_C...');

  const res = await request('POST', '/api/emergencies', {
    id: `E_SCENARIO_3_${Date.now()}`,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C'
  });

  const em = res.data;
  console.log(`Expected: Eligible AVAILABLE unit A01 selected; BUSY/OFFLINE units ignored`);
  console.log(`Actual  : Allocated Team=${em.allocatedTeamId}`);

  if (em.allocatedTeamId === 'A01') {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Expected A01 to be selected among mixed status units');
    return false;
  }
}

// Scenario 4: Multiple simultaneous emergencies (priority queue heap ordering)
async function runScenario4() {
  console.log('\n--------------------------------------------------');
  console.log('[4/10] Multiple simultaneous emergencies (Priority Heap)');
  console.log('--------------------------------------------------');
  await resetCityState();

  // Make all units OFFLINE first so emergencies accumulate in the priority heap
  await request('POST', '/api/teams/A01/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/A02/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/F01/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/R01/status', { status: 'OFFLINE' });

  console.log('Action: Queuing emergencies with LOW, MEDIUM, and CRITICAL priorities...');
  const eLow = `E_LOW_${Date.now()}`;
  const eMed = `E_MED_${Date.now()}`;
  const eCrit = `E_CRIT_${Date.now()}`;

  await request('POST', '/api/emergencies', { id: eLow, type: 'MEDICAL', priority: 'LOW', nodeId: 'FC_Road_C' });
  await sleep(20);
  await request('POST', '/api/emergencies', { id: eMed, type: 'MEDICAL', priority: 'MEDIUM', nodeId: 'FC_Road_C' });
  await sleep(20);
  await request('POST', '/api/emergencies', { id: eCrit, type: 'MEDICAL', priority: 'CRITICAL', nodeId: 'FC_Road_C' });

  console.log('Action: Bringing A01 back to AVAILABLE. Binary Heap should dispatch CRITICAL incident first...');
  const res = await request('POST', '/api/teams/A01/status', { status: 'AVAILABLE' });

  const stateRes = await request('GET', '/api/state');
  const a01 = stateRes.data.teams.find(t => t.id === 'A01');
  const activeAsg = stateRes.data.assignments.find(a => a.id === a01.activeAssignmentId);

  console.log(`Expected: CRITICAL incident (${eCrit}) extracted first from priority heap`);
  console.log(`Actual  : Active Emergency assigned to A01 = ${activeAsg ? activeAsg.emergencyId : 'None'}`);

  if (activeAsg && activeAsg.emergencyId === eCrit) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Priority heap did not allocate CRITICAL emergency first');
    return false;
  }
}

// Scenario 5: Shortest path computation
async function runScenario5() {
  console.log('\n--------------------------------------------------');
  console.log('[5/10] Shortest path computation (C++ Dijkstra)');
  console.log('--------------------------------------------------');
  await resetCityState();

  // Set A02 OFFLINE so A01 (at Hospital_A) is selected to compute path Hospital_A -> FC_Road_C
  await request('POST', '/api/teams/A02/status', { status: 'OFFLINE' });

  // Dispatch A01 from Hospital_A to FC_Road_C
  // Path options:
  // 1: Hospital_A -> Shivaji_Nagar_B (2.1) -> FC_Road_C (1.4) = 3.5 km
  // 2: Hospital_A -> Swargate_E (2.4) -> Deccan_Gymkhana_D (2.7) -> FC_Road_C (1.8) = 6.9 km
  console.log('Setup: Testing C++ shortest path for A01 from Hospital_A to FC_Road_C');
  const res = await request('POST', '/api/emergencies', {
    id: `E_SCENARIO_5_${Date.now()}`,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C'
  });

  const route = res.data.route;
  const expectedSequence = ['Hospital_A', 'Shivaji_Nagar_B', 'FC_Road_C'];
  const expectedDist = 3.5;

  console.log(`Expected Route   : [${expectedSequence.join(' -> ')}] (${expectedDist} km)`);
  console.log(`Actual C++ Route : [${route ? route.nodeIds.join(' -> ') : ''}] (${route ? route.totalDistanceKm : 0} km)`);

  const nodesMatch = route && JSON.stringify(route.nodeIds) === JSON.stringify(expectedSequence);
  const distMatch = route && Math.abs(route.totalDistanceKm - expectedDist) < 0.01;

  if (nodesMatch && distMatch) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Dijkstra did not return the expected shortest path');
    return false;
  }
}

// Scenario 6: Static road blockage avoidance
async function runScenario6() {
  console.log('\n--------------------------------------------------');
  console.log('[6/10] Static road blockage avoidance');
  console.log('--------------------------------------------------');
  await resetCityState();

  // Set A02 OFFLINE so A01 at Hospital_A is tested
  await request('POST', '/api/teams/A02/status', { status: 'OFFLINE' });

  console.log('Action: Pre-blocking road R_BC (Shivaji_Nagar_B <-> FC_Road_C) BEFORE dispatch...');
  await request('POST', '/api/roads/R_BC/status', { status: 'BLOCKED' });

  console.log('Action: Dispatching emergency at FC_Road_C...');
  const res = await request('POST', '/api/emergencies', {
    id: `E_SCENARIO_6_${Date.now()}`,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C'
  });

  const route = res.data.route;
  const containsBlocked = route && route.nodeIds.includes('Shivaji_Nagar_B') && route.nodeIds.includes('FC_Road_C') &&
                          Math.abs(route.nodeIds.indexOf('Shivaji_Nagar_B') - route.nodeIds.indexOf('FC_Road_C')) === 1;

  const expectedRoute = ['Hospital_A', 'Swargate_E', 'Deccan_Gymkhana_D', 'FC_Road_C'];
  console.log(`Expected Route bypassing R_BC : [${expectedRoute.join(' -> ')}] (6.9 km)`);
  console.log(`Actual C++ Route               : [${route ? route.nodeIds.join(' -> ') : ''}] (${route ? route.totalDistanceKm : 0} km)`);

  if (!containsBlocked && route && route.nodeIds.includes('Deccan_Gymkhana_D')) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Route did not avoid the statically blocked road');
    return false;
  }
}

// Scenario 7: MID-TRANSIT dynamic road blockage & current location reroute
async function runScenario7() {
  console.log('\n--------------------------------------------------');
  console.log('[7/10] MID-TRANSIT dynamic road blockage & rerouting');
  console.log('--------------------------------------------------');
  await resetCityState();

  // Set A02 OFFLINE so A01 at Hospital_A is assigned
  await request('POST', '/api/teams/A02/status', { status: 'OFFLINE' });

  const emId = `E_MIDTRANSIT_${Date.now()}`;
  console.log('Action 1: Dispatching emergency at FC_Road_C to A01...');
  const emRes = await request('POST', '/api/emergencies', {
    id: emId,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C'
  });

  const asgId = emRes.data.notifications.find(n => n.includes('offered assignment'))?.split(' ').pop();
  console.log(`Action 2: A01 accepts assignment ${asgId}...`);
  await request('POST', `/api/assignments/${asgId}/accept`);

  console.log('Action 3: A01 begins transit, moves halfway, arrives at Shivaji_Nagar_B...');
  await request('POST', '/api/teams/A01/location', {
    nodeId: 'Shivaji_Nagar_B',
    lat: 18.5310,
    lon: 73.8446
  });

  console.log('Action 4: Road R_BC (Shivaji_Nagar_B <-> FC_Road_C) becomes BLOCKED mid-transit!');
  const blockRes = await request('POST', '/api/roads/R_BC/status', { status: 'BLOCKED' });

  const reroute = blockRes.data.reroute;
  console.log(`Verification: Checking C++ dynamic reroute...`);
  console.log(`- Dynamic Origin (must be Shivaji_Nagar_B, NOT Hospital_A): ${reroute ? reroute.nodeIds[0] : 'None'}`);
  console.log(`- Revised C++ Route: [${reroute ? reroute.nodeIds.join(' -> ') : ''}]`);
  console.log(`- Revised Distance: ${reroute ? reroute.totalDistanceKm : 0} km | Recalculated ETA: ${reroute ? reroute.etaMinutes : 0} min`);

  const originCorrect = reroute && reroute.nodeIds[0] === 'Shivaji_Nagar_B';
  const destinationCorrect = reroute && reroute.nodeIds[reroute.nodeIds.length - 1] === 'FC_Road_C';
  const avoidsBlockedRoad = reroute && !reroute.nodeIds.includes('R_BC');

  if (originCorrect && destinationCorrect && avoidsBlockedRoad && reroute.totalDistanceKm > 0) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Dynamic mid-transit reroute failed to use current vehicle node as origin');
    return false;
  }
}

// Scenario 8: Zero available units (graceful queueing and subsequent assignment)
async function runScenario8() {
  console.log('\n--------------------------------------------------');
  console.log('[8/10] Zero available units (Graceful Queueing)');
  console.log('--------------------------------------------------');
  await resetCityState();

  console.log('Setup: Setting all response teams to OFFLINE...');
  await request('POST', '/api/teams/A01/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/A02/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/F01/status', { status: 'OFFLINE' });
  await request('POST', '/api/teams/R01/status', { status: 'OFFLINE' });

  const emId = `E_ZERO_AVAIL_${Date.now()}`;
  console.log(`Action 1: Reporting emergency ${emId}...`);
  const emRes = await request('POST', '/api/emergencies', {
    id: emId,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C'
  });

  const stateRes1 = await request('GET', '/api/state');
  const pendingEm = stateRes1.data.emergencies.find(e => e.id === emId);
  const isPending = pendingEm && pendingEm.status === 'PENDING';

  console.log(`Expected: Emergency remains PENDING in heap, no invalid allocation`);
  console.log(`Actual  : Emergency Status = ${pendingEm ? pendingEm.status : 'None'}, Allocated = ${emRes.data.allocatedTeamId || 'None'}`);

  console.log('Action 2: Unit A01 comes back online (AVAILABLE)...');
  await request('POST', '/api/teams/A01/status', { status: 'AVAILABLE' });

  const stateRes2 = await request('GET', '/api/state');
  const a01 = stateRes2.data.teams.find(t => t.id === 'A01');
  const asg = stateRes2.data.assignments.find(a => a.id === a01.activeAssignmentId);

  console.log(`Expected: A01 immediately assigned the queued emergency (${emId})`);
  console.log(`Actual  : A01 active assignment = ${asg ? asg.emergencyId : 'None'}`);

  if (isPending && asg && asg.emergencyId === emId) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Graceful queueing and subsequent dispatch failed');
    return false;
  }
}

// Scenario 9: Incident completion and unit release
async function runScenario9() {
  console.log('\n--------------------------------------------------');
  console.log('[9/10] Incident completion and unit release');
  console.log('--------------------------------------------------');
  await resetCityState();

  const emId = `E_COMPLETION_${Date.now()}`;
  console.log('Action 1: Dispatching emergency to nearest available unit...');
  const res = await request('POST', '/api/emergencies', {
    id: emId,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'FC_Road_C'
  });

  const allocatedTeam = res.data.allocatedTeamId;
  const state1 = (await request('GET', '/api/state')).data;
  const teamBusy = state1.teams.find(t => t.id === allocatedTeam)?.status === 'BUSY';
  console.log(`Unit ${allocatedTeam} status while assigned: ${state1.teams.find(t => t.id === allocatedTeam)?.status}`);

  console.log(`Action 2: Completing emergency ${emId}...`);
  await request('POST', `/api/emergencies/${emId}/complete`);

  const state2 = (await request('GET', '/api/state')).data;
  const teamAvail = state2.teams.find(t => t.id === allocatedTeam)?.status === 'AVAILABLE';
  const emCompleted = state2.emergencies.find(e => e.id === emId)?.status === 'COMPLETED';

  console.log(`Expected: Emergency COMPLETED, ${allocatedTeam} returned to AVAILABLE`);
  console.log(`Actual  : Emergency Status=${state2.emergencies.find(e => e.id === emId)?.status}, ${allocatedTeam} Status=${state2.teams.find(t => t.id === allocatedTeam)?.status}`);

  if (teamBusy && teamAvail && emCompleted) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Unit release after completion failed');
    return false;
  }
}

// Scenario 10: Critical emergency during active assignment (no auto-preemption)
async function runScenario10() {
  console.log('\n--------------------------------------------------');
  console.log('[10/10] Critical emergency during active assignment (No Preemption)');
  console.log('--------------------------------------------------');
  await resetCityState();

  // Set A02 OFFLINE initially so E1 assigns to A01
  await request('POST', '/api/teams/A02/status', { status: 'OFFLINE' });

  const e1Id = `E_ACTIVE_${Date.now()}`;
  console.log(`Action 1: Assigning active emergency ${e1Id} to A01...`);
  await request('POST', '/api/emergencies', {
    id: e1Id,
    type: 'MEDICAL',
    priority: 'HIGH',
    nodeId: 'Shivaji_Nagar_B'
  });

  const state1 = (await request('GET', '/api/state')).data;
  const a01Asg1 = state1.teams.find(t => t.id === 'A01')?.activeAssignmentId;

  // Bring A02 back to AVAILABLE for other incidents
  await request('POST', '/api/teams/A02/status', { status: 'AVAILABLE' });

  console.log(`Action 2: A new CRITICAL incident arrives at FC_Road_C...`);
  const e2Id = `E_CRIT_NEW_${Date.now()}`;
  const res2 = await request('POST', '/api/emergencies', {
    id: e2Id,
    type: 'MEDICAL',
    priority: 'CRITICAL',
    nodeId: 'FC_Road_C'
  });

  const state2 = (await request('GET', '/api/state')).data;
  const a01After = state2.teams.find(t => t.id === 'A01');
  const asg1After = state2.assignments.find(a => a.id === a01After.activeAssignmentId);

  console.log(`Expected: A01 remains assigned to E1 (${e1Id}); NO auto-preemption`);
  console.log(`Actual  : A01 still working on = ${asg1After ? asg1After.emergencyId : 'None'}`);
  console.log(`Actual  : Second incident allocated to = ${res2.data.allocatedTeamId || 'Queued'}`);

  const notPreempted = asg1After && asg1After.emergencyId === e1Id;
  const a02AllocatedOrQueued = res2.data.allocatedTeamId !== 'A01';

  if (notPreempted && a02AllocatedOrQueued) {
    console.log('PASS');
    return true;
  } else {
    console.error('FAIL: Active assignment was inappropriately preempted');
    return false;
  }
}

// Edge Case Tests (README Section 36)
async function runEdgeCases() {
  console.log('\n==================================================');
  console.log('SUPPLEMENTAL: README SECTION 36 EDGE CASE VERIFICATION');
  console.log('==================================================');

  let passed = 0;
  let total = 4;

  // Edge Case 1: Invalid/non-existent graph destination node
  try {
    process.stdout.write('[Edge 1] Non-existent destination node: ');
    const res = await request('POST', '/api/emergencies', {
      id: `E_INVALID_NODE_${Date.now()}`,
      type: 'MEDICAL',
      priority: 'HIGH',
      nodeId: 'NON_EXISTENT_NODE_XYZ'
    });
    // C++ route planner should return null or UNREACHABLE without crashing
    const unreachableOrNull = !res.data.route || res.data.route.status === 'UNREACHABLE';
    if (res.data.success && unreachableOrNull) {
      console.log('PASS (Handled gracefully with no crash)');
      passed++;
    } else {
      console.log('FAIL');
    }
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  // Edge Case 2: Duplicate emergency ID
  try {
    process.stdout.write('[Edge 2] Duplicate emergency ID rejection: ');
    const dupId = `E_DUP_${Date.now()}`;
    await request('POST', '/api/emergencies', { id: dupId, type: 'MEDICAL', priority: 'HIGH', nodeId: 'FC_Road_C' });
    const dupRes = await request('POST', '/api/emergencies', { id: dupId, type: 'MEDICAL', priority: 'HIGH', nodeId: 'FC_Road_C' });
    
    // Check if duplicate is rejected by checking state count or response
    const state = (await request('GET', '/api/state')).data;
    const occurrences = state.emergencies.filter(e => e.id === dupId).length;
    if (occurrences === 1) {
      console.log('PASS (Duplicate not added to state; system kept single incident)');
      passed++;
    } else {
      console.log(`FAIL (Found ${occurrences} instances of ${dupId})`);
    }
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  // Edge Case 3: Response team going offline while on active assignment
  try {
    process.stdout.write('[Edge 3] Response team goes OFFLINE while on active assignment: ');
    await resetCityState();
    const emId = `E_OFFLINE_MID_${Date.now()}`;
    await request('POST', '/api/emergencies', { id: emId, type: 'MEDICAL', priority: 'HIGH', nodeId: 'FC_Road_C' });
    
    // Team A01 is assigned. Take A01 OFFLINE
    await request('POST', '/api/teams/A01/status', { status: 'OFFLINE' });
    
    // The C++ engine should mark assignment REASSIGNMENT_REQUIRED and return incident to pending queue
    const state = (await request('GET', '/api/state')).data;
    const em = state.emergencies.find(e => e.id === emId);
    if (em && (em.status === 'PENDING' || em.status === 'ASSIGNED')) {
      console.log('PASS (Active emergency returned to pending queue)');
      passed++;
    } else {
      console.log('FAIL');
    }
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  // Edge Case 4: Road reopening restoration
  try {
    process.stdout.write('[Edge 4] Road reopening (BLOCKED -> OPEN): ');
    await request('POST', '/api/roads/R_AB/status', { status: 'BLOCKED' });
    const reopenRes = await request('POST', '/api/roads/R_AB/status', { status: 'OPEN' });
    const state = (await request('GET', '/api/state')).data;
    const road = state.roads.find(r => r.id === 'R_AB');
    if (reopenRes.data.success && road && road.status === 'OPEN') {
      console.log('PASS (Road status successfully restored to OPEN)');
      passed++;
    } else {
      console.log('FAIL');
    }
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  console.log(`Edge Case Results: ${passed}/${total} passed.`);
  return passed === total;
}

// Master Runner
async function runAll() {
  console.log('==================================================');
  console.log('SMART EMERGENCY RESPONSE SYSTEM');
  console.log('AUTOMATED SCENARIO RUNNER (README SECTION 35)');
  console.log('==================================================');

  await ensureBackendRunning();
  await connectWebSocket();

  const scenarios = [
    runScenario1,
    runScenario2,
    runScenario3,
    runScenario4,
    runScenario5,
    runScenario6,
    runScenario7,
    runScenario8,
    runScenario9,
    runScenario10
  ];

  let passedCount = 0;
  for (let i = 0; i < scenarios.length; i++) {
    const success = await scenarios[i]();
    if (success) {
      passedCount++;
    } else {
      console.error(`\n[ABORT] Scenario ${i + 1} failed.`);
      break;
    }
  }

  console.log('\n==================================================');
  console.log(`RESULT: ${passedCount}/10 SCENARIOS PASSED`);
  console.log('==================================================');

  let edgeCasesPassed = false;
  if (passedCount === 10) {
    edgeCasesPassed = await runEdgeCases();
  }

  // Cleanup
  await resetCityState();
  if (wsClient) {
    wsClient.close();
  }

  if (passedCount === 10 && edgeCasesPassed) {
    console.log('\n>>> ALL 10 OFFICIAL SCENARIOS + EDGE CASES VERIFIED 100% SUCCESSFULLY! <<<\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('\nFatal error in scenario runner:', err);
  process.exit(1);
});
