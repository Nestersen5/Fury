'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createGame, observe, localModes } = require('../../src/session/localTracking');
const { createSessionStore } = require('../../src/session/sessionStore');
const { createSessionTracker } = require('../../src/session/sessionTracker');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory');
const { stats: cardStats } = require('../../src/launcher/renderer/launcher_session_card');

const start = { mode: 'BEDWARS', sessionKey: 'game-1', key: 'game-1', ownName: 'Tester', ownTeam: 'Aqua',
    observedFromStart: true, standardBedwars: true, identityKnown: true, startedAt: 1000 };
const game = createGame(start);
for (const message of ['Party > Friend: VICTORY!', '[MVP+] Rival: BED DESTRUCTION > Your Bed was destroyed by Tester!',
    'Tester fell into the void.', 'Rival was killed by Tester.', 'VICTORY!', 'GAME OVER!']) observe(game, message);
assert.equal(localModes({current:game})[0].kills,1);assert.equal(localModes({current:game})[0].deaths,1);
assert.equal(localModes({current:game})[0].games,0,'Chat observation alone does not invent a result');
for (let repeat = 0; repeat < 2; repeat++) {
    observe(game, 'Rival was killed by Tester. FINAL KILL!');
    observe(game, "Enemy was Tester's final #42. FINAL KILL!");
    observe(game, 'BED DESTRUCTION > Red Bed was destroyed by Tester!');
    observe(game, 'BED DESTRUCTION > Your Bed was destroyed by Enemy!');
    observe(game, 'BED DESTRUCTION > Aqua Bed was destroyed by Enemy!');
}
assert.equal(localModes({current:game})[0].finals,2);assert.equal(localModes({current:game})[0].beds,1);assert.equal(localModes({current:game})[0].bedsLost,1);
observe(game, 'Other vanished mysteriously. FINAL KILL!');
assert(!('finals' in localModes({ current: game })[0]), 'Unknown final format removes the total instead of reporting a partial number');
assert.strictEqual(localModes({ current: game })[0].beds, 1);
observe(game, 'BED DESTRUCTION > Red Bed disappeared mysteriously!');
assert(!cardStats(localModes({current:game})[0]).some(x=>['finals','beds','bedsLost','fkdr','bblr'].includes(x.key)));
assert.strictEqual(cardStats(localModes({current:createGame({...start,observedFromStart:false})})[0]).length,0);
for(const patch of [{standardBedwars:false},{mode:'DUELS'}])assert(!('finals'in localModes({current:createGame({...start,...patch})})[0]));
const automaticBeds = createGame(start);
observe(automaticBeds, 'All beds have been destroyed!');
assert(!('bblr'in localModes({current:automaticBeds})[0]));assert.equal(localModes({current:automaticBeds})[0].finals,0);
// Nicked play counts under the live nick; an unplaced nick stays unknown.
const nicked = createGame({ ...start, ownNames: ['Tester', 'NickName'] });
observe(nicked, 'Rival was killed by NickName. FINAL KILL!', { ownNames: ['NickName'] });
observe(nicked, 'BED DESTRUCTION > Red Bed was destroyed by NickName!', { ownNames: ['NickName'] });
observe(nicked, 'Enemy was killed by NickName.', { ownNames: ['NickName'] });
observe(nicked, 'NickName was killed by Enemy.', { ownNames: ['NickName'] });
assert.deepStrictEqual([localModes({current:nicked})[0].finals,localModes({current:nicked})[0].beds,localModes({current:nicked})[0].kills,localModes({current:nicked})[0].deaths],[1,1,1,1]);
const lateNick = createGame(start);
observe(lateNick, 'Rival was killed by LateNick. FINAL KILL!', { ownNames: ['LateNick'] });
assert.equal(localModes({current:lateNick})[0].finals, 1, 'A nick placed mid-game joins the own names');
const unplaced = createGame({ ...start, identityKnown: false });
observe(unplaced, 'Rival was killed by NickName. FINAL KILL!', { identityKnown: false });
assert(!('finals' in localModes({ current: unplaced })[0]) && !('kills' in localModes({ current: unplaced })[0]));
assert.deepStrictEqual(require('../../src/session/localStats').normalizeLocal({ current: { ...start, mode: 'BEDWARS', ownName: 'Tester' } }).current.ownNames, ['tester'], 'Older saves keep their single own name');

(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-local-sessions-'));
    const sessionFile = path.join(folder, 'sessions.json');
    let stamp = 1000000, apiAvailable = false, calls = 0;
    const account = { uuid: 'a'.repeat(32), name: 'Tester' };
    const timers = new Map(); let timerId = 0;
    const storeOptions = { sessionFile, now: () => stamp, saveDelayMs: 0, maxGamesPerSession: 1,
        writeJsonOffThread: (file, data, label, done) => {
            fs.writeFileSync(file, JSON.stringify(data));
            done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
        } };
    let store = createSessionStore(storeOptions);
    const options = { getIdentity: () => account, now: () => stamp, isApiAvailable: () => apiAvailable,
        minGameDurationMs: 0, gameEndDelayMs: 0,
        setTimeoutImpl: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeoutImpl: id => timers.delete(id),
        fetchOwnStats: async () => { calls++; return { uuid: account.uuid, displayname: account.name,
            stats: { Bedwars: { final_kills_bedwars: 10000 + calls, beds_broken_bedwars: 2000 } } }; } };
    let tracker = createSessionTracker({ ...options, store });
    await tracker.onQueueStart(start); assert.strictEqual(store.getSessions().length, 0);
    await tracker.onGameStart(start);
    assert.strictEqual(calls, 0);
    tracker.observeLocalChat('Rival was killed by Tester. FINAL KILL!', start);
    tracker.observeLocalChat('BED DESTRUCTION > Red Bed was destroyed by Tester!', start);
    stamp += 60000;
    tracker.observeLocalResult('VICTORY!');
    await tracker.onGameEnd({ ...start, durationMs: 60000 });
    await tracker.onGameEnd({ ...start, durationMs: 60000 });
    await tracker.refresh({ force: true }); await tracker.processPendingVerifications({ force: true });
    assert.strictEqual(calls, 0, 'API-off play and forced refresh/retries must not fetch');
    assert.strictEqual(store.getPendingGames().length, 0);
    const localId = tracker.getActiveSessionId();
    let history = buildLauncherSessionHistory(store.getHistory(), { now: stamp, account, accountScoped: true });
    assert.equal(history.live.modes[0].finals,1);assert.equal(history.live.modes[0].beds,1);assert.equal(history.live.modes[0].wins,1);
    assert.equal(history.live.metrics.wins,1);assert.equal(history.live.metrics.games,1);assert.equal(history.live.metrics.fkdr,1);
    assert.strictEqual(history.summary.wins,1);assert.strictEqual(history.trends.fkdr[0].value,1);
    assert(cardStats(history.live.modes[0]).some(x=>x.key==='localStreak'));
    assert.strictEqual(buildLauncherSessionHistory(store.getHistory(), { account: { uuid: 'b'.repeat(32), name: 'Other' }, accountScoped: true }).sessions.length, 0);
    tracker.detach();
    store = createSessionStore(storeOptions); tracker = createSessionTracker({ ...options, store });
    await tracker.onGameStart({ ...start, sessionKey: 'game-2' });
    assert.strictEqual(tracker.getActiveSessionId(), localId, 'Resume the account-owned local session from disk');
    tracker.observeLocalChat('Rival was killed by Tester. FINAL KILL!', start);
    stamp += 60000; tracker.observeLocalResult('GAME OVER!'); await tracker.onGameEnd({ ...start, durationMs: 60000 });
    assert.strictEqual(tracker.getSessionDelta().modes[0].finals, 2, 'A new match can credit the same victim once again');
    assert.strictEqual(tracker.getActiveSession().games.length, 1, 'Pruning game records must not lose aggregate counters');
    await tracker.finish();
    assert.strictEqual(store.getHistory()[0].delta.modes[0].finals, 2);
    store = createSessionStore(storeOptions);
    assert.strictEqual(store.getHistory()[0].delta.modes[0].finals, 2, 'Closed local summaries survive normalization');

    tracker = createSessionTracker({ ...options, store });
    stamp += 100; await tracker.onGameStart({ ...start, sessionKey: 'zero' });
    stamp += 60000; tracker.observeLocalResult('VICTORY!'); await tracker.onGameEnd({ ...start, durationMs: 60000 }); await tracker.finish();
    assert(store.getHistory().some(entry=>entry.delta.local&&entry.delta.modes[0]?.finals===0&&entry.delta.modes[0]?.wins===1),'A confirmed win is retained even with no finals or beds');
    stamp += 100; await tracker.onGameStart({ ...start, sessionKey: 'interrupted' });
    tracker.observeLocalChat('Rival was killed by Tester. FINAL KILL!', start); stamp += 5000; tracker.detach();
    const interrupted = store.getHistory()[0];
    assert(interrupted.session.localTracking.current.leftAt > 0, 'Disconnecting mid-BedWars pauses the game for a rejoin');
    assert.strictEqual(interrupted.delta.modes[0].finals, 1, 'Counters seen before leaving are kept');
    assert(!('wins' in interrupted.delta.modes[0]) && !('finalDeaths' in interrupted.delta.modes[0]), 'A paused game claims no result or bed outcome');
    assert.strictEqual(calls, 0);

    apiAvailable = true; tracker = createSessionTracker({ ...options, store });
    stamp += 100; await tracker.onGameStart(start);
    const apiId = tracker.getActiveSessionId(); assert.notStrictEqual(apiId, interrupted.session.id);
    stamp += 60000; await tracker.onGameEnd({ ...start, durationMs: 60000 });
    assert.strictEqual(tracker.getSessionDelta().stats.Bedwars.final_kills_bedwars, 1, 'Returning API data must not turn lifetime counters into local gains');
    apiAvailable = false; tracker.refreshSettings();
    tracker.observeLocalChat('Rival was killed by Tester. FINAL KILL!', start);
    assert.notStrictEqual(tracker.getActiveSessionId(), apiId);
    assert.strictEqual(cardStats(tracker.getSessionDelta().modes[0]).length, 0, 'Switching mid-game cannot claim full coverage');
    const countAtDisable = calls; await tracker.refresh({ force: true });
    assert.strictEqual(calls, countAtDisable);
    tracker.detach();

    // Ambiguous own identity must persist even when the triggering message
    // itself contains no stat. It cannot silently turn a missing nick into zero.
    tracker = createSessionTracker({ ...options, store });
    await tracker.ensureSession(); await tracker.finish(); stamp += 100;
    await tracker.onGameStart({ ...start, sessionKey: 'nick-change' });
    tracker.observeLocalChat('Ordinary server notice', { ...start, identityKnown: false });
    assert(!('finals'in tracker.getSessionDelta().modes[0]));assert.equal(tracker.getSessionDelta().modes[0].bedsLost,0);
    stamp += 60000; tracker.observeLocalResult('VICTORY!');
    await tracker.onGameEnd({ ...start, durationMs: 60000 });
    const idleSession = tracker.getActiveSession();
    stamp += 4 * 3600000;
    for (const [key, callback] of [...timers]) { timers.delete(key); callback(); }
    assert.strictEqual(store.findSession(idleSession.id).endedAt, idleSession.lastSeen, 'Idle timeout closes at last observation, not hours later');
    tracker.detach();

    apiAvailable = true; let resolveLate;
    tracker = createSessionTracker({ ...options, store,
        fetchOwnStats: () => new Promise(resolve => { resolveLate = resolve; }) });
    const waitingForApi = tracker.onGameStart(start);
    apiAvailable = false; tracker.refreshSettings(); stamp += 100;
    await tracker.onGameStart({ ...start, sessionKey: 'after-api-disable' });
    const newLocalId = tracker.getActiveSessionId();
    resolveLate({ uuid: account.uuid, displayname: account.name, stats: { Bedwars: { final_kills_bedwars: 99999 } } });
    await waitingForApi;
    assert.strictEqual(tracker.getActiveSessionId(), newLocalId);
    assert(!store.findSession(newLocalId).endedAt, 'A late API response cannot close or overwrite the new local session');
    assert.strictEqual(tracker.getSessionDelta().modes[0].finals, 0);
    tracker.detach();

    // Write-time retention, as well as reload, belongs to each account.
    store = createSessionStore({ ...storeOptions, maxSessions: 1 });
    const other = { uuid: 'b'.repeat(32), name: 'Other' };
    const localState = { totals: { BEDWARS: createGame(start).counts } };
    localState.totals.BEDWARS.finals.value=1;
    for (const owner of [other, account, account]) {
        stamp += 100;
        const row = store.startSession({ ...owner, at: stamp, trackingSource: 'local' });
        store.updateLocalTracking(row.id, localState, stamp);
        store.endSession(row.id);
    }
    assert.strictEqual(store.getHistory(other.uuid).length, 1);
    assert.strictEqual(store.getHistory(account.uuid).length, 1);

    // Leaving mid-game and rejoining under another name continues one game.
    const fresh = () => { store = createSessionStore(storeOptions); tracker = createSessionTracker({ ...options, store }); };
    const lastGame = () => { const games = store.getSessions(account.uuid).flatMap(session => session.games); return games[games.length - 1]; };
    const say = (text, name) => tracker.observeLocalChat(text, { ...start, ownNames: [name] });
    fresh(); await tracker.ensureSession(); await tracker.finish(); stamp += 100;
    await tracker.onGameStart({ ...start, sessionKey: 'nick-then-real', ownNames: ['NickA'] });
    say('Rival was killed by NickA. FINAL KILL!', 'NickA');
    stamp += 60000; await tracker.onGameEnd({ ...start, durationMs: 60000 });
    assert(tracker.getActiveSession().localTracking.current.leftAt, '/lobby with a bed pauses the game');
    stamp += 30000; say('Enemy was killed by Tester. FINAL KILL!', 'Tester');
    assert.strictEqual(tracker.getActiveSession().localTracking.current.leftAt, 0, 'Rejoining resumes it');
    say('BED DESTRUCTION > Red Bed was destroyed by Tester!', 'Tester');
    stamp += 60000; tracker.observeLocalResult('VICTORY!'); await tracker.onGameEnd({ ...start, durationMs: 150000 });
    assert.deepStrictEqual([lastGame().localModes[0].finals, lastGame().localModes[0].beds, lastGame().result, lastGame().localModes[0].games], [2, 1, 'win', 1]);

    stamp += 100; await tracker.onGameStart({ ...start, sessionKey: 'real-then-nick' });
    say('Rival was killed by Tester. FINAL KILL!', 'Tester');
    stamp += 60000; tracker.detach(); fresh();
    stamp += 30000; await tracker.ensureSession();
    assert(tracker.getActiveSession().localTracking.current.leftAt, 'A proxy disconnect keeps the game paused for the next connection');
    say('Enemy was killed by NickB. FINAL KILL!', 'NickB'); stamp += 30000; tracker.detach(); fresh();
    stamp += 30000; say('Other was killed by NickC. FINAL KILL!', 'NickC');
    say('NickC was killed by Rival.', 'NickC');
    stamp += 60000; tracker.observeLocalResult('GAME OVER!'); await tracker.onGameEnd({ ...start, durationMs: 60000 });
    assert.deepStrictEqual([lastGame().localModes[0].finals, lastGame().localModes[0].deaths, lastGame().result], [3, 1, 'loss'], 'Several name changes still count as one player');

    stamp += 100; await tracker.onGameStart({ ...start, sessionKey: 'no-bed' });
    say('BED DESTRUCTION > Your Bed was dismantled by Rival!', 'Tester');
    stamp += 60000; await tracker.onGameEnd({ ...start, durationMs: 60000 });
    assert(!tracker.getActiveSession().localTracking.current, 'Leaving without a bed ends the game');
    assert.strictEqual(lastGame().localModes[0].finalDeaths, 1, 'and is a final death');
    assert(!('wins' in lastGame().localModes[0]), 'Teammates may still win, so the result stays unknown');

    stamp += 100; await tracker.onGameStart({ ...start, sessionKey: 'abandoned' });
    say('Rival was killed by Tester. FINAL KILL!', 'Tester');
    stamp += 60000; await tracker.onGameEnd({ ...start, durationMs: 60000 });
    stamp += 100; await tracker.onGameStart({ ...start, sessionKey: 'next' });
    const abandoned = lastGame().localModes[0];
    assert.strictEqual(abandoned.finals, 1, 'A game never rejoined keeps what was seen');
    assert(!('finalDeaths' in abandoned) && !('bedsLost' in abandoned) && !('games' in abandoned), 'but not what could happen after leaving');

    say('Rival was killed by Tester. FINAL KILL!', 'Tester');
    stamp += 60000; await tracker.onGameEnd({ ...start, durationMs: 60000 });
    const expiring = tracker.getActiveSession();
    stamp += 4 * 3600000;
    for (const [key, callback] of [...timers]) { timers.delete(key); callback(); }
    const expired = store.findSession(expiring.id);
    assert(expired.endedAt && !expired.localTracking.current, 'A pause past the resume window settles and closes the session');
    assert.strictEqual(lastGame().localModes[0].finals, 1);
    tracker.detach();
    fs.unlinkSync(sessionFile); fs.rmdirSync(folder);
    console.log('Local session tracking: strict counters, coverage, persistence, ownership and source transitions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
