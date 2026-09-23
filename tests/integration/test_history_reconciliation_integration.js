'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

// Actual proxy/health/IPC/writer ownership with synthetic storage. Only the
// delivery of a worker acknowledgement is gated; production writes are intact.
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { cleanEnvironment, unusedPorts, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const { superviseChild } = require('../../src/bootstrap/childShutdown');
const { writeFileAtomic } = require('../../src/storage/atomic_file');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-reconciliation-native-'));
const children = [], results = [];

async function scenario(mode) {
    const data = path.join(root, mode); fs.mkdirSync(data);
    const file = path.join(data, 'session_data.json'), now = Date.now();
    const account = { name: 'Fixture', uuid: 'a'.repeat(32) };
    const seed = { version: 4, sessions: [{ ...account, id: 's', startedAt: now - 10000, lastSeen: now, endedAt: 0,
        baseline: { stats: { Bedwars: { wins_bedwars: 1 } } }, latest: { stats: { Bedwars: { wins_bedwars: 2 } } },
        games: [{ id: 'g', at: now, mode: 'BEDWARS', result: 'win', verificationStatus: 'pending' }] }] };
    fs.writeFileSync(file, JSON.stringify(seed));
    const [direct, failover, health, cosmetic, blocked] = await unusedPorts(5);
    fs.writeFileSync(path.join(data, 'server_config.json'), JSON.stringify({ proxyDirectPort: direct, proxyFailoverPort: failover,
        healthPort: health, proxyDirectHost: '127.0.0.1', proxyFailoverHost: '127.0.0.1' }));
    fs.writeFileSync(path.join(data, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false }));
    const worker = path.join(data, 'worker.cjs'), preload = path.join(data, 'preload.cjs');
    const fromRoot = require('module').createRequire(path.join(REPOSITORY_ROOT, 'package.json'));
    const resolve = name => JSON.stringify(fromRoot.resolve(name));
    fs.writeFileSync(worker, `
const {parentPort}=require('worker_threads');const send=parentPort.postMessage.bind(parentPort);let held,once=false;
${mode === 'failure' ? `require(${resolve('./src/storage/atomic_file')}).writeFileAtomic=async()=>{throw Error('synthetic write failure');};` : ''}
parentPort.postMessage=m=>{if(!once&&m.label==='SessionStore'){once=true;held=m;send({fixturePublished:true});}else send(m);};
parentPort.on('message',m=>{if(m.fixtureRelease){send(held);held=null;}});
require(${resolve('./src/storage/json_writer_worker')});
`);
    fs.writeFileSync(preload, `
const W=require(${resolve('./src/storage/jsonWriter')}),make=W.createJsonWriter;let writer;
W.createJsonWriter=o=>{writer=make({...o,workerPath:${JSON.stringify(worker)}});return writer;};
const S=require(${resolve('./src/session/sessionStore')}),create=S.createSessionStore;
S.createSessionStore=o=>{const s=create(o);process.on('message',m=>{
 if(m.type==='fixture:seed'){
  s.updateGame('s','g',{result:'loss'});s.flush();
  ${mode === 'newer-memory' ? "s.updateGame('s','g',{result:'win'});" : ''}
  writer.ensureJsonWriterWorker().on('message',m=>{if(m.fixturePublished)process.send({type:'fixture:published'});});
 }
 if(m.type==='fixture:release')writer.ensureJsonWriterWorker().postMessage({fixtureRelease:true});
});return s;};
`);
    const env = cleanEnvironment(data, REPOSITORY_ROOT, cosmetic, blocked); env.FURY_SERVICE_INSTANCE = randomUUID();
    const child = spawn(process.execPath, ['--require', preload, path.join(REPOSITORY_ROOT, 'proxy.js')], {
        cwd: data, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    children.push(child); const messages = []; let logs = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-10000); });
    child.on('message', message => messages.push(message));
    const owner = superviseChild(child, env.FURY_SERVICE_INSTANCE);
    await eventually(async () => { assert.equal(child.exitCode, null, logs); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'proxy ready');
    child.send({ type: 'fixture:seed' });
    await eventually(() => assert(messages.some(m => m.type === 'fixture:published')), 'worker gate');
    if (mode === 'newer-memory') {
        // Real cache interval, with the older publication visible and unacked.
        await new Promise(resolve => setTimeout(resolve, 1100));
        const response = await getJson(`http://127.0.0.1:${health}/health?includeSessions=1&sessionAccount=${encodeURIComponent(JSON.stringify(account))}`);
        assert.equal(response.sessionHistory.sessions[0].games[0].result, 'win');
    }
    if (mode === 'external') await writeFileAtomic(file, JSON.stringify(seed));
    const started = performance.now();
    const stopping = owner.stop(); // Stop must join the held publication before sealing.
    const poll = getJson(`http://127.0.0.1:${health}/health?includeSessions=1`).catch(() => null);
    setTimeout(() => child.send({ type: 'fixture:release' }), 120);
    const outcome = await stopping; await poll;
    assert.equal(outcome.clean, mode === 'newer-memory', logs); assert.equal(outcome.exited, true);
    assert.equal(messages.some(m => m.type === 'shutdown-complete'), mode === 'newer-memory');
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved.sessions[0].games[0].result, 'win'); assert.equal(saved.sessions[0].uuid, account.uuid);
    if (mode === 'newer-memory') assert.equal(saved.sessions[0].games[0].verificationStatus, 'pending');
    for (const port of [direct, failover, health]) {
        const server = net.createServer();
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
        await new Promise(resolve => server.close(resolve));
    }
    assert.throws(() => process.kill(child.pid, 0));
    results.push({ mode, outcome, milliseconds: Math.round(performance.now() - started) });
}

(async () => {
    for (const mode of ['newer-memory', 'external', 'failure']) await scenario(mode);
    console.log(JSON.stringify({ passed: true, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') await new Promise(resolve => require('child_process').execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
        else child.kill('SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
