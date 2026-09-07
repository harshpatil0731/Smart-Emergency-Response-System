const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json());

// Serve static frontend files if needed
app.use(express.static(path.join(__dirname, 'public')));

// Path to C++ Engine Executable with configuration fallback
const possibleEnginePaths = [
  path.resolve(__dirname, '..', 'ds-engine', 'build', 'Debug', 'engine_console.exe'),
  path.resolve(__dirname, '..', 'ds-engine', 'build', 'Release', 'engine_console.exe'),
  path.resolve(__dirname, '..', 'ds-engine', 'build', 'engine_console.exe'),
  path.resolve(__dirname, '..', 'ds-engine', 'build', 'engine_console')
];
const ENGINE_EXE = possibleEnginePaths.find(p => fs.existsSync(p)) || possibleEnginePaths[0];

// Spawn C++ Engine in IPC mode with Request-Response Correlation
let engineProcess = null;
let nextRequestId = 1;
const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }

function spawnEngine() {
  console.log(`[Backend] Spawning DS Engine: ${ENGINE_EXE} --ipc`);
  engineProcess = spawn(ENGINE_EXE, ['--ipc'], {
    stdio: ['pipe', 'pipe', 'inherit']
  });

  const rl = readline.createInterface({
    input: engineProcess.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    try {
      const response = JSON.parse(line);
      const reqId = response.requestId;

      if (reqId && pendingRequests.has(reqId)) {
        const { resolve, timeout } = pendingRequests.get(reqId);
        clearTimeout(timeout);
        pendingRequests.delete(reqId);
        resolve(response);
      } else if (!reqId && pendingRequests.size > 0) {
        // Fallback for untagged responses (e.g. initial handshake)
        const firstKey = pendingRequests.keys().next().value;
        const { resolve, timeout } = pendingRequests.get(firstKey);
        clearTimeout(timeout);
        pendingRequests.delete(firstKey);
        resolve(response);
      }

      // Broadcast state update to all WebSocket clients
      broadcast({ type: 'ENGINE_EVENT', data: response });
    } catch (err) {
      console.error('[Backend] Failed to parse engine JSON:', line, err);
      if (pendingRequests.size > 0) {
        const firstKey = pendingRequests.keys().next().value;
        const { reject, timeout } = pendingRequests.get(firstKey);
        clearTimeout(timeout);
        pendingRequests.delete(firstKey);
        reject(new Error(`Invalid JSON from engine: ${line}`));
      }
    }
  });

  engineProcess.on('exit', (code, signal) => {
    console.error(`[Backend] DS Engine exited with code ${code}, signal ${signal}`);
  });
}

function sendToEngine(cmdObj) {
  return new Promise((resolve, reject) => {
    if (!engineProcess || engineProcess.killed) {
      return reject(new Error('Engine process is not running'));
    }
    const reqId = `req_${nextRequestId++}`;
    cmdObj.requestId = reqId;

    const timeout = setTimeout(() => {
      if (pendingRequests.has(reqId)) {
        pendingRequests.delete(reqId);
        reject(new Error(`IPC request timeout for ${reqId}`));
      }
    }, 10000);

    pendingRequests.set(reqId, { resolve, reject, timeout });
    const jsonStr = JSON.stringify(cmdObj) + '\n';
    engineProcess.stdin.write(jsonStr);
  });
}

// WebSocket broadcast helper
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', async (ws) => {
  console.log('[WebSocket] Client connected');
  try {
    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    ws.send(JSON.stringify({ type: 'INITIAL_STATE', data: snapshot }));
  } catch (e) {
    console.error('[WebSocket] Error sending initial snapshot:', e.message);
  }

  ws.on('close', () => console.log('[WebSocket] Client disconnected'));
});

// Seed Initial City Graph and Teams
async function seedDefaultCity() {
  console.log('[Backend] Seeding initial city network...');
  const nodes = [
    { id: 'Hospital_A', lat: 18.5204, lon: 73.8567 },
    { id: 'Shivaji_Nagar_B', lat: 18.5310, lon: 73.8446 },
    { id: 'FC_Road_C', lat: 18.5280, lon: 73.8390 },
    { id: 'Deccan_Gymkhana_D', lat: 18.5160, lon: 73.8400 },
    { id: 'Swargate_E', lat: 18.5010, lon: 73.8580 },
    { id: 'Camp_Zone_F', lat: 18.5130, lon: 73.8780 },
    { id: 'Koregaon_Park_G', lat: 18.5360, lon: 73.8940 }
  ];

  for (const n of nodes) {
    await sendToEngine({ cmd: 'ADD_NODE', id: n.id, lat: n.lat, lon: n.lon });
  }

  const roads = [
    { id: 'R_AB', u: 'Hospital_A', v: 'Shivaji_Nagar_B', distanceKm: 2.1 },
    { id: 'R_BC', u: 'Shivaji_Nagar_B', v: 'FC_Road_C', distanceKm: 1.4 },
    { id: 'R_CD', u: 'FC_Road_C', v: 'Deccan_Gymkhana_D', distanceKm: 1.8 },
    { id: 'R_DE', u: 'Deccan_Gymkhana_D', v: 'Swargate_E', distanceKm: 2.7 },
    { id: 'R_EA', u: 'Swargate_E', v: 'Hospital_A', distanceKm: 2.4 },
    { id: 'R_EF', u: 'Swargate_E', v: 'Camp_Zone_F', distanceKm: 2.9 },
    { id: 'R_FA', u: 'Camp_Zone_F', v: 'Hospital_A', distanceKm: 2.2 },
    { id: 'R_FG', u: 'Camp_Zone_F', v: 'Koregaon_Park_G', distanceKm: 3.5 },
    { id: 'R_GA', u: 'Koregaon_Park_G', v: 'Hospital_A', distanceKm: 3.8 }
  ];

  for (const r of roads) {
    await sendToEngine({ cmd: 'ADD_ROAD', id: r.id, u: r.u, v: r.v, distanceKm: r.distanceKm });
  }

  const teams = [
    { id: 'A01', type: 'AMBULANCE', status: 'AVAILABLE', nodeId: 'Hospital_A', lat: 18.5204, lon: 73.8567 },
    { id: 'A02', type: 'AMBULANCE', status: 'AVAILABLE', nodeId: 'Swargate_E', lat: 18.5010, lon: 73.8580 },
    { id: 'F01', type: 'FIRE_BRIGADE', status: 'AVAILABLE', nodeId: 'Shivaji_Nagar_B', lat: 18.5310, lon: 73.8446 },
    { id: 'R01', type: 'RESCUE_TEAM', status: 'AVAILABLE', nodeId: 'Camp_Zone_F', lat: 18.5130, lon: 73.8780 }
  ];

  for (const t of teams) {
    await sendToEngine({
      cmd: 'ADD_TEAM',
      id: t.id,
      type: t.type,
      status: t.status,
      nodeId: t.nodeId,
      lat: t.lat,
      lon: t.lon
    });
  }

  console.log('[Backend] Seed complete.');
}

// ---------------------------------------------------------
// REST API ENDPOINTS
// ---------------------------------------------------------

// Get snapshot of all engine entities
app.get('/api/state', async (req, res) => {
  try {
    const data = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific team details and its active assignment
app.get('/api/teams/:id', async (req, res) => {
  try {
    const teamId = req.params.id;
    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const team = snapshot.teams ? snapshot.teams.find(t => t.id === teamId) : null;
    if (!team) {
      return res.status(404).json({ success: false, error: `Team ${teamId} not found` });
    }
    const activeAssignment = (team.activeAssignmentId && snapshot.assignments)
      ? snapshot.assignments.find(a => a.id === team.activeAssignmentId)
      : null;
    res.json({
      success: true,
      team,
      activeAssignment
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Report an Emergency
app.post('/api/emergencies', async (req, res) => {
  try {
    const { id, type, priority, nodeId, lat, lon, injuredCount, severity } = req.body;
    const emId = id || `E${Date.now().toString().slice(-4)}`;
    const result = await sendToEngine({
      cmd: 'REPORT_EMERGENCY',
      id: emId,
      type: type || 'ACCIDENT',
      priority: priority || 'HIGH',
      nodeId: nodeId || 'Deccan_Gymkhana_D',
      lat: lat || 18.5160,
      lon: lon || 73.8400,
      injuredCount: injuredCount || 1,
      severity: severity || 3
    });

    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'EMERGENCY_REPORTED',
      emergencyId: emId,
      allocatedTeamId: result.allocatedTeamId || null,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Road Status (Block / Unblock)
app.post('/api/roads/:id/status', async (req, res) => {
  try {
    const roadId = req.params.id;
    const { status } = req.body; // 'BLOCKED' or 'OPEN'
    const result = await sendToEngine({
      cmd: 'SET_ROAD_STATUS',
      roadId,
      status: status === 'BLOCKED' ? 'BLOCKED' : 'OPEN'
    });

    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'ROAD_STATUS_CHANGED',
      roadId,
      status: status === 'BLOCKED' ? 'BLOCKED' : 'OPEN',
      reroute: result.reroute || null,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Team Status (AVAILABLE, BUSY, OFFLINE)
app.post('/api/teams/:id/status', async (req, res) => {
  try {
    const teamId = req.params.id;
    const { status } = req.body;
    const result = await sendToEngine({
      cmd: 'UPDATE_TEAM_STATUS',
      teamId,
      status
    });

    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'TEAM_STATUS_CHANGED',
      teamId,
      status,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Team Location (Simulated GPS / Node transition)
app.post('/api/teams/:id/location', async (req, res) => {
  try {
    const teamId = req.params.id;
    const { nodeId, lat, lon } = req.body;
    const result = await sendToEngine({
      cmd: 'UPDATE_TEAM_LOCATION',
      teamId,
      nodeId,
      lat: lat || 0.0,
      lon: lon || 0.0
    });

    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'TEAM_LOCATION_UPDATED',
      teamId,
      nodeId,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept Assignment
app.post('/api/assignments/:id/accept', async (req, res) => {
  try {
    const asgId = req.params.id;
    const result = await sendToEngine({
      cmd: 'ACCEPT_ASSIGNMENT',
      assignmentId: asgId
    });

    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'ASSIGNMENT_ACCEPTED',
      assignmentId: asgId,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Decline Assignment
app.post('/api/assignments/:id/decline', async (req, res) => {
  try {
    const asgId = req.params.id;
    const result = await sendToEngine({
      cmd: 'DECLINE_ASSIGNMENT',
      assignmentId: asgId
    });

    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'ASSIGNMENT_DECLINED',
      assignmentId: asgId,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete Emergency
app.post('/api/emergencies/:id/complete', async (req, res) => {
  try {
    const emId = req.params.id;
    const result = await sendToEngine({
      cmd: 'COMPLETE_EMERGENCY',
      emergencyId: emId
    });

    const snapshot = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'EMERGENCY_COMPLETED',
      emergencyId: emId,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`[Backend] Emergency Response Server listening on http://localhost:${PORT}`);
  spawnEngine();
  await seedDefaultCity();
});
