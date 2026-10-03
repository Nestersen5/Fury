'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createSessionStore } = require('../../src/session/sessionStore');
const { createSessionTracker } = require('../../src/session/sessionTracker');
const { isBedwarsPregameScoreboard, parseBedwarsPregameMap } = require('../../src/net/session/pregame_chat');
const { pregameLobbyIdForScoreboard, requeueCommandForScoreboard } = require('../../src/dodge/bedwarsQueue');

function checkScoreboardTransitions(proxy) {
    const transitions = [];
    let board = '';
    const context = vm.createContext({
        gameActive: true, currentGamemode: 'BEDWARS', activeMatchServerId: 'mini1A',
        gameStartTime: 1000000, activeSessionGameMetadata: { serverId: 'mini1A' },
        bedwarsPregameActive: false, bedwarsPregameLobbyId: null,
        bedwarsPregameLocalQueue: null, bedwarsPregameLocalUnsupported: false,
        getCurrentScoreboardText: () => board, getCurrentScoreboardTitle: () => 'BED WARS',
        getScoreboardLineList: () => [board], isBedwarsPregameScoreboard, parseBedwarsPregameMap,
        pregameLobbyIdForScoreboard, requeueCommandForScoreboard,
        lookingForTriggers: { isLobbyChange: () => false },
        autoDodger: { noteScoreboard() {} }, updateDuelsStateFromScoreboard: () => false,
        notePrivateSessionGame() {}, detectGamemodeFromText: () => 'BEDWARS',
        setCurrentGamemode: mode => { context.currentGamemode = mode; },
        detectLobbyFromScoreboard: () => null, updateLobbyStateFromScoreboard: () => false,
        isSupportedTabStatsMode: mode => mode === 'BEDWARS',
        updateActiveGameStateFromScoreboard: () => true,
        enterBedwarsPregame: lobbyId => {
            transitions.push({ lobbyId, previousServer: context.activeMatchServerId });
            context.gameActive = false;
            context.bedwarsPregameActive = true;
            context.bedwarsPregameLobbyId = lobbyId;
        }
    });
    for (const name of ['updateDetectedStateFromScoreboard', 'noteActiveMatchServerId', 'updateBedwarsPregameStateFromScoreboard']) {
        const start = proxy.indexOf(`        function ${name}(`);
        assert(start >= 0, name);
        const end = proxy.indexOf('\n        function ', start + 1);
        vm.runInContext(proxy.slice(start, end), context);
    }
    const waiting = id => `BED WARS 10/03/26 ${id} Map: Airshow Players: 15/16 Starting in 1s Mode: Doubles`;
    for (const id of ['mini1A', '', 'mini1A', '']) {
        board = waiting(id);
        context.updateDetectedStateFromScoreboard();
    }
    assert.equal(transitions.length, 0, 'Lingering waiting-room packets cannot finalize or requeue the live game');
    assert.equal(context.gameStartTime, 1000000, 'The original game start survives repeated sidebar updates');
    context.activeMatchServerId = null;
    board = waiting('mini1A');
    context.updateDetectedStateFromScoreboard();
    assert.equal(transitions.length, 0, 'Missing live server identity is not proof of a new queue');
    board = 'BED WARS 10/03/26 mini1A Diamond II in 4:20 Red: Alive Blue: Alive';
    context.updateDetectedStateFromScoreboard();
    assert.equal(context.activeMatchServerId, 'mini1A', 'An active sidebar can establish the live server identity');
    board = waiting('mini2B');
    context.updateDetectedStateFromScoreboard();
    assert.deepEqual(transitions, [{ lobbyId: 'mini2B', previousServer: 'mini1A' }],
        'A different server opens a queue without overwriting the game being finalized');
    assert.equal(context.activeSessionGameMetadata.serverId, 'mini1A');
    context.updateDetectedStateFromScoreboard();
    assert.equal(transitions.length, 1, 'Repeated queue packets do not open another queue');
    context.bedwarsPregameActive = false;
    context.activeMatchServerId = null;
    board = waiting('');
    context.updateDetectedStateFromScoreboard();
    assert.equal(transitions.length, 2, 'After a transfer reset, a queue can open before its server ID arrives');
}

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-bedwars-queue-'));
let stamp = 1000000;
const owner = { uuid: 'a'.repeat(32), name: 'Tester' };
const storeOptions = name => ({ sessionFile: path.join(folder, name), now: () => stamp,
    saveDelayMs: 0, writeJsonOffThread: (file, data, label, done) => {
        fs.writeFileSync(file, JSON.stringify(data));
        done(null, { version: 1,
            stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
    } });
const timers = { setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {} };
const start = { mode: 'BEDWARS', sessionKey: 'mini1:1000000', ownTeam: 'Aqua',
    ownNames: ['Tester'], observedFromStart: true, standardBedwars: true,
    identityKnown: true, variant: 'Doubles' };

(async () => {
    try {
        const store = createSessionStore(storeOptions('local.json'));
        const tracker = createSessionTracker({ store, now: () => stamp, getIdentity: () => owner,
            isApiAvailable: () => false, fetchOwnStats: async () => { throw Error('API must stay off'); },
            ...timers });
        await tracker.onGameStart(start);
        tracker.observeLocalChat('Rival was killed by Tester.', start);
        stamp += 60000;
        tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000 });
        assert(tracker.getActiveSession().localTracking.current.leftAt, 'leaving pauses the game');
        stamp += 10000;
        const ticket = tracker.onQueueStart({ mode: 'BEDWARS' });
        assert(ticket?.needsResult, 'a new queue closes the prior game and needs its outcome');
        let record = store.findSession(ticket.sessionId).games.at(-1);
        assert.equal(record.result, null);
        assert.equal(record.localModes[0].games, 1, 'a full game is counted at the next queue');
        assert.equal(tracker.getActiveSession().localTracking.current, null);
        stamp += 1000;
        await tracker.onGameStart({ ...start, sessionKey: 'mini2:1071000' });
        record = tracker.confirmPreviousGameResult({ result: 'win', localTicket: ticket });
        assert.equal(record.result, 'win', 'answer still works after the next game starts');
        assert.equal(record.resultSource, 'manual');
        assert.equal(record.localModes[0].wins, 1);
        assert.equal(tracker.getSessionDelta().modes[0].wins, 1);
        assert.equal(tracker.confirmPreviousGameResult({ result: 'loss', localTicket: ticket }), null,
            'the answer cannot be applied twice');
        tracker.detach();

        const apiStore = createSessionStore(storeOptions('api.json'));
        let apiStats = { wins_bedwars: 0, losses_bedwars: 0, games_played_bedwars: 0 };
        const apiTracker = createSessionTracker({ store: apiStore, now: () => stamp,
            getIdentity: () => owner, isApiAvailable: () => true, gameEndDelayMs: 0,
            fetchOwnStats: async () => ({ ...owner, stats: { Bedwars: apiStats } }), ...timers });
        await apiTracker.onGameStart({ mode: 'BEDWARS' });
        stamp += 60000;
        await apiTracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000,
            metadata: { serverId: 'mini3' } });
        let apiRecord = apiStore.findSession(apiTracker.getActiveSessionId()).games.at(-1);
        assert.equal(apiRecord.verificationStatus, 'pending');
        apiRecord = apiTracker.confirmPreviousGameResult({ result: 'loss', at: stamp,
            serverId: 'mini3' });
        assert.equal(apiRecord.resultSource, 'manual');
        apiStats = { wins_bedwars: 1, losses_bedwars: 0, games_played_bedwars: 1 };
        await apiTracker.processPendingVerifications({ force: true });
        apiRecord = apiStore.findSession(apiTracker.getActiveSessionId()).games.at(-1);
        assert.equal(apiRecord.verificationStatus, 'verified');
        assert.equal(apiRecord.result, 'win');
        assert.equal(apiRecord.resultSource, 'api', 'verified API outcome takes precedence');
        apiTracker.detach();

        const delayedStore = createSessionStore(storeOptions('delayed.json'));
        const delayedTracker = createSessionTracker({ store: delayedStore, now: () => stamp,
            getIdentity: () => owner, isApiAvailable: () => true,
            fetchOwnStats: async () => ({ ...owner, stats: { Bedwars: apiStats } }), ...timers });
        await delayedTracker.onGameStart({ mode: 'BEDWARS' });
        stamp += 60000;
        delayedTracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000,
            metadata: { serverId: 'mini4' } });
        const earlyAnswer = delayedTracker.confirmPreviousGameResult({ result: 'loss',
            at: stamp, serverId: 'mini4' });
        assert.equal(earlyAnswer.source, 'manual', 'answer can attach before API capture creates a record');
        await delayedTracker.quiesce();
        const delayedRecord = delayedStore.getSessions(owner.uuid).flatMap(session => session.games).at(-1);
        assert.equal(delayedRecord.result, 'loss');
        assert.equal(delayedRecord.resultSource, 'manual');

        const proxy = fs.readFileSync(path.join(__dirname, '../../proxy.js'), 'utf8');
        checkScoreboardTransitions(proxy);
        assert(proxy.includes("value: '/session result win'")
            && proxy.includes("value: '/session result loss'"), 'pregame prompt offers clickable results');
        assert(proxy.includes('bedwarsStatsDebug.onNewQueue()')
            && proxy.includes("sessionTracker.onQueueStart({ mode: 'BEDWARS' })"),
            'the prompt uses the confirmed waiting-room transition');
        console.log('BedWars queue result: previous game closure, late manual answer, API override and chat prompt passed.');
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
