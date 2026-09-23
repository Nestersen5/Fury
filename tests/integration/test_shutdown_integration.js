'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
// Real proxy, IPC, workers and Minecraft listeners. Authentication and remote
// navigation are replaced only in a temporary preload, never production code.
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const mc = require('minecraft-protocol');
const { superviseChild } = require('../../src/bootstrap/childShutdown');
const { unusedPorts, cleanEnvironment, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = REPOSITORY_ROOT;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-shutdown-integration-'));
const children = [], players = [], results = [];
let upstream;
async function run() {
    const [directPort, failoverPort, healthPort, upstreamPort, cosmeticPort, blockedPort] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyDirectPort: directPort, proxyFailoverPort: failoverPort, healthPort, proxyDirectHost: '127.0.0.1', proxyFailoverHost: '127.0.0.1' }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false }));
    const preload = path.join(directory, 'fixture.cjs');
    const fromRoot = require('module').createRequire(path.join(REPOSITORY_ROOT, 'package.json'));
    const resolve = name => JSON.stringify(fromRoot.resolve(name));
    fs.writeFileSync(preload, `
const mc = require(${resolve('minecraft-protocol')});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host:'127.0.0.1', 'online-mode':false });
mc.createClient = options => { options.host='127.0.0.1';options.port=${upstreamPort};options.auth='offline';return createClient(options); };
require(${resolve('./src/accounts/connectionAuth')}).hasSavedLogin = () => true;
const stores = require(${resolve('./src/session/sessionStore')});
const create = stores.createSessionStore;
stores.createSessionStore = options => {
 const store = create(options);
 process.on('message', message => {
  if(message?.type !== 'fixture:session') return;
  const session=store.startSession({at:Date.now(),uuid:'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa',name:'Fixture',stats:{Bedwars:{wins_bedwars:1}},achievements:{}});
  store.appendGame(session.id,{at:Date.now(),mode:'BEDWARS',result:'win',verificationStatus:'pending',delta:null});
  process.send({type:'fixture:ready'});
 });
 return store;
};
`);
    upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    upstream.on('login', client => {
        client.on('error', () => {});
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    for (const mode of ['idle', 'pending-session', 'recording']) {
        const env = cleanEnvironment(directory, root, cosmeticPort, blockedPort);
        env.FURY_SERVICE_INSTANCE = randomUUID();
        const child = spawn(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], { env, cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        children.push(child); let logs = ''; const messages = [];
        for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-10000); });
        child.on('message', message => messages.push(message));
        const owner = superviseChild(child, env.FURY_SERVICE_INSTANCE, { log: message => { logs += message; } });
        await eventually(async () => { assert.equal(child.exitCode, null, logs); assert((await getJson(`http://127.0.0.1:${healthPort}/health`)).ok); }, 'proxy ready');
        if (mode !== 'idle') {
            child.send({ type: 'fixture:session' });
            await eventually(() => assert(messages.some(message => message.type === 'fixture:ready')), 'pending synthetic session');
        }
        if (mode === 'recording') {
            const player = mc.createClient({ host: '127.0.0.1', port: directPort, username: 'Fixture', auth: 'offline', version: '1.8.9', keepAlive: false }); players.push(player);
            player.on('error', () => {}); let connected = false; const chat = [];
            player.on('login', () => { connected = true; }); player.on('chat', packet => chat.push(packet.message));
            await eventually(() => assert(connected, logs), 'Minecraft login');
            player.write('chat', { message: '/rc Fixture synthetic' });
            await eventually(() => assert(logs.includes('[RECORDER] Recording'), logs + chat.join('\n')), mode + ' active');
        }
        const start = performance.now(); const result = await owner.stop(); const elapsed = performance.now() - start;
        assert.equal(result.clean, true, logs + JSON.stringify(messages.filter(message => message.type.startsWith('shutdown'))));
        assert.equal(result.exited, true); results.push({ mode, milliseconds: Math.round(elapsed * 10) / 10 });
        assert(messages.some(message => message.type === 'shutdown-complete'));
        if (mode !== 'idle') {
            const saved = JSON.parse(fs.readFileSync(path.join(directory, 'session_data.json')));
            assert(saved.sessions.some(session => session.name === 'Fixture' && session.games.some(game => game.verificationStatus === 'pending')));
        }
        if (mode === 'recording') {
            const recordings = fs.readdirSync(path.join(directory, 'recordings')).filter(file => file.endsWith('.jsonl'));
            assert(recordings.length);
            for (const file of recordings) assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'recordings', file), 'utf8').trim().split('\n').at(-1)).k, 'footer');
        }
        // The next iteration immediately binds these same listener ports.
    }
    console.log(JSON.stringify({ passed: true, results }, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const player of players) { try { player.socket?.destroy(); clearTimeout(player.closeTimer); } catch {} }
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (upstream) {
        for (const client of Object.values(upstream.clients)) { client.socket?.destroy(); clearTimeout(client.closeTimer); }
        upstream.socketServer.close();
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.rmSync(directory, { recursive: true, force: true });
});
