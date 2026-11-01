'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createSessionStore } = require('../../src/session/sessionStore');
const { createSessionTracker } = require('../../src/session/sessionTracker');
const { captureSessionSnapshot } = require('../../src/session/sessionSnapshot');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory');

function fixture(t, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-counting-'));
    let stamp = 1000000;
    const account = { uuid: 'a'.repeat(32), name: 'Tester' };
    let player = { ...account, displayname: account.name, stats: {
        Bedwars: { wins_bedwars: 10, losses_bedwars: 10, kills_bedwars: 20 },
        Duels: { wins: 10, losses: 10, kills: 20 }
    } };
    const timers = new Map(); let serial = 0;
    const store = createSessionStore({ sessionFile: path.join(dir, 'sessions.json'), now: () => stamp,
        saveDelayMs: 0, writeJsonOffThread(file, data, _label, done) {
            fs.writeFileSync(file, JSON.stringify(data));
            done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
        } });
    const tracker = createSessionTracker({ store, getIdentity: () => account, now: () => stamp,
        fetchOwnStats: async () => player, gameEndDelayMs: 15000,
        setTimeoutImpl: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: stamp + ms }); return id; },
        clearTimeoutImpl: id => timers.delete(id), logger: { error() {}, warn() {} }, ...options });
    const start = { mode: 'BEDWARS', observedFromStart: true, identityKnown: true,
        ownName: account.name, ownTeam: 'Red', standardBedwars: true, variant: 'Solos' };
    t.after(() => { tracker.detach(); fs.rmSync(dir, { recursive: true, force: true }); });
    return { tracker, store, account, start, timers, tick: ms => { stamp += ms; }, now: () => stamp,
        reload: () => createSessionStore({ sessionFile: path.join(dir, 'sessions.json'), now: () => stamp, writeJsonOffThread() {} }),
        setPlayer: value => { player = value; }, snapshot: () => captureSessionSnapshot(player, { now: () => stamp }),
        async fireDue() {
            for (const [id, timer] of [...timers]) if (timer.at <= stamp) { timers.delete(id); await timer.fn(); }
            await new Promise(resolve => setImmediate(resolve));
        } };
}

test('a short, confirmed API-enabled duel counts immediately from its observed title', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, mode: 'DUELS', sessionKey: 'duel' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(5000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'DUELS', sessionKey: 'duel', durationMs: 5000, force: true, immediate: true });
    assert.equal(f.store.getLastGame(f.account.uuid)?.result, 'win');
    assert.equal(f.tracker.getSessionDelta().modes[0].games, 1);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 1);
});

test('two rapid unconfirmed game ends both survive their delayed captures', async t => {
    const f = fixture(t);
    for (const key of ['first', 'second']) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: key });
        f.tick(1000);
        await f.tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: key, durationMs: 60000 });
    }
    f.tick(15000); await f.fireDue();
    assert.equal(f.tracker.getActiveSession().games.length, 2);
});

test('a shared API window is not assigned to either of two delayed match ends', async t => {
    const f = fixture(t);
    for (const key of ['first', 'second']) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: key }); f.tick(1000);
        await f.tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: key, durationMs: 60000 });
    }
    const snapshot = f.snapshot(); snapshot.stats.Bedwars.wins_bedwars++;
    f.setPlayer({ uuid: f.account.uuid, stats: snapshot.stats });
    f.tick(15000); await f.fireDue();
    const records = f.tracker.getActiveSession().games;
    assert.equal(records.length, 2);
    assert(records.every(record => record.verificationStatus === 'pending' && record.delta === null));
});

test('an API result published before its kills cannot replace an observed kill with zero', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'late-kills' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true, durationMs: 60000 });
    const snapshot = f.snapshot(); snapshot.stats.Bedwars.wins_bedwars++;
    f.setPlayer({ uuid: f.account.uuid, stats: snapshot.stats });
    await f.tracker.processPendingVerifications({ force: true });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 1);
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus, 'pending');
    snapshot.stats.Bedwars.kills_bedwars++;
    await f.tracker.processPendingVerifications({ force: true });
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus, 'verified');
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 1);
});

for (const action of ['finish', 'reset', 'quiesce']) test(`${action} preserves a completed game waiting for capture`, async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'ended' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000);
    await f.tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000,
        events: [{ type: 'victory', at: 1060000 }] });
    await f.tracker[action]();
    const records = f.store.getSessions(f.account.uuid).flatMap(s => s.games);
    assert.equal(records.length, 1);
    assert.equal(records[0].result, 'win');
    f.tick(15000); await f.fireDue();
    assert.equal(f.store.getSessions(f.account.uuid).flatMap(s => s.games).length, 1);
});

test('manual BedWars result updates its mode totals as well as overall totals', async t => {
    const f = fixture(t, { isApiAvailable: () => false });
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'unknown' });
    f.tick(60000);
    const ticket = f.tracker.onQueueStart({ mode: 'BEDWARS' });
    f.tracker.confirmPreviousGameResult({ result: 'win', localTicket: ticket });
    const mode = f.tracker.getSessionDelta().modes[0];
    assert.equal(mode.wins, 1);
    assert.equal(mode.submodes[0].wins, 1);
    assert.equal(mode.submodes[0].losses, 0);
    f.store.flush();
    assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].submodes[0].wins, 1);
});

test('a snapshot rollback cannot erase matches already observed in the session', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'saved' });
    f.tick(60000);
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true, durationMs: 60000,
        events: [{ type: 'victory', at: 1060000 }] });
    const session = f.tracker.getActiveSession();
    const rollback = f.snapshot(); rollback.stats.Bedwars.kills_bedwars = 1;
    f.setPlayer({ uuid: f.account.uuid, displayname: 'Tester', stats: rollback.stats });
    await f.tracker.refresh({ force: true });
    assert.equal(f.store.findSession(session.id).games.length, 1);
    assert.equal(f.tracker.getSessionDelta().modes[0].wins, 1);
});

test('verification never fetches another account to service its pending records', async t => {
    let calls = 0;
    const f = fixture(t, { fetchOwnStats: async () => { calls++; return null; } });
    const other = f.store.startSession({ uuid: 'b'.repeat(32), name: 'Other', at: 1000000 });
    const game = f.store.appendGame(other.id, { at: 1000000, mode: 'BEDWARS',
        verificationStatus: 'pending', nextVerificationAt: 1000000 });
    await f.tracker.processPendingVerifications({ force: true });
    assert.equal(calls, 0);
    assert.equal(f.store.findSession(other.id).games[0].verificationAttempts, game.verificationAttempts);
});

test('an observed kill survives finishing and exhausted API verification without a known result', async t => {
    const f = fixture(t, { gameEndDelayMs: 0, verificationRetryDelaysMs: [] });
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'left' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000);
    await f.tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000 });
    await f.tracker.finish(); f.store.flush();
    const history = f.reload().getHistory(f.account.uuid);
    assert.equal(history.length, 1);
    assert.equal(history[0].delta.modes[0].kills, 1);
    const projected = buildLauncherSessionHistory(history, { account: f.account, accountScoped: true, now: f.now() });
    assert.equal(projected.sessions.length, 1);
    assert.equal(projected.sessions[0].modes[0].kills, 1);
});

test('the game ending during an API rollback also retains its own observations', async t => {
    const f = fixture(t, { gameEndDelayMs: 0 });
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'rollback' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    f.setPlayer({ uuid: f.account.uuid, stats: { Bedwars: { wins_bedwars: 1 } } });
    await f.tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000 });
    assert.equal(f.tracker.getActiveSession().games.length, 1);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 1);
    assert.equal(f.tracker.getSessionDelta().modes[0].wins, 1);
});

test('a stale end from another mode cannot consume the current API-tracked match', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, mode: 'DUELS', sessionKey: 'duel' });
    f.tick(60000);
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true, durationMs: 60000 });
    assert.equal(f.tracker.getActiveSession().games.length, 0);
    f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'DUELS', immediate: true, durationMs: 60000 });
    assert.equal(f.tracker.getSessionDelta().modes[0].mode, 'DUELS');
});

test('a confirmed subsecond match is counted without an arbitrary duration cutoff', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, mode: 'DUELS', sessionKey: 'fast' });
    f.tick(500); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'DUELS', immediate: true, durationMs: 500 });
    assert.equal(f.tracker.getSessionDelta().modes[0]?.games, 1);
});

test('refreshing during a long live game keeps its original session', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'long' });
    const id = f.tracker.getActiveSessionId();
    f.tick(31 * 60000);
    await f.tracker.refresh({ force: true });
    assert.equal(f.tracker.getActiveSessionId(), id);
});

test('a mismatched API profile cannot assign observed stats to another account', async t => {
    const f = fixture(t, { fetchOwnStats: async () => ({ uuid: 'b'.repeat(32), displayname: 'Other',
        stats: { Duels: { wins: 50000 } } }) });
    await f.tracker.onGameStart({ ...f.start, mode: 'DUELS', sessionKey: 'wrong-profile' });
    f.tick(5000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'DUELS', immediate: true, durationMs: 5000 });
    assert.equal(f.tracker.getActiveSession().uuid, f.account.uuid);
    assert.equal(f.store.getSessions('b'.repeat(32)).length, 0);
    assert.equal(f.tracker.getSessionDelta().modes[0].wins, 1);
});

for (const apiAvailable of [true, false]) test(`production Duels chat wiring counts consecutive short games (API ${apiAvailable})`, async t => {
    const f = fixture(t, { isApiAvailable: () => apiAvailable });
    const proxy = fs.readFileSync(path.resolve(__dirname, '../../proxy.js'), 'utf8');
    const context = vm.createContext({ sessionTracker: f.tracker, console,
        Date: { now: f.now }, state: { sessionTrackingEnabled: true, apiKillSwitchEnabled: !apiAvailable },
        duelsState: { sessionId: 1, modeName: 'Classic Duel', modeDef: { id: 'classic_1v1', label: 'Classic Duel' } },
        stripAnsi: text => text, localSessionIdentity: () => ({ ownNames: ['Tester'], identityKnown: true }),
        gameActive: false, hasHypixelApiKeyConfigured: () => apiAvailable });
    vm.runInContext('let localDuelKey = null, localDuelStartedAt = 0;', context);
    for (const name of ['finishLocalDuel', 'startObservedDuel', 'observeSessionGameChat']) {
        const start = proxy.indexOf(`        function ${name}(`);
        assert(start >= 0, name);
        const end = proxy.indexOf('\n        function ', start + 1);
        vm.runInContext(proxy.slice(start, end), context);
    }
    assert(proxy.includes('startObservedDuel(text);'), 'The packet handler calls the shared production entry point');
    for (let i = 0; i < 2; i++) {
        context.startObservedDuel('Opponent: Rival');
        await new Promise(resolve => setImmediate(resolve));
        context.observeSessionGameChat('Rival was killed by Tester.');
        f.tick(5000);
        context.observeSessionGameChat('VICTORY!');
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(f.tracker.getSessionDelta().modes[0].games, 2);
    assert.equal(f.tracker.getSessionDelta().modes[0].wins, 2);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 2);
    assert.equal(f.tracker.getActiveSession().games.length, 2);
    f.tracker.observeLocalResult('VICTORY!');
    assert.equal(f.tracker.getActiveSession().games.length, 2, 'Duplicate result after completion adds no match');
});
