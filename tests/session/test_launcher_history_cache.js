'use strict';

// Cached launcher session history: the proxy rebuilds only when the store or
// the session settings change, answers "unchanged" to a launcher that already
// holds the build, and between builds only advances the live session's clock.
// Every cached or advanced answer must equal a fresh build at the same time.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPublicationStamp } = require('../../src/storage/filePublication');
const { once } = require('events');
const { createSessionStore } = require('../../src/session/sessionStore.js');
const {
    buildLauncherSessionHistory,
    advanceSessionHistoryClock,
    createLauncherSessionHistoryCache,
    createLauncherSessionHistoryReceiver
} = require('../../src/session/launcherSessionHistory.js');
const { createHealthServer } = require('../../src/health/httpServer.js');

const T0 = 1_800_000_000_000;
const alice = { name: 'Alice', uuid: 'a'.repeat(32) };
const bob = { name: 'Bob', uuid: 'b'.repeat(32) };
const bedwars = (wins, finals, games) => ({ stats: { Bedwars: { wins_bedwars: wins, final_kills_bedwars: finals, games_played_bedwars: games } } });
const game = (id, at, extra = {}) => ({
    id, at, mode: 'BEDWARS', durationMs: 300_000, result: 'win', opponents: ['Rival'],
    events: [{ type: 'final_kill', actor: 'Alice', victim: 'Rival', at: at - 1000 }],
    delta: bedwars(1, 2, 1), verificationStatus: 'verified', ...extra
});
const counts = Object.fromEntries(require('../../src/session/localStats').FIELDS.map(key => [key, { value: 3, available: true }]));
const fixture = {
    version: 4,
    sessions: [
        // Closed API session for Alice.
        { ...alice, id: 's-closed', startedAt: T0 - 7_200_000, lastSeen: T0 - 5_400_000, endedAt: T0 - 5_400_000,
            baseline: bedwars(10, 20, 30), latest: bedwars(12, 25, 33), games: [game('g-old', T0 - 5_500_000)] },
        // Live API session for Alice.
        { ...alice, id: 's-live', startedAt: T0 - 1_800_000, lastSeen: T0 - 60_000, endedAt: 0,
            baseline: bedwars(12, 25, 33), latest: bedwars(14, 29, 35), games: [game('g-live', T0 - 120_000)] },
        // Live local-tracking session for Bob.
        { ...bob, id: 's-bob', startedAt: T0 - 900_000, lastSeen: T0 - 30_000, endedAt: 0,
            trackingSource: 'local', localTracking: { totals: { BEDWARS: counts } }, games: [] }
    ]
};
const settings = {
    sessionBedwarsFields: ['wins', 'finals'], sessionSkywarsFields: [], sessionDuelsFields: [],
    sessionGoalWins: 5, sessionGoalFinals: 0, sessionGoalGames: 0, sessionGoalMinutes: 45
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-history-cache-'));
const file = path.join(directory, 'session_data.json');
fs.writeFileSync(file, JSON.stringify(fixture));
let clock = T0;
const store = createSessionStore({ sessionFile: file, writeJsonOffThread: (target, value, label, done) => {
    fs.writeFileSync(target, JSON.stringify(value));
    done(null, { version: 1, stamp: readPublicationStamp(target) });
}, now: () => clock });
const fresh = (options) => buildLauncherSessionHistory(store.getHistory(), { now: clock, sessionSettings: settings, ...options });
const strip = value => JSON.parse(JSON.stringify(value));

(async () => {
    try {
        // Advancing the clock equals a fresh build at the later time, for API
        // and local live sessions, minutes goals included.
        for (const account of [alice, bob]) {
            const early = fresh({ account, accountScoped: true });
            clock = T0 + 10 * 60_000;
            const later = fresh({ account, accountScoped: true });
            assert.notDeepStrictEqual(strip(early), strip(later), 'the live session moves with the clock');
            assert.deepStrictEqual(strip(advanceSessionHistoryClock(early, clock)), strip(later));
            assert.deepStrictEqual(strip(advanceSessionHistoryClock(strip(early), clock)), strip(later), 'works on a JSON copy');
            assert.deepStrictEqual(strip(early), strip(buildLauncherSessionHistory(store.getHistory(), { now: T0, sessionSettings: settings, account, accountScoped: true })), 'input not modified');
            clock = T0;
        }
        const liveGoal = fresh({ account: alice, accountScoped: true }).goals.find(goal => goal.key === 'minutes');
        assert.ok(liveGoal && liveGoal.value > 0, 'minutes goal is time based');
        const idle = buildLauncherSessionHistory([], { now: clock, sessionSettings: settings });
        assert.strictEqual(advanceSessionHistoryClock(idle, clock + 1000), idle, 'nothing live: same object');

        // Store revision: every commit and every reload of the file.
        const r0 = store.revision();
        assert.strictEqual(store.revision(), r0, 'reading does not bump');
        store.appendGame('s-live', game('g-new', T0 - 30_000));
        const r1 = store.revision();
        assert.ok(r1 > r0, 'commit bumps');
        await store.flush({ strict: true });
        fs.writeFileSync(file, JSON.stringify({ ...fixture, sessions: fixture.sessions.slice(1) }));
        store.cache.invalidate();
        assert.ok(store.revision() > r1, 'reload bumps');
        assert.strictEqual(store.findSession('s-closed'), null);
        fs.writeFileSync(file, JSON.stringify(fixture));
        store.cache.invalidate();

        // The store's own saves are not read back; other writers still are.
        const ownFile = path.join(directory, 'own.json');
        fs.writeFileSync(ownFile, JSON.stringify(fixture));
        const writer = (target, value, label, done) => { fs.writeFileSync(target, JSON.stringify(value) + ' '.repeat(writes++)); done?.(null, { version: 1, stamp: readPublicationStamp(target) }); };
        let writes = 1;
        const own = createSessionStore({ sessionFile: ownFile, writeJsonOffThread: writer, saveDelayMs: 0 });
        own.appendGame('s-live', game('g-own', T0 - 10_000));
        const ownRevision = own.revision();
        own.cache.nextCheckAt = 0;
        assert.strictEqual(own.revision(), ownRevision, 'own write is not re-read');
        assert.ok(own.findSession('s-live').games.some(row => row.id === 'g-own'));
        fs.writeFileSync(ownFile, JSON.stringify({ ...fixture, sessions: fixture.sessions.slice(1) }));
        own.cache.nextCheckAt = 0;
        assert.ok(own.revision() > ownRevision, 'an outside write is still read');
        assert.strictEqual(own.findSession('s-closed'), null);

        // Proxy cache.
        const cache = createLauncherSessionHistoryCache({ now: () => clock });
        const ask = (options = {}) => cache.get(store, { sessionSettings: settings, account: alice, accountScoped: true, ...options });
        const first = ask();
        assert.strictEqual(typeof first.revision, 'string');
        assert.deepStrictEqual(strip(first.history), strip(fresh({ account: alice, accountScoped: true })));
        clock += 5_200;
        const unchanged = ask({ knownRevision: first.revision });
        assert.deepStrictEqual(unchanged, { revision: first.revision, history: null, unchanged: true });
        const again = ask();
        assert.strictEqual(again.revision, first.revision, 'no rebuild without a change');
        assert.deepStrictEqual(strip(again.history), strip(fresh({ account: alice, accountScoped: true })), 'hit equals a fresh build now');
        const stale = ask({ knownRevision: 'other:1' });
        assert.ok(stale.history, 'an unknown revision gets the history');

        store.appendGame('s-live', game('g-after', clock - 1000));
        const afterGame = ask({ knownRevision: first.revision });
        assert.notStrictEqual(afterGame.revision, first.revision, 'a store change rebuilds');
        assert.ok(afterGame.history.sessions.find(session => session.id === 's-live').games.some(row => row.id === 'g-after'));
        assert.deepStrictEqual(strip(afterGame.history), strip(fresh({ account: alice, accountScoped: true })));
        const gameOf = (history, sessionId, gameId) => history.sessions.find(session => session.id === sessionId).games.find(row => row.id === gameId);
        assert.strictEqual(gameOf(afterGame.history, 's-closed', 'g-old'), gameOf(first.history, 's-closed', 'g-old'), 'unchanged games are not compacted again');
        store.updateGame('s-closed', 'g-old', { result: 'loss' });
        const afterUpdate = ask();
        assert.strictEqual(gameOf(afterUpdate.history, 's-closed', 'g-old').result, 'loss', 'an updated game is compacted again');
        assert.deepStrictEqual(strip(afterUpdate.history), strip(fresh({ account: alice, accountScoped: true })));

        const goalChange = ask({ sessionSettings: { ...settings, sessionGoalWins: 9 }, knownRevision: afterGame.revision });
        assert.notStrictEqual(goalChange.revision, afterGame.revision, 'a goal change rebuilds');
        assert.strictEqual(goalChange.history.goals.find(goal => goal.key === 'wins').target, 9);
        const fieldChange = ask({ sessionSettings: { ...settings, sessionBedwarsFields: ['wins'] }, knownRevision: goalChange.revision });
        assert.deepStrictEqual(fieldChange.history.settings.bedwarsFields, ['wins'], 'a field change rebuilds');

        // Account isolation: another scope never gets "unchanged" for Alice's build.
        const aliceRevision = ask().revision;
        const bobReply = ask({ account: bob, knownRevision: aliceRevision });
        assert.ok(bobReply.history && !bobReply.unchanged);
        assert.deepStrictEqual(bobReply.history.sessions.map(session => session.name), ['Bob']);
        const emptyScope = ask({ account: {}, knownRevision: bobReply.revision });
        assert.strictEqual(emptyScope.history.sessions.length, 0, 'empty scope never returns every account');
        assert.notStrictEqual(createLauncherSessionHistoryCache().get(store, { sessionSettings: settings }).revision.split(':')[0],
            cache.get(store, { sessionSettings: settings }).revision.split(':')[0], 'revisions differ per proxy run');

        // Main receiver.
        const receiver = createLauncherSessionHistoryReceiver({ now: () => clock });
        const scope = JSON.stringify(alice);
        assert.strictEqual(receiver.base(scope), null);
        const full = ask();
        const wire = strip({ sessionHistory: full.history, sessionHistoryRevision: full.revision });
        assert.deepStrictEqual(receiver.accept(scope, null, wire), wire.sessionHistory);
        const base = receiver.base(scope);
        assert.strictEqual(base.revision, full.revision);
        assert.strictEqual(receiver.base(JSON.stringify(bob)), null, 'kept per account scope');
        clock += 60_000;
        const reused = receiver.accept(scope, base, { sessionHistory: null, sessionHistoryRevision: full.revision, sessionHistoryUnchanged: true });
        assert.deepStrictEqual(strip(reused), strip(fresh({ account: alice, accountScoped: true })), 'reused history is advanced to now');
        assert.strictEqual(receiver.accept(scope, { ...base, revision: 'old:1' }, { sessionHistory: null, sessionHistoryRevision: full.revision, sessionHistoryUnchanged: true }),
            null, 'an unchanged reply only pairs with the history it was checked against');
        const legacy = { sessions: [] };
        assert.strictEqual(receiver.accept(scope, base, { sessionHistory: legacy }), legacy, 'a proxy without revisions still works');
        assert.strictEqual(receiver.base(scope), null, 'and is not reused');

        // HTTP round trip through the health server.
        const proxyCache = createLauncherSessionHistoryCache({ now: () => clock });
        const server = createHealthServer({
            state: {}, proxyStartTime: Date.now(), chatTriggerManager: { getTriggers: () => [] },
            globalCache: new Map(), auroraPingCache: new Map(), getActiveUser: () => null, getKeys: () => ({}), getServerConfigs: () => [],
            getLastScanSummary: () => null, getFeatures: () => ({}), proxyHealthSnapshot: () => ({}), getHypixelApiUsageSnapshot: () => ({}),
            getUrchinRateLimitSnapshot: () => ({}), hasHypixelApiKeyConfigured: () => false, logger: { log() {}, error() {} },
            getSessionHistory: (account, accountScoped, knownRevision) => proxyCache.get(store, { sessionSettings: settings, account, accountScoped, knownRevision })
        }).start(0);
        try {
            await once(server, 'listening');
            const url = (revision) => `http://127.0.0.1:${server.address().port}/health?includeSessions=1&sessionAccount=${encodeURIComponent(scope)}${revision ? `&sessionRevision=${encodeURIComponent(revision)}` : ''}`;
            const one = await (await fetch(url())).json();
            assert.ok(one.sessionHistory && typeof one.sessionHistoryRevision === 'string' && !one.sessionHistoryUnchanged);
            const two = await (await fetch(url(one.sessionHistoryRevision))).json();
            assert.strictEqual(two.sessionHistory, null);
            assert.strictEqual(two.sessionHistoryUnchanged, true);
            const plain = await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
            assert.strictEqual(plain.sessionHistory, null);
            assert.ok(!('sessionHistoryRevision' in plain), 'no session fields without includeSessions');
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
        console.log('Launcher history cache: clock equivalence, store revisions, rebuild triggers, account scope, receiver pairing and HTTP round trip passed.');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
