'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createSessionTracker } = require('../../src/session/sessionTracker');
const { createSessionStore } = require('../../src/session/sessionStore');
const { isOwnTeamElimination } = require('../../src/session/gameResult');
const { parseGameEvents, normalizeGameEvent, eventSignature } = require('../../src/session/gameEvents');

// Exercise the actual proxy chat/finalization wiring without opening Minecraft
// sockets, using the real tracker and a temporary persistent store.
const proxySource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8');
function proxyFunction(name) {
    const start = proxySource.indexOf(`        function ${name}(`);
    assert(start >= 0, name);
    const end = proxySource.indexOf('\n        function ', start + 1);
    return proxySource.slice(start, end);
}

async function run(apiAvailable) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-elimination-'));
    const sessionFile = path.join(folder, 'sessions.json');
    let stamp = 100000, fetches = 0;
    const uuid = 'a'.repeat(32);
    let stats = { losses_bedwars: 10, final_kills_bedwars: 20, final_deaths_bedwars: 10 };
    const options = { sessionFile, now: () => stamp, saveDelayMs: 0,
        writeJsonOffThread: (file, data, label, done) => {
            fs.writeFileSync(file, JSON.stringify(data));
            done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
        } };
    const store = createSessionStore(options);
    const timers = new Map(); let timerId = 0;
    const tracker = createSessionTracker({ store, now: () => stamp,
        getIdentity: () => ({ uuid, name: 'Tester' }), isApiAvailable: () => apiAvailable,
        fetchOwnStats: async () => { fetches++; return { uuid, displayname: 'Tester', stats: { Bedwars: stats } }; },
        setTimeoutImpl: (fn, delay) => { timers.set(++timerId, { fn, at: stamp + delay }); return timerId; },
        clearTimeoutImpl: id => timers.delete(id) });
    const start = { mode: 'BEDWARS', sessionKey: 'server:100000', ownTeam: 'Aqua',
        observedFromStart: true, standardBedwars: true, identityKnown: true };
    await tracker.onGameStart(start);
    const context = vm.createContext({
        console, Promise, Date: { now: () => stamp }, state: { sessionTrackingEnabled: true },
        gameActive: true, gameStartTime: stamp, gameSessionId: 1, currentGamemode: 'BEDWARS',
        activeMatchServerId: 'server', sessionGameFinalized: false, localDuelKey: null,
        activeSessionGameEvents: [], activeSessionGameMetadata: {}, sessionTracker: tracker,
        normalizeGameEvent, eventSignature, parseGameEvents, isOwnTeamElimination,
        client: { username: 'Tester' }, getOwnKnownNames: () => ['Tester'],
        localSessionIdentity: () => ({ ownNames: ['Tester'], identityKnown: true }),
        buildSessionGameMetadata: () => ({ team: 'Aqua', observedFromStart: true }),
        resolveBedwarsTeamName: name => name === 'Tester' ? 'Aqua' : 'Red',
        detectKillMessageOwner: () => null,
        buildSessionRosterSnapshot: () => [{ name: 'Tester', team: 'Aqua', relation: 'self' }],
        saveCurrentMatchSnapshot: () => {}
    });
    vm.runInContext(['appendSessionGameEvent', 'observeSessionGameChat', 'finalizeSessionGame'].map(proxyFunction).join('\n'), context);
    const chat = text => context.observeSessionGameChat(text);
    const session = () => store.findSession(tracker.getActiveSessionId());

    stamp += 5000;
    chat('Enemy was killed by Tester. FINAL KILL!');
    chat('Tester was killed by Enemy. FINAL KILL!');
    assert.equal(session().games.length, 0, 'A personal final death does not finalize the team result');
    chat('TEAM ELIMINATED > Red Team has been eliminated!');
    chat('Friend: TEAM ELIMINATED > Aqua Team has been eliminated!');
    assert.equal(session().games.length, 0, 'Other teams and player chat cannot end our game');

    stamp += 5000;
    chat('TEAM ELIMINATED > Aqua Team has been eliminated!');
    assert.equal(context.sessionGameFinalized, true);
    assert.equal(session().games.length, 1, 'Confirmed elimination saves even a game shorter than 30 seconds');
    const record = session().games[0];
    assert.equal(record.result, 'loss');
    assert.equal(record.durationMs, 10000);
    assert.equal(record.at, stamp);
    assert(record.events.some(event => event.type === 'final_kill' && event.actor === 'Tester'));
    assert.equal(JSON.parse(fs.readFileSync(sessionFile)).sessions[0].games.length, 1, 'Record is flushed immediately');
    const savedId = record.id;
    const eventCount = record.events.length;
    stamp += 120000;
    chat('TEAM ELIMINATED > Aqua Team has been eliminated!');
    chat('Spectator was killed by Enemy. FINAL KILL!');
    context.finalizeSessionGame();
    assert.equal(session().games.length, 1);
    assert.equal(session().games[0].durationMs, 10000, 'Spectating/leaving does not extend duration');
    assert.equal(session().games[0].events.length, eventCount);
    if (apiAvailable) {
        assert.equal(fetches, 1, 'Saving does not fetch ahead of the verification delay');
        assert.equal(record.verificationStatus, 'pending');
        assert.equal(record.verificationAttempts, 0);
        assert.equal(record.nextVerificationAt, record.at + 15000);
        const pendingReload = createSessionStore(options).getPendingGames()[0];
        assert.equal(pendingReload.game.id, savedId, 'Pending verification survives a reload');
        assert(pendingReload.game.verificationBaseline);
        await tracker.onGameStart({ ...start, sessionKey: 'next-game' });
        stats = { ...stats, final_kills_bedwars: 21, final_deaths_bedwars: 11 };
        await tracker.processPendingVerifications({ force: true });
        assert.equal(session().games[0].verificationStatus, 'pending', 'Partial API publication must wait for the loss');
        stats = { ...stats, losses_bedwars: 11 };
        await tracker.processPendingVerifications({ force: true });
        assert.equal(session().games.length, 1);
        assert.equal(session().games[0].id, savedId, 'Verification updates the original record');
        assert.equal(session().games[0].verificationStatus, 'verified');
        assert.equal(session().games[0].delta.stats.Bedwars.losses_bedwars, 1);
        assert.equal(session().games[0].durationMs, 10000);
    } else {
        assert.equal(fetches, 0);
        assert.equal(record.verificationStatus, 'local');
        assert.equal(record.localModes[0].finals, 1);
        assert.equal(record.localModes[0].finalDeaths, 1);
        assert.equal(record.localModes[0].losses, 1);
        assert.equal(session().localTracking.current, null);
    }
    tracker.detach();
    const reloaded = createSessionStore(options);
    assert.equal(reloaded.getSessions()[0].games[0].id, savedId);
    await tracker.onGameStart({ ...start, sessionKey: 'next-game' });
    assert(tracker.getActiveSessionId(), 'Next game can start normally');
    tracker.detach();
    fs.rmSync(folder, { recursive: true, force: true });
}

(async () => {
    await run(true);
    await run(false);
    assert(isOwnTeamElimination({ type: 'team_eliminated', targetTeam: 'Gray' }, 'BEDWARS', 'Grey'));
    assert(!isOwnTeamElimination({ type: 'team_eliminated', targetTeam: 'Aqua' }, 'BEDWARS', null));
    console.log('Team elimination: immediate persistence, API verification, local stats, duration and duplicate protection passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
