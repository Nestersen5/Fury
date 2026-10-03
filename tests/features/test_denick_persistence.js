'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { once } = require('events');
const { createDenickHistory } = require('../../src/denick/history');
const { buildDenickHistoryIndex } = require('../../src/denick/denick_history_index');
const { createLauncherDenickHistory } = require('../../src/launcher/denickHistory');
const { createLauncherDenickActions } = require('../../src/launcher/denickActions');
const { createDenickTracker } = require('../../src/net/session/denickTracking');
const { createHealthServer } = require('../../src/health/httpServer');
const { writeFileAtomic } = require('../../src/storage/atomic_file');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-denick-test-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
let sequence = 0;
const file = () => path.join(temp, `${sequence++}.json`);
const writer = (f, players, label, done, options) => writeFileAtomic(f, JSON.stringify(players), 'utf8', options).then(receipt => done(null, receipt), e => done(e.message));
const entry = (nick, realIGN = 'RealPlayer', method = 'skin') => ({ nick, realIGN, method });

test('overlapping mutations survive older write acknowledgements; flush saves final state', async () => {
    const historyFile = file(), queued = [];
    const store = createDenickHistory({ historyFile, writeJsonOffThread: (...args) => queued.push([args[0], structuredClone(args[1]), ...args.slice(2)]) });
    store.appendDenickHistory(entry('FirstNick'));
    const flushing = store.flush({ strict: true });
    assert.equal(queued.length, 1);
    store.appendDenickHistory(entry('SecondNick'));
    await writer(...queued.shift());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.findKnownDenickByNick('SecondNick').realName, 'RealPlayer');
    assert.equal(queued.length, 1);
    await writer(...queued.shift());
    await flushing;
    assert.equal(JSON.parse(fs.readFileSync(historyFile))[0].nicks.length, 2);
    store.denickHistoryFileCache.nextCheckAt = 0;
    assert.equal(store.findKnownDenickByNick('SecondNick').realName, 'RealPlayer');
});

test('failed writes retain pending mappings and report failure; explicit retry succeeds', async () => {
    let fail = true;
    const historyFile = file(), store = createDenickHistory({ historyFile, writeJsonOffThread: (...args) => fail ? args[3]('disk unavailable') : writer(...args) });
    store.appendDenickHistory(entry('SavedNick'));
    await assert.rejects(store.flush({ strict: true }), /disk unavailable/);
    assert.equal(store.findKnownDenickByNick('SavedNick').realName, 'RealPlayer');
    fail = false;
    await store.flush({ strict: true });
    assert.equal(JSON.parse(fs.readFileSync(historyFile))[0].nicks[0], 'SavedNick');
});

test('offline edits preserve legacy method-only mappings and event-only nicknames', async () => {
    const historyFile = file();
    fs.writeFileSync(historyFile, JSON.stringify([
        { realIGN: 'LegacyPlayer', nicks: ['LegacyNick'], methods: ['manual'], events: [] },
        { realIGN: 'EventPlayer', nicks: [], events: [{ nick: 'EventNick', at: '2026-01-01', method: 'skin' }] }
    ]));
    const store = createDenickHistory({ historyFile, writeJsonOffThread: writer });
    store.appendDenickHistory(entry('NewNick'));
    await store.flush({ strict: true });
    const saved = JSON.parse(fs.readFileSync(historyFile));
    assert.deepEqual(saved.find(p => p.realIGN === 'LegacyPlayer').methods, ['manual']);
    assert(saved.find(p => p.realIGN === 'EventPlayer').nicks.includes('EventNick'));
    assert.equal(store.findKnownDenickByNick('LegacyNick').source, 'manual');
});

test('conflicts prefer manual, newest evidence, then stable name; updates/removals fall back correctly', async () => {
    const rows = [
        { realIGN: 'Alpha', nicks: ['Shared'], events: [{ nick: 'Shared', method: 'skin', at: '2026-09-01' }] },
        { realIGN: 'Bravo', nicks: ['Shared'], events: [{ nick: 'Shared', method: 'manual', at: '2026-01-01' }] }
    ];
    for (const players of [rows, rows.slice().reverse()]) assert.equal(buildDenickHistoryIndex(players).get('shared').realName, 'Bravo');
    rows[1].events[0].method = 'stats';
    assert.equal(buildDenickHistoryIndex(rows).get('shared').realName, 'Alpha');
    const historyFile = file(); fs.writeFileSync(historyFile, JSON.stringify(rows));
    const store = createDenickHistory({ historyFile, writeJsonOffThread: writer });
    store.appendDenickHistory(entry('Shared', 'Bravo', 'manual'));
    assert.equal(store.findKnownDenickByNick('Shared').realName, 'Bravo');
    // Evidence capping and later automatic sightings must not erase a correction.
    for (let i = 0; i < 105; i++) store.appendDenickHistory(entry(`NewNick${i}`, 'Bravo'));
    store.appendDenickHistory(entry('Shared', 'Alpha'));
    assert.equal(store.findKnownDenickByNick('Shared').realName, 'Bravo');
    await store.flush({ strict: true });
    const reloaded = createDenickHistory({ historyFile, writeJsonOffThread: writer });
    assert.equal(reloaded.findKnownDenickByNick('Shared').realName, 'Bravo');
    assert(reloaded.removeDenickMapping('Bravo', 'Shared').removed);
    assert.equal(reloaded.findKnownDenickByNick('Shared').realName, 'Alpha');
    await reloaded.flush({ strict: true });
});

test('unchanged launcher history reuses projection and omits its payload; atomic edits/deletion invalidate it', async () => {
    const historyFile = file(), reader = createLauncherDenickHistory(historyFile);
    const empty = reader.get(); assert.equal(reader.get(empty.revision), null);
    await writeFileAtomic(historyFile, JSON.stringify([{ realIGN: 'PlayerOne', nicks: ['NickOne'] }]));
    const first = reader.get(empty.revision); assert.equal(first.players.length, 1);
    assert.equal(reader.get(), first);
    assert.equal(reader.get(first.revision), null);
    await writeFileAtomic(historyFile, JSON.stringify([{ realIGN: 'PlayerTwo', nicks: ['NickTwo'] }]));
    const second = reader.get(first.revision); assert.equal(second.players[0].realIGN, 'PlayerTwo');
    fs.writeFileSync(historyFile, 'broken'); assert.equal(reader.get(), second, 'preserve last good snapshot on malformed data');
    fs.unlinkSync(historyFile); assert.equal(reader.get(second.revision).totalPlayers, 0);
});

test('the latest explicit correction wins even within one clock tick and supports reserved-looking names', async () => {
    const historyFile = file(), store = createDenickHistory({ historyFile, writeJsonOffThread: writer });
    const now = Date.now;
    try {
        Date.now = () => 1800000000000;
        store.appendDenickHistory(entry('__proto__', 'Alpha', 'manual'));
        store.appendDenickHistory(entry('__proto__', 'Zulu', 'manual'));
        assert.equal(store.findKnownDenickByNick('__proto__').realName, 'Zulu');
    } finally { Date.now = now; }
    await store.flush({ strict: true });
    assert.equal(createDenickHistory({ historyFile, writeJsonOffThread: writer }).findKnownDenickByNick('__proto__').realName, 'Zulu');
});

test('launcher only falls back on refused connection with no proxy owner; offline operations are serialized', async () => {
    const historyFile = file(); let code = 'ECONNABORTED', running = false;
    const fail = async () => { throw Object.assign(new Error('network'), { code }); };
    const actions = createLauncherDenickActions({ historyFile, axios: { post: fail, delete: fail }, getPort: () => 1, proxyRunning: () => running });
    await assert.rejects(actions.add(entry('FirstNick'))); assert(!fs.existsSync(historyFile));
    code = 'ECONNREFUSED'; running = true;
    await assert.rejects(actions.add(entry('FirstNick'))); assert(!fs.existsSync(historyFile));
    running = false;
    await Promise.all([actions.add(entry('FirstNick')), actions.add(entry('SecondNick'))]);
    await actions.idle(); assert.equal(JSON.parse(fs.readFileSync(historyFile))[0].nicks.length, 2);
    await actions.remove(entry('FirstNick')); assert.deepEqual(JSON.parse(fs.readFileSync(historyFile))[0].nicks, ['SecondNick']);
});

test('live corrections clear active results and reject stale automatic completions until reset', () => {
    const tracker = createDenickTracker({ isValidPlayerName: () => true, nickKey: n => n.toLowerCase() });
    tracker.rememberKnownDenickInSession('SavedNick', 'WrongPlayer');
    const version = tracker.mappingVersion('SavedNick');
    tracker.applySavedMappingChange('SavedNick', null);
    assert.equal(tracker.getAutoDenickResult('SavedNick'), null);
    assert.equal(tracker.canAutoDenick('SavedNick', version), false);
    assert.equal(tracker.canAutoDenick('SavedNick'), false);
    tracker.applySavedMappingChange('SavedNick', { realName: 'CorrectPlayer', source: 'manual' });
    assert.equal(tracker.getAutoDenickResult('SavedNick').realName, 'CorrectPlayer');
    assert.equal(tracker.canAutoDenick('SavedNick', version), false);
    tracker.clear(); assert.equal(tracker.canAutoDenick('SavedNick'), true);
    assert.equal(tracker.canAutoDenick('SavedNick', version), false);
});

test('live HTTP edits await durable save and never mirror a competing launcher write', async () => {
    const historyFile = file(), store = createDenickHistory({ historyFile, writeJsonOffThread: writer });
    const server = createHealthServer({ appendDenickHistory: store.appendDenickHistory, removeDenickMapping: store.removeDenickMapping, flushDenickHistory: store.flush, logger: { log() {}, error() {} } }).start(0);
    await once(server, 'listening');
    try {
        const actions = createLauncherDenickActions({ historyFile, axios: require('axios'), getPort: () => server.address().port, proxyRunning: () => true });
        store.appendDenickHistory(entry('DetectedNick'));
        assert((await actions.add(entry('ManualNick', 'RealPlayer'))).ok);
        assert.deepEqual(JSON.parse(fs.readFileSync(historyFile))[0].nicks, ['DetectedNick', 'ManualNick']);
        assert((await actions.remove(entry('ManualNick'))).ok);
        assert.equal(store.findKnownDenickByNick('ManualNick'), null);
        assert.deepEqual(JSON.parse(fs.readFileSync(historyFile))[0].nicks, ['DetectedNick']);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
