const assert = require('assert');
const os = require('os');
const path = require('path');

const { createSessionStore } = require('../../src/session/sessionStore.js');
const { createSessionTracker } = require('../../src/session/sessionTracker.js');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory.js');
const {
    SESSION_DEFAULTS,
    normalizeSessionFeatureSettings
} = require('../../src/session/settings.js');

const UUID = 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa';

function sessionFile(label) {
    return path.join(os.tmpdir(), `fury_session_enhancements_${label}_${process.pid}_${Date.now()}.json`);
}

function player({ wins = 100, losses = 50, finals = 400, games = 150 } = {}) {
    return {
        player: {
            uuid: UUID,
            displayname: 'Tester',
            networkExp: 1000000,
            karma: 5000,
            achievements: { bedwars_level: 100 },
            stats: {
                Bedwars: {
                    wins_bedwars: wins,
                    losses_bedwars: losses,
                    final_kills_bedwars: finals,
                    final_deaths_bedwars: 200,
                    beds_broken_bedwars: 120,
                    beds_lost_bedwars: 60,
                    kills_bedwars: 900,
                    deaths_bedwars: 700,
                    games_played_bedwars: games,
                    Experience: 500000
                }
            }
        }
    };
}

function snapshot(at, wins = 0) {
    return {
        at,
        uuid: UUID,
        name: 'Tester',
        networkExp: 0,
        karma: 0,
        achievements: {},
        stats: { Bedwars: { wins_bedwars: wins } }
    };
}

function createStore({ now, getMaxSessions = null } = {}) {
    return createSessionStore({
        sessionFile: sessionFile('store'),
        writeJsonOffThread: () => {},
        now,
        getMaxSessions,
        saveDelayMs: 0,
        logger: { error: () => {} }
    });
}

(async () => {
    {
        const normalized = normalizeSessionFeatureSettings({
            sessionBoundaryMinutes: 45,
            sessionRetention: 250,
            sessionRecapStyle: 'custom',
            sessionRecapFields: ['result', 'goals', 'result', 'bad'],
            sessionBedwarsFields: ['wins', 'fkdr', 'bad'],
            sessionGoalWins: -2,
            sessionGoalMinutes: 99999
        });
        assert.strictEqual(normalized.sessionBoundaryMinutes, SESSION_DEFAULTS.sessionBoundaryMinutes);
        assert.strictEqual(normalized.sessionRetention, 0, 'legacy retention choices migrate to unlimited');
        assert.strictEqual(normalizeSessionFeatureSettings({sessionBoundaryMinutes:180}).sessionBoundaryMinutes, 30, 'legacy inactivity choices migrate to 30 minutes');
        assert.strictEqual(normalized.sessionRecapStyle, 'custom');
        assert.deepStrictEqual(normalized.sessionRecapFields, ['result', 'goals']);
        assert.deepStrictEqual(normalized.sessionBedwarsFields, ['wins', 'fkdr']);
        assert.strictEqual(normalized.sessionGoalWins, 0);
        assert.strictEqual(normalized.sessionGoalMinutes, 10080);
        assert.strictEqual(normalizeSessionFeatureSettings({ sessionRetention: 0 }).sessionRetention, 0, 'zero retention means Infinite');
    }

    {
        let stamp = 5000;
        const store = createStore({ now: () => stamp, getMaxSessions: () => 0 });
        for (let index = 0; index < 6; index += 1) store.startSession(snapshot(stamp++, index));
        assert.strictEqual(store.getSessions().length, 6, 'Infinite retention must not trim local sessions');
    }

    {
        let stamp = 1000;
        let retention = 2;
        const store = createStore({ now: () => stamp, getMaxSessions: () => retention });
        store.startSession(snapshot(stamp++, 1));
        store.startSession(snapshot(stamp++, 2));
        store.startSession(snapshot(stamp++, 3));
        assert.strictEqual(store.getSessions().length, 2, 'dynamic retention should trim old sessions');

        stamp += 60001;
        assert.strictEqual(store.closeExpiredSessions(60000), 2, 'inactive sessions should close automatically');
        assert(store.getSessions().every(session => session.endedAt > 0 && !session.baseline));
        retention = 1;
        store.startSession(snapshot(stamp, 4));
        assert.strictEqual(store.getSessions().length, 1, 'new retention should apply without recreating the store');
    }

    {
        let stamp = 100000;
        const timers = [];
        const store = createStore({ now: () => stamp });
        const lifecycleRows = [player(), player({ wins: 101, games: 151 })];
        let fetches = 0;
        const tracker = createSessionTracker({
            store,
            now: () => stamp,
            getResumeWindowMs: () => 60000,
            gameEndDelayMs: 0,
            minGameDurationMs: 0,
            fetchOwnStats: async () => {
                fetches += 1;
                return lifecycleRows.shift() || player({ wins: 101, games: 151 });
            },
            setTimeoutImpl: (callback, delay) => {
                const timer = { callback, delay, active: true, unref: () => {} };
                timers.push(timer);
                return timer;
            },
            clearTimeoutImpl: timer => { if (timer) timer.active = false; },
            logger: { error: () => {}, warn: () => {} }
        });

        assert.strictEqual(store.getSessions().length, 0, 'opening the tracker must not create an automatic session');
        assert.strictEqual(fetches, 0, 'idle launcher/lobby time must not request a session baseline');
        assert.strictEqual(await tracker.onQueueStart({ mode: 'LOBBY' }), null, 'non-game lobbies are not queue boundaries');
        assert.strictEqual(fetches, 0);

        const id = await tracker.onQueueStart({ mode: 'BEDWARS' });
        assert(id, 'the first confirmed supported queue should start a session automatically');
        assert.strictEqual(store.findSession(id).startedAt, stamp, 'session time begins at the queue boundary');
        assert.strictEqual(fetches, 1, 'the first queue captures exactly one baseline');

        stamp += 5000;
        const gameSessionId = await tracker.onGameStart({ mode: 'BEDWARS' });
        assert.strictEqual(gameSessionId, id, 'game activation must reuse the queue-started session');
        assert.strictEqual(fetches, 1, 'game activation must not fetch a second baseline');
        stamp += 60000;
        await tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000, sessionKey: 'boundary-game' });
        const boundaryTimer = timers.find(timer => timer.active && timer.delay === 60000);
        assert(boundaryTimer, 'an inactivity boundary should be scheduled');
        stamp += 60001;
        boundaryTimer.callback();
        assert.strictEqual(tracker.getActiveSessionId(), null, 'the inactivity boundary should end the session');
        assert(store.findSession(id).endedAt > 0);
        tracker.detach();
    }

    {
        let stamp = 200000;
        const rows = [
            player(),
            player(),
            player({ wins: 101, finals: 401, games: 151 })
        ];
        const recaps = [];
        const store = createStore({ now: () => stamp });
        const tracker = createSessionTracker({
            store,
            now: () => stamp,
            gameEndDelayMs: 0,
            minGameDurationMs: 0,
            minRefreshIntervalMs: 0,
            verificationRetryDelaysMs: [1, 1],
            fetchOwnStats: async () => rows.shift() || player({ wins: 101, finals: 401, games: 151 }),
            setTimeoutImpl: (callback, delay) => ({ callback, delay, unref: () => {} }),
            clearTimeoutImpl: () => {},
            onGameRecap: recap => recaps.push(recap),
            logger: { error: () => {}, warn: () => {} }
        });

        await tracker.onGameStart({ mode: 'BEDWARS' });
        stamp += 60000;
        const pending = await tracker.onGameEnd({
            mode: 'BEDWARS',
            durationMs: 60000,
            sessionKey: 'game-1',
            roster: [{ name: 'Rival', uuid: 'bbbbbbbbbbbb4bbbbbbbbbbbbbbbbbbb' }]
        });
        assert.strictEqual(pending.verificationStatus, 'pending', 'an unchanged game-end snapshot should be retried');
        assert.strictEqual(store.getPendingGames().length, 1);

        stamp += 1;
        const verified = await tracker.processPendingVerifications({ force: true });
        assert.strictEqual(verified.verificationStatus, 'verified');
        assert.strictEqual(verified.result, 'win');
        assert.strictEqual(store.getPendingGames().length, 0);
        assert.strictEqual(recaps.length, 1, 'a successful retry should emit the delayed recap once');

        const history = buildLauncherSessionHistory(store.getHistory(UUID), {
            now: stamp,
            encounterLookup: name => name === 'Rival' ? { games: 4, wins: 3, lastSeen: stamp - 1000 } : null,
            sessionSettings: {
                sessionGoalWins: 1,
                sessionGoalFinals: 1,
                sessionGoalGames: 1,
                sessionBedwarsFields: ['wins', 'finals', 'fkdr']
            }
        });
        assert(history.live, 'the launcher projection should expose the live session');
        assert.strictEqual(history.live.metrics.pendingGames, 0);
        assert.strictEqual(history.goals.length, 3);
        assert(history.goals.every(goal => goal.complete), 'verified stats should update live goals');
        assert.strictEqual(history.live.games[0].opponentDetails[0].encounter.games, 4);
        assert.strictEqual(history.trends.wins.length, 1);
        tracker.detach();
    }

    console.log('test_session_enhancements.js: all assertions passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
