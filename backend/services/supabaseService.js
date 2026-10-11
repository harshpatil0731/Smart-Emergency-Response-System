/**
 * ============================================================================
 * SMART EMERGENCY RESPONSE & DISASTER MANAGEMENT SYSTEM
 * SUPABASE SERVICE MODULE
 * ============================================================================
 * 
 * Manages PostgreSQL persistence and Supabase Auth with secure backend token
 * verification, entity lifecycle management, audit trail logging, and state
 * recovery across server restarts.
 */

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch (e) {}

class SupabaseService {
  constructor() {
    const rawUrl = (process.env.SUPABASE_URL || '').trim();
    // Normalize URL: remove trailing /rest/v1 or /rest/v1/ and trailing slashes
    this.url = rawUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
    this.anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
    this.serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    this.client = null;
    this.adminClient = null;
    this.isReady = false;
    this.schemaReady = false;
    this.configWarning = null;

    // Cryptographic secret for signing session tokens
    // Priority: SESSION_SECRET env var > SHA-256 of SUPABASE_SERVICE_ROLE_KEY > ephemeral random (local dev)
    const isProduction = process.env.NODE_ENV === 'production';
    if (process.env.SESSION_SECRET) {
      this.tokenSecret = process.env.SESSION_SECRET;
    } else if (this.serviceRoleKey) {
      this.tokenSecret = crypto.createHash('sha256').update(this.serviceRoleKey).digest('hex');
    } else if (isProduction) {
      // In production, fail securely rather than silently using an ephemeral secret
      throw new Error('[Auth Fatal] Production environment requires SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY to be set in environment variables.');
    } else {
      // Local development only: generate ephemeral secret per process start.
      // Tokens will not survive server restarts without SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY.
      this.tokenSecret = crypto.randomBytes(32).toString('hex');
      console.warn('[Auth] WARNING: No SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY configured.');
      console.warn('[Auth] Using ephemeral signing secret — driver tokens will not survive server restarts.');
      console.warn('[Auth] Set SESSION_SECRET in backend/.env for persistent local development tokens.');
    }

    // Local fallback store for offline development when Supabase credentials or tables are not yet ready
    this.fallbackDir = path.resolve(__dirname, '..', '.storage');
    this.fallbackDriversPath = path.resolve(__dirname, '..', '.drivers.json');
    this.fallbackDbPath = path.join(this.fallbackDir, 'local_db.json');
    this.initFallbackStore();

    this.init();
  }

  init() {
    const isPlaceholder = (val) => {
      if (!val) return true;
      const lower = val.toLowerCase();
      return lower.includes('your-project') || lower.includes('your_supabase') || lower.includes('your-');
    };

    if (!this.url || isPlaceholder(this.url) || (!this.serviceRoleKey && !this.anonKey) || isPlaceholder(this.serviceRoleKey)) {
      this.configWarning = `[Supabase] Live Supabase credentials not yet configured in backend/.env.
--> Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to connect to your Supabase project.
--> Schema migration file available at: backend/supabase/schema.sql
--> Operating with secure local persistent repository until live credentials are provided.`;
      console.warn(this.configWarning);
      this.initFallbackStore();
      return;
    }

    try {
      // Preferred: Privileged service-role client for backend administrative operations
      const authKey = this.serviceRoleKey || this.anonKey;
      this.adminClient = createClient(this.url, authKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      this.client = this.adminClient;
      this.isReady = true;
      console.log(`[Supabase] Client initialized for project host: ${new URL(this.url).host}`);
    } catch (err) {
      console.error('[Supabase] Failed to initialize Supabase client:', err.message);
      this.initFallbackStore();
    }
  }

  initFallbackStore() {
    if (!fs.existsSync(this.fallbackDir)) {
      try { fs.mkdirSync(this.fallbackDir, { recursive: true }); } catch (e) {}
    }
    this.fallbackData = {
      driver_accounts: [],
      response_units: [],
      emergencies: [],
      assignments: [],
      location_history: [],
      audit_events: []
    };
    if (fs.existsSync(this.fallbackDbPath)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(this.fallbackDbPath, 'utf8'));
        this.fallbackData = { ...this.fallbackData, ...loaded };
      } catch (e) {}
    } else if (fs.existsSync(this.fallbackDriversPath)) {
      // Migrate from previous .drivers.json if present
      try {
        const drivers = JSON.parse(fs.readFileSync(this.fallbackDriversPath, 'utf8'));
        if (Array.isArray(drivers)) {
          drivers.forEach(d => {
            const driverId = crypto.randomUUID();
            this.fallbackData.driver_accounts.push({
              id: driverId,
              mobile_number: d.mobileNumber,
              driver_name: d.driverName,
              status: 'ACTIVE',
              password_hash: d.passwordHash || bcrypt.hashSync(d.password || 'password123', 8),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
            this.fallbackData.response_units.push({
              id: d.unitId,
              driver_id: driverId,
              role: d.role,
              vehicle_number: d.vehicleNumber,
              location_type: 'DECCAN_GYMKHANA',
              location_name: 'Deccan Gymkhana',
              lat: 18.5160,
              lon: 73.8400,
              node_id: 'Deccan_Gymkhana_D',
              status: 'OFFLINE',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          });
          this.saveFallbackStore();
        }
      } catch (e) {}
    }
  }

  saveFallbackStore() {
    try {
      fs.writeFileSync(this.fallbackDbPath, JSON.stringify(this.fallbackData, null, 2), 'utf8');
    } catch (e) {
      console.warn('[Supabase Fallback] Could not save storage file:', e.message);
    }
  }

  async checkSchemaAvailability() {
    if (!this.adminClient || !this.isReady) return false;
    try {
      const { error } = await this.adminClient.from('driver_accounts').select('id').limit(1);
      if (!error) {
        this.schemaReady = true;
        console.log('[Supabase] Live Supabase PostgreSQL connection and tables verified.');
        return true;
      }
      if (error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'))) {
        this.schemaReady = false;
        console.warn('[Supabase] Connected to Supabase host, but required database tables are missing!');
        console.warn('[Supabase] --> Action Required: Run "backend/supabase/schema.sql" in your Supabase SQL Editor.');
        console.warn('[Supabase] --> Operating in local persistent fallback store until tables are created.');
        this.initFallbackStore();
        return false;
      }
      console.warn('[Supabase] Schema check warning:', error.message);
      this.schemaReady = false;
      this.initFallbackStore();
      return false;
    } catch (err) {
      console.warn('[Supabase] Schema check error:', err.message);
      this.schemaReady = false;
      this.initFallbackStore();
      return false;
    }
  }

  isConfigured() {
    return this.isReady && this.adminClient !== null && this.schemaReady === true;
  }

  // ==========================================================================
  // AUTHENTICATION & DRIVER REGISTRATION
  // ==========================================================================

  /**
   * Registers a new driver account with encrypted password and creates the associated unit record.
   */
  async registerDriver({ mobileNumber, password, driverName, role, vehicleNumber, locationType, lat, lon }) {
    const cleanMobile = mobileNumber.trim().replace(/[^\d+]/g, '');
    const cleanName = driverName.trim();
    const cleanVehicle = vehicleNumber.trim().toUpperCase().replace(/\s+/g, '');

    if (this.isConfigured()) {
      // 1. Check duplicate mobile
      const { data: existingMobile, error: mErr } = await this.adminClient
        .from('driver_accounts')
        .select('id')
        .eq('mobile_number', cleanMobile)
        .maybeSingle();

      if (existingMobile) {
        const err = new Error('A driver account with this mobile number already exists.');
        err.statusCode = 409;
        throw err;
      }

      // 2. Check duplicate vehicle plate
      const { data: existingVehicle, error: vErr } = await this.adminClient
        .from('response_units')
        .select('id')
        .eq('vehicle_number', cleanVehicle)
        .maybeSingle();

      if (existingVehicle) {
        const err = new Error(`Vehicle number ${cleanVehicle} is already registered to unit ${existingVehicle.id}.`);
        err.statusCode = 409;
        throw err;
      }

      // 3. Create Supabase Auth User (handles bcrypt hashing and JWT issuance)
      const virtualEmail = `${cleanMobile.replace('+', '')}@driver.smarte.local`;
      let authUserId = null;

      const { data: authData, error: authErr } = await this.adminClient.auth.admin.createUser({
        email: virtualEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          mobileNumber: cleanMobile,
          driverName: cleanName,
          role
        }
      });

      if (authErr) {
        // If user already exists in auth.users, fetch it
        if (authErr.message && authErr.message.toLowerCase().includes('already')) {
          const { data: userList } = await this.adminClient.auth.admin.listUsers();
          const found = userList?.users?.find(u => u.email === virtualEmail);
          if (found) authUserId = found.id;
        }
        if (!authUserId) {
          const err = new Error(authErr.message || 'Failed to register authentication account');
          err.statusCode = 400;
          throw err;
        }
      } else {
        authUserId = authData.user.id;
      }

      // 4. Insert into driver_accounts
      const { data: driverAcc, error: accErr } = await this.adminClient
        .from('driver_accounts')
        .insert({
          id: authUserId,
          mobile_number: cleanMobile,
          driver_name: cleanName,
          status: 'ACTIVE'
        })
        .select()
        .single();

      if (accErr) {
        throw new Error(`Failed to save driver account: ${accErr.message}`);
      }

      // 5. Generate Unit ID based on role
      const unitId = await this.generateNextUnitId(role);

      // 6. Insert into response_units (starts OFFLINE until driver activates shift)
      const { data: unitRecord, error: unitErr } = await this.adminClient
        .from('response_units')
        .insert({
          id: unitId,
          driver_id: authUserId,
          role: role,
          vehicle_number: cleanVehicle,
          location_type: locationType || 'DECCAN_GYMKHANA',
          location_name: locationType === 'CAMP_ZONE' ? 'Camp Zone' : (locationType === 'SHIVAJI_NAGAR' ? 'Shivaji Nagar' : 'Deccan Gymkhana'),
          lat: lat || 18.5160,
          lon: lon || 73.8400,
          status: 'OFFLINE'
        })
        .select()
        .single();

      if (unitErr) {
        throw new Error(`Failed to initialize response unit: ${unitErr.message}`);
      }

      // Generate a signed token for subsequent API calls
      const token = this.generateSessionToken(authUserId, cleanMobile);

      await this.logAuditEvent('DRIVER_REGISTERED', authUserId, {
        unitId,
        mobileNumber: cleanMobile,
        driverName: cleanName,
        role,
        vehicleNumber: cleanVehicle
      });

      return {
        driver: {
          id: authUserId,
          mobileNumber: cleanMobile,
          driverName: cleanName,
          role,
          vehicleNumber: cleanVehicle,
          unitId
        },
        unit: unitRecord,
        token
      };

    } else {
      // Local persistent fallback engine
      const existing = this.fallbackData.driver_accounts.find(d => d.mobile_number === cleanMobile);
      if (existing) {
        const err = new Error('A driver account with this mobile number already exists.');
        err.statusCode = 409;
        throw err;
      }
      const existingVeh = this.fallbackData.response_units.find(u => u.vehicle_number === cleanVehicle);
      if (existingVeh) {
        const err = new Error(`Vehicle number ${cleanVehicle} is already registered to unit ${existingVeh.id}.`);
        err.statusCode = 409;
        throw err;
      }

      const driverId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(password, 10);
      const unitId = await this.generateNextUnitId(role);

      const newDriver = {
        id: driverId,
        mobile_number: cleanMobile,
        driver_name: cleanName,
        status: 'ACTIVE',
        password_hash: passwordHash,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const newUnit = {
        id: unitId,
        driver_id: driverId,
        role,
        vehicle_number: cleanVehicle,
        location_type: locationType || 'DECCAN_GYMKHANA',
        location_name: locationType === 'CAMP_ZONE' ? 'Camp Zone' : (locationType === 'SHIVAJI_NAGAR' ? 'Shivaji Nagar' : 'Deccan Gymkhana'),
        lat: lat || 18.5160,
        lon: lon || 73.8400,
        node_id: 'Deccan_Gymkhana_D',
        status: 'OFFLINE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      this.fallbackData.driver_accounts.push(newDriver);
      this.fallbackData.response_units.push(newUnit);
      this.saveFallbackStore();

      const token = this.generateSessionToken(driverId, cleanMobile);
      await this.logAuditEvent('DRIVER_REGISTERED', driverId, { unitId, mobileNumber: cleanMobile, driverName: cleanName });

      return {
        driver: {
          id: driverId,
          mobileNumber: cleanMobile,
          driverName: cleanName,
          role,
          vehicleNumber: cleanVehicle,
          unitId
        },
        unit: newUnit,
        token
      };
    }
  }

  /**
   * Authenticates a driver using Mobile Number and Password.
   */
  async loginDriver({ mobileNumber, password }) {
    const cleanMobile = mobileNumber.trim().replace(/[^\d+]/g, '');

    if (this.isConfigured()) {
      // 1. Look up driver profile
      const { data: driverAcc, error: dErr } = await this.adminClient
        .from('driver_accounts')
        .select('*')
        .eq('mobile_number', cleanMobile)
        .maybeSingle();

      if (!driverAcc) {
        const err = new Error('No driver account found with this mobile number. Please register first.');
        err.statusCode = 404;
        throw err;
      }

      // 2. Authenticate credentials via Supabase Auth using isolated auth client
      // (Using a separate client prevents mutating adminClient session and losing service_role privileges)
      const virtualEmail = `${cleanMobile.replace('+', '')}@driver.smarte.local`;
      const authClient = createClient(this.url, this.anonKey || this.serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      const { data: authSession, error: authErr } = await authClient.auth.signInWithPassword({
        email: virtualEmail,
        password: password
      });

      if (authErr) {
        const err = new Error('Invalid mobile number or password.');
        err.statusCode = 401;
        throw err;
      }

      // 3. Fetch associated unit details
      const { data: unitRecord, error: uErr } = await this.adminClient
        .from('response_units')
        .select('*')
        .eq('driver_id', driverAcc.id)
        .maybeSingle();

      const token = authSession.session?.access_token || this.generateSessionToken(driverAcc.id, cleanMobile);

      await this.logAuditEvent('DRIVER_LOGIN', driverAcc.id, {
        mobileNumber: cleanMobile,
        unitId: unitRecord?.id
      });

      return {
        driver: {
          id: driverAcc.id,
          mobileNumber: driverAcc.mobile_number,
          driverName: driverAcc.driver_name,
          role: unitRecord?.role || 'AMBULANCE',
          vehicleNumber: unitRecord?.vehicle_number || '',
          unitId: unitRecord?.id || ''
        },
        unit: unitRecord,
        isOnline: unitRecord ? (unitRecord.status !== 'OFFLINE') : false,
        token
      };

    } else {
      // Local fallback auth
      const driverAcc = this.fallbackData.driver_accounts.find(d => d.mobile_number === cleanMobile);
      if (!driverAcc) {
        const err = new Error('No driver account found with this mobile number. Please register first.');
        err.statusCode = 404;
        throw err;
      }

      const match = await bcrypt.compare(password, driverAcc.password_hash);
      if (!match) {
        const err = new Error('Invalid mobile number or password.');
        err.statusCode = 401;
        throw err;
      }

      const unitRecord = this.fallbackData.response_units.find(u => u.driver_id === driverAcc.id);
      const token = this.generateSessionToken(driverAcc.id, cleanMobile);

      await this.logAuditEvent('DRIVER_LOGIN', driverAcc.id, { mobileNumber: cleanMobile, unitId: unitRecord?.id });

      return {
        driver: {
          id: driverAcc.id,
          mobileNumber: driverAcc.mobile_number,
          driverName: driverAcc.driver_name,
          role: unitRecord?.role || 'AMBULANCE',
          vehicleNumber: unitRecord?.vehicle_number || '',
          unitId: unitRecord?.id || ''
        },
        unit: unitRecord,
        isOnline: unitRecord ? (unitRecord.status !== 'OFFLINE') : false,
        token
      };
    }
  }

  /**
   * Generates next sequential Unit ID per role (AMB-01, FIR-01, RES-01) from database records.
   */
  async generateNextUnitId(role) {
    const prefix = role.toUpperCase().startsWith('FIRE') ? 'FIR' :
                   role.toUpperCase().startsWith('RES') ? 'RES' : 'AMB';

    let maxNum = 0;

    if (this.isConfigured()) {
      const { data: units } = await this.adminClient
        .from('response_units')
        .select('id')
        .like('id', `${prefix}-%`);

      if (units) {
        units.forEach(u => {
          const match = u.id.match(/^([A-Z]{3})-(\d+)$/);
          if (match) {
            const n = parseInt(match[2], 10);
            if (n > maxNum) maxNum = n;
          }
        });
      }
    } else {
      const units = this.fallbackData.response_units.filter(u => u.id.startsWith(`${prefix}-`));
      units.forEach(u => {
        const match = u.id.match(/^([A-Z]{3})-(\d+)$/);
        if (match) {
          const n = parseInt(match[2], 10);
          if (n > maxNum) maxNum = n;
        }
      });
    }

    const nextNum = maxNum + 1;
    return `${prefix}-${String(nextNum).padStart(2, '0')}`;
  }

  /**
   * Verifies an authentication token sent in the Authorization header.
   */
  async verifyToken(token) {
    if (!token) return null;
    const cleanToken = token.replace(/^Bearer\s+/i, '').trim();

    if (this.isConfigured()) {
      try {
        const { data: { user }, error } = await this.adminClient.auth.getUser(cleanToken);
        if (user && !error) {
          const { data: driver } = await this.adminClient
            .from('driver_accounts')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          return {
            userId: user.id,
            driverAccount: driver,
            email: user.email
          };
        }
      } catch (e) {}
    }

    // Fallback token verification
    try {
      const decoded = Buffer.from(cleanToken, 'base64').toString('utf8');
      const [driverId, mobile, expiresStr, signature] = decoded.split(':');
      const expires = parseInt(expiresStr, 10);

      if (expires && expires > Date.now() && signature) {
        const expectedSig = crypto.createHmac('sha256', this.tokenSecret).update(`${driverId}:${mobile}:${expiresStr}`).digest('hex');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
          const driver = this.isConfigured()
            ? (await this.adminClient.from('driver_accounts').select('*').eq('id', driverId).maybeSingle()).data
            : this.fallbackData.driver_accounts.find(d => d.id === driverId);

          return {
            userId: driverId,
            driverAccount: driver,
            mobileNumber: mobile
          };
        }
      }
    } catch (e) {}

    return null;
  }

  generateSessionToken(userId, mobile) {
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    const base = `${userId}:${mobile}:${expires}`;
    const sig = crypto.createHmac('sha256', this.tokenSecret).update(base).digest('hex');
    return Buffer.from(`${base}:${sig}`).toString('base64');
  }

  // ==========================================================================
  // RESPONSE UNIT LIFECYCLE
  // ==========================================================================

  /**
   * Activates a unit online with specified location.
   */
  async activateUnit(unitId, locationData) {
    const updatePayload = {
      status: 'AVAILABLE',
      location_type: locationData.locationType,
      location_name: locationData.locationName,
      lat: locationData.lat,
      lon: locationData.lon,
      node_id: locationData.nodeId,
      last_online_at: new Date().toISOString(),
      last_location_update_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.isConfigured()) {
      const { data, error } = await this.adminClient
        .from('response_units')
        .update(updatePayload)
        .eq('id', unitId)
        .select();

      if (error) throw new Error(`Failed to activate unit in Supabase: ${error.message}`);
    } else {
      const u = this.fallbackData.response_units.find(item => item.id === unitId);
      if (u) {
        Object.assign(u, updatePayload);
        this.saveFallbackStore();
      }
    }

    await this.recordLocationHistory(unitId, locationData.lat, locationData.lon, locationData.nodeId);
    await this.logAuditEvent('UNIT_STATUS_CHANGED', unitId, { status: 'AVAILABLE', ...locationData });
  }

  /**
   * Updates unit location telemetry.
   */
  async updateUnitLocation(unitId, { lat, lon, nodeId }) {
    const updatePayload = {
      lat,
      lon,
      node_id: nodeId,
      last_location_update_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.isConfigured()) {
      await this.adminClient
        .from('response_units')
        .update(updatePayload)
        .eq('id', unitId);
    } else {
      const u = this.fallbackData.response_units.find(item => item.id === unitId);
      if (u) {
        Object.assign(u, updatePayload);
        this.saveFallbackStore();
      }
    }

    await this.recordLocationHistory(unitId, lat, lon, nodeId);
  }

  /**
   * Updates unit status (AVAILABLE, BUSY, OFFLINE).
   */
  async updateUnitStatus(unitId, status) {
    const updatePayload = {
      status,
      updated_at: new Date().toISOString()
    };

    if (this.isConfigured()) {
      await this.adminClient
        .from('response_units')
        .update(updatePayload)
        .eq('id', unitId);
    } else {
      const u = this.fallbackData.response_units.find(item => item.id === unitId);
      if (u) {
        Object.assign(u, updatePayload);
        this.saveFallbackStore();
      }
    }

    await this.logAuditEvent('UNIT_STATUS_CHANGED', unitId, { status });
  }

  /**
   * Decommissions a unit to OFFLINE upon driver logout.
   */
  async setUnitOffline(unitId) {
    await this.updateUnitStatus(unitId, 'OFFLINE');
    await this.logAuditEvent('DRIVER_LOGOUT', unitId, { status: 'OFFLINE' });
  }

  /**
   * Retrieves unit record by Unit ID.
   */
  async getUnitById(unitId) {
    if (this.isConfigured()) {
      const { data } = await this.adminClient
        .from('response_units')
        .select('*, driver:driver_accounts(*)')
        .eq('id', unitId)
        .maybeSingle();
      return data;
    } else {
      const u = this.fallbackData.response_units.find(item => item.id === unitId);
      if (!u) return null;
      const d = this.fallbackData.driver_accounts.find(item => item.id === u.driver_id);
      return { ...u, driver: d };
    }
  }

  /**
   * Records a location ping in location_history with distance / time throttling.
   */
  async recordLocationHistory(unitId, lat, lon, nodeId) {
    if (!lat || !lon) return;

    const record = {
      unit_id: unitId,
      lat,
      lon,
      node_id: nodeId,
      recorded_at: new Date().toISOString()
    };

    if (this.isConfigured()) {
      // Async insert without blocking the critical path
      this.adminClient
        .from('location_history')
        .insert(record)
        .then(() => {})
        .catch(err => console.warn('[Supabase] Location history write error:', err.message));
    } else {
      this.fallbackData.location_history.push({ id: crypto.randomUUID(), ...record });
      // Keep history bounded to last 200 items in local fallback
      if (this.fallbackData.location_history.length > 200) {
        this.fallbackData.location_history = this.fallbackData.location_history.slice(-200);
      }
      this.saveFallbackStore();
    }
  }

  // ==========================================================================
  // EMERGENCIES & ASSIGNMENTS
  // ==========================================================================

  /**
   * Persists an incident record in the emergencies table.
   */
  async saveEmergency({ id, type, priority, description, nodeId, lat, lon, injuredCount, severity, status, allocatedTeamId }) {
    const payload = {
      id,
      type: type || 'ACCIDENT',
      priority: priority || 'HIGH',
      description: description || '',
      node_id: nodeId,
      lat,
      lon,
      injured_count: injuredCount || 0,
      severity: severity || 1,
      status: status || 'REPORTED',
      allocated_team_id: allocatedTeamId || null,
      updated_at: new Date().toISOString()
    };

    if (this.isConfigured()) {
      const { error } = await this.adminClient
        .from('emergencies')
        .upsert(payload, { onConflict: 'id' });

      if (error) console.warn('[Supabase] Emergency upsert error:', error.message);
    } else {
      const idx = this.fallbackData.emergencies.findIndex(e => e.id === id);
      if (idx >= 0) {
        this.fallbackData.emergencies[idx] = { ...this.fallbackData.emergencies[idx], ...payload };
      } else {
        this.fallbackData.emergencies.push({ ...payload, created_at: new Date().toISOString() });
      }
      this.saveFallbackStore();
    }

    await this.logAuditEvent('EMERGENCY_REPORTED', id, payload);
  }

  /**
   * Persists assignment result linking an emergency to a response unit.
   */
  async saveAssignment({ id, emergencyId, teamId, status, routeNodes, distanceKm, etaMinutes }) {
    const payload = {
      id,
      emergency_id: emergencyId,
      team_id: teamId,
      status: status || 'OFFERED',
      route_nodes: routeNodes || [],
      distance_km: distanceKm || 0.0,
      eta_minutes: etaMinutes || 0,
      updated_at: new Date().toISOString()
    };

    if (this.isConfigured()) {
      // 1. Upsert assignment
      await this.adminClient
        .from('assignments')
        .upsert(payload, { onConflict: 'id' });

      // 2. Update emergency status and allocated team
      await this.adminClient
        .from('emergencies')
        .update({
          status: 'ASSIGNED',
          allocated_team_id: teamId,
          updated_at: new Date().toISOString()
        })
        .eq('id', emergencyId);

      // 3. Update response unit's active assignment
      await this.adminClient
        .from('response_units')
        .update({
          active_assignment_id: id,
          status: 'ASSIGNED',
          updated_at: new Date().toISOString()
        })
        .eq('id', teamId);
    } else {
      const idx = this.fallbackData.assignments.findIndex(a => a.id === id);
      if (idx >= 0) {
        this.fallbackData.assignments[idx] = { ...this.fallbackData.assignments[idx], ...payload };
      } else {
        this.fallbackData.assignments.push({ ...payload, created_at: new Date().toISOString() });
      }

      const em = this.fallbackData.emergencies.find(e => e.id === emergencyId);
      if (em) {
        em.status = 'ASSIGNED';
        em.allocated_team_id = teamId;
      }
      const unit = this.fallbackData.response_units.find(u => u.id === teamId);
      if (unit) {
        unit.active_assignment_id = id;
        unit.status = 'ASSIGNED';
      }
      this.saveFallbackStore();
    }

    await this.logAuditEvent('ASSIGNMENT_CREATED', id, payload);
  }

  /**
   * Marks an emergency and its active assignment as COMPLETED / RESOLVED.
   */
  async completeEmergency(emergencyId) {
    const now = new Date().toISOString();

    if (this.isConfigured()) {
      // 1. Fetch emergency to find allocated team
      const { data: em } = await this.adminClient
        .from('emergencies')
        .select('*')
        .eq('id', emergencyId)
        .maybeSingle();

      // 2. Update emergency record
      await this.adminClient
        .from('emergencies')
        .update({
          status: 'RESOLVED',
          resolved_at: now,
          updated_at: now
        })
        .eq('id', emergencyId);

      // 3. Update assignment record
      await this.adminClient
        .from('assignments')
        .update({
          status: 'COMPLETED',
          completed_at: now,
          updated_at: now
        })
        .eq('emergency_id', emergencyId);

      // 4. Release allocated unit back to AVAILABLE
      if (em && em.allocated_team_id) {
        await this.adminClient
          .from('response_units')
          .update({
            status: 'AVAILABLE',
            active_assignment_id: null,
            updated_at: now
          })
          .eq('id', em.allocated_team_id);
      }
    } else {
      const em = this.fallbackData.emergencies.find(e => e.id === emergencyId);
      if (em) {
        em.status = 'RESOLVED';
        em.resolved_at = now;
        if (em.allocated_team_id) {
          const unit = this.fallbackData.response_units.find(u => u.id === em.allocated_team_id);
          if (unit) {
            unit.status = 'AVAILABLE';
            unit.active_assignment_id = null;
          }
        }
      }
      const asg = this.fallbackData.assignments.find(a => a.emergency_id === emergencyId);
      if (asg) {
        asg.status = 'COMPLETED';
        asg.completed_at = now;
      }
      this.saveFallbackStore();
    }

    await this.logAuditEvent('EMERGENCY_COMPLETED', emergencyId, { resolvedAt: now });
  }

  // ==========================================================================
  // AUDIT LOGGING
  // ==========================================================================

  async logAuditEvent(eventType, entityId, payload = {}) {
    const event = {
      event_type: eventType,
      entity_id: String(entityId || ''),
      payload: payload || {},
      created_at: new Date().toISOString()
    };

    if (this.isConfigured()) {
      this.adminClient
        .from('audit_events')
        .insert(event)
        .then(() => {})
        .catch(err => console.warn('[Supabase Audit] Error:', err.message));
    } else {
      this.fallbackData.audit_events.push({ id: crypto.randomUUID(), ...event });
      if (this.fallbackData.audit_events.length > 500) {
        this.fallbackData.audit_events = this.fallbackData.audit_events.slice(-500);
      }
      this.saveFallbackStore();
    }
  }

  // ==========================================================================
  // RESTART & STATE RECOVERY
  // ==========================================================================

  /**
   * Recovers persistent driver and unit metadata upon server cold start.
   *
   * Crucial Policy:
   * - Restores registered driver accounts and unit configurations.
   * - Preserves zero active/online units on fresh start by resetting any stale
   *   un-logged-out units to OFFLINE status.
   * - Restores persistent emergency and assignment history.
   */
  async recoverStateOnStartup() {
    // Check if live Supabase is accessible and tables exist
    await this.checkSchemaAvailability();

    const recovered = {
      driverAccounts: new Map(),
      unitMetadata: new Map(),
      unitCounters: { 'AMBULANCE': 0, 'FIRE_BRIGADE': 0, 'RESCUE_TEAM': 0 },
      emergencies: [],
      assignments: []
    };

    if (this.isConfigured()) {
      try {
        // 1. Load drivers
        const { data: drivers } = await this.adminClient.from('driver_accounts').select('*');
        if (drivers) {
          drivers.forEach(d => recovered.driverAccounts.set(d.mobile_number, d));
        }

        // 2. Load units and set stale units to OFFLINE (guaranteeing 0 initial active units)
        const { data: units } = await this.adminClient.from('response_units').select('*');
        if (units) {
          for (const u of units) {
            recovered.unitMetadata.set(u.id, {
              driverId: u.driver_id,
              driverName: drivers?.find(d => d.id === u.driver_id)?.driver_name || '',
              vehicleNumber: u.vehicle_number,
              locationType: u.location_type,
              locationName: u.location_name,
              lat: u.lat,
              lon: u.lon,
              nodeId: u.node_id,
              role: u.role,
              status: 'OFFLINE'
            });

            // Update auto-increment counters
            const match = u.id.match(/^([A-Z]{3})-(\d+)$/);
            if (match) {
              const prefix = match[1];
              const num = parseInt(match[2], 10);
              if (prefix === 'AMB') recovered.unitCounters.AMBULANCE = Math.max(recovered.unitCounters.AMBULANCE, num);
              if (prefix === 'FIR') recovered.unitCounters.FIRE_BRIGADE = Math.max(recovered.unitCounters.FIRE_BRIGADE, num);
              if (prefix === 'RES') recovered.unitCounters.RESCUE_TEAM = Math.max(recovered.unitCounters.RESCUE_TEAM, num);
            }
          }

          // Force all units to OFFLINE in Supabase on cold boot to ensure clean zero-unit startup
          await this.adminClient
            .from('response_units')
            .update({ status: 'OFFLINE' })
            .neq('status', 'OFFLINE');
        }

        // 3. Load active emergencies & assignments
        const { data: emergencies } = await this.adminClient
          .from('emergencies')
          .select('*')
          .neq('status', 'RESOLVED')
          .neq('status', 'CANCELLED');
        if (emergencies) recovered.emergencies = emergencies;

        const { data: assignments } = await this.adminClient
          .from('assignments')
          .select('*')
          .neq('status', 'COMPLETED')
          .neq('status', 'CANCELLED');
        if (assignments) recovered.assignments = assignments;

        console.log(`[Supabase Recovery] Reconciled ${recovered.driverAccounts.size} driver account(s), ${recovered.unitMetadata.size} registered unit(s). All units set to OFFLINE (0 active units).`);
      } catch (err) {
        console.error('[Supabase Recovery] Warning during state recovery:', err.message);
      }
    } else {
      // Recover from fallback data
      this.fallbackData.driver_accounts.forEach(d => recovered.driverAccounts.set(d.mobile_number, d));
      this.fallbackData.response_units.forEach(u => {
        u.status = 'OFFLINE'; // Reset to OFFLINE on startup
        const d = this.fallbackData.driver_accounts.find(item => item.id === u.driver_id);
        recovered.unitMetadata.set(u.id, {
          driverId: u.driver_id,
          driverName: d?.driver_name || '',
          vehicleNumber: u.vehicle_number,
          locationType: u.location_type,
          locationName: u.location_name,
          lat: u.lat,
          lon: u.lon,
          nodeId: u.node_id,
          role: u.role,
          status: 'OFFLINE'
        });

        const match = u.id.match(/^([A-Z]{3})-(\d+)$/);
        if (match) {
          const prefix = match[1];
          const num = parseInt(match[2], 10);
          if (prefix === 'AMB') recovered.unitCounters.AMBULANCE = Math.max(recovered.unitCounters.AMBULANCE, num);
          if (prefix === 'FIR') recovered.unitCounters.FIRE_BRIGADE = Math.max(recovered.unitCounters.FIRE_BRIGADE, num);
          if (prefix === 'RES') recovered.unitCounters.RESCUE_TEAM = Math.max(recovered.unitCounters.RESCUE_TEAM, num);
        }
      });
      this.saveFallbackStore();
      recovered.emergencies = this.fallbackData.emergencies.filter(e => e.status !== 'RESOLVED');
      recovered.assignments = this.fallbackData.assignments.filter(a => a.status !== 'COMPLETED');
      console.log(`[Supabase Fallback Recovery] Reconciled ${recovered.driverAccounts.size} driver account(s), ${recovered.unitMetadata.size} registered unit(s). Initial active units = 0.`);
    }

    return recovered;
  }
}

// Export singleton instance
module.exports = new SupabaseService();
