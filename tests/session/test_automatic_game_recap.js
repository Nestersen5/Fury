'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createAutomaticRecapGuard, isCompletedGameRecap, createRecapDelivery } = require('../../src/session/gameRecap');
const { createSessionTracker } = require('../../src/session/sessionTracker');
const { createSessionStore } = require('../../src/session/sessionStore');

function recap(overrides = {}) {
    return {
        record: { id: 'game-1', at: 61000, durationMs: 60000, mode: 'BEDWARS',
            result: 'win', verificationStatus: 'verified', ...overrides },
        delta: { from: 1000, to: 76000, stats: { Bedwars: { wins_bedwars: 1 } } }
    };
}

for (const mode of ['BEDWARS', 'SKYWARS', 'DUELS']) {
    const game = { BEDWARS: 'Bedwars', SKYWARS: 'SkyWars', DUELS: 'Duels' }[mode];
    const sample = recap({ mode });
    sample.delta.stats = { [game]: { [mode === 'BEDWARS' ? 'wins_bedwars' : 'wins']: 1 } };
    assert(isCompletedGameRecap(sample), `${mode}: one published win is a completed game`);
}
for (const patch of [
    { durationMs: 0 }, { durationMs: 499 }, { durationMs: 1000 },
    { result: null }, { verificationStatus: 'pending' }, { verificationStatus: 'unverified' },
    { metadata: { privateGame: true } }
]) assert(!isCompletedGameRecap(recap(patch)), JSON.stringify(patch));
assert(isCompletedGameRecap(recap({ durationMs: 5000, events: [{ type: 'victory' }] })),
    'A confirmed short win remains eligible');
for (const stats of [
    { kills_bedwars: 3 }, { coins: 100 }, { wins_bedwars: 2 },
    { wins_bedwars: 1, losses_bedwars: 1 }, { wins_bedwars: -1 }
]) {
    const sample = recap(); sample.delta.stats.Bedwars = stats;
    assert(!isCompletedGameRecap(sample), 'Combat, rewards and combined games are not one finished game');
}
const local = recap({ verificationStatus: 'local', durationMs: 5000,
    localModes: [{ mode: 'BEDWARS', games: 1, wins: 1, losses: 0 }] });
assert(isCompletedGameRecap(local));
local.record.localModes[0].games = undefined;
assert(!isCompletedGameRecap(local), 'A partially observed local game does not claim completion');

{
    const allow = createAutomaticRecapGuard({ now: () => 1000 });
    assert(allow(recap()));
    assert(!allow(recap()), 'Duplicate callbacks are silent');
    const overlapping = recap({ id: 'game-2', at: 80000 });
    overlapping.delta.to = 95000;
    assert(!allow(overlapping), 'Two records cannot announce the same API stat movement');
    const next = recap({ id: 'game-3', at: 160000 });
    next.delta.from = 95000; next.delta.to = 175000;
    assert(allow(next), 'The next independent game is eligible');
}
for (const options of [{ enabled: false }, { playing: true }]) {
    const allow = createAutomaticRecapGuard({ now: () => 1000 });
    assert(!allow(recap(), options));
    assert(!allow(recap()), 'Suppressed callbacks do not replay later');
}
assert(!createAutomaticRecapGuard({ now: () => 100000 })(recap()),
    'Verification of a pre-connection game cannot announce on reconnect');

// Exercise the proxy's actual packet predicate and finalizer, not a second
// implementation of those rules in the test.
{
    const proxy = fs.readFileSync(path.join(__dirname, '../../proxy.js'), 'utf8');
    const begin = proxy.indexOf('                    if (!isActionBar && /^(?:GAME OVER|VICTORY|DEFEAT)');
    assert(begin >= 0);
    const end = proxy.indexOf('\n                    }', begin) + '\n                    }'.length;
    let resets = 0;
    const packet = vm.createContext({ isActionBar: false, cleanChatText: '',
        resetMatchState: () => resets++, clearTrackedScoreboard() {} });
    for (const text of ['Rival: VICTORY!', 'Party > Friend: GAME OVER!', 'The game starts in 1 second!']) {
        packet.cleanChatText = text; vm.runInContext(proxy.slice(begin, end), packet);
    }
    assert.equal(resets, 0, 'Ordinary chat never resets the match');
    packet.cleanChatText = 'VICTORY!'; packet.isActionBar = true;
    vm.runInContext(proxy.slice(begin, end), packet);
    assert.equal(resets, 0, 'Action bars are not game-end chat');
    packet.isActionBar = false;
    vm.runInContext(proxy.slice(begin, end), packet);
    assert.equal(resets, 1, 'An exact server result still resets the match');

    const functionStart = proxy.indexOf('        function finalizeSessionGame(');
    const functionEnd = proxy.indexOf('\n        function ', functionStart + 1);
    const ends = [];
    const context = vm.createContext({
        Date: { now: () => 105000 }, Promise, console, gameStartTime: 100000,
        gameSessionId: 1, currentGamemode: 'BEDWARS', activeMatchServerId: 'mini1',
        sessionGameFinalized: false, pendingBedwarsResultPrompt: null,
        activeSessionGameEvents: [{ type: 'victory' }],
        buildSessionRosterSnapshot: () => [], buildSessionGameMetadata: () => ({}),
        bedwarsStatsDebug: { end() {} }, sessionTracker: { onGameEnd: options => ends.push(options) }
    });
    vm.runInContext(proxy.slice(functionStart, functionEnd), context);
    context.finalizeSessionGame(); context.finalizeSessionGame();
    assert.equal(ends.length, 1, 'A short confirmed game finalizes exactly once');
    assert(ends[0].immediate && ends[0].force);
    assert.equal(ends[0].durationMs, 5000);
}

async function lifecycle(apiAvailable) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-auto-recap-'));
    let stamp = 100000, wins = 10, losses = 5, kills = 20, playing = false;
    let releaseFetch = null, holdFetch = false;
    const notifications = [], callbacks = [];
    const allow = createAutomaticRecapGuard({ now: () => stamp });
    const owner = { uuid: 'a'.repeat(32), name: 'Tester' };
    const store = createSessionStore({ sessionFile: path.join(folder, 'sessions.json'),
        now: () => stamp, saveDelayMs: 0, writeJsonOffThread: () => {} });
    const tracker = createSessionTracker({ store, now: () => stamp,
        getIdentity: () => owner, isApiAvailable: () => apiAvailable, gameEndDelayMs: 0,
        setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {},
        fetchOwnStats: async () => {
            if (holdFetch) await new Promise(resolve => { releaseFetch = resolve; });
            return { uuid: owner.uuid, displayname: owner.name,
                stats: { Bedwars: { wins_bedwars: wins, losses_bedwars: losses, kills_bedwars: kills } } };
        },
        onGameRecap: value => { callbacks.push(value); if (allow(value, { playing })) notifications.push(value); }
    });
    const start = { mode: 'BEDWARS', sessionKey: 'one', ownTeam: 'Aqua',
        ownName: 'Tester', observedFromStart: true, standardBedwars: true, identityKnown: true };
    try {
        await tracker.onQueueStart(start);
        assert.equal(notifications.length, 0, 'Queue baseline is silent');
        await tracker.onGameStart(start);
        assert.equal(notifications.length, 0, 'Game start is silent');
        stamp += 1;
        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 1, sessionKey: 'one' });
        assert.equal(notifications.length, 0, 'A spurious zero-second end is silent');
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        tracker.observeLocalResult('[MVP+] Rival: VICTORY!');
        stamp += 60000;
        if (apiAvailable) {
            await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60001, sessionKey: 'one' });
            assert.equal(notifications.length, 0, 'Unpublished results wait silently');
            wins++; kills++;
            holdFetch = true;
            const a = tracker.processPendingVerifications({ force: true });
            const b = tracker.processPendingVerifications({ force: true });
            releaseFetch(); holdFetch = false;
            await Promise.all([a, b]);
            assert.equal(callbacks.length, 1, 'Concurrent verification consumes a record once');
        } else {
            tracker.observeLocalResult('VICTORY!');
            await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60001, sessionKey: 'one' });
        }
        assert.equal(notifications.length, 1, 'Exactly one recap for the real game');
        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60001, sessionKey: 'one' });
        assert.equal(notifications.length, 1, 'Repeated game-end signal is silent');

        await tracker.onGameStart({ ...start, sessionKey: 'two' });
        tracker.observeLocalChat('Other was killed by Tester.', start);
        stamp += 60000;
        if (apiAvailable) {
            await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000, sessionKey: 'two' });
            playing = true;
            await tracker.onGameStart({ ...start, sessionKey: 'three' });
            wins++;
            await tracker.processPendingVerifications({ force: true });
            assert.equal(notifications.length, 1, 'A delayed recap never interrupts the next game');
            assert.equal(store.getLastGame(owner.uuid).verificationStatus, 'pending', 'A window overlapping a live match cannot be attributed to the previous game');
        } else {
            tracker.observeLocalResult('VICTORY!');
            await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000, sessionKey: 'two' });
            assert.equal(notifications.length, 2);
            assert.equal(notifications[1].delta.modes[0].kills, 1, 'Local recap contains only this game');
            assert.equal(notifications[1].sessionDelta.modes[0].kills, 2, 'Session total remains separate');
            assert(notifications[1].record.id, 'Local callback carries the persisted game identity');
        }
    } finally {
        tracker.detach();
        fs.rmSync(folder, { recursive: true, force: true });
    }
}

function deliveryTiming() {
    let stamp = 1000;
    let runtime = { enabled: true, playing: false, gameGeneration: 1, sessionId: 'one' };
    const timers = new Map(), sent = [];
    const delivery = createRecapDelivery({ now: () => stamp, getState: () => runtime,
        send: value => sent.push(value),
        setTimeoutImpl: (fn, delay) => { const token = {}; timers.set(token, { fn, at: stamp + delay }); return token; },
        clearTimeoutImpl: token => timers.delete(token) });
    function tick(ms) {
        const until = stamp + ms;
        while (true) {
            const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            timers.delete(next[0]); stamp = next[1].at; next[1].fn();
        }
        stamp = until;
    }
    let sequence = 0;
    const queue = () => {
        const value = recap({ id: `delivery-${++sequence}`, at: stamp, verificationStatus: 'local',
            localModes: [{ mode: 'BEDWARS', games: 1, wins: 1, losses: 0 }] });
        value.delta = { local: true, modes: value.record.localModes };
        delivery.enqueue(value);
        return value;
    };
    const first = queue();
    assert.equal(sent.length, 0, 'Completion does not print inside the title/result packet handler');
    tick(2800);
    delivery.observeChat('§a+10 Slumber Tickets (Time Played)\n+90 tokens! (Win)');
    tick(200);
    assert.equal(sent.length, 0, 'Rewards extend the quiet period past the minimum delay');
    delivery.observeChat('TEAM ELIMINATED > Gray Team has been eliminated!');
    tick(1249); assert.equal(sent.length, 0);
    tick(1); assert.equal(sent.length, 1, 'Recap prints after the result block settles');
    assert.equal(delivery.enqueue(first), false, 'Duplicate callbacks cannot restart a printed recap');
    tick(1); queue();
    tick(2900); delivery.observeChat('[MVP+] Friend: hello');
    tick(100); assert.equal(sent.length, 2, 'Ordinary lobby chat does not keep postponing the recap');
    tick(1); queue(); runtime.gameGeneration++;
    tick(3000); assert.equal(sent.length, 2, 'Starting another match cancels the previous recap even if it ends quickly');
    tick(1); queue(); runtime.playing = true;
    tick(3000); assert.equal(sent.length, 2, 'A recap never interrupts an active game');
    runtime.playing = false;
    tick(1); queue(); runtime.enabled = false;
    tick(3000); assert.equal(sent.length, 2, 'Disabled output is rechecked at delivery');
    runtime.enabled = true;
    tick(1); queue(); runtime.sessionId = 'two';
    tick(3000); assert.equal(sent.length, 2, 'Session reset cancels pending output');
    tick(1); queue(); delivery.clear();
    assert.equal(timers.size, 0, 'Disconnect/settings cleanup removes the timer');
    tick(3000); assert.equal(sent.length, 2);
    tick(1); queue();
    for (let i = 0; i < 9; i++) { tick(1000); delivery.observeChat('+10 Slumber Tickets'); }
    tick(1000); assert.equal(sent.length, 2, 'A continuously busy result stream expires without printing in the middle');
    assert.equal(timers.size, 0, 'No timer or queued recap leaks after expiry');
}

(async () => {
    deliveryTiming();
    await lifecycle(true);
    await lifecycle(false);
    console.log('Automatic recaps: completed games, duplicate retries, stale/overlapping snapshots, reconnect, live-game suppression and local counters passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
