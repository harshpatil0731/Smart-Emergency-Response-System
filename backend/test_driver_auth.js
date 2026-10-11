const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Ensure clean driver and storage files for test
const driversFile = path.join(__dirname, '..', 'backend', '.drivers.json');
if (fs.existsSync(driversFile)) {
    try { fs.unlinkSync(driversFile); } catch (e) {}
}
const storageFile = path.join(__dirname, '..', 'backend', '.storage', 'local_db.json');
if (fs.existsSync(storageFile)) {
    try { fs.unlinkSync(storageFile); } catch (e) {}
}

const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..', 'backend'),
    stdio: 'pipe'
});

serverProcess.stdout.on('data', (d) => process.stdout.write('[SERVER] ' + d.toString()));
serverProcess.stderr.on('data', (d) => process.stderr.write('[SERVER-ERR] ' + d.toString()));

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: '127.0.0.1',
            port: 4000,
            path: path,
            method: method,
            headers: payload ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            } : {}
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
    console.log('Waiting for backend server to start...');
    let ready = false;
    for (let i = 0; i < 20; i++) {
        await delay(500);
        try {
            const health = await request('GET', '/api/state');
            if (health.status === 200) {
                ready = true;
                break;
            }
        } catch (e) {}
    }

    if (!ready) {
        throw new Error('Server failed to start');
    }

    console.log('\n--- 1. Checking Initial Units ---');
    const initTeams = await request('GET', '/api/teams');
    console.log('Initial teams count:', (initTeams.data.teams || []).length);
    if ((initTeams.data.teams || []).length !== 0) {
        throw new Error('Expected 0 teams on startup!');
    }
    console.log('PASS: Initial units is exactly 0.');

    console.log('\n--- 2. Register Driver Account ---');
    const regRes = await request('POST', '/api/drivers/register', {
        role: 'Ambulance',
        driverName: 'Rohit Mane',
        mobileNumber: '9823012345',
        password: 'pass1234',
        vehicleNumber: 'MH12AB1000'
    });
    console.log('Register response status:', regRes.status, regRes.data);
    if ((regRes.status !== 200 && regRes.status !== 201) || !regRes.data.driver || regRes.data.driver.unitId !== 'AMB-01') {
        throw new Error('Registration failed or wrong unit ID assigned');
    }
    console.log('PASS: Driver registered with Unit ID:', regRes.data.driver.unitId);

    console.log('\n--- 3. Check Teams Still Zero (Account registered but not yet activated) ---');
    const midTeams = await request('GET', '/api/teams');
    console.log('Teams count before activation:', (midTeams.data.teams || []).length);
    if ((midTeams.data.teams || []).length !== 0) {
        throw new Error('Unit should not be active before location activation!');
    }
    console.log('PASS: Unit is not yet active in system.');

    console.log('\n--- 4. Test Duplicate Registration Prevention ---');
    const dupRes = await request('POST', '/api/drivers/register', {
        role: 'Ambulance',
        driverName: 'Another Driver',
        mobileNumber: '9823012345',
        password: 'pass1234',
        vehicleNumber: 'MH12AB9999'
    });
    console.log('Duplicate mobile status:', dupRes.status);
    if (dupRes.status !== 409) {
        throw new Error('Expected 409 for duplicate mobile number');
    }
    console.log('PASS: Duplicate mobile rejected with 409.');

    console.log('\n--- 5. Test Driver Login ---');
    const wrongPassRes = await request('POST', '/api/drivers/login', {
        mobileNumber: '9823012345',
        password: 'wrongpassword'
    });
    console.log('Wrong password status:', wrongPassRes.status);
    if (wrongPassRes.status !== 401) {
        throw new Error('Expected 401 for wrong password');
    }

    const loginRes = await request('POST', '/api/drivers/login', {
        mobileNumber: '9823012345',
        password: 'pass1234'
    });
    console.log('Login status:', loginRes.status, 'Driver:', loginRes.data.driver.driverName, 'isOnline:', loginRes.data.isOnline);
    if (loginRes.status !== 200 || loginRes.data.isOnline !== false || loginRes.data.driver.unitId !== 'AMB-01') {
        throw new Error('Login failed or unexpected online status');
    }
    console.log('PASS: Driver login retrieved profile successfully.');

    console.log('\n--- 6. Activate Unit & Go Online with Location ---');
    const actRes = await request('POST', '/api/drivers/activate', {
        mobileNumber: '9823012345',
        unitId: 'AMB-01',
        locationType: 'CAMP_ZONE'
    });
    console.log('Activation status:', actRes.status, 'Team:', actRes.data.team);
    if (actRes.status !== 200 || !actRes.data.team || actRes.data.team.id !== 'AMB-01') {
        throw new Error('Activation failed');
    }
    console.log('PASS: Unit activated in C++ engine and state.');

    console.log('\n--- 7. Check Active Teams Count ---');
    const activeTeams = await request('GET', '/api/teams');
    console.log('Active teams count:', (activeTeams.data.teams || []).length);
    if ((activeTeams.data.teams || []).length !== 1) {
        throw new Error('Expected 1 active team!');
    }
    console.log('PASS: Exactly 1 team active in system.');

    console.log('\n--- 8. Login While Online ---');
    const loginAgain = await request('POST', '/api/drivers/login', {
        mobileNumber: '9823012345',
        password: 'pass1234'
    });
    console.log('Login again isOnline:', loginAgain.data.isOnline, 'Team status:', loginAgain.data.team.status);
    if (loginAgain.data.isOnline !== true || loginAgain.data.team.status !== 'AVAILABLE') {
        throw new Error('Expected isOnline true when logging in while online');
    }
    console.log('PASS: Active unit recognized on login.');

    console.log('\n--- 9. Driver Logout ---');
    const logoutRes = await request('POST', '/api/teams/AMB-01/logout');
    console.log('Logout status:', logoutRes.status);
    const postLogoutTeams = await request('GET', '/api/teams');
    console.log('Teams count after logout:', (postLogoutTeams.data.teams || []).length);
    if ((postLogoutTeams.data.teams || []).length !== 0) {
        throw new Error('Expected 0 teams after logout');
    }
    console.log('PASS: Unit removed from active teams on logout.');

    console.log('\n=== ALL END-TO-END TESTS PASSED SUCCESSFULLY! ===\n');
}

run()
    .then(() => {
        serverProcess.kill('SIGINT');
        process.exit(0);
    })
    .catch((err) => {
        console.error('TEST FAILED:', err);
        serverProcess.kill('SIGINT');
        process.exit(1);
    });
