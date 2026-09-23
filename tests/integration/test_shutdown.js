'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
const { once } = require('events');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-shutdown-test-'));
process.env.FURY_DATA_DIR = root;
const { createShutdown } = require('../../src/bootstrap/shutdown');
const { superviseChild } = require('../../src/bootstrap/childShutdown');
const { createJsonWriter } = require('../../src/storage/jsonWriter');
const { createPacketRecorder } = require('../../src/recorder/packetRecorder');
const { createWorkDrain, ownListener, createUpstreamOwner } = require('../../src/bootstrap/shutdownResources');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('idle, duplicate request, one deadline and hung phase', async () => {
    const phases = [];
    const shutdown = createShutdown({ quiesce: () => phases.push('q'), drain: () => phases.push('d'), close: () => phases.push('c') });
    const first = shutdown.request();
    assert.equal(shutdown.request(), first);
    assert.equal((await first).clean, true);
    assert.deepEqual(phases, ['q', 'd', 'c']);
    const hung = createShutdown({ drain: () => new Promise(() => {}) });
    const begin = performance.now();
    assert.deepEqual(await hung.request({ deadline: Date.now() + 40 }), { clean: false, outcome: 'FORCED', phase: 'persistence', code: 'SHUTDOWN_TIMEOUT' });
    assert(performance.now() - begin < 250);
});

test('failed cancellation still drains durable owners and is never acknowledged clean', async () => {
    let persisted = false, closed = false;
    const shutdown = createShutdown({ quiesce() { throw new Error('fixture'); }, drain() { persisted = true; }, close() { closed = true; } });
    const result = await shutdown.request();
    assert(persisted && closed); assert.equal(result.clean, false); assert.equal(result.outcome, 'FAILED'); assert.equal(result.phase, 'quiesce');
});

test('service IPC validates identity and repeated requests execute one shutdown', async () => {
    const fake = new EventEmitter(); fake.env = { FURY_SERVICE_INSTANCE: 'owned' }; fake.connected = true;
    const sent = []; let exits = 0, drains = 0;
    fake.send = (message, callback) => { sent.push(message); callback?.(); };
    fake.disconnect = () => { fake.connected = false; }; fake.exit = code => { assert.equal(code, 0); exits++; };
    require('../../src/bootstrap/shutdown').installServiceShutdown({ drain: async () => { drains++; await delay(5); } }, { processObject: fake });
    const message = { type: 'shutdown-request', version: 1, instanceId: 'owned', requestId: 'request', deadline: Date.now() + 500 };
    fake.emit('message', { ...message, instanceId: 'wrong' });
    assert.equal(drains, 0);
    fake.emit('message', message); fake.emit('message', message);
    await delay(20);
    assert.equal(drains, 1); assert.equal(exits, 1);
    const ack = sent.find(message => message.type === 'shutdown-complete');
    assert.equal(ack.requestId, 'request'); assert.equal(ack.instanceId, 'owned');
});

test('JSON drain accounts for writes without callbacks, seals admission, persists exact output', async () => {
    const writer = createJsonWriter({ workerPath: path.join(REPOSITORY_ROOT, 'src/storage/json_writer_worker.js') });
    const file = path.join(root, 'writer.json');
    for (let i = 0; i < 20; i++) writer.writeJsonOffThread(file, { sequence: i });
    await writer.drain();
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { sequence: 19 });
    assert.throws(() => writer.writeJsonOffThread(file, {}), /shutting down/);
    await writer.close();
});

for (const scenario of ['delayed', 'failure', 'exit-zero']) test(`JSON writer ${scenario}`, async () => {
    const workerPath = path.join(root, scenario + '.cjs');
    fs.writeFileSync(workerPath, `const {parentPort}=require('worker_threads');parentPort.on('message', m => ${scenario === 'exit-zero' ? 'process.exit(0)' : `setTimeout(()=>parentPort.postMessage({id:m.id,error:${scenario === 'failure' ? "'fixture failure'" : 'null'}}),80)`});`);
    const writer = createJsonWriter({ workerPath, logger: { error() {} } });
    writer.writeJsonOffThread('fixture', {});
    if (scenario === 'delayed') { await writer.drain(); await writer.close(); }
    else {
        await assert.rejects(writer.drain(), /persistence/);
        if (scenario === 'failure') await writer.ensureJsonWriterWorker().terminate();
    }
});

test('session debounce flush and observed delayed game end survive with account identity', async () => {
    const { createSessionStore } = require('../../src/session/sessionStore');
    const { createSessionTracker } = require('../../src/session/sessionTracker');
    const { captureSessionSnapshot } = require('../../src/session/sessionSnapshot');
    const writer = createJsonWriter({ workerPath: path.join(REPOSITORY_ROOT, 'src/storage/json_writer_worker.js') });
    const file = path.join(root, 'sessions.json');
    const store = createSessionStore({ sessionFile: file, saveDelayMs: 2000, writeJsonOffThread: writer.writeJsonOffThread });
    const player = { uuid: 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa', displayname: 'Fixture', stats: { Bedwars: { wins_bedwars: 1 } } };
    const tracker = createSessionTracker({ store, fetchOwnStats: async () => player, gameEndDelayMs: 2000, minGameDurationMs: 0 });
    await tracker.ensureSession();
    tracker.onGameStart({ mode: 'BEDWARS' });
    tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000, sessionKey: 'fixture-end' });
    tracker.quiesce();
    store.flush({ strict: true, onlyPending: true });
    await writer.close();
    const persisted = JSON.parse(fs.readFileSync(file));
    assert.equal(persisted.sessions.length, 1);
    assert.equal(persisted.sessions[0].uuid, player.uuid);
    assert.equal(persisted.sessions[0].games.length, 1);
    assert.equal(persisted.sessions[0].games[0].verificationStatus, 'pending');
});

test('recording retained after stop, delayed stream finish/close and exact footer', async () => {
    let output = '';
    const recorder = createPacketRecorder({ dir: path.join(root, 'recordings'), createWriteStream: () => new Writable({
        write(chunk, encoding, callback) { setTimeout(() => { output += chunk; callback(); }, 30); }
    }) });
    assert(recorder.start({ player: 'Fixture', label: 'test' }).ok);
    recorder.observe({ age: 1, time: 2 }, { name: 'update_time' });
    recorder.stop('Fixture');
    assert.equal(recorder.status().length, 0);
    await recorder.drain();
    const rows = output.trim().split('\n').map(JSON.parse);
    assert.equal(rows[0].k, 'header');
    assert.equal(rows.at(-1).k, 'footer');
    assert(rows.some(row => row.k === 'time'));
    assert.equal(recorder.start({ player: 'Fixture', label: 'test' }).reason, 'shutting-down');
});

test('observed game end retains its already-running initial baseline before detach', async () => {
    const { createSessionStore } = require('../../src/session/sessionStore');
    const { createSessionTracker } = require('../../src/session/sessionTracker');
    let release, latest;
    const stats = new Promise(resolve => { release = resolve; });
    const store = createSessionStore({ sessionFile: path.join(root, 'initial-baseline.json'), writeJsonOffThread: (file, value) => { latest = value; } });
    const tracker = createSessionTracker({ store, fetchOwnStats: () => stats, gameEndDelayMs: 2000, minGameDurationMs: 0 });
    tracker.onGameStart({ mode: 'BEDWARS' });
    tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000, sessionKey: 'initial' });
    const pending = tracker.quiesce();
    release({ uuid: 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa', displayname: 'Fixture', stats: { Bedwars: { wins_bedwars: 1 } } });
    await pending;
    assert.equal(latest.sessions[0].games.length, 1);
    assert.equal(latest.sessions[0].games[0].verificationStatus, 'pending');
});

test('late game-end snapshot cannot duplicate or verify a shutdown pending record', async () => {
    const { createSessionStore } = require('../../src/session/sessionStore');
    const { createSessionTracker } = require('../../src/session/sessionTracker');
    let release, calls = 0, latest;
    const player = { uuid: 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa', displayname: 'Fixture', stats: { Bedwars: { wins_bedwars: 1 } } };
    const store = createSessionStore({ sessionFile: path.join(root, 'late-snapshot.json'), writeJsonOffThread: (file, value) => { latest = value; } });
    const tracker = createSessionTracker({ store, fetchOwnStats: () => ++calls === 1 ? Promise.resolve(player) : new Promise(resolve => { release = resolve; }), gameEndDelayMs: 0, minGameDurationMs: 0 });
    await tracker.ensureSession(); tracker.onGameStart({ mode: 'BEDWARS' });
    const capture = tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000, sessionKey: 'late' });
    await delay(1); await tracker.quiesce();
    release({ ...player, stats: { Bedwars: { wins_bedwars: 2 } } }); await capture;
    assert.equal(latest.sessions[0].games.length, 1);
    assert.equal(latest.sessions[0].games[0].verificationStatus, 'pending');
});

test('recording stream failure cannot be reported as a clean drain', async () => {
    const recorder = createPacketRecorder({ dir: path.join(root, 'record-failure'), createWriteStream: () => new Writable({
        write(chunk, encoding, callback) { callback(new Error('fixture disk failure')); }
    }) });
    recorder.start({ player: 'Fixture', label: 'test' });
    await assert.rejects(recorder.drain(), /Recording/);
});

test('user-recorded cosmetic settings drain the latest accepted state', async () => {
    const file = path.join(root, 'cosmetics.json');
    const library = require('../../src/cosmetics/effectLibrary').createEffectLibrary({ file });
    library.setSetting('notify', true); const first = library.saveNow();
    library.setSetting('notify', false);
    await library.drain(); await first;
    assert.equal(JSON.parse(fs.readFileSync(file)).settings.notify, false);
});

test('accepted persistence remains tracked after owner detaches and failure is not clean', async () => {
    const drain = createWorkDrain();
    let written = false;
    drain.track(delay(30).then(() => { written = true; }));
    await drain.drain(); assert(written);
    drain.track(Promise.reject(new Error('fixture')));
    await assert.rejects(drain.drain());
});

function fakeChild() {
    const child = new EventEmitter();
    child.send = message => { child.request = message; };
    child.kill = () => child.emit('exit', null, 'SIGKILL');
    return child;
}
test('matching ack AND exit required, stale identity ignored, duplicate stop shares operation', async () => {
    const child = fakeChild();
    const owner = superviseChild(child, 'instance');
    let done = false;
    const stop = owner.stop(); stop.then(() => { done = true; });
    assert.equal(owner.stop(), stop);
    child.emit('message', { ...child.request, type: 'shutdown-complete', requestId: 'stale', persisted: true, resourcesClosed: true });
    await delay(10); assert(!done);
    child.emit('message', { ...child.request, type: 'shutdown-complete', persisted: true, resourcesClosed: true });
    await delay(10); assert(!done);
    child.emit('exit', 0, null);
    assert.equal((await stop).clean, true);
});
test('force fallback is bounded and never clean', async () => {
    const child = fakeChild();
    let forced = false;
    const owner = superviseChild(child, 'instance', { force: async () => { forced = true; child.kill(); } });
    const result = await owner.stop({ deadline: Date.now() + 35 });
    assert(forced); assert.equal(result.clean, false); assert.equal(result.exited, true);
});

test('late upstream auth settles but cannot connect after quiesce', async () => {
    let resolveToken, connected = false;
    class Client extends EventEmitter { end() {} setSocket() { connected = true; } }
    const owner = createUpstreamOwner({ Client, createClient(options) {
        const client = new options.Client();
        options.connect = () => { connected = true; };
        client.authflow = { getMinecraftJavaToken: () => new Promise(resolve => { resolveToken = resolve; }) };
        client.authflow.getMinecraftJavaToken().then(() => options.connect(client));
        return client;
    } });
    owner.create({}); owner.quiesce(); resolveToken({ synthetic: true });
    await owner.drain(); await Promise.resolve(); assert(!connected);
});

test('listener stops admission, closes sockets and releases port', async () => {
    const net = require('net');
    const server = net.createServer(); const owner = ownListener(server);
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
    const client = net.connect(port, '127.0.0.1'); await once(client, 'connect');
    owner.quiesce(); await owner.close();
    const replacement = net.createServer(); replacement.listen(port, '127.0.0.1'); await once(replacement, 'listening');
    await new Promise(resolve => replacement.close(resolve)); client.destroy();
});

test('renderer accepted-save barrier responds once work is complete and shares repeated work', async () => {
    const ipc = new EventEmitter(); const messages = []; ipc.send = (...args) => messages.push(args);
    let resolve, count = 0;
    require('../../src/launcher/renderer/launcher_shutdown').installRendererShutdown(ipc, () => { count++; return new Promise(done => { resolve = done; }); });
    ipc.emit('shutdown:prepare-renderer', {}, { version: 1, requestId: 'a' });
    ipc.emit('shutdown:prepare-renderer', {}, { version: 1, requestId: 'b' });
    await Promise.resolve(); assert.equal(messages.length, 0); resolve(); await delay(1);
    assert.equal(count, 1); assert.equal(messages.length, 2); assert(messages.every(message => message[1].clean));
});

test('failure reports its responsible phase even after later cleanup progress', async () => {
    const child = fakeChild();
    const owner = superviseChild(child, 'instance', { force: async () => {} });
    const stopping = owner.stop();
    child.emit('message', { ...child.request, type: 'shutdown-progress', phase: 'resources' });
    child.emit('message', { ...child.request, type: 'shutdown-failed', phase: 'persistence' });
    child.emit('exit', 1, null);
    const result = await stopping;
    assert.equal(result.clean, false); assert.equal(result.phase, 'persistence');
});

test('real minecraft-protocol late Microsoft callback is fenced without changing Authflow', async () => {
    const { Authflow } = require('prismarine-auth');
    const original = Authflow.prototype.getMinecraftJavaToken;
    let release, connects = 0;
    Authflow.prototype.getMinecraftJavaToken = () => new Promise(resolve => { release = resolve; });
    let client;
    try {
        const owner = createUpstreamOwner(require('minecraft-protocol'));
        client = owner.create({ username: 'Fixture', profilesFolder: path.join(root, 'synthetic-auth'), auth: 'microsoft', version: '1.8.9', connect: () => { connects++; } });
        client.on('error', () => {});
        owner.quiesce(); client.end('shutdown');
        release({ token: 'synthetic-fixture-only', profile: { id: 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa', name: 'Fixture' }, entitlements: {} });
        await owner.drain(); await delay(5);
        assert.equal(connects, 0);
    } finally {
        Authflow.prototype.getMinecraftJavaToken = original;
        if (client) clearTimeout(client.closeTimer);
    }
});
