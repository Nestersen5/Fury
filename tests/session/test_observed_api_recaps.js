'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessionStore } = require('../../src/session/sessionStore');
const { createSessionTracker } = require('../../src/session/sessionTracker');
const { createAutomaticRecapGuard } = require('../../src/session/gameRecap');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory');

async function scenario({ unavailable = false, partial = false, overlap = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-observed-api-'));
    const file = path.join(dir, 'session.json');
    let stamp = 100000, losses = 10, kills = 20, fail = unavailable;
    const owner = { uuid: 'a'.repeat(32), name: 'Tester' };
    const timers = new Map();
    const recaps = [], announcements = [], verifications = [];
    const guard = createAutomaticRecapGuard({ now: () => stamp });
    const storeOptions = { sessionFile: file, now: () => stamp, saveDelayMs: 0,
        writeJsonOffThread: (target, data, _label, done) => {
            fs.writeFileSync(target, JSON.stringify(data));
            done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(target) });
        } };
    const store = createSessionStore(storeOptions);
    const tracker = createSessionTracker({ store, now: () => stamp, getIdentity: () => owner,
        isApiAvailable: () => true, fetchOwnStats: async () => {
            if (fail) throw new Error('simulated unavailable API');
            return { uuid: owner.uuid, displayname: owner.name, stats: { Bedwars: {
                losses_bedwars: losses, wins_bedwars: 5, kills_bedwars: kills, final_deaths_bedwars: losses,
                final_kills_bedwars: 2, beds_broken_bedwars: 1, beds_lost_bedwars: losses
            } } };
        }, logger: { error() {} },
        setTimeoutImpl: (fn, delay) => { const timer = { fn, at: stamp + delay, unref() {} }; timers.set(timer, timer); return timer; },
        clearTimeoutImpl: timer => timers.delete(timer),
        onGameRecap: recap => { recaps.push(recap); if (guard(recap)) announcements.push(recap); },
        onGameVerified: recap => verifications.push(recap)
    });
    const start = { mode: 'BEDWARS', ownTeam: 'Green', ownNames: ['Tester'], identityKnown: true,
        observedFromStart: !partial, standardBedwars: true, variant: 'Solos' };
    async function play(key) {
        await tracker.onGameStart({ ...start, sessionKey: key });
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        tracker.observeLocalChat('BED DESTRUCTION > Your Bed was gulped by Rival!', start);
        tracker.observeLocalChat('Tester was killed by Rival. FINAL KILL!', start);
        stamp += 60000;
        tracker.observeLocalChat('TEAM ELIMINATED > Green Team has been eliminated!', start);
        return tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: key, immediate: true, durationMs: 60000,
            metadata: { team: 'Green', map: 'Lighthouse', variant: 'Solos', observedFromStart: !partial },
            events: [{ type: 'team_eliminated', targetTeam: 'Green', at: stamp, source: 'chat', confidence: 'confirmed' }] });
    }
    try {
        const record = await play('one');
        assert.equal(record.result, 'loss');
        assert.equal(record.verificationStatus, 'pending');
        assert.equal(announcements.length, 1, 'Known completion prints without fresh API stats');
        assert.equal(recaps[0].delta.local, true);
        assert.equal(tracker.getSessionDelta().modes[0].games, 1);
        assert.equal(tracker.getSessionDelta().modes[0].losses, 1);
        if (partial) assert(!('kills' in recaps[0].delta.modes[0]), 'Unobserved coverage stays unknown');
        else assert.equal(recaps[0].delta.modes[0].kills, 1);
        assert.equal(record.metadata.map, 'Lighthouse');
        assert.equal(createSessionStore(storeOptions).getLastGame(owner.uuid).localModes[0].games, 1, 'Observed stats persist before verification');
        const history = buildLauncherSessionHistory(store.getHistory(owner.uuid), { now: stamp });
        assert.equal(history.sessions[0].modes[0].games, 1, 'Launcher totals immediately count the game');
        assert.equal(history.sessions[0].games[0].statsSource, 'local');
        assert.equal(history.sessions[0].games[0].stats.losses, 1);
        if (overlap) {
            await play('two');
            assert.equal(announcements.length, 2);
            losses += 2; kills += 7;
            await tracker.processPendingVerifications({ force: true });
            await tracker.processPendingVerifications({ force: true });
            assert(store.getSessions(owner.uuid)[0].games.every(game => !game.delta), 'Combined API movement is never assigned to either game');
            assert.equal(tracker.getSessionDelta().modes[0].games, 2);
            assert.equal(tracker.getSessionDelta().modes[0].kills, 2, 'Per-game observations remain separate');
            assert.equal(recaps.length, 2, 'Reconciliation never reprints recaps');
            stamp += 1000;
            const third = await play('three');
            losses++; kills++;
            for (let i = 0; i < 4 && store.getLastGame(owner.uuid).verificationStatus !== 'verified'; i++) {
                await tracker.processPendingVerifications({ force: true });
            }
            assert.equal(store.getLastGame(owner.uuid).id, third.id);
            assert.equal(store.getLastGame(owner.uuid).verificationStatus, 'verified', 'A later isolated game uses the refreshed boundary');
            assert.equal(tracker.getSessionDelta().modes[0].games, 3);
            assert.equal(recaps.length, 3);
        } else if (!unavailable) {
            // An unchanged response remains pending beyond the old four-minute
            // expiry. Exercise actual scheduled timers, not forced retries.
            const ended = stamp;
            while (true) {
                const timer = [...timers.values()].sort((a, b) => a.at - b.at)[0];
                assert(timer);
                if (timer.at - ended > 300000) break;
                timers.delete(timer); stamp = timer.at;
                await timer.fn();
                await new Promise(resolve => setImmediate(resolve));
            }
            assert.equal(store.getLastGame(owner.uuid).verificationStatus, 'pending', 'Five-minute stale snapshots do not exhaust verification');
            stamp = ended + 360000; losses++; kills += 2;
            await tracker.processPendingVerifications({ force: true });
            const verified = store.getLastGame(owner.uuid);
            assert.equal(verified.id, record.id);
            assert.equal(verified.verificationStatus, 'verified');
            assert.equal(recaps.length, 1);
            assert.equal(verifications.length, 1, 'Opt-in API diagnostics still receive reconciliation');
            assert.equal(tracker.getSessionDelta().modes[0].games, 1);
            assert.equal(tracker.getSessionDelta().modes[0].kills, 2, 'Attributable API stats reconcile the same game');
        } else {
            for (let i = 0; i < 6; i++) await tracker.processPendingVerifications({ force: true });
            assert.equal(store.getLastGame(owner.uuid).verificationStatus, 'unverified');
            assert.equal(tracker.getSessionDelta().modes[0].games, 1, 'API failure cannot erase completion');
            assert.equal(recaps.length, 1);
        }
        const freshGuard = createAutomaticRecapGuard({ now: () => stamp + 1 });
        assert(!freshGuard(recaps[0]), 'Reconnect cannot replay the completed game');
        await tracker.finish();
        await tracker.reset();
        await play('fresh-session');
        assert.equal(tracker.getSessionDelta().modes[0].games, 1, 'A new session resets completed-game progress');
        assert.equal(store.getSessions('b'.repeat(32)).length, 0, 'Observed stats stay scoped to their account');
        await tracker.onGameStart({ ...start, sessionKey: 'reset-mid-game' });
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        await tracker.reset();
        stamp += 60000;
        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000, immediate: true,
            events: [{ type: 'victory', at: stamp }] });
        assert.equal(tracker.getActiveSession().games.length, 0, 'A reset cannot import a match already underway into the new session');
    } finally {
        tracker.detach();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

(async () => {
    await scenario();
    await scenario({ partial: true });
    await scenario({ unavailable: true });
    await scenario({ overlap: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-observed-retention-'));
    try {
        const options = { sessionFile: path.join(dir, 'session.json'), maxGamesPerSession: 2,
            writeJsonOffThread: (file, data, _label, done) => {
                fs.writeFileSync(file, JSON.stringify(data));
                done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
            } };
        const store = createSessionStore(options);
        const session = store.startSession({ uuid: 'a'.repeat(32), at: 1000 });
        for (let i = 1; i <= 4; i++) store.appendGame(session.id, { at: i * 60000, durationMs: 59000,
            mode: 'BEDWARS', result: 'loss', verificationStatus: 'pending', metadata: { variant: 'Solos' },
            localModes: [{ mode: 'BEDWARS', losses: 1, wins: 0, games: 1, kills: 2 }] });
        assert.equal(store.findSession(session.id).games.length, 2, 'History retention remains bounded');
        assert.equal(store.getHistory()[0].delta.modes[0].games, 4, 'Retaining fewer game details never lowers goal progress');
        assert.equal(store.getHistory()[0].delta.modes[0].submodes[0].games, 4);
        store.flush();
        const reloaded = createSessionStore(options);
        assert.equal(reloaded.getHistory()[0].delta.modes[0].games, 4, 'Retained totals survive restart');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('Observed/API recaps: immediate results, goal/history totals, unavailable counters, persistence, delayed reconciliation and multi-game isolation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
