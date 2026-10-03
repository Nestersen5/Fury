'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');
const net = require('net');
const crypto = require('crypto');
const mineflayer = require('./runtime/node_modules/mineflayer');
const { Vec3 } = require('./runtime/node_modules/vec3');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../smoke_packaged_app');
const { setup } = require('./setup_server');
const { buildTickAgent } = require('./build_tick_agent');
const { LocalTransport } = require('./transport');
const root = path.resolve(__dirname, '../../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function chooseJava() {
    const candidates = [process.env.FURY_LAB_JAVA,
        'C:/Program Files/Eclipse Adoptium/jdk-8.0.462.8-hotspot/bin/java.exe',
        'C:/Program Files/Java/jdk8u452-b09/bin/java.exe'];
    const found = candidates.find(file => file && fs.existsSync(file));
    if (!found) throw new Error('Set FURY_LAB_JAVA to a trusted Java 8 executable.');
    return found;
}

class Lab {
    constructor(directory, options = {}) {
        this.directory = path.resolve(directory);
        this.options = options;
        this.bots = [];
        this.messages = [];
        this.errors = [];
        this.rawPackets = [];
    }

    async start() {
        if (fs.existsSync(this.directory)) throw new Error('Use a fresh run directory.');
        fs.mkdirSync(this.directory, { recursive: true });
        const [server, direct, failover, health, cosmetic, blocked, tickControl] = await unusedPorts(7);
        this.ports = { server, direct, failover, health, cosmetic, blocked, tickControl };
        this.serverDir = path.join(this.directory, 'world');
        this.profile = path.join(this.directory, 'fury-profile');
        fs.mkdirSync(this.serverDir);
        fs.mkdirSync(this.profile);
        const jar = await setup();
        const agent = buildTickAgent(chooseJava());
        fs.writeFileSync(path.join(this.serverDir, 'eula.txt'), 'eula=true\n');
        fs.writeFileSync(path.join(this.serverDir, 'server.properties'), [
            'server-ip=127.0.0.1', `server-port=${server}`, 'online-mode=false',
            'level-name=lab-world', 'level-type=FLAT', 'level-seed=189421',
            'generate-structures=false', 'spawn-protection=0', 'max-players=12',
            'view-distance=3', 'gamemode=0', 'difficulty=0', 'pvp=true',
            'allow-flight=true', 'spawn-animals=false', 'spawn-monsters=false',
            'spawn-npcs=false', 'enable-rcon=false', 'enable-query=false',
            'snooper-enabled=false', 'max-tick-time=60000', 'motd=Fury local anticheat lab'
        ].join('\n') + '\n');
        this.server = spawn(chooseJava(), ['-Xms256M', '-Xmx768M',
            `-javaagent:${agent}=${tickControl}|${path.join(this.directory, 'server-ticks.jsonl')}`, '-jar', jar, 'nogui'], {
            cwd: this.serverDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        });
        this.server.output = '';
        this.server.outputTotal = 0;
        this.server.label = 'Local vanilla 1.8.9 server';
        this.server.on('error', error => { this.server.startError = error; });
        this.serverLog = fs.createWriteStream(path.join(this.directory, 'server.log'));
        for (const stream of [this.server.stdout, this.server.stderr]) stream.on('data', bytes => {
            this.serverLog.write(bytes);
            const text = bytes.toString();
            this.server.outputTotal += text.length;
            this.server.output = (this.server.output + text).slice(-24000);
        });
        await eventually(() => {
            assertRunning(this.server);
            assert(this.server.output.includes('Done ('), this.server.output.slice(-2000));
            assert(fs.existsSync(path.join(this.directory, 'server-ticks.jsonl')), 'Server instrumentation did not initialize');
        }, 'Starting vanilla server', 60000);
        await this.commands(['gamerule doDaylightCycle false', 'gamerule doMobSpawning false',
            'gamerule keepInventory true', 'gamerule naturalRegeneration true', 'time set 6000',
            'setworldspawn 0 64 0']);
        if (this.options.preObserverCommands?.length) {
            const fixture = await this.connectBot('LabFixture');
            await this.commands(['gamemode 1 LabFixture', 'tp LabFixture 0.5 64 0.5']);
            await fixture.waitForChunksToLoad();
            await this.commands(this.options.preObserverCommands);
            const offset = this.server.outputTotal; fixture.quit();
            await eventually(() => assert(this.serverOutputSince(offset).includes('LabFixture left the game')), 'Removing setup-only fixture');
            fixture._client.socket?.destroy(); this.bots = this.bots.filter(bot => bot !== fixture);
        }
        this.transportLog = fs.createWriteStream(path.join(this.directory, 'transport.jsonl'));
        const transportLog = owner => event => this.transportLog.write(JSON.stringify({ t: Date.now(), owner, ...event }) + '\n');
        this.actorTransport = await new LocalTransport(server, transportLog('actor')).start();
        this.observerTransport = await new LocalTransport(server, transportLog('observer')).start();

        fs.writeFileSync(path.join(this.profile, 'server_config.json'), JSON.stringify({
            proxyDirectHost: '127.0.0.1', proxyDirectPort: direct,
            proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health
        }));
        fs.writeFileSync(path.join(this.profile, 'features_config.json'), JSON.stringify({
            apiKillSwitchEnabled: true, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false,
            tabStatsEnabled: false, nametagOverlayEnabled: false, autoScanOnGameStart: false
        }));
        const env = cleanEnvironment(this.profile, root, cosmetic, blocked);
        env.FURY_ENABLE_DIAGNOSTICS = '0';
        env.FURY_LAB_ISOLATED = '1';
        env.FURY_LAB_SERVER_PORT = String(this.observerTransport.port);
        env.FURY_LAB_TRACE_DETECTORS = this.options.traceDetectors || process.env.FURY_LAB_TRACE_DETECTORS === '1' ? '1' : '0';
        const productionHashes = {};
        for (const relative of ['proxy.js', 'src/detect/detectorShared.js', 'src/detect/scaffoldDetector.js',
            'src/detect/autoblockDetector.js', 'src/detect/stasisDetector.js', 'src/recorder/packetRecorder.js']) {
            const bytes = fs.readFileSync(path.join(root, relative));
            const snapshot = path.join(this.directory, 'production-source', relative);
            fs.mkdirSync(path.dirname(snapshot), { recursive: true }); fs.writeFileSync(snapshot, bytes, { flag: 'wx' });
            productionHashes[relative] = crypto.createHash('sha256').update(bytes).digest('hex');
        }
        fs.writeFileSync(path.join(this.directory, 'production-source.json'), JSON.stringify({ capturedAt: new Date().toISOString(),
            purpose: 'Exact production files on disk immediately before starting this owned Fury process.', hashes: productionHashes }, null, 2));
        this.proxy = startChild(process.execPath, ['--require', path.join(__dirname, 'offline_preload.js'), path.join(root, 'proxy.js')], env, 'Isolated Fury proxy');
        this.proxyLog = fs.createWriteStream(path.join(this.directory, 'proxy.log'));
        for (const stream of [this.proxy.stdout, this.proxy.stderr]) stream.on('data', bytes => this.proxyLog.write(bytes));
        await eventually(async () => { assertRunning(this.proxy); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Starting Fury');
        this.observer = mc.createClient({ host: '127.0.0.1', port: direct,
            username: 'LabObserver', auth: 'offline', version: '1.8.9' });
        this.observer.on('error', error => this.errors.push(`observer: ${error.message}`));
        this.observer.on('packet', (data, meta) => {
            if (meta.name === 'chat') this.messages.push({ t: Date.now(), message: data.message });
            if (['named_entity_spawn', 'spawn_entity', 'entity_equipment', 'entity_metadata', 'animation', 'entity_status',
                'rel_entity_move', 'entity_move_look', 'entity_look', 'entity_teleport', 'entity_velocity',
                'block_change', 'multi_block_change', 'entity_destroy', 'update_time', 'player_info'].includes(meta.name)) {
                const row = JSON.stringify({ t: Date.now(), name: meta.name, data });
                if (this.rawStream) this.rawStream.write(row + '\n');
                this.rawPackets.push(JSON.parse(row));
                if (this.rawPackets.length > 10000) this.rawPackets.splice(0, 1000);
            }
        });
        this.observer.on('position', data => {
            this.observerPosition = data;
            this.observer.write('position_look', { x: data.x, y: data.y, z: data.z,
                yaw: data.yaw, pitch: data.pitch, onGround: false });
        });
        await eventually(() => { assertRunning(this.proxy); assert(this.observerPosition); }, 'Joining through Fury');
        this.actor = await this.connectBot('LabActor');
        this.opponent = await this.connectBot('LabOpponent');
        // Load both halves before fill; vanilla refuses coordinates in unloaded chunks.
        await this.commands(['gamemode 1 LabActor', 'gamemode 1 LabOpponent',
            'gamemode 1 LabObserver', 'tp LabActor 32.5 64 0.5', 'tp LabOpponent 0.5 64 0.5']);
        await this.actor.waitForChunksToLoad();
        await this.opponent.waitForChunksToLoad();
        await this.commands(['fill -16 63 -16 63 63 16 stone',
            'gamemode 1 LabObserver', 'tp LabObserver 0.5 68 -10.5',
            'tp LabActor 0.5 64 0.5', 'tp LabOpponent 4.5 64 0.5',
            'gamemode 0 LabActor', 'gamemode 0 LabOpponent',
            'scoreboard objectives add lab dummy BED WARS',
            'scoreboard objectives setdisplay sidebar lab', 'scoreboard players set Diamond lab 5']);
        await this.command('/anticheat on', /Anticheat/);
        await this.command('/teamdebug LabActor', /saved|report/i);
        const debugDir = path.join(this.profile, 'diagnostics/teams');
        const file = await eventually(() => {
            assert(fs.existsSync(debugDir));
            const name = fs.readdirSync(debugDir).find(name => name.endsWith('.json'));
            assert(name); return path.join(debugDir, name);
        }, 'Verifying production game gate');
        const gate = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.strictEqual(gate.state.currentGamemode, 'BEDWARS');
        assert.strictEqual(gate.state.gameActive, true);
        fs.writeFileSync(path.join(this.directory, 'environment.json'), JSON.stringify({
            createdAt: new Date().toISOString(), ports: this.ports, java: chooseJava(), node: process.version,
            server: 'official vanilla 1.8.9', mineflayer: require('./runtime/node_modules/mineflayer/package.json').version,
            gameGate: { mode: gate.state.currentGamemode, active: gate.state.gameActive },
            originalVapeCodeExecuted: false, profile: this.profile,
            preObserverCommands: this.options.preObserverCommands || [],
            limitation: 'Vanilla local server and Mineflayer physics; no claim of Hypixel or original-client equivalence'
        }, null, 2) + '\n');
        console.log('Lab ready: real server, actor/opponent, observer through Fury; production game gate verified.');
        return this;
    }

    async connectBot(username, options = {}) {
        const bot = mineflayer.createBot({ host: '127.0.0.1', port: username === 'LabActor' ? this.actorTransport.port : this.ports.server, username,
            ...options,
            auth: 'offline', version: '1.8.9', viewDistance: 'tiny', logErrors: false });
        this.bots.push(bot);
        bot.on('error', error => this.errors.push(`${username}: ${error.message}`));
        bot.on('kicked', reason => this.errors.push(`${username} kicked: ${JSON.stringify(reason)}`));
        let timeout;
        try { await Promise.race([once(bot, 'spawn'), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(`${username} spawn timeout`)), 20000);
        })]); } finally { clearTimeout(timeout); }
        await bot.waitForChunksToLoad();
        return bot;
    }

    async replaceActor(options = {}) {
        if (this.actor) {
            const previous = this.actor;
            const outputOffset = this.server.outputTotal;
            previous.quit();
            await eventually(() => assert(this.serverOutputSince(outputOffset).includes('LabActor left the game')), 'Removing previous trial actor');
            previous._client.socket?.destroy();
            this.bots = this.bots.filter(bot => bot !== previous);
        }
        this.actor = await this.connectBot('LabActor', options);
        return this.actor;
    }

    async commands(commands) {
        assertRunning(this.server);
        const outputOffset = this.server.outputTotal;
        this.server.stdin.write(commands.join('\n') + '\n');
        const marker = `lab-barrier-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        this.server.stdin.write(`say ${marker}\n`);
        await eventually(() => { assertRunning(this.server); assert(this.server.output.includes(marker)); }, 'Server command barrier');
        const response = this.serverOutputSince(outputOffset);
        assert(!/Cannot place blocks outside|Unknown command|Usage:|No entity was found/.test(response), response);
        await delay(150);
    }

    serverOutputSince(offset) {
        return this.server.output.slice(Math.max(0, offset - (this.server.outputTotal - this.server.output.length)));
    }

    async configureConditions({ label, seed = 421, actor = {}, observer = {}, server = {} }) {
        this.actorTransport.configure({ seed, label, ...actor });
        this.observerTransport.configure({ seed: seed + 1, label, ...observer });
        const socket = net.connect({ host: '127.0.0.1', port: this.ports.tickControl });
        socket.setTimeout(3000, () => socket.destroy(new Error('Tick agent config timeout')));
        try {
            await once(socket, 'connect');
            const reply = once(socket, 'data');
            socket.write(`${server.minimumMs || 0} ${server.jitterMs || 0} ${seed} ${label}\n`);
            assert.strictEqual((await reply)[0].toString().trim(), `OK ${label}`);
        } finally { socket.destroy(); }
        const condition = { t: Date.now(), label, seed, actor, observer, server };
        fs.appendFileSync(path.join(this.directory, 'conditions.jsonl'), JSON.stringify(condition) + '\n');
        return condition;
    }

    async command(text, expected) {
        const offset = this.messages.length;
        this.observer.write('chat', { message: text });
        if (expected) await eventually(() => {
            assertRunning(this.proxy);
            assert(this.messages.slice(offset).some(row => expected.test(row.message)), this.messages.slice(offset).map(r => r.message).join('\n'));
        }, `Fury ${text}`, 10000);
    }

    async startRecording(label) {
        if (!/^[a-z0-9_]{1,40}$/.test(label)) throw new Error('Invalid lab label');
        this.rawStream = fs.createWriteStream(path.join(this.directory, `${label}.observer-packets.jsonl`), { flags: 'wx' });
        await this.command(`/recordcheat LabActor ${label}`, /Recording|Started|recording/);
    }

    async stopRecording() {
        await this.command('/recordcheat stop LabActor', /Stopped/);
        if (this.rawStream) { const stream = this.rawStream; this.rawStream = null; await new Promise(resolve => stream.end(resolve)); }
    }

    async close() {
        for (const bot of this.bots) { bot.quit(); bot._client?.socket?.destroy(); }
        this.observer?.end();
        this.observer?.socket?.destroy();
        if (this.rawStream) await new Promise(resolve => this.rawStream.end(resolve));
        await stopChild(this.proxy);
        await this.actorTransport?.close();
        await this.observerTransport?.close();
        if (this.server && this.server.exitCode === null) {
            this.server.stdin.write('stop\n');
            await Promise.race([once(this.server, 'exit'), delay(5000)]);
            await stopChild(this.server);
        }
        for (const log of [this.proxyLog, this.serverLog, this.transportLog]) if (log) await new Promise(resolve => log.end(resolve));
        if (fs.existsSync(this.directory)) fs.writeFileSync(path.join(this.directory, 'errors.json'), JSON.stringify(this.errors, null, 2) + '\n');
    }
}

module.exports = { Lab, delay, Vec3, root };
