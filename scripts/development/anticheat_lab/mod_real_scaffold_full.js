'use strict';
// Frozen full campaign for the real Forge client. Existing lab modules are imported read-only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { once } = require('events');
const { resolveTarget } = require('../../../src/recorder/recordingAnalysis');
const setupServer = require('./setup_server');
const cachedServer = path.resolve(__dirname, '../../../output/anticheat-lab/server/minecraft-server-1.8.9.jar');
const isolatedServer = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/server');
assert(fs.existsSync(cachedServer), 'The existing hash-verified vanilla server must be cached');
fs.mkdirSync(isolatedServer, { recursive: true });
if (!fs.existsSync(path.join(isolatedServer, 'minecraft-server-1.8.9.jar')))
    fs.copyFileSync(cachedServer, path.join(isolatedServer, 'minecraft-server-1.8.9.jar'));
const originalSetup = setupServer.setup;
setupServer.setup = () => originalSetup(isolatedServer);
const { Lab, delay, root } = require('./lab');
const { eventually } = require('../../smoke_packaged_app');

const modRoot = 'C:/Users/Admin/Desktop/vape-test-mod-codex';
const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');
const gameDir = path.join(outputRoot, 'client-game');
const java = 'C:/Program Files/Eclipse Adoptium/jdk-8.0.462.8-hotspot/bin/java.exe';
const driverFile = path.join(__dirname, 'mod_real_input.py');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const keybinds = { NoItemRelease: 34, NoSlowdown: 35, AutoBlock: 36, AutoClicker: 37,
    SilentAura: 38, Sprint: 49, Scaffold: 50 }; // LWJGL G/H/J/K/L/N/M; no vanilla controls
const vk = { NoItemRelease: 0x47, NoSlowdown: 0x48, AutoBlock: 0x4a,
    AutoClicker: 0x4b, SilentAura: 0x4c, Sprint: 0x4e, Scaffold: 0x4d };
const controls = { W: 0x57, A: 0x41, S: 0x53, D: 0x44, SPACE: 0x20,
    SHIFT: 0x10, CTRL: 0x11, ONE: 0x31, TWO: 0x32, E: 0x45, ESC: 0x1b };
const scenarios = [
    { id: 'C1', part: 'autoblock', enabled: ['NoItemRelease'] },
    { id: 'C2', part: 'autoblock', enabled: ['NoSlowdown', 'Sprint'] },
    { id: 'C3', part: 'autoblock', enabled: ['AutoBlock', 'AutoClicker'], settings: { AutoBlock: { 'Only while targeting': false } } },
    { id: 'C4', part: 'autoblock', enabled: ['AutoBlock'], settings: { AutoBlock: { 'Block ticks': 3 } } },
    { id: 'C5', part: 'autoblock', enabled: ['SilentAura', 'AutoBlock'] },
    { id: 'C6', part: 'autoblock', enabled: ['NoItemRelease', 'AutoBlock', 'AutoClicker'], settings: { AutoBlock: { 'Only while targeting': false } } },
    ...['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map(id => ({ id, part: 'autoblock', enabled: [] })),
    ...['S1', 'S2', 'S3', 'S4', 'S5'].map((id, i) => ({ id, part: 'scaffold', enabled: ['Scaffold'],
        settings: { Scaffold: { Mode: ['Legit', 'Legit', 'GodBridge', 'GodBridge', 'TellyBridge'][i] } } })),
    ...['L7', 'L8', 'L9', 'L10', 'L11'].map(id => ({ id, part: 'scaffold', enabled: [] }))
];
const humanSeed = 918489;
const campaignSeed = 29092026;
const counts = {
    autoblock: { C1: 12, C2: 10, C3: 10, C4: 10, C5: 8, C6: 8,
        L1: 10, L2: 10, L3: 8, L4: 8, L5: 8, L6: 8 },
    scaffold: { S1: 10, S2: 8, S3: 10, S4: 8, S5: 8,
        L7: 10, L8: 8, L9: 8, L10: 6, L11: 6 }
};

function checkHashes() {
    const expected = {
        'output/anticheat-lab/autoblock-v2/baseline-detectors/autoblockDetector.js': 'a7ce23bacdb1681c2f2d0711cab7c39f4c95385eae3d2f84c936e2facb5afc8e',
        'src/detect/autoblockDetector.js': 'eb13ff1a2303b1691033c7461a5a07fc89105086e4d92b2a3d8b411b011be6cf',
        'src/detect/detectorShared.js': '2113d07146dab75e9f77a48ebe17796087834fe3b663fd64c0478727b5efa986',
        'src/detect/scaffoldDetector.js': '4c4c7a6a2a7225b420bd5ddb38b9653f51a7337cf55ee90a976073e3a0212555'
    };
    for (const [file, hash] of Object.entries(expected)) assert.strictEqual(sha(fs.readFileSync(path.join(root, file))), hash, file);
    const before = JSON.parse(fs.readFileSync(path.join(outputRoot, 'mod-build-before.json')));
    for (const [relative, hash] of Object.entries(before.classFiles))
        assert.strictEqual(sha(fs.readFileSync(path.join(modRoot, 'build/classes/java/main', relative))), hash, relative);
    assert.strictEqual(sha(fs.readFileSync(path.join(modRoot, 'build/libs/ClientEnhancer-1.0.0.jar'))), before.jarSha256);
}

function writeClientSettings(spec) {
    fs.mkdirSync(path.join(gameDir, 'config'), { recursive: true });
    const defaults = {
        NoItemRelease: { Swords: true, Food: true, Potions: true },
        NoSlowdown: { 'Limit Items': false, Swords: true },
        AutoBlock: { 'Only while targeting': true, 'Manual clicks': true, 'Block ticks': 1 },
        AutoClicker: { 'Hold to click': true, 'Trigger mode': false, 'Break blocks': false,
            'Break blocks delay': { low: 0, high: 10 }, 'Break blocks whitelist': false,
            CPS: { low: 6, high: 13 }, Randomization: 'Extra', Jitter: false,
            'Limit items': false, 'Show generated CPS': true },
        SilentAura: { 'Aim speed': 6, 'Extra swing distance': 0, 'Require mouse down': false,
            'Disable on death': true, 'Show target': true, Switch: false,
            'Limit to items': false, 'Allowed Items': 'Swords', 'Break blocks': true,
            'Attacks per Second': { low: 8, high: 12 }, 'Max angle': 90,
            'Target mode': 'Distance', 'Target area': 'Closest', 'Render type': 'Box', 'Perfect swing': false },
        Sprint: { 'Cancel Invis': false },
        Scaffold: { Mode: 'Legit', 'Sneak delay': { low: 100, high: 200 }, 'Require sneak': false,
            'Require blocks': true, 'Auto switch': true, 'Block count': false,
            'Pitch check': false, Pitch: 45 }
    };
    const config = { guiKey: 'HOME' };
    for (const name of Object.keys(keybinds)) config[name] = { key: keybinds[name],
        settings: { ...defaults[name], ...(spec.settings?.[name] || {}) } };
    const configFile = path.join(gameDir, 'config/clientenhancer.json');
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    const options = [
        'lang:en_US', 'fullscreen:false', 'overrideWidth:960', 'overrideHeight:540',
        'guiScale:2', 'pauseOnLostFocus:false', 'fov:0.0', 'mouseSensitivity:0.5',
        ...['master','music','record','weather','block','hostile','neutral','player','ambient','voice'].map(x => `soundCategory_${x}:0.0`)
    ];
    fs.writeFileSync(path.join(gameDir, 'options.txt'), options.join('\n') + '\n');
    return { config, configSha256: sha(fs.readFileSync(configFile)), optionsSha256: sha(fs.readFileSync(path.join(gameDir, 'options.txt'))) };
}

class Driver {
    constructor(pid, logFile) {
        this.proc = spawn('python', [driverFile, '--pid', String(pid)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.logFile = logFile;
        this.pending = new Map();
        this.next = 1;
        this.buffer = '';
        this.stderr = '';
        this.proc.stderr.on('data', b => { this.stderr += b.toString(); });
        this.proc.stdout.on('data', b => {
            this.buffer += b.toString();
            for (;;) {
                const end = this.buffer.indexOf('\n'); if (end < 0) break;
                const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
                const row = JSON.parse(line);
                const pending = this.pending.get(row.id); this.pending.delete(row.id);
                fs.appendFileSync(this.logFile, JSON.stringify({ ...pending?.request, ...row }) + '\n');
                if (pending) row.ok ? pending.resolve(row) : pending.reject(new Error(row.error));
            }
        });
        this.proc.on('exit', () => { for (const p of this.pending.values()) p.reject(new Error(`Input driver exited: ${this.stderr}`)); this.pending.clear(); });
    }
    action(command, params = {}) {
        const id = this.next++;
        const request = { id, command, ...params };
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, request });
            this.proc.stdin.write(JSON.stringify(request) + '\n');
        });
    }
    async tap(vkCode, ms = 90) { await this.action('key', { vk: vkCode, down: true }); await delay(ms); await this.action('key', { vk: vkCode, down: false }); }
    async hold(vkCode, ms) { await this.action('key', { vk: vkCode, down: true }); await delay(ms); await this.action('key', { vk: vkCode, down: false }); }
    async mouseTap(button, ms = 75) { await this.action('mouse', { button, down: true }); await delay(ms); await this.action('mouse', { button, down: false }); }
    async close() { this.proc.stdin.end(); if (this.proc.exitCode === null) await Promise.race([once(this.proc, 'exit'), delay(2000)]); if (this.proc.exitCode === null) this.proc.kill(); }
}

async function launchClient(lab, spec, trialDir) {
    const settings = writeClientSettings(spec);
    assert(lab.actorTransport.port > 0 && lab.actorTransport.server.address().address === '127.0.0.1');
    const cp = fs.readFileSync(path.join(modRoot, '.devrun/cp.txt'), 'utf8').trim();
    assert(cp.split(';').every(file => fs.existsSync(file)), 'Dev classpath has a missing entry');
    const args = ['-Xmx3g',
        '-Dhttp.proxyHost=127.0.0.1', '-Dhttp.proxyPort=9',
        '-Dhttps.proxyHost=127.0.0.1', '-Dhttps.proxyPort=9',
        `-Dfabric.dli.config=${path.join(modRoot, '.gradle/loom-cache/launch.cfg')}`,
        '-Dfabric.dli.env=client', '-Dfabric.dli.main=net.minecraft.launchwrapper.Launch',
        '-cp', cp, 'net.fabricmc.devlaunchinjector.Main',
        '--width', '960', '--height', '540', '--gameDir', gameDir,
        '--username', 'LabActor', '--server', '127.0.0.1', '--port', String(lab.actorTransport.port)];
    assert(!args.some(arg => arg.includes('vapetest.selftest')));
    fs.writeFileSync(path.join(trialDir, 'client-launch.json'), JSON.stringify({ executable: java, cwd: gameDir,
        arguments: args.map((arg, i) => i && args[i-1] === '-cp' ? `<classpath: ${cp.split(';').length} local entries>` : arg),
        target: { host: '127.0.0.1', port: lab.actorTransport.port }, settings }, null, 2));
    const joinedFrom = lab.server.outputTotal;
    const clientLog = fs.createWriteStream(path.join(trialDir, 'client.log'));
    const client = spawn(java, args, { cwd: gameDir, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [client.stdout, client.stderr]) stream.on('data', b => clientLog.write(b));
    try {
        await eventually(() => {
            assert(client.exitCode === null, 'Forge client exited before joining');
            assert(lab.serverOutputSince(joinedFrom).includes('LabActor joined the game'), 'Awaiting local client join');
        }, 'Forge client joined loopback lab', 120000);
        const driver = new Driver(client.pid, path.join(trialDir, 'input.jsonl'));
        await eventually(async () => { await driver.action('find'); }, 'Finding Minecraft window', 60000);
        await driver.action('focus');
        await delay(1500);
        return { client, clientLog, driver, settings };
    } catch (error) { client.kill(); clientLog.end(); throw error; }
}

async function stopClient(session) {
    if (!session) return;
    await session.driver?.close();
    if (session.client && session.client.exitCode === null) {
        session.client.kill();
        await Promise.race([once(session.client, 'exit'), delay(5000)]);
    }
    await new Promise(resolve => session.clientLog.end(resolve));
}

function rng(seed) { let x = seed | 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }

function frozenPlan(part) {
    const partRoot = part === 'scaffold' ? path.join(outputRoot, 'scaffold') : outputRoot;
    const file = path.join(partRoot, `FULL_PLAN_${part}.json`);
    if (fs.existsSync(file)) {
        const plan = JSON.parse(fs.readFileSync(file));
        assert.strictEqual(plan.part, part);
        assert.strictEqual(plan.seed, campaignSeed);
        return plan;
    }
    const random = rng(campaignSeed + (part === 'scaffold' ? 100000 : 0));
    const trials = [];
    for (const [scenarioId, count] of Object.entries(counts[part])) {
        const base = scenarios.find(s => s.id === scenarioId);
        assert(base && base.part === part);
        for (let number = 1; number <= count; number++) {
            const id = `${scenarioId.toLowerCase()}_${String(number).padStart(3, '0')}`;
            const settings = JSON.parse(JSON.stringify(base.settings || {}));
            const enabled = [...base.enabled];
            if (scenarioId === 'C2' && number > count / 2) enabled.splice(enabled.indexOf('Sprint'), 1);
            if (['C3', 'C6'].includes(scenarioId)) settings.AutoClicker = { CPS: { low: 6 + (number % 4), high: 10 + (number % 4) } };
            if (['C4', 'C6'].includes(scenarioId)) (settings.AutoBlock ||= {})['Block ticks'] = 1 + ((number - 1) % 5);
            if (scenarioId === 'C5') settings.SilentAura = { 'Attacks per Second': { low: 7 + (number % 3), high: 10 + (number % 3) } };
            if (['S1', 'S2'].includes(scenarioId)) settings.Scaffold['Sneak delay'] = {
                low: 100 + ((number - 1) % 4) * 15, high: 170 + ((number - 1) % 4) * 10 };
            const seed = (campaignSeed + trials.length * 7919 + Math.floor(random() * 1000000)) >>> 0;
            const slow = scenarioId === 'L6' || number % 5 === 0;
            const transport = {
                actor: { latencyMs: scenarioId === 'L6' ? 100 + number * 8 : 30 + Math.floor(random() * 55),
                    jitterMs: scenarioId === 'L6' ? 100 + number * 10 : 5 + Math.floor(random() * 36) },
                observer: { latencyMs: 6 + Math.floor(random() * 20), jitterMs: 3 + Math.floor(random() * 16) },
                server: { minimumMs: slow ? 75 + Math.floor(random() * 25) : 0,
                    jitterMs: slow ? 5 + Math.floor(random() * 16) : 0 }
            };
            trials.push({ id, scenarioId, number, part, enabled, settings, seed, transport,
                effectExpected: scenarioId.startsWith(part === 'scaffold' ? 'S' : 'C') });
        }
    }
    for (let i = trials.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [trials[i], trials[j]] = [trials[j], trials[i]];
    }
    const plan = { schema: 1, part, seed: campaignSeed, createdAt: new Date().toISOString(),
        method: 'Frozen seeded Fisher-Yates interleaving; per-scenario settings and transport fixed before verdicts', trials };
    fs.mkdirSync(partRoot, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    return plan;
}

async function setupTrial(lab, spec) {
    if (spec.part === 'autoblock') {
        const food = spec.scenarioId === 'L5';
        await lab.commands(['clear LabActor', 'effect LabActor clear', 'effect LabOpponent clear',
            'gamemode 1 LabActor', 'tp LabActor 0.5 64 0.5 -90 0', 'tp LabOpponent 3.5 64 0.5 90 0',
            'tp LabObserver 1.5 68 -8.5', 'gamemode 0 LabActor', 'gamemode 0 LabOpponent',
            'effect LabActor 11 9999 4 true', 'effect LabOpponent 11 9999 4 true',
            `replaceitem entity LabActor slot.hotbar.0 ${food ? 'bread 64' : 'diamond_sword 1'}`,
            'replaceitem entity LabActor slot.hotbar.1 bow 1', 'replaceitem entity LabActor slot.hotbar.2 arrow 64']);
    } else if (spec.scenarioId === 'L11') {
        await lab.commands(['clear LabActor', 'effect LabActor clear', 'gamemode 1 LabActor',
            'tp LabActor 0.5 64 0.5 0 90', 'tp LabObserver 0.5 70 -8.5',
            'tp LabOpponent 8.5 64 8.5', 'gamemode 0 LabActor',
            'replaceitem entity LabActor slot.hotbar.0 stone 64',
            'replaceitem entity LabActor slot.hotbar.1 stone 64']);
    } else {
        await lab.commands(['clear LabActor', 'effect LabActor clear', 'gamemode 1 LabActor',
            `tp LabActor 3.5 80 0.5 ${['S2', 'L8'].includes(spec.scenarioId) ? 135 : 90} 80`, 'tp LabObserver 8.5 84 -10.5',
            'fill 0 79 -2 43 82 2 air',
            'fill 0 79 -1 3 79 1 stone', 'tp LabOpponent 0.5 80 0.5', 'gamemode 0 LabActor',
            'replaceitem entity LabActor slot.hotbar.0 stone 64',
            'replaceitem entity LabActor slot.hotbar.1 stone 64']);
    }
    await delay(500);
}

async function combatPlay(lab, driver, spec, rand, truth) {
    const id = spec.scenarioId;
    const follow = setInterval(() => {
        const target = lab.opponent.players.LabActor?.entity;
        if (!target || !lab.opponent.entity) return;
        const distance = lab.opponent.entity.position.distanceTo(target.position);
        lab.opponent.lookAt(target.position.offset(0, 1.4, 0), true).catch(() => {});
        lab.opponent.setControlState('forward', distance > 2.3 && distance < 18);
    }, 150);
    try {
    if (id === 'L5') await driver.tap(controls.TWO);
    if (['C2','L2','L3','L4','L5'].includes(id)) {
        await driver.mouseTap('left', 90);
        await delay(180);
        await driver.mouseTap('left', 90);
    }
    if (id === 'C1') {
        await driver.action('mouse', { button: 'right', down: true });
        await delay(1400);
        await driver.action('key', { vk: controls.CTRL, down: true });
    }
    if (['C2','L2','L3','L4','L5'].includes(id)) await driver.action('mouse', { button: 'right', down: true });
    if (['C3','C6'].includes(id)) await driver.action('mouse', { button: 'left', down: true });
    if (id === 'L3') { await driver.action('mouse', { button: 'right', down: false }); await driver.hold(controls.W, 1300); await driver.action('mouse', { button: 'right', down: true }); }
    const end = Date.now() + 31000;
    let attacks = 0, cycles = 0;
    while (Date.now() < end) {
        if (['C1','C4','L1','L6'].includes(id)) {
            if (id === 'C1') {
                await driver.action('mouse', { button: 'right', down: false });
                await delay(120);
            }
            await driver.mouseTap('left', 65 + Math.floor(rand()*45)); attacks++;
            if (id === 'C1') {
                await delay(80);
                await driver.action('mouse', { button: 'right', down: true });
            }
            if (['L1','L6'].includes(id) && attacks % 3 === 0) await driver.mouseTap('right', 110 + Math.floor(rand()*90));
        }
        if (id === 'L4' && attacks++ % 3 === 0) lab.opponent.attack(lab.opponent.players.LabActor?.entity || lab.opponent.nearestEntity());
        if (id === 'C5') attacks++;
        const travel = ['C1','C2','L2','L3','L5'].includes(id);
        const key = [controls.W, controls.A, controls.S, controls.D][Math.floor(cycles / (travel ? 7 : 3)) % 4];
        await driver.hold(key, (travel ? 340 : 140) + Math.floor(rand()*(travel ? 170 : 80)));
        cycles++;
        if (rand() < 0.55) await driver.action('move', { dx: Math.floor(rand()*5)-2, dy: Math.floor(rand()*5)-2 });
        await delay(85 + Math.floor(rand()*80));
    }
    for (const button of ['left', 'right']) await driver.action('mouse', { button, down: false });
    if (id === 'C1') await driver.action('key', { vk: controls.CTRL, down: false });
    truth.injectedAttackClicks = attacks;
    } finally { clearInterval(follow); lab.opponent.clearControlStates(); }
}

async function scaffoldPlay(lab, driver, spec, rand, truth) {
    const id = spec.scenarioId;
    if (id === 'L9') {
        // Release sneak briefly after an accepted block appears, as a human
        // ninja bridger would after seeing the new support. Detector output
        // and cheat state are never consulted.
        let packetIndex = lab.rawPackets.length;
        await driver.action('mouse', { button: 'right', down: true });
        await driver.action('key', { vk: controls.SHIFT, down: true });
        await driver.action('key', { vk: controls.S, down: true });
        const end = Date.now() + 31000;
        let cycles = 0, transitions = 1, placementsSeen = 0;
        try {
            while (Date.now() < end) {
                let newPlacement = false;
                for (let i = packetIndex; i < lab.rawPackets.length; i++) {
                    const row = lab.rawPackets[i];
                    if (row.name === 'block_change' && row.data?.type === 16 && row.data?.location?.y === 79) {
                        placementsSeen++; newPlacement = true;
                    }
                }
                packetIndex = lab.rawPackets.length;
                if (newPlacement) {
                    await driver.action('key', { vk: controls.SHIFT, down: false });
                    transitions++;
                    await delay(35 + Math.floor(rand()*10));
                    await driver.action('key', { vk: controls.SHIFT, down: true });
                    transitions++;
                }
                cycles++;
                await delay(25 + Math.floor(rand()*15));
            }
        } finally {
            await driver.action('key', { vk: controls.S, down: false });
            await driver.action('key', { vk: controls.SHIFT, down: false });
            await driver.action('mouse', { button: 'right', down: false });
        }
        truth.inputCycles = cycles; truth.sneakTransitions = transitions;
        truth.placementsSeenForInput = placementsSeen;
        truth.edgeFeedback = 'raw observer accepted placements, without detector output';
        return;
    }
    if (['L7','L8','L10'].includes(id)) await driver.action('key', { vk: controls.SHIFT, down: true });
    if (id === 'S5') await driver.action('key', { vk: controls.SPACE, down: true });
    if (id !== 'S3' && id !== 'S4' && id !== 'S5') await driver.action('mouse', { button: 'right', down: true });
    const end = Date.now() + 31000;
    let steps = 0;
    while (Date.now() < end) {
        if (id === 'L11') {
            await driver.hold(controls.SPACE, 250);
            await delay(250 + Math.floor(rand()*100));
            steps++;
            continue;
        }
        const movingDiagonal = id === 'S4';
        if (movingDiagonal && steps % 4 === 0) await driver.action('key', { vk: controls.A, down: true });
        await driver.hold(controls.S, 350 + Math.floor(rand()*120));
        if (movingDiagonal && steps % 4 === 0) await driver.action('key', { vk: controls.A, down: false });
        if (id === 'L10' && steps % 5 === 0) { await driver.action('mouse', { button: 'right', down: false }); await delay(350); await driver.action('mouse', { button: 'right', down: true }); }
        if (id === 'L10' && steps % 5 === 1) await driver.action('move', { dx: Math.floor(rand()*11)-5, dy: Math.floor(rand()*7)-3 });
        if (id === 'S1' || id === 'S2') await driver.action('mouse', { button: 'right', down: true });
        steps++;
        await delay(60 + Math.floor(rand()*65));
    }
    await driver.action('key', { vk: controls.SHIFT, down: false });
    await driver.action('key', { vk: controls.SPACE, down: false });
    await driver.action('key', { vk: controls.A, down: false });
    await driver.action('mouse', { button: 'right', down: false });
    truth.inputCycles = steps;
}

async function fullTrial(lab, spec, attempt, runDir) {
    const trialDir = path.join(runDir, spec.id, `attempt-${String(attempt).padStart(3, '0')}`);
    fs.mkdirSync(trialDir, { recursive: true });
    const seed = spec.seed; const rand = rng(seed);
    const label = `${spec.id}_a${String(attempt).padStart(2, '0')}`;
    const truth = { id: spec.id, scenarioId: spec.scenarioId, pilot: false, seed, scenario: spec,
        requestedEnabled: spec.enabled, startedAt: Date.now(), invalidReasons: [], toggles: [],
        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256: sha(fs.readFileSync(driverFile)) };
    let session, recording = false;
    try {
        checkHashes();
        truth.condition = await lab.configureConditions({ label, seed, ...spec.transport });
        session = await launchClient(lab, spec, trialDir);
        truth.fullModuleSettings = session.settings.config;
        await session.driver.action('shot', { path: path.join(trialDir, 'before_respawn.png') });
        await session.driver.action('respawn_click');
        await delay(900);
        // Arena restoration sends many block changes. Keep detector scoring off
        // until setup finishes, then record the complete active-play lead-in.
        await lab.command('/anticheat off', /Anticheat/);
        await setupTrial(lab, spec);
        await lab.startRecording(label); recording = true;
        await lab.command('/anticheat on', /Anticheat/);
        await session.driver.action('focus');
        await session.driver.tap(controls.ONE);
        // The vanilla first-play "Press E" toast covers the mod's top-right HUD.
        await session.driver.tap(controls.E);
        await session.driver.tap(controls.ESC);
        // Capture healthy server clock history before any module is toggled.
        // The live detector has already seen these ticks; replay must too.
        await delay(6200);
        await session.driver.action('shot', { path: path.join(trialDir, 'hud_all_off.png') });
        for (const module of spec.enabled) {
            const down = await session.driver.action('key', { vk: vk[module], down: true });
            await delay(90);
            await session.driver.action('key', { vk: vk[module], down: false });
            truth.toggles.push({ t: down.t, module, enabled: true, keyVk: vk[module] });
            await delay(220);
            await session.driver.action('shot', { path: path.join(trialDir, `hud_after_${module.toLowerCase()}.png`) });
        }
        truth.cheatStartAt = spec.enabled.length ? Date.now() : null;
        truth.controlStartAt = Date.now();
        truth.preliminaryActorId = lab.rawPackets.filter(p => p.name === 'named_entity_spawn').at(-1)?.data.entityId ?? null;
        if (spec.part === 'autoblock') await combatPlay(lab, session.driver, spec, rand, truth);
        else await scaffoldPlay(lab, session.driver, spec, rand, truth);
        truth.activeEndAt = Date.now();
        await delay(1400);
        await lab.stopRecording(); recording = false;
        const recorderDir = path.join(lab.profile, 'recordings');
        const recorderName = fs.readdirSync(recorderDir).find(name => name.endsWith(`_${label}.jsonl`));
        assert(recorderName, 'Fury recording missing');
        const recorderRecords = fs.readFileSync(path.join(recorderDir, recorderName), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
        const target = resolveTarget(recorderRecords, { player: 'LabActor' });
        assert(target.ids.size > 0, 'Actor identity not resolved from Fury observer recording');
        truth.actorId = [...target.ids].at(-1);
        truth.recorderFile = path.join('fury-profile', 'recordings', recorderName);
        truth.observerPacketFile = `${label}.observer-packets.jsonl`;
        const rows = fs.readFileSync(path.join(lab.directory, truth.observerPacketFile), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
        const activeStart = truth.cheatStartAt || truth.controlStartAt;
        const actor = rows.filter(row => row.t >= activeStart && row.t <= truth.activeEndAt &&
            row.data?.entityId === truth.actorId);
        const counts = {};
        for (const row of actor) counts[row.name] = (counts[row.name] || 0) + 1;
        const placed = rows.filter(row => row.t >= activeStart && row.t <= truth.activeEndAt &&
            row.name === 'block_change' && row.data?.type === 16
            && (spec.scenarioId === 'L11' || row.data?.location?.y === 79));
        truth.observerEvidence = { actorPacketCounts: counts, acceptedPlacements: placed.length,
            placementTimes: placed.map(row => row.t), sampleActorPackets: actor.slice(0, 12) };
        truth.firstCheatAssistedPlacementAt = spec.part === 'scaffold' && spec.enabled.length ? placed[0]?.t ?? null : null;
        if (!truth.actorId) truth.invalidReasons.push('No actor spawn in observer packets');
        if (spec.part === 'scaffold' && placed.length < 12) truth.invalidReasons.push('Fewer than 12 accepted placements');
        if (!counts.rel_entity_move && !counts.entity_move_look && !counts.entity_teleport) truth.invalidReasons.push('No actor movement observed');
        if (!counts.animation) truth.invalidReasons.push('No actor swings observed');
        if (spec.part === 'autoblock' && !actor.some(row => row.name === 'entity_metadata' &&
            row.data?.metadata?.some(entry => entry.key === 0 && (entry.value & 16))))
            truth.invalidReasons.push('No observer use-on flag');
        truth.moduleState = 'pending HUD screenshot review';
    } catch (error) {
        truth.invalidReasons.push(error.message); truth.errorStack = error.stack;
    } finally {
        if (recording) { try { await lab.stopRecording(); } catch (error) { truth.invalidReasons.push(`Stop recording: ${error.message}`); } }
        truth.endedAt = Date.now();
        truth.automatedValid = truth.invalidReasons.length === 0;
        fs.writeFileSync(path.join(trialDir, 'ground-truth.json'), JSON.stringify(truth, null, 2));
        await stopClient(session);
        await delay(1500);
    }
    return truth;
}

async function main() {
    checkHashes();
    const [part, ...args] = process.argv.slice(2);
    assert(['autoblock', 'scaffold'].includes(part), 'Usage: node mod_real_full.js autoblock|scaffold [--limit=N] [--force=ID]');
    const plan = frozenPlan(part);
    const runBase = part === 'scaffold' ? path.join(outputRoot, 'scaffold') : outputRoot;
    const limit = Number(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || plan.trials.length);
    const force = args.find(arg => arg.startsWith('--force='))?.split('=')[1];
    const exclusionsFile = path.join(runBase, 'FULL_EXCLUSIONS.json');
    const excludedRuns = fs.existsSync(exclusionsFile) ? JSON.parse(fs.readFileSync(exclusionsFile)).runs : {};
    const completed = new Set();
    for (const runName of fs.readdirSync(runBase).filter(name => name.startsWith('full-'))) {
        if (excludedRuns[runName]) continue;
        const runPath = path.join(runBase, runName);
        if (!fs.statSync(runPath).isDirectory()) continue;
        for (const trialId of fs.readdirSync(runPath).filter(name => /^[a-z]\d+_\d+$/.test(name))) {
            for (const attemptName of fs.readdirSync(path.join(runPath, trialId))) {
                const truthFile = path.join(runPath, trialId, attemptName, 'ground-truth.json');
                if (fs.existsSync(truthFile) && JSON.parse(fs.readFileSync(truthFile)).automatedValid) completed.add(trialId);
            }
        }
    }
    const selected = plan.trials.filter(spec => force ? spec.id === force : !completed.has(spec.id)).slice(0, limit);
    assert(selected.length || !force, `Unknown trial ID ${force}`);
    if (!selected.length) { console.log(`All ${part} planned trials have automated evidence`); return; }
    fs.mkdirSync(runBase, { recursive: true });
    const runDir = path.join(runBase, `full-${Date.now()}`);
    const lab = new Lab(runDir, { traceDetectors: true });
    try {
        await lab.start();
        const offset = lab.server.outputTotal;
        lab.actor.quit(); lab.actor._client?.socket?.destroy();
        lab.bots = lab.bots.filter(bot => bot !== lab.actor);
        await eventually(() => assert(lab.serverOutputSince(offset).includes('LabActor left the game')), 'Removing Mineflayer setup actor');
        lab.actor = null;
        const results = [];
        for (const spec of selected) {
            for (let attempt = 1; attempt <= 3; attempt++) {
                console.log(`Full ${part} ${spec.id} attempt ${attempt} starting`);
                const result = await fullTrial(lab, spec, attempt, runDir);
                const row = { id: spec.id, attempt, valid: result.automatedValid,
                    invalidReasons: result.invalidReasons, evidence: result.observerEvidence,
                    trialDir: path.join(runDir, spec.id, `attempt-${String(attempt).padStart(3, '0')}`) };
                results.push(row);
                fs.writeFileSync(path.join(runDir, 'full-summary.json'), JSON.stringify(results, null, 2));
                console.log(`Full ${part} ${spec.id}: ${JSON.stringify(row)}`);
                if (result.automatedValid) break;
            }
        }
    } finally { await lab.close(); checkHashes(); }
    console.log(`FULL_RUN=${runDir}`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
