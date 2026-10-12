const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Use isolated local storage directory for test to guarantee zero live Supabase modification
const storageDir = path.join(__dirname, '.storage_test_decline');
try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch (e) {}

const TEST_PORT = 4099;

const serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: {
        ...process.env,
        PORT: String(TEST_PORT),
        SUPABASE_URL: '', // Force fallback storage
        SUPABASE_SERVICE_ROLE_KEY: '',
        STORAGE_DIR: storageDir,
        NODE_ENV: 'test'
    },
    stdio: 'pipe'
});

serverProcess.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('error') || s.includes('Error') || s.includes('WARN')) {
        process.stdout.write('[SERVER] ' + s);
    }
});
serverProcess.stderr.on('data', (d) => process.stderr.write('[SERVER-ERR] ' + d.toString()));

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

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function run() {
    console.log('--- Starting Driver Decline & Reallocation Integration Test ---');
    try {
        // 1. Wait for server readiness
        let ready = false;
        for (let i = 0; i < 30; i++) {
            await delay(300);
            try {
                const res = await request('GET', '/api/state');
                if (res.status === 200) { ready = true; break; }
            } catch (e) {}
        }
        if (!ready) throw new Error('Server failed to start on test port');
        console.log('[PASS] Server started and healthy');

        // Generate unique numbers per run
        const suffix = String(Math.floor(1000 + Math.random() * 9000));
        const mob1 = `981111${suffix}`;
        const mob2 = `982222${suffix}`;

        // 2. Register and Activate Driver 1 (Ambulance at DECCAN_GYMKHANA)
        const d1 = await request('POST', '/api/drivers/register', {
            mobileNumber: mob1,
            password: 'password123',
            driverName: 'Ramesh Driver 1',
            role: 'AMBULANCE',
            vehicleNumber: 'MH-12-AMB-101'
        });
        if (!d1.data.success || !d1.data.driver) throw new Error(`Driver 1 registration failed: ${JSON.stringify(d1.data)}`);
        const token1 = d1.data.token;
        const unitId1 = d1.data.driver.unitId;
        console.log(`[PASS] Driver 1 registered (Unit: ${unitId1})`);

        // Activate Driver 1 at Deccan Gymkhana
        const act1 = await request('POST', '/api/drivers/activate', {
            mobileNumber: mob1,
            unitId: unitId1,
            locationType: 'DECCAN_GYMKHANA'
        }, { 'Authorization': `Bearer ${token1}` });
        if (!act1.data.success) throw new Error(`Driver 1 activation failed: ${JSON.stringify(act1.data)}`);
        console.log(`[PASS] Driver 1 activated at Deccan Gymkhana`);

        // 3. Register and Activate Driver 2 (Ambulance at SHIVAJI_NAGAR)
        const d2 = await request('POST', '/api/drivers/register', {
            mobileNumber: mob2,
            password: 'password123',
            driverName: 'Suresh Driver 2',
            role: 'AMBULANCE',
            vehicleNumber: 'MH-12-AMB-102'
        });
        if (!d2.data.success || !d2.data.driver) throw new Error(`Driver 2 registration failed: ${JSON.stringify(d2.data)}`);
        const token2 = d2.data.token;
        const unitId2 = d2.data.driver.unitId;
        console.log(`[PASS] Driver 2 registered (Unit: ${unitId2})`);

        // Activate Driver 2 at Shivaji Nagar
        const act2 = await request('POST', '/api/drivers/activate', {
            mobileNumber: mob2,
            unitId: unitId2,
            locationType: 'SHIVAJI_NAGAR'
        }, { 'Authorization': `Bearer ${token2}` });
        if (!act2.data.success) throw new Error(`Driver 2 activation failed: ${JSON.stringify(act2.data)}`);
        console.log(`[PASS] Driver 2 activated at Shivaji Nagar`);

        // 4. Report Emergency close to Deccan Gymkhana (lat 18.5162, lon 73.8402)
        // Unit 1 (Deccan Gymkhana) is ~0.03 km away. Unit 2 (Shivaji Nagar) is ~1.7 km away.
        const emReport = await request('POST', '/api/emergencies', {
            id: 'EM-DEC-01',
            type: 'ACCIDENT',
            priority: 'HIGH',
            nodeId: 'Deccan_Gymkhana_D',
            lat: 18.5162,
            lon: 73.8402,
            injuredCount: 1,
            severity: 3
        });
        console.log('Report emergency response:', emReport.data);
        if (!emReport.data.allocatedTeamId || emReport.data.allocatedTeamId !== unitId1) {
            throw new Error(`Expected nearest driver ${unitId1} to be allocated, got: ${emReport.data.allocatedTeamId}`);
        }
        console.log(`[PASS] Nearest driver ${unitId1} allocated initially`);

        // Verify Unit 1 has active assignment
        const stateRes1 = await request('GET', '/api/state');
        const team1State = stateRes1.data.teams.find(t => t.id === unitId1);
        const initialAsgId = team1State.activeAssignmentId;
        if (!initialAsgId) throw new Error('Unit 1 missing activeAssignmentId');
        console.log(`[PASS] Unit 1 activeAssignmentId: ${initialAsgId}`);

        // 5. Driver 1 declines their assignment using Driver 1's token
        console.log(`Driver 1 declining assignment ${initialAsgId} with token1...`);
        const declineRes1 = await request('POST', `/api/assignments/${initialAsgId}/decline`, null, {
            'Authorization': `Bearer ${token1}`
        });
        console.log('Decline response:', declineRes1.data);
        if (!declineRes1.data.success) {
            throw new Error(`Decline failed: ${JSON.stringify(declineRes1.data)}`);
        }

        // Check reallocation result: MUST BE UNIT 2, NOT UNIT 1!
        if (declineRes1.data.allocatedTeamId !== unitId2) {
            throw new Error(`EXPECTED REALLOCATION TO UNIT 2 (${unitId2}), BUT GOT: ${declineRes1.data.allocatedTeamId}`);
        }
        console.log(`[PASS] C++ Engine successfully reallocated emergency to second-nearest driver: ${unitId2}`);

        // Verify snapshot states
        const stateRes2 = await request('GET', '/api/state');
        const team1After = stateRes2.data.teams.find(t => t.id === unitId1);
        const team2After = stateRes2.data.teams.find(t => t.id === unitId2);

        if (team1After.status !== 'AVAILABLE') throw new Error(`Unit 1 should be restored to AVAILABLE, got ${team1After.status}`);
        if (team1After.activeAssignmentId) throw new Error(`Unit 1 should have empty activeAssignmentId, got ${team1After.activeAssignmentId}`);
        if (team2After.status !== 'BUSY') throw new Error(`Unit 2 should be BUSY, got ${team2After.status}`);
        if (!team2After.activeAssignmentId) throw new Error('Unit 2 should have activeAssignmentId');
        const secondAsgId = team2After.activeAssignmentId;
        console.log(`[PASS] Unit 1 restored to AVAILABLE, Unit 2 assigned: ${secondAsgId}`);

        // 6. Test Cross-Driver Decline Protection:
        // Driver 1 attempts to decline Driver 2's assignment (secondAsgId) using Driver 1's token
        console.log(`Testing cross-driver decline protection: Driver 1 attempting to decline Driver 2's assignment (${secondAsgId})...`);
        const crossDecline = await request('POST', `/api/assignments/${secondAsgId}/decline`, null, {
            'Authorization': `Bearer ${token1}`
        });
        console.log('Cross-driver decline status:', crossDecline.status);
        if (crossDecline.status !== 403) {
            throw new Error(`Expected 403 Forbidden for cross-driver decline, got: ${crossDecline.status} ${JSON.stringify(crossDecline.data)}`);
        }
        console.log('[PASS] Cross-driver decline blocked with 403 Forbidden');

        // 7. Test Idempotent decline on initial assignment by Driver 1
        const dupDecline = await request('POST', `/api/assignments/${initialAsgId}/decline`, null, {
            'Authorization': `Bearer ${token1}`
        });
        if (!dupDecline.data.success) throw new Error(`Duplicate decline should be idempotent: ${JSON.stringify(dupDecline.data)}`);
        console.log('[PASS] Duplicate decline handled idempotently');

        // 8. Test Invalid Lifecycle Transition: Decline after Accept
        // Driver 2 accepts secondAsgId
        console.log(`Driver 2 accepting assignment ${secondAsgId}...`);
        const acceptRes = await request('POST', `/api/assignments/${secondAsgId}/accept`, null, {
            'Authorization': `Bearer ${token2}`
        });
        if (!acceptRes.data.success) throw new Error(`Driver 2 accept failed: ${JSON.stringify(acceptRes.data)}`);
        console.log('[PASS] Driver 2 accepted assignment successfully');

        // Driver 2 now attempts to decline secondAsgId after accepting it
        console.log(`Driver 2 attempting to decline assignment ${secondAsgId} AFTER accepting...`);
        const declineAfterAccept = await request('POST', `/api/assignments/${secondAsgId}/decline`, null, {
            'Authorization': `Bearer ${token2}`
        });
        console.log('Decline after accept status:', declineAfterAccept.status, declineAfterAccept.data);
        if (declineAfterAccept.status !== 400 || declineAfterAccept.data.success !== false) {
            throw new Error(`Expected 400 Bad Request for decline after accept, got: ${declineAfterAccept.status}`);
        }
        console.log('[PASS] Decline after accept rejected with 400 Bad Request');

        // Verify database persistence file after accept
        const dbFile = path.join(storageDir, 'local_db.json');
        if (fs.existsSync(dbFile)) {
            const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
            const asg1Db = db.assignments.find(a => a.id === initialAsgId);
            const asg2Db = db.assignments.find(a => a.id === secondAsgId);
            const emDb = db.emergencies.find(e => e.id === 'EM-DEC-01');
            const u1Db = db.response_units.find(u => u.id === unitId1);
            const u2Db = db.response_units.find(u => u.id === unitId2);

            if (!asg1Db || asg1Db.status !== 'DECLINED') throw new Error(`Expected asg1 DECLINED in DB, got: ${asg1Db?.status}`);
            if (!asg2Db || asg2Db.status !== 'ACCEPTED') throw new Error(`Expected asg2 ACCEPTED in DB, got: ${asg2Db?.status}`);
            if (!emDb || emDb.allocated_team_id !== unitId2) throw new Error(`Expected emergency allocated to unitId2 in DB, got: ${emDb?.allocated_team_id}`);
            if (!u1Db || u1Db.status !== 'AVAILABLE' || u1Db.active_assignment_id !== null) throw new Error(`Expected u1 AVAILABLE in DB, got: ${u1Db?.status}`);
            if (!u2Db || u2Db.status !== 'BUSY') throw new Error(`Expected u2 BUSY in DB, got: ${u2Db?.status}`);
            console.log('[PASS] Database persistence verified: initial DECLINED, second ACCEPTED, units consistent');
        }

        // Complete emergency EM-DEC-01 to free Unit 2
        await request('POST', '/api/emergencies/EM-DEC-01/complete');
        console.log('[PASS] Emergency EM-DEC-01 completed');

        // 9. All-Drivers-Decline Case:
        // Report EM-DEC-03 near Deccan Gymkhana
        console.log('Reporting new emergency EM-DEC-03 for all-drivers-decline test...');
        const emReport3 = await request('POST', '/api/emergencies', {
            id: 'EM-DEC-03',
            type: 'ACCIDENT',
            priority: 'HIGH',
            nodeId: 'Deccan_Gymkhana_D',
            lat: 18.5162,
            lon: 73.8402,
            injuredCount: 1,
            severity: 3
        });
        const asg3Id = emReport3.data.assignmentId;
        console.log(`EM-DEC-03 offered to ${emReport3.data.allocatedTeamId} (asg: ${asg3Id})`);

        // Driver 1 declines
        const dec3_1 = await request('POST', `/api/assignments/${asg3Id}/decline`, null, {
            'Authorization': `Bearer ${token1}`
        });
        const asg3_2Id = dec3_1.data.newAssignmentId || dec3_1.data.assignmentId;
        console.log(`EM-DEC-03 reallocated to ${dec3_1.data.allocatedTeamId} (asg: ${asg3_2Id})`);

        // Driver 2 also declines
        const dec3_2 = await request('POST', `/api/assignments/${asg3_2Id}/decline`, null, {
            'Authorization': `Bearer ${token2}`
        });
        console.log('Driver 2 decline response for EM-DEC-03:', dec3_2.data);
        if (dec3_2.data.allocatedTeamId) {
            throw new Error(`Expected no allocation when all drivers declined, got: ${dec3_2.data.allocatedTeamId}`);
        }

        // Verify snapshot and database in all-drivers-decline state:
        const stateRes3 = await request('GET', '/api/state');
        const em3State = stateRes3.data.emergencies.find(e => e.id === 'EM-DEC-03');
        const t1State3 = stateRes3.data.teams.find(t => t.id === unitId1);
        const t2State3 = stateRes3.data.teams.find(t => t.id === unitId2);

        if (em3State.status !== 'PENDING') throw new Error(`EM-DEC-03 must be PENDING, got ${em3State.status}`);
        if (t1State3.activeAssignmentId || t2State3.activeAssignmentId) {
            throw new Error(`Neither unit should have active assignment. t1: ${t1State3.activeAssignmentId}, t2: ${t2State3.activeAssignmentId}`);
        }
        if (t1State3.status !== 'AVAILABLE' || t2State3.status !== 'AVAILABLE') {
            throw new Error(`Both units must be AVAILABLE. t1: ${t1State3.status}, t2: ${t2State3.status}`);
        }
        console.log('[PASS] All-drivers-decline verified: emergency safely remains PENDING with no stale assignments');

        // 10. Declining drivers remain eligible for NEW emergencies
        console.log('Reporting new emergency EM-DEC-04...');
        const emReport4 = await request('POST', '/api/emergencies', {
            id: 'EM-DEC-04',
            type: 'ACCIDENT',
            priority: 'HIGH',
            nodeId: 'Deccan_Gymkhana_D',
            lat: 18.5162,
            lon: 73.8402,
            injuredCount: 1,
            severity: 3
        });
        if (emReport4.data.allocatedTeamId !== unitId1) {
            throw new Error(`Unit 1 should be eligible for new emergency EM-DEC-04, got: ${emReport4.data.allocatedTeamId}`);
        }
        console.log(`[PASS] Driver 1 (${unitId1}) is eligible and selected for subsequent emergency EM-DEC-04`);

        console.log('\n========================================');
        console.log('ALL DECLINE & REALLOCATION TESTS PASSED!');
        console.log('========================================');
    } finally {
        serverProcess.kill('SIGTERM');
        try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch (e) {}
    }
}

run().catch(err => {
    console.error('[FAIL]', err.message);
    serverProcess.kill('SIGKILL');
    try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch (e) {}
    process.exit(1);
});
