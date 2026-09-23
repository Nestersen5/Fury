'use strict';

// Run on the target OS against an extracted release, never against npm start.
// Every application and protocol check runs with the packaged
// Electron executable. The outer Node process is only the CI test driver.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function uiTestArguments() {
    // Mac CI VMs have no usable WebGL GPU. Opt in only for the isolated test
    // process loading trusted local app content; shipped app defaults stay intact.
    // https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
    return process.platform === 'darwin' && process.env.CI === 'true'
        ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] : [];
}

function packagePaths(input) {
    let executable = path.resolve(input);
    if (executable.endsWith('.app') && fs.statSync(executable).isDirectory()) {
        const candidates = fs.readdirSync(path.join(executable, 'Contents', 'MacOS'));
        assert.strictEqual(candidates.length, 1, 'Expected one main macOS executable');
        executable = path.join(executable, 'Contents', 'MacOS', candidates[0]);
    }
    assert(fs.statSync(executable).isFile(), 'Pass a packaged executable or .app bundle');
    const resources = process.platform === 'darwin'
        ? path.resolve(path.dirname(executable), '..', 'Resources')
        : path.join(path.dirname(executable), 'resources');
    const appRoot = path.join(resources, 'app');
    assert(fs.existsSync(path.join(appRoot, 'launcher.js')), 'Packaged launcher is missing');
    for (const privatePath of ['.env', '.env.local', 'statmod_key.txt', 'auth_tokens', 'launcher_data',
        'recordings', 'packet_logs', 'backups', 'tmp', 'friend_aliases.json', 'session_data.json',
        'denicked.json', 'encounter_data.json', 'features_config.json', 'server_config.json',
        'cosmetic_search_cache.json', 'cosmetic_direct_samples.json', 'kill_message_patterns.json',
        'src/cosmetics/effect_library.json']) {
        assert(!fs.existsSync(path.join(appRoot, privatePath)), `Private runtime data was bundled: ${privatePath}`);
    }
    for (const asset of ['skinview3d/bundles/skinview3d.bundle.js', 'skinview3d/assets/minecraft.woff2']) {
        assert(fs.existsSync(path.join(appRoot, 'node_modules', asset)), `Skin preview asset is missing: ${asset}`);
    }
    return { executable, resources, appRoot };
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { timeout: 2000 }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('error', reject);
            response.on('end', () => {
                try {
                    assert.strictEqual(response.statusCode, 200, `${url}: ${response.statusCode}`);
                    resolve(JSON.parse(body));
                } catch (error) { reject(error); }
            });
        });
        request.on('timeout', () => request.destroy(new Error(`Request timed out: ${url}`)));
        request.on('error', reject);
    });
}

async function eventually(operation, description, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try { return await operation(); } catch (error) { lastError = error; }
        await delay(200);
    }
    throw new Error(`${description}: ${lastError?.message || 'timed out'}`);
}

async function unusedPorts(count) {
    // Reserve all ports together so this process never selects duplicates.
    const servers = [];
    try {
        for (let index = 0; index < count; index++) {
            const server = net.createServer();
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            servers.push(server);
        }
        return servers.map(server => server.address().port);
    } finally {
        await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    }
}

function startChild(executable, args, env, label) {
    const child = spawn(executable, args, {
        cwd: env.FURY_DATA_DIR,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.output = '';
    for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', chunk => { child.output = (child.output + chunk.toString()).slice(-18000); });
    }
    child.on('error', error => { child.startError = error; });
    child.label = label;
    return child;
}

function assertRunning(child) {
    if (child.startError) throw child.startError;
    assert(child.exitCode === null && child.signalCode === null,
        `${child.label} exited unexpectedly\n${child.output}`);
}

async function stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const deadline = Date.now() + 5000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(50);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await eventually(async () => {
            assert(child.exitCode !== null || child.signalCode !== null, 'process still running');
        }, `Stopping ${child.label}`, 5000);
    }
}

async function completedChild(child, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
        if (child.startError) throw child.startError;
        await delay(100);
    }
    if (child.exitCode === null && child.signalCode === null) {
        await stopChild(child);
        throw new Error(`${child.label} timed out\n${child.output}`);
    }
    assert.strictEqual(child.exitCode, 0, `${child.label} failed\n${child.output}`);
    process.stdout.write(child.output);
}

function cleanEnvironment(tempDirectory, resources, cosmeticPort, blockedNetworkPort) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (/^(?:FURY_|NESTER_|STATMOD_|PUPPETEER_|COSMETIC_SEARCH_|AURORA_|HYPIXEL_|URCHIN_|SERAPH_)/i.test(key)
            || /^(?:NODE_OPTIONS|NODE_PATH|NODE_BINARY|npm_node_execpath|ELECTRON_RUN_AS_NODE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i.test(key)) delete env[key];
        // No npm, Homebrew, or other development-runtime directories in PATH.
        if (/^path$/i.test(key)) delete env[key];
    }
    env.PATH = process.platform === 'win32'
        ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
        : '/usr/bin:/bin:/usr/sbin:/sbin';
    return {
        ...env,
        FURY_DATA_DIR: tempDirectory,
        FURY_RESOURCES_PATH: resources,
        COSMETIC_SEARCH_API_URL: `http://127.0.0.1:${cosmeticPort}`,
        COSMETIC_SEARCH_PORT: String(cosmeticPort),
        STATMOD_AUTO_START_PROXY: '0',
        // Launcher status and avatar previews normally contact public services.
        // Route those through a closed local endpoint during this offline check.
        HTTP_PROXY: `http://127.0.0.1:${blockedNetworkPort}`,
        HTTPS_PROXY: `http://127.0.0.1:${blockedNetworkPort}`,
        ALL_PROXY: `http://127.0.0.1:${blockedNetworkPort}`,
        NO_PROXY: '127.0.0.1,localhost,::1',
        FORCE_COLOR: '0'
    };
}

async function protocolWorker(appRoot, directPort, failoverPort) {
    const appRequire = createRequire(path.join(appRoot, 'package.json'));
    assert(process.versions.electron, 'Checks must use the packaged Electron Node runtime');
    const minecraft = appRequire('minecraft-protocol');
    for (const port of [directPort, failoverPort]) {
        const response = await minecraft.ping({ host: '127.0.0.1', port: Number(port), version: '1.8.9', closeTimeout: 5000 });
        assert.strictEqual(response.version.protocol, 47, 'Proxy must advertise Minecraft 1.8.9');
    }
    console.log('Both packaged Minecraft proxy routes responded to local status pings.');
}

async function connectDevtools(appRequire, target, errors) {
    const WebSocket = appRequire('ws');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;
    socket.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.id) {
            const waiter = pending.get(message.id);
            if (waiter) {
                pending.delete(message.id);
                clearTimeout(waiter.timer);
                if (message.error) waiter.reject(new Error(message.error.message));
                else waiter.resolve(message.result);
            }
        } else if (message.method === 'Runtime.exceptionThrown') {
            const details = message.params.exceptionDetails;
            errors.push(details.exception?.description || details.text);
        }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
        for (const waiter of pending.values()) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('DevTools connection closed'));
        }
        pending.clear();
    });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    function call(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timed out: ${method}`)); }, 15000);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        assert(!response.exceptionDetails, response.exceptionDetails?.exception?.description || 'Renderer evaluation failed');
        return response.result.value;
    }
    await call('Runtime.enable');
    await call('Page.enable');
    return { call, evaluate, close: () => socket.close() };
}

async function uiWorker(appRoot, debugPort) {
    const appRequire = createRequire(path.join(appRoot, 'package.json'));
    const base = `http://127.0.0.1:${debugPort}`;
    const errors = [];
    const connections = [];
    async function connectPage(filename, overlay = false) {
        const target = await eventually(async () => {
            const targets = await getJson(`${base}/json/list`);
            const found = targets.find(item => item.type === 'page'
                && new URL(item.url).pathname.endsWith(`/${filename}`)
                && new URL(item.url).searchParams.has('overlayWindow') === overlay);
            assert(found, `Missing ${filename} window`);
            return found;
        }, `Finding ${filename}`);
        const connection = await connectDevtools(appRequire, target, errors);
        connections.push(connection);
        // Reload after attaching so syntax errors during initial render are observed.
        await connection.call('Page.reload');
        await eventually(async () => {
            assert.strictEqual(await connection.evaluate('document.readyState'), 'complete');
            assert(await connection.evaluate('Boolean(document.body && document.body.children.length)'));
        }, `Loading ${filename}`);
        return connection;
    }
    try {
        const main = await connectPage('launcher.html');
        const state = await main.evaluate("require('electron').ipcRenderer.invoke('state:get', {activePage:'settings'})");
        assert(state.settings && state.services, 'Launcher IPC did not return application state');
        assert(Object.values(state.settings.keys).every(value => !value), 'Smoke test must not use saved API keys');
        assert(await main.evaluate('Boolean(furyDesign && document.querySelector(".fury-account-trigger"))'), 'Redesigned launcher did not mount');
        await main.evaluate("activatePage('overlay')");
        assert(await main.evaluate('document.querySelector("#overlay-table").checkVisibility()'), 'Player board is missing');
        assert(await main.evaluate("require('electron').ipcRenderer.invoke('fury-hud:open').then(()=>false,()=>true)"), 'Removed HUD route is still registered');
        await main.evaluate("furyDesign.openManager()");
        assert(await main.evaluate('document.querySelector(".fury-account-manager").open'), 'Account manager did not open');
        await delay(500);
        assert.deepStrictEqual(errors, [], 'Renderer JavaScript exceptions');
        console.log('Packaged launcher, player board, account manager, and IPC passed.');
    } finally { connections.forEach(connection => connection.close()); }
}

async function main(args) {
    if (args[0] === '--worker') {
        if (args[1] === 'protocol') return protocolWorker(args[2], args[3], args[4]);
        if (args[1] === 'ui') return uiWorker(args[2], args[3]);
        throw new Error(`Unknown worker: ${args[1]}`);
    }
    if (!args[0] || args[0] === '--help') {
        console.log('Usage: node scripts/smoke_packaged_app.js <Fury.app or packaged executable> [--no-ui]');
        return;
    }
    assert(args.length <= 2 && (!args[1] || args[1] === '--no-ui'), 'Unknown smoke-test arguments');
    const { executable, resources, appRoot } = packagePaths(args[0]);
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-portable-smoke-'));
    const children = [];
    try {
        const [directPort, failoverPort, healthPort, cosmeticPort, debugPort, blockedNetworkPort] = await unusedPorts(7);
        const env = cleanEnvironment(tempDirectory, resources, cosmeticPort, blockedNetworkPort);
        const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' };
        fs.writeFileSync(path.join(tempDirectory, 'server_config.json'), JSON.stringify({
            proxyDirectPort: directPort, proxyFailoverPort: failoverPort, healthPort,
            proxyDirectHost: '127.0.0.1', proxyFailoverHost: '127.0.0.1'
        }));
        fs.writeFileSync(path.join(tempDirectory, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true }));
        const proxy = startChild(executable, [path.join(appRoot, 'proxy.js')], nodeEnv, 'Packaged proxy');
        const cosmetic = startChild(executable, [path.join(appRoot, 'cosmetic_search_api.js')], nodeEnv, 'Packaged cosmetic service');
        children.push(proxy, cosmetic);
        const health = await eventually(async () => {
            assertRunning(proxy);
            const result = await getJson(`http://127.0.0.1:${healthPort}/health`);
            assert.strictEqual(result.ok, true);
            return result;
        }, 'Proxy health');
        assert.strictEqual(health.connectedAccount, null);
        assert(Object.values(health.apiKeys).every(value => !value), 'Proxy unexpectedly loaded API keys');
        assert.strictEqual(health.features.apiKillSwitchEnabled, true);
        await eventually(async () => {
            assertRunning(cosmetic);
            const result = await getJson(`http://127.0.0.1:${cosmeticPort}/health`);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.playersCached, 0, 'Cosmetic service loaded private cache');
        }, 'Cosmetic service health');
        console.log('Packaged proxy and cosmetic service passed clean-data health checks.');
        const protocol = startChild(executable, [__filename, '--worker', 'protocol', appRoot, String(directPort), String(failoverPort)], nodeEnv, 'Protocol smoke');
        children.push(protocol);
        await completedChild(protocol);
        if (args[1] !== '--no-ui') {
            const launcher = startChild(executable, [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', `--proxy-server=${env.HTTPS_PROXY}`], env, 'Packaged launcher');
            children.push(launcher);
            await eventually(async () => { assertRunning(launcher); return getJson(`http://127.0.0.1:${debugPort}/json/list`); }, 'Launcher DevTools');
            const ui = startChild(executable, [__filename, '--worker', 'ui', appRoot, String(debugPort)], nodeEnv, 'Launcher UI smoke');
            children.push(ui);
            await completedChild(ui, 90000);
            assertRunning(launcher);
        }
        assertRunning(proxy);
        assertRunning(cosmetic);
        assert(fs.statSync(path.join(tempDirectory, 'auth_tokens')).isDirectory(), 'Writable authentication storage was not created');
        console.log('Portable release smoke checks passed; no account or external API requests were used.');
    } catch (error) {
        for (const child of children) {
            if (child.output) console.error(`\n${child.label}:\n${child.output}`);
        }
        throw error;
    } finally {
        for (const child of children.reverse()) await stopChild(child);
        // Only remove the exact directory returned by mkdtemp, after all owned processes exit.
        assert(path.dirname(tempDirectory) === path.resolve(os.tmpdir()));
        assert(path.basename(tempDirectory).startsWith('fury-portable-smoke-'));
        fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = {
    packagePaths, cleanEnvironment, getJson, unusedPorts,
    startChild, stopChild, assertRunning, eventually, connectDevtools, uiTestArguments
};
