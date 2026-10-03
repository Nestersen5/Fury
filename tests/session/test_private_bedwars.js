'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { isPrivateBedwarsScoreboard, pregameLobbyIdForScoreboard } = require('../../src/dodge/bedwarsQueue');
const { createSessionStore } = require('../../src/session/sessionStore');
const { createSessionTracker } = require('../../src/session/sessionTracker');
const { localModes } = require('../../src/session/localTracking');

const privateBoard = 'BED WARS §710/03/26 §8m1🔮8K§8[P] Diamond II in 5:56';
assert(isPrivateBedwarsScoreboard(privateBoard));
assert.equal(pregameLobbyIdForScoreboard(privateBoard), 'm18K');
for (const board of ['BED WARS 10/03/26 m18K Map: Cascade Players: 2/2',
    'BED WARS 10/03/26 m18K Player: [P] Tester', 'BED WARS [P]',
    'BED WARS 10/03/26 m18K[PUBLIC]']) assert(!isPrivateBedwarsScoreboard(board), board);

const source = fs.readFileSync(path.resolve(__dirname, '../../proxy.js'), 'utf8');
const begin = source.indexOf('        function notePrivateSessionGame(');
const end = source.indexOf('\n        function ', begin + 1);
const detectorSource = source.slice(begin, end);

async function run(apiAvailable) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-private-bedwars-'));
    let stamp = 1000000, fetches = 0;
    let wins = 10, kills = 20;
    const timers = new Map(); let timerId = 0;
    const uuid = 'a'.repeat(32);
    const store = createSessionStore({ sessionFile: path.join(directory, 'sessions.json'),
        now: () => stamp, saveDelayMs: 0,
        writeJsonOffThread(file, data, label, done) {
            fs.writeFileSync(file, JSON.stringify(data));
            done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
        } });
    const trackerOptions = { store, now: () => stamp,
        getIdentity: () => ({ uuid, name: 'Tester' }), isApiAvailable: () => apiAvailable,
        minGameDurationMs: 0, gameEndDelayMs: 0,
        fetchOwnStats: async () => { fetches++; return { uuid, displayname: 'Tester', stats: {
            Bedwars: { wins_bedwars: wins, kills_bedwars: kills, games_played_bedwars: wins }
        } }; },
        setTimeoutImpl: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeoutImpl: id => timers.delete(id) };
    let tracker = createSessionTracker(trackerOptions);
    const start = { mode: 'BEDWARS', ownTeam: 'Red', ownName: 'Tester',
        observedFromStart: true, standardBedwars: true, identityKnown: true };
    const session = () => tracker.getActiveSession();
    async function publicGame(key) {
        await tracker.onGameStart({ ...start, sessionKey: key });
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        tracker.observeLocalResult('VICTORY!');
        stamp += 60000; wins++; kills++;
        await tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: key, durationMs: 60000 });
    }
    try {
        await publicGame('public-1');
        assert.equal(session().games.length, 1);
        const priorLocal = JSON.stringify(session().localTracking?.totals);
        const priorStreaks = JSON.stringify(session().localTracking?.streaks);
        // Exclude while an API baseline may still be in flight, or after a
        // locally observed kill has already contributed provisional counters.
        const starting = tracker.onGameStart({ ...start, sessionKey: 'private' });
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        let board = 'BED WARS 10/03/26 m18K Players: 2/2';
        let discarded = 0, snapshot = null;
        const context = vm.createContext({ gameActive: true, currentGamemode: 'BEDWARS',
            activeSessionGameMetadata: { serverId: 'm18K' }, sessionGameFinalized: false,
            activeSessionGameEvents: [{ type: 'kill' }], sessionTracker: tracker,
            getCurrentScoreboardText: () => board, isPrivateBedwarsScoreboard,
            bedwarsStatsDebug: { discardCurrentGame: () => discarded++ },
            saveCurrentMatchSnapshot: () => { snapshot = { ...context.activeSessionGameMetadata }; } });
        vm.runInContext(detectorSource, context);
        context.notePrivateSessionGame();
        assert.equal(discarded, 0, 'Pregame is not classified private');
        board = privateBoard;
        context.currentGamemode = 'DUELS';
        context.notePrivateSessionGame();
        assert.equal(discarded, 0, 'Duels is unaffected');
        context.currentGamemode = 'BEDWARS';
        context.notePrivateSessionGame();
        await starting;
        assert.equal(discarded, 1);
        assert(snapshot.privateGame, 'Reconnect snapshot remembers exclusion');
        assert(context.sessionGameFinalized);
        assert.equal(context.activeSessionGameEvents.length, 0);
        board = 'BED WARS 10/03/26 m18K';
        context.notePrivateSessionGame();
        assert(context.activeSessionGameMetadata.privateGame, 'Missing marker does not undo exclusion');
        const beforeEndFetches = fetches;
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        tracker.observeLocalResult('VICTORY!');
        stamp += 60000;
        for (let i = 0; i < 2; i++) await tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: 'private', durationMs: 60000 });
        assert.equal(fetches, beforeEndFetches, 'Excluded ends do not fetch or verify');
        assert.equal(session().games.length, 1);
        assert.equal(store.getPendingGames().length, 0);
        if (!apiAvailable) {
            assert.equal(session().localTracking.current, null);
            assert.equal(JSON.stringify(session().localTracking.totals), priorLocal);
            assert.equal(JSON.stringify(session().localTracking.streaks), priorStreaks);
        }
        // A new proxy connection restores the match snapshot and reapplies
        // exclusion before chat can implicitly start a local game.
        await tracker.quiesce();
        tracker = createSessionTracker(trackerOptions);
        if (snapshot.privateGame) tracker.excludeCurrentGame();
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        tracker.observeLocalResult('VICTORY!');
        await tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: 'rejoined-private', durationMs: 60000 });
        assert.equal(store.getSessions(uuid)[0].games.length, 1, 'Rejoin stays excluded');
        await tracker.onQueueStart({ mode: 'BEDWARS' });
        assert.equal(store.getSessions(uuid)[0].games.length, 1, 'Queue cannot settle the excluded game');
        await publicGame('public-2');
        assert.equal(session().games.length, 2, 'Next public match records normally');
        if (!apiAvailable) {
            const totals = localModes(session().localTracking)[0];
            assert.equal(totals.kills, 2);
            assert.equal(totals.wins, 2);
        } else {
            assert.equal(session().games[1].delta.stats.Bedwars.kills_bedwars, 1);
        }
        await tracker.quiesce();
        assert.equal(store.getSessions(uuid)[0].games.length, 2, 'Disconnect does not restore excluded data');
    } finally {
        store.flush();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
(async () => {
    await run(false);
    await run(true);
    console.log('Private Bed Wars exclusion tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
