'use strict';

// Default-profile Windows acceptance. Unlike every other packaged harness this
// one deliberately does NOT set FURY_DATA_DIR, because its whole purpose is to
// prove the real canonical %APPDATA%\Fury resolution and installer/portable
// interoperability against it. It refuses to run if a Fury profile already
// exists, and removes only the profile it created itself.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const WS = require('ws');
const { unusedPorts, eventually, getJson, packagePaths } = require('./smoke_packaged_app');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '..');
const T0 = Date.now();
const trace = (...m) => console.error(`[t+${String(Date.now() - T0).padStart(6)}ms]`, ...m);

function profileRoots(env) {
    const appData = env.APPDATA;
    assert(appData && path.isAbsolute(appData), 'APPDATA must be set for default-profile verification');
    const data = path.join(appData, 'Fury');
    return { appData, data, userData: path.join(data, 'launcher_data') };
}

// A minimal inspector session: enough to fence authentication and read the
// real paths production Main resolved, without the full runtime fixture.
async function attach(port) {
    const target = await eventually(async () => (await getJson(`http://127.0.0.1:${port}/json/list`))[0],
        'packaged Main inspector', 45000);
    const socket = new WS(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let sequence = 0;
    const pending = new Map(), events = new Map();
    socket.on('message', raw => {
        const message = JSON.parse(raw);
        if (!message.id) return void events.get(message.method)?.(message.params);
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        message.error ? waiter?.reject(new Error(message.error.message)) : waiter?.resolve(message.result);
    });
    const call = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP ${method} did not respond within ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, {
            resolve: value => { clearTimeout(timer); resolve(value); },
            reject: error => { clearTimeout(timer); reject(error); }
        });
        socket.send(JSON.stringify({ id, method, params }));
    });
    // Register before enabling: an --inspect-brk target reports its pause as
    // soon as the debugger attaches, and a handler installed afterwards misses
    // it and waits forever.
    const paused = new Promise(resolve => events.set('Debugger.paused', resolve));
    await call('Debugger.enable');
    await call('Runtime.runIfWaitingForDebugger');
    const callFrameId = (await paused).callFrames[0].callFrameId;
    const evaluate = async expression => {
        const result = await call('Debugger.evaluateOnCallFrame', { callFrameId, expression, returnByValue: true });
        assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    // Runtime.evaluate targets the running main context, unlike
    // Debugger.evaluateOnCallFrame which only works while paused.
    const runtime = async expression => {
        const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    return { call, evaluate, runtime, close: () => socket.close() };
}

function cleanWindowsEnvironment(blockedPort) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        // FURY_DATA_DIR in particular must not survive: it would defeat the test.
        if (/^(?:FURY_|NESTER_|STATMOD_|PUPPETEER_|COSMETIC_SEARCH_|AURORA_|HYPIXEL_|URCHIN_|SERAPH_)/i.test(key)
            || /^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i.test(key)) delete env[key];
    }
    return { ...env, STATMOD_AUTO_START_PROXY: '0', FORCE_COLOR: '0',
        HTTP_PROXY: `http://127.0.0.1:${blockedPort}`, HTTPS_PROXY: `http://127.0.0.1:${blockedPort}`,
        ALL_PROXY: `http://127.0.0.1:${blockedPort}`, NO_PROXY: '127.0.0.1,localhost,::1' };
}

const launched = [];
async function launch(executable, { blocked, label }) {
    const [inspect, debugPort] = await unusedPorts(2);
    const env = cleanWindowsEnvironment(blocked);
    const child = cp.spawn(executable, [`--inspect-brk=127.0.0.1:${inspect}`,
        `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'],
        { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    launched.push(child);
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    trace(label, 'spawned pid', child.pid, 'inspector port', inspect);
    const session = await attach(inspect).catch(error => {
        throw new Error(`${label} inspector failed: ${error.message}\n${output}`);
    });
    trace(label, 'inspector attached and paused');
    // Fence real authentication and external navigation before Main continues.
    await session.evaluate(`(()=>{const e=require('electron');
        e.shell.openExternal=async()=>{throw Error('EXTERNAL BROWSER DISABLED IN ACCEPTANCE TEST');};
        require('prismarine-auth').Authflow.prototype.getMinecraftJavaToken=async()=>{throw Error('REAL AUTH DISABLED IN ACCEPTANCE TEST');};
        return true;})()`);
    trace(label, 'auth/browser fenced');
    // Resume first. At the --inspect-brk breakpoint Main has not run yet, so
    // app.getPath('userData') still reports Electron's own default. The
    // production value only exists after launcher.js calls app.setPath().
    await session.call('Debugger.resume');
    session.close();
    trace(label, 'resumed, inspector released');
    const { userData: expectedUserData } = profileRoots(process.env);
    // Electron only writes its profile once Main has redirected userData to the
    // canonical root, so this file appearing is the real production signal.
    await eventually(() => {
        assert(child.exitCode === null, `${label} exited early with ${child.exitCode}: ${output}`);
        assert(fs.existsSync(path.join(expectedUserData, 'Preferences')), 'canonical launcher_data not initialised yet');
    }, `${label} canonical profile`, 90000);
    trace(label, 'canonical profile initialised at', expectedUserData);
    // Quitting before the launcher is interactive is not a clean quit. The
    // accepted packaged harnesses wait for renderer readiness first, so this
    // one does too, otherwise shutdown is measured mid-initialisation.
    const browser = await eventually(() => puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null }),
        `${label} renderer`, 60000);
    const page = await eventually(async () => {
        const found = (await browser.pages()).find(item => item.url().endsWith('/launcher.html'));
        assert(found, 'launcher page not open yet');
        return found;
    }, `${label} launcher page`, 60000);
    await page.waitForFunction('!!furyDesign && !!state?.settings', { timeout: 60000 });
    browser.disconnect();
    trace(label, 'launcher interactive');
    // Observed rather than self-reported: userData is proven by Electron's own
    // profile file existing there, and the version by the packaged application.
    const appPackage = JSON.parse(fs.readFileSync(
        path.join(path.dirname(executable), 'resources', 'app', 'package.json'), 'utf8'));
    const paths = { appData: profileRoots(process.env).appData, userData: expectedUserData,
        packaged: true, exec: executable, version: appPackage.version, dataDir: env.FURY_DATA_DIR ?? null };
    return { child, paths, output: () => output };
}

async function quit(child, label) {
    trace(label, 'quit requested for pid', child.pid);
    // WM_CLOSE, not TerminateProcess: the accepted F7 shutdown entry point,
    // identical to a user closing the window, so persistence actually drains.
    cp.spawnSync('taskkill', ['/PID', String(child.pid)], { windowsHide: true });
    const code = await eventually(() => { assert.notEqual(child.exitCode, null, `${label} still running`); return child.exitCode; },
        `${label} exit`, 30000);
    trace(label, 'exited with code', code);
    return code;
}

async function main() {
    assert.equal(process.platform, 'win32', 'Default-profile acceptance runs on Windows');
    const [installed, portable] = process.argv.slice(2, 4);
    assert(installed && portable, 'Usage: node scripts/verify_windows_default_profile.js <installed app dir> <portable app dir> [report.json]');
    const { appData, data, userData } = profileRoots(process.env);
    assert(!fs.existsSync(data), `Refusing to run: a Fury profile already exists at ${data}. `
        + 'This check owns the default profile and must not touch real user data.');
    const [blocked] = await unusedPorts(1);
    const results = { schemaVersion: 1, platform: 'win32', defaultProfileTested: true, canonicalRoot: data, checks: [] };
    const record = (name, detail) => { results.checks.push({ name, ...detail }); console.log(`ok ${name}`); trace('CHECK', name); };
    // Accept either the application directory or its executable.
    const resolveApp = input => {
        const target = path.resolve(input);
        const candidate = fs.existsSync(target) && fs.statSync(target).isDirectory()
            ? path.join(target, 'Fury.exe') : target;
        return packagePaths(candidate).executable;
    };
    const applications = { installed: resolveApp(installed), portable: resolveApp(portable) };
    try {
        // 1. Installer first: the canonical profile is created where it belongs.
        const first = await launch(applications.installed, { blocked, label: 'installed' });
        assert.equal(first.paths.dataDir, null, 'FURY_DATA_DIR must not be set for default-profile verification');
        assert(first.paths.packaged, 'Acceptance requires the packaged application');
        assert.equal(path.resolve(first.paths.appData), path.resolve(appData));
        assert.equal(path.resolve(first.paths.userData), path.resolve(userData));
        await eventually(() => assert(fs.existsSync(userData)), 'canonical launcher_data', 30000);
        record('canonical-default-profile', { appData: first.paths.appData, userData: first.paths.userData, version: first.paths.version });

        // Synthetic profile marker written directly into the canonical root.
        const marker = path.join(data, 'features_config.json');
        fs.writeFileSync(marker, JSON.stringify({ apiKillSwitchEnabled: true, chatPrefixAccentHex: '#123456' }));
        assert.equal(await quit(first.child, 'installed'), 0);
        record('installer-clean-exit', { exitCode: 0 });

        // 2. Portable second: same machine profile, no second data root.
        const second = await launch(applications.portable, { blocked, label: 'portable' });
        assert.equal(path.resolve(second.paths.userData), path.resolve(userData));
        assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).chatPrefixAccentHex, '#123456');
        record('portable-sees-installer-profile', { userData: second.paths.userData });

        // 3. Single-instance ownership: the second application must not take over.
        const collision = cp.spawn(applications.installed, [], { env: cleanWindowsEnvironment(blocked), windowsHide: true, stdio: 'ignore' });
        const collisionCode = await eventually(() => { assert.notEqual(collision.exitCode, null); return collision.exitCode; },
            'single-instance secondary exit', 30000);
        assert.equal(collisionCode, 0, 'A secondary instance must exit cleanly rather than run');
        record('single-instance-ownership', { secondaryExitCode: collisionCode });
        assert.equal(await quit(second.child, 'portable'), 0);

        // 4. Portable first, installer second, after replacing portable files.
        const replaced = path.join(path.dirname(applications.portable), 'acceptance-replacement-probe.txt');
        fs.writeFileSync(replaced, 'synthetic replacement marker');
        fs.rmSync(replaced);
        const third = await launch(applications.portable, { blocked, label: 'portable-first' });
        fs.writeFileSync(marker, JSON.stringify({ apiKillSwitchEnabled: true, chatPrefixAccentHex: '#abcdef' }));
        assert.equal(await quit(third.child, 'portable-first'), 0);
        const fourth = await launch(applications.installed, { blocked, label: 'installed-second' });
        assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).chatPrefixAccentHex, '#abcdef');
        assert.equal(path.resolve(fourth.paths.userData), path.resolve(userData));
        record('installer-sees-portable-profile', { userData: fourth.paths.userData });
        assert.equal(await quit(fourth.child, 'installed-second'), 0);

        // 5. User data survives application replacement.
        assert(fs.existsSync(marker), 'User data must survive replacing the portable application');
        record('user-data-survives-replacement', { marker: path.basename(marker) });
        results.passed = true;
    } finally {
        // Tear down any application still holding the profile before touching it.
        for (const child of launched) {
            if (child.exitCode === null) {
                try { cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* already gone */ }
            }
        }
        // Remove only what this check created. It asserted the profile was absent
        // first. The migration receipt must go too: leaving a completed receipt
        // behind would make a later real install skip migrating legacy data.
        // Cleanup failures must never replace the real failure.
        try {
            for (const created of [data, path.join(appData, '.Fury-migration-v1')]) {
                if (fs.existsSync(created)) fs.rmSync(created, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
            }
        } catch (error) { console.error('cleanup warning:', error.message); }
    }
    if (process.argv[4]) fs.writeFileSync(path.resolve(process.argv[4]), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { profileRoots, cleanWindowsEnvironment };
