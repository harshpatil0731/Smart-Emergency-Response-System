const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Load .env configuration
const envPath = path.resolve(__dirname, '.env');
try {
  require('dotenv').config({ path: envPath });
} catch (e) {}

const supabaseService = require('./services/supabaseService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// CORS: Command Center is same-origin (served from Express), Android uses OkHttp (not browser-based).
// Restrict to explicitly configured trusted origins. Default allows same-origin only.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: CORS_ORIGINS.length > 0
    ? (origin, callback) => {
        // Allow requests with no origin (non-browser clients like OkHttp, curl, Postman)
        if (!origin || CORS_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : (origin, callback) => {
        // No CORS_ORIGINS configured: allow same-origin and non-browser clients only
        if (!origin) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve static frontend files if needed
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// ---------------------------------------------------------

/**
 * Requires a valid Bearer token in the Authorization header.
 * Attaches the verified driver info to req.driver on success.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required. Provide Authorization: Bearer <token>.' });
  }

  try {
    const result = await supabaseService.verifyToken(authHeader);
    if (!result) {
      return res.status(401).json({ success: false, error: 'Invalid or expired authentication token.' });
    }
    req.driver = result;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token verification failed.' });
  }
}

/**
 * Requires the authenticated driver to own the unit specified in req.params.id.
 * Must be used after requireAuth so that req.driver is populated.
 * Looks up the driver's unit in the registeredTeams in-memory map and
 * verifies the driver's userId matches the unit's associated driverId.
 */
async function requireUnitOwnership(req, res, next) {
  const teamId = req.params.id;
  if (!teamId) {
    return res.status(400).json({ success: false, error: 'Unit ID is required.' });
  }

  let meta = registeredTeams.get(teamId);
  if (!meta) {
    // If not in cache, try looking up from database/fallback
    try {
      const dbUnit = await supabaseService.getUnitById(teamId);
      if (dbUnit) {
        meta = {
          driverId: dbUnit.driver_id,
          driverName: dbUnit.driver?.driver_name || '',
          vehicleNumber: dbUnit.vehicle_number,
          role: dbUnit.role,
          mobileNumber: dbUnit.driver?.mobile_number || ''
        };
        registeredTeams.set(teamId, meta);
      }
    } catch (e) {}
  }

  if (!meta) {
    return res.status(404).json({ success: false, error: `Unit ${teamId} not found.` });
  }

  // Match the authenticated driver's userId to the unit's driverId
  const driverId = req.driver.userId;
  const accountId = req.driver.driverAccount ? req.driver.driverAccount.id : null;
  const authorized = (meta.driverId && (meta.driverId === driverId || meta.driverId === accountId));

  if (!authorized) {
    return res.status(403).json({ success: false, error: 'Forbidden: You are not authorized to modify this unit.' });
  }

  req.unitMeta = meta;
  next();
}

// ---------------------------------------------------------
// C++ DSA ENGINE EXECUTABLE RESOLUTION & IPC SPAWN
// ---------------------------------------------------------

/**
 * Resolves the C++ Engine executable path with prioritized fallback:
 * 1. process.env.ENGINE_BIN_PATH (absolute or relative to current working directory / __dirname)
 * 2. Multi-config CMake paths (Debug, Release, RelWithDebInfo, MinSizeRel)
 * 3. Single-config CMake build paths (Linux engine_console, Windows engine_console.exe)
 * 4. Parent root build fallback
 */
function resolveEngineExecutable() {
  const isWindows = process.platform === 'win32';
  const customPath = process.env.ENGINE_BIN_PATH ? process.env.ENGINE_BIN_PATH.trim() : null;

  if (customPath) {
    const candidates = [
      path.resolve(process.cwd(), customPath),
      path.resolve(__dirname, customPath),
      path.resolve(__dirname, '..', customPath)
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    throw new Error(
      `[Engine Fatal] Configured ENGINE_BIN_PATH does not exist: "${customPath}". ` +
      `Checked: ${candidates.join(', ')}`
    );
  }

  const dsEngineDir = path.resolve(__dirname, '..', 'ds-engine', 'build');
  const binaryNames = isWindows
    ? ['engine_console.exe', 'engine_console']
    : ['engine_console', 'engine_console.exe'];

  const candidateDirs = [
    path.join(dsEngineDir, 'Debug'),
    path.join(dsEngineDir, 'Release'),
    path.join(dsEngineDir, 'RelWithDebInfo'),
    path.join(dsEngineDir, 'MinSizeRel'),
    dsEngineDir,
    path.resolve(__dirname, '..', 'build'),
    path.resolve(__dirname, 'bin')
  ];

  const searchPaths = [];
  for (const dir of candidateDirs) {
    for (const bin of binaryNames) {
      const fullPath = path.join(dir, bin);
      searchPaths.push(fullPath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  throw new Error(
    `[Engine Fatal] C++ DS Engine executable "engine_console" not found!\n` +
    `Searched candidate locations:\n  - ${searchPaths.join('\n  - ')}\n` +
    `--> Build the engine with CMake, or set ENGINE_BIN_PATH in your environment variables.`
  );
}

let ENGINE_EXE = null;
try {
  ENGINE_EXE = resolveEngineExecutable();
} catch (err) {
  console.error(err.message);
}

// Spawn C++ Engine in IPC mode with Request-Response Correlation
let engineProcess = null;
let nextRequestId = 1;
const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
let isSeedComplete = false;

function spawnEngine() {
  if (!ENGINE_EXE) {
    try {
      ENGINE_EXE = resolveEngineExecutable();
    } catch (err) {
      console.error(err.message);
      throw err;
    }
  }

  // Verify file permissions / readability
  try {
    fs.accessSync(ENGINE_EXE, fs.constants.X_OK || fs.constants.R_OK);
  } catch (accessErr) {
    console.warn(`[Backend] Executable permission warning for ${ENGINE_EXE}:`, accessErr.message);
  }

  console.log(`[Backend] Spawning DS Engine: ${ENGINE_EXE} --ipc`);
  engineProcess = spawn(ENGINE_EXE, ['--ipc'], {
    stdio: ['pipe', 'pipe', 'inherit']
  });

  engineProcess.on('error', (err) => {
    console.error(`[Engine Fatal] Failed to launch C++ DS Engine at "${ENGINE_EXE}":`, err.message);
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

// Configurable emergency vehicle base speeds (km/h)
const VEHICLE_BASE_SPEEDS = {
  AMBULANCE: 50,      // Ambulance: 50 km/h
  FIRE_BRIGADE: 40,   // Fire Brigade: 40 km/h
  FIRE: 40,
  RESCUE_TEAM: 42,    // Rescue Team: 42 km/h
  RESCUE: 42,
  DEFAULT: 45
};

// Deterministic road/traffic condition factors
// 1.0 = normal/clear, 1.1-1.2 = moderate, 1.3 = heavy traffic
const ROAD_TRAFFIC_FACTORS = {
  'R_AB': 1.0,
  'R_BC': 1.2,
  'R_CD': 1.1,
  'R_DE': 1.0,
  'R_EA': 1.3,
  'R_FA': 1.1,
  'R_GA': 1.0,
  'R_DH': 1.2,
  'R_HO': 1.1,
  'R_CI': 1.0,
  'R_FL': 1.3,
  'R_EM': 1.1,
  'R_MV': 1.2,
  'R_VK': 1.1,
  'R_LK': 1.3,
  'R_JL': 1.1,
  'R_JM': 1.2,
  'R_LO': 1.1,
  'R_EN': 1.2
};

// Registry of known roads for lookup and traffic calculations
const knownRoads = new Map();

function findRoadBetween(u, v) {
  for (const road of knownRoads.values()) {
    if ((road.u === u && road.v === v) || (road.u === v && road.v === u)) {
      return road;
    }
  }
  return null;
}

function calculateRouteEta(nodeIds, totalDistanceKm, teamType = 'DEFAULT') {
  if (!totalDistanceKm || totalDistanceKm <= 0) return 0;

  const speed = VEHICLE_BASE_SPEEDS[teamType] || VEHICLE_BASE_SPEEDS['DEFAULT'] || 45;

  if (Array.isArray(nodeIds) && nodeIds.length >= 2) {
    let totalHours = 0;
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const u = nodeIds[i];
      const v = nodeIds[i + 1];
      const road = findRoadBetween(u, v);
      if (road) {
        const factor = road.trafficFactor || ROAD_TRAFFIC_FACTORS[road.id] || 1.0;
        totalHours += (road.distanceKm * factor) / speed;
      }
    }
    if (totalHours > 0) {
      return Math.max(1, Math.ceil(totalHours * 60));
    }
  }

  // Fallback if individual segment links are not matched
  const defaultFactor = 1.1;
  const minutes = Math.ceil(((totalDistanceKm * defaultFactor) / speed) * 60);
  return Math.max(1, minutes);
}

// Predefined Demo Locations
const PREDEFINED_DEMO_LOCATIONS = {
  'DECCAN_GYMKHANA': {
    locationType: 'DECCAN_GYMKHANA',
    locationName: 'Deccan Gymkhana',
    nodeId: 'Deccan_Gymkhana_D',
    lat: 18.5160,
    lon: 73.8400
  },
  'SHIVAJI_NAGAR': {
    locationType: 'SHIVAJI_NAGAR',
    locationName: 'Shivaji Nagar',
    nodeId: 'Shivaji_Nagar_B',
    lat: 18.5310,
    lon: 73.8446
  },
  'CAMP_ZONE': {
    locationType: 'CAMP_ZONE',
    locationName: 'Camp Zone',
    nodeId: 'Camp_Zone_F',
    lat: 18.5130,
    lon: 73.8780
  }
};

// Known nodes registry for fast lookup & nearest-node snapping
const knownNodes = new Map();

function findNearestGraphNode(lat, lon) {
  if (knownNodes.size === 0) return 'Hospital_A';
  let bestNodeId = 'Hospital_A';
  let minDistance = Infinity;

  for (const node of knownNodes.values()) {
    const dLat = (node.lat - lat);
    const dLon = (node.lon - lon);
    const distSq = (dLat * dLat) + (dLon * dLon);
    if (distSq < minDistance) {
      minDistance = distSq;
      bestNodeId = node.id;
    }
  }
  return bestNodeId;
}

// In-memory team registry for metadata (driverName, vehicleNumber, locationType, locationName)
// Persists through driver session lifecycle
const registeredTeams = new Map();

function enrichSnapshot(snapshot) {
  if (!snapshot) return snapshot;

  const teamTypeMap = new Map();
  if (snapshot.teams) {
    snapshot.teams.forEach(t => {
      teamTypeMap.set(t.id, t.type);
      // Merge registered metadata if present
      const meta = registeredTeams.get(t.id);
      if (meta) {
        t.driverName = meta.driverName;
        t.vehicleNumber = meta.vehicleNumber;
        t.locationType = meta.locationType;
        t.locationName = meta.locationName;
        if (meta.lat !== undefined && meta.lat !== null && meta.lat !== 0) {
          t.lat = meta.lat;
        }
        if (meta.lon !== undefined && meta.lon !== null && meta.lon !== 0) {
          t.lon = meta.lon;
        }
        if (meta.nodeId) {
          t.nodeId = meta.nodeId;
        }
        if (meta.updatedAt) {
          t.updatedAt = meta.updatedAt;
        }
        if (meta.status === 'OFFLINE') {
          t.status = 'OFFLINE';
        }
      }
    });
  }

  if (snapshot.assignments) {
    snapshot.assignments.forEach(a => {
      const teamType = teamTypeMap.get(a.teamId) || 'DEFAULT';
      const eta = calculateRouteEta(a.routeNodes, a.routeDistanceKm, teamType);
      a.etaMinutes = eta;
      a.distance = a.routeDistanceKm;
      a.route = a.routeNodes;
    });
  }

  return snapshot;
}

wss.on('connection', async (ws) => {
  console.log('[WebSocket] Client connected');
  try {
    if (!isSeedComplete) {
      let attempts = 0;
      while (!isSeedComplete && attempts++ < 30) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'INITIAL_STATE', data: snapshot }));
    }
  } catch (e) {
    console.error('[WebSocket] Error sending initial snapshot:', e.message);
  }

  ws.on('close', () => console.log('[WebSocket] Client disconnected'));
});

// Seed Initial City Graph and Roads
async function seedDefaultCity() {
  console.log('[Backend] Seeding initial city network...');
  const nodes = [
    { id: 'Hospital_A', lat: 18.5204, lon: 73.8567 },
    { id: 'Shivaji_Nagar_B', lat: 18.5310, lon: 73.8446 },
    { id: 'FC_Road_C', lat: 18.5280, lon: 73.8390 },
    { id: 'Deccan_Gymkhana_D', lat: 18.5160, lon: 73.8400 },
    { id: 'Swargate_E', lat: 18.5010, lon: 73.8580 },
    { id: 'Camp_Zone_F', lat: 18.5130, lon: 73.8780 },
    { id: 'Koregaon_Park_G', lat: 18.5360, lon: 73.8940 },
    { id: 'Kothrud_H', lat: 18.5074, lon: 73.8077 },
    { id: 'SB_Road_I', lat: 18.5370, lon: 73.8300 },
    { id: 'Karve_Nagar_J', lat: 18.4910, lon: 73.8210 },
    { id: 'Hadapsar_K', lat: 18.5030, lon: 73.9120 },
    { id: 'Bibwewadi_L', lat: 18.4800, lon: 73.8600 },
    { id: 'VIT_Bibwewadi_M', lat: 18.4637, lon: 73.8683 },
    { id: 'Katraj_N', lat: 18.4536, lon: 73.8617 },
    { id: 'VIT_Kondhwa_O', lat: 18.4750, lon: 73.8860 }
  ];

  for (const n of nodes) {
    knownNodes.set(n.id, n);
    await sendToEngine({ cmd: 'ADD_NODE', id: n.id, lat: n.lat, lon: n.lon });
  }

  const roads = [
    { id: 'R_AB', u: 'Hospital_A', v: 'Shivaji_Nagar_B', distanceKm: 2.1 },
    { id: 'R_BC', u: 'Shivaji_Nagar_B', v: 'FC_Road_C', distanceKm: 1.4 },
    { id: 'R_CD', u: 'FC_Road_C', v: 'Deccan_Gymkhana_D', distanceKm: 1.8 },
    { id: 'R_DE', u: 'Deccan_Gymkhana_D', v: 'Swargate_E', distanceKm: 2.7 },
    { id: 'R_EA', u: 'Swargate_E', v: 'Hospital_A', distanceKm: 2.4 },
    { id: 'R_FA', u: 'Camp_Zone_F', v: 'Hospital_A', distanceKm: 2.2 },
    { id: 'R_GA', u: 'Koregaon_Park_G', v: 'Hospital_A', distanceKm: 3.8 },
    { id: 'R_DH', u: 'Deccan_Gymkhana_D', v: 'Kothrud_H', distanceKm: 3.4 },
    { id: 'R_HO', u: 'Kothrud_H', v: 'Karve_Nagar_J', distanceKm: 2.6 },
    { id: 'R_CI', u: 'FC_Road_C', v: 'SB_Road_I', distanceKm: 1.5 },
    { id: 'R_FL', u: 'Camp_Zone_F', v: 'Hadapsar_K', distanceKm: 3.8 },
    { id: 'R_EM', u: 'Swargate_E', v: 'Bibwewadi_L', distanceKm: 2.5 },
    { id: 'R_MV', u: 'Bibwewadi_L', v: 'VIT_Bibwewadi_M', distanceKm: 2.0 },
    { id: 'R_VK', u: 'VIT_Bibwewadi_M', v: 'Katraj_N', distanceKm: 1.6 },
    { id: 'R_LK', u: 'Katraj_N', v: 'VIT_Kondhwa_O', distanceKm: 3.5 },
    { id: 'R_JL', u: 'Karve_Nagar_J', v: 'Bibwewadi_L', distanceKm: 5.2 },
    { id: 'R_JM', u: 'Karve_Nagar_J', v: 'VIT_Bibwewadi_M', distanceKm: 6.5 },
    { id: 'R_LO', u: 'Bibwewadi_L', v: 'VIT_Kondhwa_O', distanceKm: 3.2 },
    { id: 'R_EN', u: 'Swargate_E', v: 'Katraj_N', distanceKm: 5.6 }
  ];

  for (const r of roads) {
    knownRoads.set(r.id, {
      id: r.id,
      u: r.u,
      v: r.v,
      distanceKm: r.distanceKm,
      trafficFactor: ROAD_TRAFFIC_FACTORS[r.id] || 1.0
    });
    await sendToEngine({ cmd: 'ADD_ROAD', id: r.id, u: r.u, v: r.v, distanceKm: r.distanceKm });
  }

  // Recover persistent driver accounts and units from Supabase on startup
  try {
    const recovered = await supabaseService.recoverStateOnStartup();
    if (recovered && recovered.unitMetadata) {
      for (const [uId, meta] of recovered.unitMetadata) {
        registeredTeams.set(uId, meta);
      }
    }
  } catch (recErr) {
    console.warn('[Backend] State recovery warning:', recErr.message);
  }

  isSeedComplete = true;
  console.log('[Backend] Seed complete. 0 initial response units created (dynamic registration enabled).');
}

// ---------------------------------------------------------
// REST API ENDPOINTS
// ---------------------------------------------------------

// Get snapshot of all engine entities
app.get('/api/state', async (req, res) => {
  try {
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const data = enrichSnapshot(raw);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get registered teams (active / non-OFFLINE by default)
app.get('/api/teams', async (req, res) => {
  try {
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    const includeOffline = req.query.includeOffline === 'true';
    const allTeams = snapshot && snapshot.teams ? snapshot.teams : [];
    const teams = includeOffline ? allTeams : allTeams.filter(t => t.status !== 'OFFLINE');
    res.json({
      success: true,
      count: teams.length,
      teams
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get specific team details and its active assignment
app.get('/api/teams/:id', async (req, res) => {
  try {
    const teamId = req.params.id;
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
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

// ---------------------------------------------------------
// DRIVER AUTHENTICATION & UNIT LIFECYCLE
// ---------------------------------------------------------

// 1. Driver Account Registration (First-time account creation)
app.post('/api/drivers/register', async (req, res) => {
  try {
    const { mobileNumber, password, driverName, role, vehicleNumber, locationType } = req.body;
    const lat = req.body.lat !== undefined ? req.body.lat : req.body.latitude;
    const lon = req.body.lon !== undefined ? req.body.lon : req.body.longitude;

    if (!mobileNumber || typeof mobileNumber !== 'string' || mobileNumber.trim().length < 8) {
      return res.status(400).json({ success: false, error: 'Valid mobile number is required (min 8 digits).' });
    }
    const cleanMobile = mobileNumber.trim().replace(/[^\d+]/g, '');

    if (!password || typeof password !== 'string' || password.trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters.' });
    }

    if (!driverName || typeof driverName !== 'string' || driverName.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Driver name must be at least 2 characters.' });
    }
    const cleanDriverName = driverName.trim();

    if (!role || typeof role !== 'string') {
      return res.status(400).json({ success: false, error: 'Role is required.' });
    }
    const normalizedRole = role.trim().toUpperCase().replace(/\s+/g, '_');
    let engineType = '';
    let roleDisplay = '';
    if (normalizedRole === 'AMBULANCE') {
      engineType = 'AMBULANCE';
      roleDisplay = 'Ambulance';
    } else if (normalizedRole === 'FIRE_BRIGADE' || normalizedRole === 'FIRE') {
      engineType = 'FIRE_BRIGADE';
      roleDisplay = 'Fire Brigade';
    } else if (normalizedRole === 'RESCUE_TEAM' || normalizedRole === 'RESCUE') {
      engineType = 'RESCUE_TEAM';
      roleDisplay = 'Rescue Team';
    } else {
      return res.status(400).json({
        success: false,
        error: `Invalid role "${role}". Must be Ambulance, Fire Brigade, or Rescue Team.`
      });
    }

    if (!vehicleNumber || typeof vehicleNumber !== 'string' || vehicleNumber.trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Valid vehicle number is required.' });
    }
    const cleanVehicleNumber = vehicleNumber.trim().toUpperCase().replace(/\s+/g, '');

    const regResult = await supabaseService.registerDriver({
      mobileNumber: cleanMobile,
      password,
      driverName: cleanDriverName,
      role: engineType,
      vehicleNumber: cleanVehicleNumber,
      locationType,
      lat,
      lon
    });

    const unitId = regResult.driver.unitId;
    const normLocType = (locationType || 'DECCAN_GYMKHANA').trim().toUpperCase().replace(/\s+/g, '_');
    const demo = PREDEFINED_DEMO_LOCATIONS[normLocType] || PREDEFINED_DEMO_LOCATIONS['DECCAN_GYMKHANA'];
    const resolvedRegLat = (lat !== undefined && lat !== null && !isNaN(parseFloat(lat)) && parseFloat(lat) !== 0) ? parseFloat(lat) : demo.lat;
    const resolvedRegLon = (lon !== undefined && lon !== null && !isNaN(parseFloat(lon)) && parseFloat(lon) !== 0) ? parseFloat(lon) : demo.lon;

    registeredTeams.set(unitId, {
      driverId: regResult.driver.id,
      driverName: regResult.driver.driverName,
      vehicleNumber: regResult.driver.vehicleNumber,
      locationType: normLocType,
      locationName: demo.locationName,
      lat: resolvedRegLat,
      lon: resolvedRegLon,
      nodeId: demo.nodeId,
      role: engineType,
      status: 'OFFLINE',
      mobileNumber: cleanMobile,
      updatedAt: Date.now()
    });

    console.log(`[Backend] Registered new driver account in ${supabaseService.isConfigured() ? 'Supabase' : 'local persistent storage'}: ${cleanDriverName} (${cleanMobile}) -> Unit ID: ${unitId}`);

    res.status(200).json({
      success: true,
      driver: {
        unitId,
        mobileNumber: regResult.driver.mobileNumber,
        driverName: regResult.driver.driverName,
        role: engineType,
        roleDisplay,
        vehicleNumber: regResult.driver.vehicleNumber
      },
      token: regResult.token
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ success: false, error: err.message });
  }
});

// 2. Driver Login (Authenticate with Mobile Number + Password)
app.post('/api/drivers/login', async (req, res) => {
  try {
    const { mobileNumber, password } = req.body;
    if (!mobileNumber || !password) {
      return res.status(400).json({ success: false, error: 'Mobile number and password are required.' });
    }
    const cleanMobile = mobileNumber.trim().replace(/[^\d+]/g, '');

    const loginResult = await supabaseService.loginDriver({
      mobileNumber: cleanMobile,
      password: password.trim()
    });

    const unitId = loginResult.driver.unitId;

    // Check if unit is currently active/online in C++ Engine
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    const activeTeam = snapshot.teams ? snapshot.teams.find(t => t.id === unitId && t.status !== 'OFFLINE') : null;

    res.json({
      success: true,
      isOnline: !!activeTeam,
      team: activeTeam,
      driver: {
        unitId: loginResult.driver.unitId,
        mobileNumber: loginResult.driver.mobileNumber,
        driverName: loginResult.driver.driverName,
        role: loginResult.driver.role,
        roleDisplay: loginResult.driver.role === 'FIRE_BRIGADE' ? 'Fire Brigade' : (loginResult.driver.role === 'RESCUE_TEAM' ? 'Rescue Team' : 'Ambulance'),
        vehicleNumber: loginResult.driver.vehicleNumber
      },
      token: loginResult.token
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ success: false, error: err.message });
  }
});

// 3. Driver Unit Activation (Select Location and Go Online)
app.post('/api/drivers/activate', async (req, res) => {
  try {
    const { mobileNumber, unitId, locationType } = req.body;
    const lat = req.body.lat !== undefined ? req.body.lat : req.body.latitude;
    const lon = req.body.lon !== undefined ? req.body.lon : req.body.longitude;

    // Verify token if provided
    let authUser = null;
    if (req.headers.authorization) {
      authUser = await supabaseService.verifyToken(req.headers.authorization);
    }

    let targetUnitId = unitId;
    let targetMeta = null;

    if (!targetUnitId && authUser && authUser.driverAccount) {
      const unit = await supabaseService.getUnitById(authUser.driverAccount.id);
      if (unit) targetUnitId = unit.id;
    }

    if (!targetUnitId && mobileNumber) {
      const cleanMobile = mobileNumber.trim().replace(/[^\d+]/g, '');
      for (const [id, meta] of registeredTeams) {
        if (meta.mobileNumber === cleanMobile) {
          targetUnitId = id;
          targetMeta = meta;
          break;
        }
      }
    }

    if (targetUnitId) {
      targetMeta = registeredTeams.get(targetUnitId);
      if (!targetMeta) {
        const dbUnit = await supabaseService.getUnitById(targetUnitId);
        if (dbUnit) {
          targetMeta = {
            driverId: dbUnit.driver_id,
            driverName: dbUnit.driver?.driver_name || '',
            vehicleNumber: dbUnit.vehicle_number,
            role: dbUnit.role,
            mobileNumber: dbUnit.driver?.mobile_number || ''
          };
          registeredTeams.set(targetUnitId, targetMeta);
        }
      }
    }

    if (!targetUnitId || !targetMeta) {
      return res.status(404).json({ success: false, error: 'Driver unit record not found. Please log in again.' });
    }

    // Resolve location
    if (!locationType || typeof locationType !== 'string') {
      return res.status(400).json({ success: false, error: 'Location selection is required.' });
    }

    const normLocationType = locationType.trim().toUpperCase().replace(/\s+/g, '_');
    let resolvedNodeId = 'Hospital_A';
    let resolvedLat = 0.0;
    let resolvedLon = 0.0;
    let resolvedLocationName = '';

    if (PREDEFINED_DEMO_LOCATIONS[normLocationType]) {
      const demo = PREDEFINED_DEMO_LOCATIONS[normLocationType];
      resolvedNodeId = demo.nodeId;
      resolvedLat = demo.lat;
      resolvedLon = demo.lon;
      resolvedLocationName = demo.locationName;
    } else if (normLocationType === 'CURRENT_LOCATION') {
      const parsedLat = parseFloat(lat);
      const parsedLon = parseFloat(lon);
      if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat === 0 || parsedLon === 0) {
        return res.status(400).json({
          success: false,
          error: 'Current GPS location coordinates (lat, lon) are required and must be valid.'
        });
      }
      resolvedLat = parsedLat;
      resolvedLon = parsedLon;
      resolvedLocationName = 'Current Location';
      resolvedNodeId = findNearestGraphNode(parsedLat, parsedLon);
    } else {
      return res.status(400).json({
        success: false,
        error: `Unknown location option "${locationType}". Choose Current Location, Deccan Gymkhana, Shivaji Nagar, or Camp Zone.`
      });
    }

    // Register or update in C++ Engine
    const engineRes = await sendToEngine({
      cmd: 'ADD_TEAM',
      id: targetUnitId,
      type: targetMeta.role,
      status: 'AVAILABLE',
      nodeId: resolvedNodeId,
      lat: resolvedLat,
      lon: resolvedLon
    });

    if (!engineRes.success) {
      // If unit already exists in C++ engine, update status to AVAILABLE and refresh location
      await sendToEngine({
        cmd: 'UPDATE_TEAM_STATUS',
        teamId: targetUnitId,
        status: 'AVAILABLE'
      });
      await sendToEngine({
        cmd: 'UPDATE_TEAM_LOCATION',
        teamId: targetUnitId,
        nodeId: resolvedNodeId,
        lat: resolvedLat,
        lon: resolvedLon
      });
    }

    // Persist activation in Supabase
    await supabaseService.activateUnit(targetUnitId, {
      locationType: normLocationType,
      locationName: resolvedLocationName,
      lat: resolvedLat,
      lon: resolvedLon,
      nodeId: resolvedNodeId
    });

    // Update in-memory registry
    targetMeta.locationType = normLocationType;
    targetMeta.locationName = resolvedLocationName;
    targetMeta.lat = resolvedLat;
    targetMeta.lon = resolvedLon;
    targetMeta.nodeId = resolvedNodeId;
    targetMeta.status = 'AVAILABLE';
    targetMeta.updatedAt = Date.now();
    registeredTeams.set(targetUnitId, targetMeta);

    // Broadcast update
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    const newTeam = snapshot.teams ? snapshot.teams.find(t => t.id === targetUnitId) : null;

    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'TEAM_REGISTERED',
      teamId: targetUnitId,
      nodeId: resolvedNodeId,
      lat: resolvedLat,
      lon: resolvedLon,
      timestamp: targetMeta.updatedAt,
      team: newTeam,
      data: snapshot
    });

    console.log(`[Backend] Activated unit ${targetUnitId} (${targetMeta.role}) online at ${resolvedNodeId} for driver ${targetMeta.driverName}`);

    res.json({
      success: true,
      unitId: targetUnitId,
      team: newTeam
    });
  } catch (err) {
    console.error('[Backend] Error in driver activation:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Legacy / Direct Unit Registration (from Android App or Scripts)
app.post('/api/teams/register', async (req, res) => {
  try {
    const { role, driverName, vehicleNumber, locationType } = req.body;
    const lat = req.body.lat !== undefined ? req.body.lat : req.body.latitude;
    const lon = req.body.lon !== undefined ? req.body.lon : req.body.longitude;

    // 1. Role validation (Ambulance, Fire Brigade, Rescue Team)
    if (!role || typeof role !== 'string') {
      return res.status(400).json({ success: false, error: 'Role is required.' });
    }
    const normalizedRole = role.trim().toUpperCase().replace(/\s+/g, '_');
    let engineType = '';
    if (normalizedRole === 'AMBULANCE') {
      engineType = 'AMBULANCE';
    } else if (normalizedRole === 'FIRE_BRIGADE' || normalizedRole === 'FIRE') {
      engineType = 'FIRE_BRIGADE';
    } else if (normalizedRole === 'RESCUE_TEAM' || normalizedRole === 'RESCUE') {
      engineType = 'RESCUE_TEAM';
    } else {
      return res.status(400).json({
        success: false,
        error: `Invalid role "${role}". Must be Ambulance, Fire Brigade, or Rescue Team.`
      });
    }

    // 2. Driver Name validation
    if (!driverName || typeof driverName !== 'string' || driverName.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Driver name must be at least 2 characters.' });
    }
    const cleanDriverName = driverName.trim();

    // 3. Vehicle Number validation
    if (!vehicleNumber || typeof vehicleNumber !== 'string' || vehicleNumber.trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Valid vehicle number is required.' });
    }
    const cleanVehicleNumber = vehicleNumber.trim().toUpperCase().replace(/\s+/g, '');

    // Duplicate vehicle check across registered teams
    for (const [existingId, meta] of registeredTeams.entries()) {
      if (meta.vehicleNumber === cleanVehicleNumber) {
        return res.status(409).json({
          success: false,
          error: `Vehicle number ${cleanVehicleNumber} is already registered to unit ${existingId}.`
        });
      }
    }

    // 4. Location validation & resolution
    if (!locationType || typeof locationType !== 'string') {
      return res.status(400).json({ success: false, error: 'Location selection is required.' });
    }

    const normLocationType = locationType.trim().toUpperCase().replace(/\s+/g, '_');
    let resolvedNodeId = 'Hospital_A';
    let resolvedLat = 0.0;
    let resolvedLon = 0.0;
    let resolvedLocationName = '';

    if (PREDEFINED_DEMO_LOCATIONS[normLocationType]) {
      const demo = PREDEFINED_DEMO_LOCATIONS[normLocationType];
      resolvedNodeId = demo.nodeId;
      resolvedLat = demo.lat;
      resolvedLon = demo.lon;
      resolvedLocationName = demo.locationName;
    } else if (normLocationType === 'CURRENT_LOCATION') {
      const parsedLat = parseFloat(lat);
      const parsedLon = parseFloat(lon);
      if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat === 0 || parsedLon === 0) {
        return res.status(400).json({
          success: false,
          error: 'Current GPS location coordinates (lat, lon) are required and must be valid.'
        });
      }
      resolvedLat = parsedLat;
      resolvedLon = parsedLon;
      resolvedLocationName = 'Current Location';
      resolvedNodeId = findNearestGraphNode(parsedLat, parsedLon);
    } else {
      return res.status(400).json({
        success: false,
        error: `Unknown location option "${locationType}". Choose Current Location, Deccan Gymkhana, Shivaji Nagar, or Camp Zone.`
      });
    }

    // 5. Generate unique Unit ID
    const unitId = await supabaseService.generateNextUnitId(engineType);

    // 6. Register with C++ Engine
    const engineRes = await sendToEngine({
      cmd: 'ADD_TEAM',
      id: unitId,
      type: engineType,
      status: 'AVAILABLE',
      nodeId: resolvedNodeId,
      lat: resolvedLat,
      lon: resolvedLon
    });

    if (!engineRes.success) {
      return res.status(500).json({ success: false, error: 'Failed to register unit in DS Engine' });
    }

    // 7. Store in registered teams metadata map
    registeredTeams.set(unitId, {
      driverName: cleanDriverName,
      vehicleNumber: cleanVehicleNumber,
      locationType: normLocationType,
      locationName: resolvedLocationName,
      lat: resolvedLat,
      lon: resolvedLon,
      nodeId: resolvedNodeId
    });

    // 8. Fetch enriched snapshot & broadcast via WebSocket
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    const newTeam = snapshot.teams ? snapshot.teams.find(t => t.id === unitId) : null;

    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'TEAM_REGISTERED',
      teamId: unitId,
      team: newTeam,
      data: snapshot
    });

    console.log(`[Backend] Registered new unit ${unitId} (${engineType}) - Driver: ${cleanDriverName}, Vehicle: ${cleanVehicleNumber}, Node: ${resolvedNodeId}`);

    res.json({
      success: true,
      unitId,
      team: newTeam
    });
  } catch (err) {
    console.error('[Backend] Error registering unit:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Driver Logout Endpoint
app.post('/api/teams/:id/logout', async (req, res) => {
  try {
    const teamId = req.params.id;
    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    const team = snapshot.teams ? snapshot.teams.find(t => t.id === teamId) : null;

    if (!team) {
      return res.status(404).json({ success: false, error: `Team ${teamId} not found` });
    }

    // If unit is actively assigned, handle logout safely: setting OFFLINE in C++ re-queues active emergency
    await sendToEngine({
      cmd: 'UPDATE_TEAM_STATUS',
      teamId,
      status: 'OFFLINE'
    });

    // Persist OFFLINE in Supabase
    await supabaseService.setUnitOffline(teamId);

    // Update in-memory metadata status
    const meta = registeredTeams.get(teamId);
    if (meta) {
      meta.status = 'OFFLINE';
    }

    const postRaw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const postSnapshot = enrichSnapshot(postRaw);

    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'TEAM_LOGGED_OUT',
      teamId,
      data: postSnapshot
    });

    console.log(`[Backend] Unit ${teamId} logged out (persisted OFFLINE).`);
    res.json({ success: true, message: `Unit ${teamId} logged out successfully` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);

    // Calculate dynamic ETA for allocated route
    if (result.route) {
      const team = snapshot.teams ? snapshot.teams.find(t => t.id === result.allocatedTeamId) : null;
      const teamType = team ? team.type : 'DEFAULT';
      const eta = calculateRouteEta(result.route.nodeIds, result.route.totalDistanceKm, teamType);
      result.route.etaMinutes = eta;
      result.etaMinutes = eta;
    }

    // Persist emergency in Supabase
    await supabaseService.saveEmergency({
      id: emId,
      type: type || 'ACCIDENT',
      priority: priority || 'HIGH',
      description: req.body.description || '',
      nodeId: nodeId || 'Deccan_Gymkhana_D',
      lat: lat || 18.5160,
      lon: lon || 73.8400,
      injuredCount: injuredCount || 1,
      severity: severity || 3,
      status: result.allocatedTeamId ? 'ASSIGNED' : 'REPORTED',
      allocatedTeamId: result.allocatedTeamId || null
    });

    // Persist assignment in Supabase if allocated
    if (result.allocatedTeamId && result.route) {
      const asgId = result.assignmentId || `ASG-${emId}-${result.allocatedTeamId}`;
      await supabaseService.saveAssignment({
        id: asgId,
        emergencyId: emId,
        teamId: result.allocatedTeamId,
        status: 'OFFERED',
        routeNodes: result.route.nodeIds,
        distanceKm: result.route.totalDistanceKm,
        etaMinutes: result.route.etaMinutes
      });
    }

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

    // Capture pre-block active assignment details to log old route, distance, and ETA
    let oldRoute = [];
    let oldDistance = 0;
    let oldEta = 0;
    let teamType = 'DEFAULT';

    try {
      const preSnapshotRaw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
      const preSnapshot = enrichSnapshot(preSnapshotRaw);
      if (preSnapshot.assignments) {
        const activeAsg = preSnapshot.assignments.find(a => 
          a.status !== 'COMPLETED' && a.status !== 'DECLINED' && a.routeNodes && a.routeNodes.length > 0
        );
        if (activeAsg) {
          oldRoute = activeAsg.routeNodes || [];
          oldDistance = activeAsg.routeDistanceKm || 0;
          const assignedTeam = preSnapshot.teams ? preSnapshot.teams.find(t => t.id === activeAsg.teamId) : null;
          teamType = assignedTeam ? assignedTeam.type : 'DEFAULT';
          oldEta = activeAsg.etaMinutes || calculateRouteEta(oldRoute, oldDistance, teamType);
        }
      }
    } catch (e) {
      console.warn('[Backend] Could not capture pre-block snapshot:', e.message);
    }

    const result = await sendToEngine({
      cmd: 'SET_ROAD_STATUS',
      roadId,
      status: status === 'BLOCKED' ? 'BLOCKED' : 'OPEN'
    });

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);

    // Dynamic ETA recalculation and explicit console logging
    let recalculatedEta = 0;
    if (result.reroute) {
      recalculatedEta = calculateRouteEta(result.reroute.nodeIds, result.reroute.totalDistanceKm, teamType);
      result.reroute.etaMinutes = recalculatedEta;
      result.reroute.newEta = recalculatedEta;
      result.reroute.newDistance = result.reroute.totalDistanceKm;
      result.reroute.newRoute = result.reroute.nodeIds;

      console.log(`[Dynamic ETA Reroute]`);
      console.log(`- Old Route: [${oldRoute.join(' -> ')}]`);
      console.log(`- Blocked Road: ${roadId}`);
      console.log(`- New Route: [${result.reroute.nodeIds.join(' -> ')}]`);
      console.log(`- Old Distance: ${typeof oldDistance === 'number' ? oldDistance.toFixed(2) : oldDistance} km | Old ETA: ${oldEta} mins`);
      console.log(`- New Distance: ${typeof result.reroute.totalDistanceKm === 'number' ? result.reroute.totalDistanceKm.toFixed(2) : result.reroute.totalDistanceKm} km | Recalculated ETA: ${recalculatedEta} mins`);
    }

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

// Update Team Status (AVAILABLE, BUSY, OFFLINE) — Authenticated, owner-only
app.post('/api/teams/:id/status', requireAuth, requireUnitOwnership, async (req, res) => {
  try {
    const teamId = req.params.id;
    const { status } = req.body;

    // Validate status is an allowed value
    const VALID_STATUSES = ['AVAILABLE', 'BUSY', 'OFFLINE'];
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    const result = await sendToEngine({
      cmd: 'UPDATE_TEAM_STATUS',
      teamId,
      status
    });

    // Update status in Supabase
    await supabaseService.updateUnitStatus(teamId, status);

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
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

// Update Team Location (Simulated GPS / Node transition / Physical GPS) — Authenticated, owner-only
app.post('/api/teams/:id/location', requireAuth, requireUnitOwnership, async (req, res) => {
  try {
    const teamId = req.params.id;
    let { nodeId, lat, lon } = req.body;

    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);

    // Validate coordinates
    if (isNaN(parsedLat) || isNaN(parsedLon)) {
      return res.status(400).json({ success: false, error: 'Valid numeric lat and lon coordinates are required.' });
    }
    if (!isFinite(parsedLat) || !isFinite(parsedLon)) {
      return res.status(400).json({ success: false, error: 'Coordinates must be finite numbers.' });
    }
    if (parsedLat < -90 || parsedLat > 90) {
      return res.status(400).json({ success: false, error: `Invalid latitude ${parsedLat}. Must be between -90 and 90.` });
    }
    if (parsedLon < -180 || parsedLon > 180) {
      return res.status(400).json({ success: false, error: `Invalid longitude ${parsedLon}. Must be between -180 and 180.` });
    }
    if (parsedLat === 0 && parsedLon === 0) {
      return res.status(400).json({ success: false, error: 'Coordinates (0, 0) are invalid. Provide actual GPS coordinates.' });
    }

    // If nodeId is not provided or generic, find closest graph node from coordinates
    if ((!nodeId || nodeId === 'N1') && parsedLat !== 0 && parsedLon !== 0) {
      nodeId = findNearestGraphNode(parsedLat, parsedLon);
    } else if (!nodeId) {
      nodeId = 'Hospital_A';
    }

    const meta = registeredTeams.get(teamId);
    const updateTime = req.body.timestamp ? Number(req.body.timestamp) : Date.now();

    // Prevent stale GPS packets from overwriting newer authoritative coordinates
    if (meta) {
      if (meta.updatedAt && updateTime < meta.updatedAt) {
        return res.json({ success: true, ignored: true, reason: 'Stale location update discarded' });
      }

      // If unit is currently standing by at a chosen fixed demo station (e.g. Shivaji Nagar),
      // preserve the selected station coordinates unless forced or in CURRENT_LOCATION mode.
      // (Live GPS tracking is fully preserved when locationType is CURRENT_LOCATION or unit is BUSY in-transit)
      const isPredefinedStandby = meta.locationType && meta.locationType !== 'CURRENT_LOCATION' && meta.status === 'AVAILABLE';
      if (isPredefinedStandby && !req.body.force) {
        return res.json({ success: true, ignored: true, reason: 'Preserving authoritative fixed station location' });
      }
    }

    const result = await sendToEngine({
      cmd: 'UPDATE_TEAM_LOCATION',
      teamId,
      nodeId,
      lat: parsedLat,
      lon: parsedLon
    });

    // Update in-memory metadata if registered
    if (meta) {
      if (parsedLat !== 0) meta.lat = parsedLat;
      if (parsedLon !== 0) meta.lon = parsedLon;
      meta.nodeId = nodeId;
      meta.updatedAt = updateTime;
    }

    // Update location telemetry in Supabase & location_history
    await supabaseService.updateUnitLocation(teamId, { lat: parsedLat, lon: parsedLon, nodeId });

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'TEAM_LOCATION_UPDATED',
      teamId,
      nodeId,
      lat: parsedLat,
      lon: parsedLon,
      timestamp: updateTime,
      data: snapshot
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function checkAssignmentOwnership(req, asgId) {
  if (!req.headers.authorization) {
    return { authorized: true };
  }
  const auth = await supabaseService.verifyToken(req.headers.authorization);
  if (!auth) {
    return { authorized: false, status: 401, error: 'Invalid or expired authentication token.' };
  }

  const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
  const asg = raw.assignments ? raw.assignments.find(a => a.id === asgId) : null;
  if (!asg) {
    return { authorized: false, status: 404, error: `Assignment ${asgId} not found.` };
  }

  const teamId = asg.teamId;
  let meta = registeredTeams.get(teamId);
  if (!meta) {
    const dbUnit = await supabaseService.getUnitById(teamId);
    if (dbUnit) {
      meta = {
        driverId: dbUnit.driver_id,
        driverName: dbUnit.driver?.driver_name || '',
        vehicleNumber: dbUnit.vehicle_number,
        role: dbUnit.role,
        mobileNumber: dbUnit.driver?.mobile_number || ''
      };
      registeredTeams.set(teamId, meta);
    }
  }

  const driverId = auth.userId;
  const accountId = auth.driverAccount ? auth.driverAccount.id : null;
  const isOwner = (meta && meta.driverId && (meta.driverId === driverId || meta.driverId === accountId));
  if (!isOwner) {
    return { authorized: false, status: 403, error: 'Forbidden: You cannot modify an assignment belonging to another driver.' };
  }

  return { authorized: true, driver: auth };
}

// Accept Assignment
app.post('/api/assignments/:id/accept', async (req, res) => {
  try {
    const asgId = req.params.id;

    // Verify ownership if caller provides authentication
    const authCheck = await checkAssignmentOwnership(req, asgId);
    if (!authCheck.authorized) {
      return res.status(authCheck.status).json({ success: false, error: authCheck.error });
    }

    const result = await sendToEngine({
      cmd: 'ACCEPT_ASSIGNMENT',
      assignmentId: asgId
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    await supabaseService.acceptAssignment(asgId);

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
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

    // Verify ownership if caller provides authentication
    const authCheck = await checkAssignmentOwnership(req, asgId);
    if (!authCheck.authorized) {
      return res.status(authCheck.status).json({ success: false, error: authCheck.error });
    }

    // Capture declining team ID before engine decline
    let decliningTeamId = null;
    try {
      const prevRaw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
      const prevAsg = prevRaw.assignments ? prevRaw.assignments.find(a => a.id === asgId) : null;
      if (prevAsg) decliningTeamId = prevAsg.teamId;
    } catch (_) {}

    const result = await sendToEngine({
      cmd: 'DECLINE_ASSIGNMENT',
      assignmentId: asgId
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Update Supabase for the declined assignment and response unit
    await supabaseService.declineAssignment(asgId);

    if (decliningTeamId) {
      const declMeta = registeredTeams.get(decliningTeamId);
      if (declMeta) {
        declMeta.status = 'AVAILABLE';
      }
    }

    // If reallocation selected a new team, persist the new assignment in Supabase
    if (result.allocatedTeamId && result.route) {
      const allocMeta = registeredTeams.get(result.allocatedTeamId);
      if (allocMeta) {
        allocMeta.status = 'BUSY';
      }
      const emId = result.emergencyId;
      const newAsgId = result.newAssignmentId || result.assignmentId || `ASG-${emId || 'EM'}-${result.allocatedTeamId}`;
      const routeEta = result.route.etaMinutes || calculateRouteEta(result.route.nodeIds, result.route.totalDistanceKm, 'AMBULANCE');
      await supabaseService.saveAssignment({
        id: newAsgId,
        emergencyId: emId,
        teamId: result.allocatedTeamId,
        status: 'OFFERED',
        routeNodes: result.route.nodeIds,
        distanceKm: result.route.totalDistanceKm,
        etaMinutes: routeEta
      });
    }

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    broadcast({
      type: 'SNAPSHOT_UPDATED',
      eventType: 'ASSIGNMENT_DECLINED',
      assignmentId: asgId,
      teamId: decliningTeamId,
      allocatedTeamId: result.allocatedTeamId || null,
      reallocatedTeamId: result.allocatedTeamId || null,
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

    // Complete in Supabase
    await supabaseService.completeEmergency(emId);

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
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

// System Status & Supabase Diagnostic Endpoint
app.get('/api/system/status', async (req, res) => {
  try {
    let supabaseHost = null;
    if (supabaseService.url) {
      try { supabaseHost = new URL(supabaseService.url).host; } catch (e) {}
    }

    if (!isSeedComplete) {
      return res.json({
        success: true,
        service: 'Smart Emergency Response System',
        version: '1.0.0',
        supabase: {
          configured: supabaseService.isConfigured(),
          connected: supabaseService.isReady,
          schemaReady: supabaseService.schemaReady,
          storageMode: supabaseService.isConfigured() ? 'SUPABASE_POSTGRESQL' : 'LOCAL_PERSISTENT_FALLBACK',
          host: supabaseHost,
          schemaHint: null
        },
        engine: {
          active: engineProcess && !engineProcess.killed,
          teamsCount: 0
        },
        ready: false
      });
    }

    const raw = await sendToEngine({ cmd: 'GET_SNAPSHOT' });
    const snapshot = enrichSnapshot(raw);
    const activeTeams = snapshot?.teams?.filter(t => t.status !== 'OFFLINE') || [];

    res.json({
      success: true,
      service: 'Smart Emergency Response System',
      version: '1.0.0',
      supabase: {
        configured: supabaseService.isConfigured(),
        connected: supabaseService.isReady,
        schemaReady: supabaseService.schemaReady,
        storageMode: supabaseService.isConfigured() ? 'SUPABASE_POSTGRESQL' : 'LOCAL_PERSISTENT_FALLBACK',
        host: supabaseHost,
        schemaHint: (!supabaseService.schemaReady && supabaseService.isReady)
          ? 'Required database tables missing. Run backend/supabase/schema.sql in Supabase SQL Editor.'
          : null
      },
      engine: {
        active: engineProcess && !engineProcess.killed,
        teamsCount: activeTeams.length
      },
      ready: isSeedComplete
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// System & Map Configuration Endpoint
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    version: '1.0.0',
    metro: 'Pune Urban Zone'
  });
});

// ponytail: POST /api/config removed — it allowed unauthenticated .env file overwrites.
// Google Maps API key is configured directly in backend/.env by administrators.

function cleanupEngine() {
  if (engineProcess && !engineProcess.killed) {
    try {
      console.log('[Backend] Terminating DS Engine child process...');
      engineProcess.kill();
    } catch (e) {}
  }
}

process.on('SIGINT', () => {
  cleanupEngine();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupEngine();
  process.exit(0);
});

process.on('exit', () => {
  cleanupEngine();
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, async () => {
  console.log(`[Backend] Emergency Response Server listening on http://${HOST}:${PORT}`);
  spawnEngine();
  await seedDefaultCity();
});
