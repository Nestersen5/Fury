'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createSessionStore } = require('../../src/session/sessionStore');
const { createJsonWriter } = require('../../src/storage/jsonWriter');
const { writeFileAtomic } = require('../../src/storage/atomic_file');
const { createShutdown } = require('../../src/bootstrap/shutdown');
const { createLauncherSessionHistoryCache, createLauncherSessionHistoryReceiver } = require('../../src/session/launcherSessionHistory');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-history-reconciliation-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const account = { name: 'Fixture', uuid: 'a'.repeat(32) };
function seed() {
    return { version: 4, sessions: [{ ...account, id: 's', startedAt: 1000, lastSeen: 2000, endedAt: 0,
        baseline: { stats: { Bedwars: { wins_bedwars: 1 } } }, latest: { stats: { Bedwars: { wins_bedwars: 2 } } },
        games: [{ id: 'g', at: 2000, mode: 'BEDWARS', result: 'win', verificationStatus: 'pending' }] }] };
}
function fixture(name) {
    const file = path.join(root, name + '.json'), jobs = [];
    fs.writeFileSync(file, JSON.stringify(seed()));
    const store = createSessionStore({ sessionFile: file, saveDelayMs: 600000, logger: { error() {} },
        writeJsonOffThread: (file, value, label, acknowledge, options) => {
            jobs.push({ file, value: structuredClone(value), acknowledge, options });
        } });
    return { file, store, jobs };
}
async function publish(job) {
    job.receipt = await writeFileAtomic(job.file, JSON.stringify(job.value), 'utf8', job.options);
}
const current = store => store.findSession('s').games[0].result;
const disk = file => JSON.parse(fs.readFileSync(file)).sessions[0].games[0].result;
const mutate = (store, result) => store.updateGame('s', 'g', { result });

test('A: older publication and acknowledgement cannot erase newer accepted memory; shutdown queues B before sealing', async () => {
    const { file, store, jobs } = fixture('older');
    mutate(store, 'loss'); const first = store.flush({ strict: true });
    mutate(store, 'win'); const revision = store.revision();
    await publish(jobs[0]); store.cache.nextCheckAt = 0;
    assert.equal(current(store), 'win'); assert.equal(store.revision(), revision);
    const final = store.flush({ strict: true, onlyPending: true });
    jobs[0].acknowledge(null, jobs[0].receipt); await first;
    assert.equal(current(store), 'win'); assert.equal(store.revision(), revision);
    assert.equal(jobs.length, 2);
    await publish(jobs[1]); jobs[1].acknowledge(null, jobs[1].receipt); await final;
    store.cache.nextCheckAt = 0;
    assert.equal(current(store), 'win'); assert.equal(store.revision(), revision);
    store.verifyPersistence(); assert.equal(disk(file), 'win');
});

test('B: external publication between own publication and acknowledgement is reloaded', async () => {
    const { file, store, jobs } = fixture('external');
    mutate(store, 'loss'); const revision = store.revision(), writing = store.flush({ strict: true });
    await publish(jobs[0]); const external = seed(); external.sessions[0].games[0].result = 'win';
    await writeFileAtomic(file, JSON.stringify(external));
    jobs[0].acknowledge(null, jobs[0].receipt); await writing;
    store.cache.nextCheckAt = 0;
    assert.equal(current(store), 'win'); assert(store.revision() > revision);
    store.verifyPersistence(); assert.equal(disk(file), 'win');
});

test('C: uncontended actual writer receipt prevents false reload; receipt tracks the temporary inode', async () => {
    const file = path.join(root, 'real-worker.json'); fs.writeFileSync(file, JSON.stringify(seed()));
    const writer = createJsonWriter({ workerPath: path.join(REPOSITORY_ROOT, 'src/storage/json_writer_worker.js') });
    try {
        const store = createSessionStore({ sessionFile: file, writeJsonOffThread: writer.writeJsonOffThread });
        mutate(store, 'loss'); const revision = store.revision();
        await store.flush({ strict: true }); await writer.drain(); store.verifyPersistence();
        store.cache.nextCheckAt = 0; assert.equal(store.revision(), revision); assert.equal(current(store), 'loss');
        assert.throws(() => writer.writeJsonOffThread(file, seed()), /shutting down/);
    } finally { await writer.close(); }
});

test('D: failed or receiptless writes do not mark a successful publication', async () => {
    for (const error of ['synthetic failure', null]) {
        const { store, jobs } = fixture('failed-' + Boolean(error));
        mutate(store, 'loss'); const stamp = store.cache.stamp;
        const writing = store.flush({ strict: true });
        jobs[0].acknowledge(error); await assert.rejects(writing, /persistence|receipt/);
        assert.equal(store.cache.stamp, stamp); assert.equal(current(store), 'loss');
        assert.throws(() => store.verifyPersistence());
    }
});

test('E: external edit after final publication cannot receive clean F7 acknowledgement', async () => {
    const { file, store, jobs } = fixture('shutdown-external'); mutate(store, 'loss');
    let ready;
    const queued = new Promise(resolve => { ready = resolve; });
    const operation = createShutdown({ drain: async () => {
        const writing = store.flush({ strict: true, onlyPending: true }); ready(); await writing; store.verifyPersistence();
    } }).request();
    await queued;
    await publish(jobs[0]); await writeFileAtomic(file, JSON.stringify(seed()));
    jobs[0].acknowledge(null, jobs[0].receipt);
    const result = await operation;
    assert.equal(result.clean, false); assert.equal(result.outcome, 'FAILED'); assert.equal(result.phase, 'persistence');
    assert.equal(disk(file), 'win');
});

test('E: external conflict while dirty retains memory and external file, refuses destructive save', async () => {
    const { file, store, jobs } = fixture('dirty-conflict'); mutate(store, 'loss');
    await writeFileAtomic(file, JSON.stringify(seed()));
    store.cache.nextCheckAt = 0; assert.equal(current(store), 'loss');
    await assert.rejects(store.flush({ strict: true, onlyPending: true }), /changed externally/);
    assert.equal(jobs.length, 0); assert.equal(disk(file), 'win'); assert.throws(() => store.verifyPersistence());
});

test('external replacement after A with B still dirty fails instead of merging or overwriting either state', async () => {
    const { file, store, jobs } = fixture('queued-conflict');
    mutate(store, 'loss'); const first = store.flush({ strict: true });
    mutate(store, 'win'); await publish(jobs[0]);
    const external = seed(); external.sessions[0].games[0].result = 'external';
    await writeFileAtomic(file, JSON.stringify(external));
    jobs[0].acknowledge(null, jobs[0].receipt); await first;
    store.cache.nextCheckAt = 0; assert.equal(current(store), 'win');
    await assert.rejects(store.flush({ strict: true, onlyPending: true }), /changed externally/);
    assert.equal(jobs.length, 1); assert.equal(disk(file), 'external');
    assert.throws(() => store.verifyPersistence());
});

test('F/G/H: exact Main health owner fence rejects old full/unchanged replies and accepts new child', async () => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, 'launcher.js'), 'utf8');
    const body = source.slice(source.indexOf('async function getProxyHealth('), source.indexOf('\nfunction describeSecretChange'));
    const receiver = createLauncherSessionHistoryReceiver(), services = { proxy: { child: { exitCode: null, signalCode: null } } };
    const requests = [];
    const health = new Function('axios', 'normalizeAccount', 'proxySessionHistory', 'services', body + ';return getProxyHealth')(
        { get: () => new Promise(resolve => requests.push(resolve)) }, require('../../src/accounts/launcherAccounts').normalizeAccount, receiver, services);
    const options = { includeSessions: true, account }, settings = { server: { healthPort: 1 } };
    const scope = JSON.stringify(require('../../src/accounts/launcherAccounts').normalizeAccount(account));
    const history = { sessions: [], calendarSessions: [] };
    receiver.accept(scope, null, { sessionHistory: history, sessionHistoryRevision: 'old:1' });
    for (const unchanged of [false, true]) {
        const pending = health(settings, options);
        services.proxy.child = { exitCode: null, signalCode: null };
        receiver.accept(scope, null, { sessionHistory: history, sessionHistoryRevision: 'new:1' });
        requests.shift()({ data: unchanged ? { sessionHistoryUnchanged: true, sessionHistoryRevision: 'old:1' }
            : { sessionHistory: history, sessionHistoryRevision: 'old:1' } });
        assert.equal(await pending, null); assert.equal(receiver.base(scope).revision, 'new:1');
    }
    const pending = health(settings, options);
    requests.shift()({ data: { sessionHistory: history, sessionHistoryRevision: 'new:2' } });
    assert.equal((await pending).sessionHistory, history); assert.equal(receiver.base(scope).revision, 'new:2');
});

test('unchanged history still uses the same projection and WeakMap cache', async () => {
    const { store, jobs } = fixture('cache'); const cache = createLauncherSessionHistoryCache({ now: () => 5000 });
    const first = cache.get(store); const old = first.history.sessions[0].games[0];
    mutate(store, 'loss'); const changed = cache.get(store);
    assert.notEqual(changed.history.sessions[0].games[0], old);
    assert.equal(cache.get(store, { knownRevision: changed.revision }).unchanged, true);
    const write = store.flush({ strict: true }); await publish(jobs[0]); jobs[0].acknowledge(null, jobs[0].receipt); await write;
    assert.equal(cache.get(store, { knownRevision: changed.revision }).unchanged, true);
});
