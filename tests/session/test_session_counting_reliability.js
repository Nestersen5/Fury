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
const { observedSessionDelta, archiveObservedGames } = require('../../src/session/observedStats');
const { normalizeVariant } = require('../../src/session/localStats');
const localStats = require('../../src/session/localStats');

function fixture(t, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-counting-'));
    let stamp = 1000000;
    const account = { uuid: 'a'.repeat(32), name: 'Tester' };
    let player = { ...account, displayname: account.name, stats: {
        Bedwars: { wins_bedwars: 10, losses_bedwars: 10, kills_bedwars: 20 },
        Duels: { wins: 10, losses: 10, kills: 20 }
    } };
    const timers = new Map(); let serial = 0;
    const store = createSessionStore({ ...options.storeOptions, sessionFile: path.join(dir, 'sessions.json'), now: () => stamp,
        saveDelayMs: 0, writeJsonOffThread(file, data, _label, done) {
            fs.writeFileSync(file, JSON.stringify(data));
            done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
        } });
    const tracker = createSessionTracker({ store, getIdentity: () => account, now: () => stamp,
        fetchOwnStats: async () => player, gameEndDelayMs: 15000, apiSettleMs: 0,
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

test('one shared API reading checks every due game', async t => {
    let player, reads = 0;
    const f = fixture(t,{ fetchOwnStats: async () => { reads++; return player; } });
    player = { uuid: f.account.uuid, stats: f.snapshot().stats };
    for (let i=0;i<4;i++) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: `batch-${i}` });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode:'BEDWARS', immediate:true });
    }
    player = { ...player, stats: { ...player.stats, Bedwars: { wins_bedwars:14,losses_bedwars:10,kills_bedwars:28 } } };
    const before = reads;
    await f.tracker.processPendingVerifications({ force:true });
    assert.equal(reads-before,1);
    assert(f.tracker.getActiveSession().games.every(game => game.verificationAttempts>0));
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,8);
});

for (const initialApi of [false,true]) test(`API switches preserve one live game and its counts (initial ${initialApi})`, async t => {
    let enabled = initialApi;
    const f = fixture(t,{ isApiAvailable:()=>enabled });
    await f.tracker.onGameStart({ ...f.start, sessionKey:'switches' });
    const id = f.tracker.getActiveSessionId();
    f.tracker.observeLocalChat('First was killed by Tester.');
    enabled = !enabled; await f.tracker.refreshSettings();
    f.tracker.observeLocalChat('Second was killed by Tester.');
    enabled = initialApi; await f.tracker.refreshSettings();
    f.tracker.observeLocalChat('Third was killed by Tester.');
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode:'BEDWARS', immediate:true });
    assert.equal(f.tracker.getActiveSessionId(),id);
    assert.equal(f.tracker.getActiveSession().games.length,1);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,3);
});

test('a bad API reading cannot erase accepted session or mode corrections', async t => {
    const f = fixture(t);
    for (const key of ['rollback-one','rollback-two']) {
        await f.tracker.onGameStart({ ...f.start,sessionKey:key,variant:'Doubles' });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode:'BEDWARS',immediate:true });
    }
    const base = f.snapshot().stats;
    f.setPlayer({ uuid:f.account.uuid,stats:{ ...base,Bedwars:{ wins_bedwars:12,losses_bedwars:10,kills_bedwars:27 } } });
    await f.tracker.refresh({ force:true });
    f.setPlayer({ uuid:f.account.uuid,stats:{ ...base,Bedwars:{ wins_bedwars:12,losses_bedwars:10,kills_bedwars:19 } } });
    await f.tracker.refresh({ force:true });
    const mode = f.tracker.getSessionDelta().modes[0];
    assert.equal(mode.kills,7);
    assert.equal(mode.submodes[0].kills,7);
});

test('a weak result does not block a bounded combined session correction', async t => {
    const f = fixture(t);
    for (const [key,title] of [['weak-window','GAME OVER!'],['strong-window','VICTORY!']]) {
        await f.tracker.onGameStart({ ...f.start,sessionKey:key,variant:'Doubles' });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult(title);
        await f.tracker.onGameEnd({ mode:'BEDWARS',immediate:true });
    }
    f.setPlayer({ uuid:f.account.uuid,stats:{ ...f.snapshot().stats,Bedwars:{ wins_bedwars:12,losses_bedwars:10,kills_bedwars:27 } } });
    await f.tracker.processPendingVerifications({ force:true });
    const mode=f.tracker.getSessionDelta().modes[0];
    assert.deepEqual([mode.wins,mode.losses,mode.games,mode.kills],[2,0,2,7]);
    assert.deepEqual([mode.submodes[0].wins,mode.submodes[0].losses],[2,0]);
    assert(f.tracker.getActiveSession().games.every(game=>!game.delta),'Combined combat is never allocated to a match');
    assert(f.tracker.getActiveSession().games.every(game=>game.result==='win'),'Two API wins leave only one possible result for the weak game');
});

test('a pending late API window is not reused as the next game\'s clean starting point', async t => {
    const f = fixture(t,{ apiSettleMs:30000 });
    await f.tracker.onGameStart({ ...f.start,sessionKey:'older',observedFromStart:false });
    f.tracker.observeLocalChat('First was killed by Tester.');
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode:'BEDWARS',immediate:true });
    const base=f.snapshot().stats;
    f.setPlayer({ uuid:f.account.uuid,stats:{ ...base,Bedwars:{ wins_bedwars:11,losses_bedwars:10,kills_bedwars:21 } } });
    await f.tracker.processPendingVerifications({ force:true });
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus,'pending');
    await f.tracker.onGameStart({ ...f.start,sessionKey:'newer' });
    f.tracker.observeLocalChat('Second was killed by Tester.');
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode:'BEDWARS',immediate:true });
    f.setPlayer({ uuid:f.account.uuid,stats:{ ...base,Bedwars:{ wins_bedwars:12,losses_bedwars:10,kills_bedwars:24 } } });
    await f.tracker.processPendingVerifications({ force:true });
    const session=f.tracker.getActiveSession();
    assert(session.games.every(game=>!game.delta));
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,4);
});

test('plain counts survive incomplete coverage and late identity events are credited once', () => {
    const game = localStats.createGame({ mode: 'BEDWARS', key: 'identity', startedAt: 1000,
        ownName: 'Tester', observedFromStart: true, standardBedwars: true, identityKnown: false });
    localStats.observe(game, 'Rival was killed by SecretNick. FINAL KILL!', { identityKnown: false, at: 2000 });
    localStats.observe(game, 'BED DESTRUCTION > Blue Bed was destroyed by SecretNick!', { identityKnown: false, at: 3000 });
    localStats.observe(game, 'BED DESTRUCTION > Red Bed was destroyed by Rival!', { identityKnown: false, at: 4000 });
    let saved = localStats.normalizeLocal({ current: game }).current;
    localStats.observe(saved, 'Server notice', { ownNames: ['SecretNick'], ownTeam: 'Red', at: 5000 });
    localStats.observe(saved, 'Server notice', { ownNames: ['SecretNick'], ownTeam: 'Red', at: 6000 });
    let mode = localStats.localModes({ current: saved })[0];
    assert.deepEqual([mode.finals, mode.beds, mode.bedsLost], [1, 1, 1]);
    assert.equal(saved.counts.finals.available, true, 'Late confirmed identity can restore full coverage');
    localStats.observe(saved, 'Other vanished mysteriously. FINAL KILL!', { at: 7000 });
    mode = localStats.localModes({ current: saved })[0];
    assert.equal(mode.finals, 1, 'An unknown message must not hide counted finals');
    assert(mode.unavailable.includes('finals'), 'Coverage remains internal');
    assert.equal(mode.breakdown.note, '');
    const lateTeam = localStats.createGame({ mode: 'BEDWARS', key: 'team', startedAt: 1000,
        ownName: 'Tester', observedFromStart: true, standardBedwars: true, identityKnown: true });
    localStats.observe(lateTeam, 'TEAM ELIMINATED > Blue Team has been eliminated!', { at: 7000 });
    localStats.updateIdentity(lateTeam, { ownTeam: 'Blue' });
    assert.equal(lateTeam.result, 'loss');
});

test('enabling API requests midgame can correct that same locally owned game', async t => {
    let enabled=false;
    const f=fixture(t,{isApiAvailable:()=>enabled});
    await f.tracker.onGameStart({...f.start,sessionKey:'enable-midgame'});
    f.tracker.observeLocalChat('First was killed by Tester.');f.tick(10000);
    enabled=true;await f.tracker.refreshSettings();
    assert(f.tracker.getActiveSession().localTracking.current.apiBaseline);
    f.tracker.observeLocalChat('Second was killed by Tester.');f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:24}}});
    await f.tracker.processPendingVerifications({force:true});
    const record=f.store.getLastGame(f.account.uuid),mode=f.tracker.getSessionDelta().modes[0];
    assert.equal(record.verificationStatus,'verified');
    assert.deepEqual([mode.games,mode.kills],[1,4]);
    assert.equal(buildLauncherSessionHistory(f.store.getHistory(f.account.uuid),{now:f.now()}).sessions[0].games[0].stats.kills,4);
    f.tracker.detach();assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].kills,4);
});

test('a baseline reply received after the local game ended cannot recover that game', async t=>{
    let enabled=false,resolve;
    const f=fixture(t,{isApiAvailable:()=>enabled,fetchOwnStats:()=>new Promise(done=>{resolve=done;})});
    await f.tracker.onGameStart({...f.start,sessionKey:'late-anchor'});
    f.tracker.observeLocalChat('First was killed by Tester.');enabled=true;
    const lookup=f.tracker.refreshSettings();f.tick(60000);f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    resolve({uuid:f.account.uuid,stats:{Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:25}}});await lookup;
    const record=f.store.getLastGame(f.account.uuid);
    assert.equal(record.verificationBaseline,null);assert.equal(record.delta,null);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,1);
    assert(f.tracker.getActiveSession().reconciliationBaseline.priorGameKeys.includes('late-anchor'));
});

test('disabling API requests at a delayed game end saves the game and retries after re-enabling',async t=>{
    let enabled=true;
    const f=fixture(t,{isApiAvailable:()=>enabled});
    await f.tracker.onGameStart({...f.start,sessionKey:'off-at-end'});
    f.tracker.observeLocalChat('First was killed by Tester.');f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS'});
    enabled=false;await f.tracker.refreshSettings();f.tick(15000);await f.fireDue();
    assert.equal(f.tracker.getActiveSession().games.length,1);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,1);
    enabled=true;f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:23}}});
    await f.tracker.refreshSettings();await f.tracker.processPendingVerifications({force:true});
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus,'verified');
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,3);
});

test('an older game settles while the next game is running and safely advances its baseline',async t=>{
    const f=fixture(t,{apiSettleMs:30000});
    await f.tracker.onGameStart({...f.start,sessionKey:'settle-first'});f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:23}}});
    await f.tracker.processPendingVerifications({force:true});
    await f.tracker.onGameStart({...f.start,sessionKey:'still-running'});
    f.tracker.observeLocalChat('LiveRival was killed by Tester.');f.tick(30000);
    await f.tracker.processPendingVerifications({force:true});
    assert.equal(f.tracker.getActiveSession().games[0].verificationStatus,'verified');
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,4,'Live combat is added once');
    assert.equal(f.tracker.getActiveSession().liveGame.baseSnapshot.stats.Bedwars.kills_bedwars,23);
    f.tick(30000);f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:12,losses_bedwars:10,kills_bedwars:25}}});
    await f.tracker.processPendingVerifications({force:true});f.tick(30000);await f.tracker.processPendingVerifications({force:true});
    assert(f.tracker.getActiveSession().games.every(record=>record.verificationStatus==='verified'));
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,5);
});

test('late combat restarts the settling period instead of freezing the first API result',async t=>{
    const f=fixture(t,{apiSettleMs:30000});
    await f.tracker.onGameStart({...f.start,sessionKey:'slow-combat'});f.tick(60000);
    f.tracker.observeLocalChat('First was killed by Tester.');f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    const publish=kills=>f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:kills}}});
    publish(21);await f.tracker.processPendingVerifications({force:true});
    f.tick(30000);publish(24);await f.tracker.processPendingVerifications({force:true});
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus,'pending');
    f.tick(30000);await f.tracker.processPendingVerifications({force:true});
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus,'verified');
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,4);
});

test('unchanged replies stop automatic retries but recent games can recover on a later shared refresh',async t=>{
    let reads=0;
    const f=fixture(t,{fetchOwnStats:async()=>{reads++;return player;}});
    let player={uuid:f.account.uuid,stats:f.snapshot().stats};
    await f.tracker.onGameStart({...f.start,sessionKey:'frozen-profile'});f.tick(60000);
    f.tracker.observeLocalChat('First was killed by Tester.');f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    for(let i=0;i<6;i++)await f.tracker.processPendingVerifications({force:true});
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus,'unverified');
    assert(f.store.getLastGame(f.account.uuid).verificationBaseline);
    assert.equal(f.store.getPendingGames().length,0,'No continuing automatic retry timer');
    player={...player,stats:{...player.stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:24}}};
    const before=reads;await f.tracker.refresh({force:true});
    assert.equal(reads-before,1,'Refresh and recovery share the same reply');
    assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus,'verified');
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,4);
});

for(const enabled of [false,true])test(`a confirmed draw counts one game without a win or loss (API ${enabled})`,async t=>{
    const f=fixture(t,{isApiAvailable:()=>enabled});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Duels:{wins:10,losses:10,kills:20,games_played_duels:20}}});
    await f.tracker.onGameStart({...f.start,mode:'DUELS',sessionKey:'draw'});
    f.tracker.observeLocalChat('Rival was killed by Tester.');f.tick(60000);
    f.tracker.observeLocalResult('DRAW!');await f.tracker.onGameEnd({mode:'DUELS',immediate:true});
    if(enabled){f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Duels:{wins:10,losses:10,kills:22,games_played_duels:21}}});
        await f.tracker.processPendingVerifications({force:true});
        assert.equal(f.store.getLastGame(f.account.uuid).verificationStatus,'verified');}
    const mode=f.tracker.getSessionDelta().modes.find(mode=>mode.mode==='DUELS');
    assert.deepEqual([mode.wins,mode.losses,mode.games],[0,0,1]);
    assert.equal(f.store.getLastGame(f.account.uuid).result,'draw');
    assert.equal(buildLauncherSessionHistory(f.store.getHistory(f.account.uuid),{now:f.now()}).sessions[0].games[0].result,'draw');
});

test('a missing mode gets a scoped baseline without importing its lifetime counters',async t=>{
    const f=fixture(t);
    f.setPlayer({uuid:f.account.uuid,stats:{Bedwars:f.snapshot().stats.Bedwars}});
    await f.tracker.ensureSession();
    await f.tracker.onGameStart({...f.start,mode:'SKYWARS',sessionKey:'missing-mode',variant:'Solo Normal'});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,SkyWars:{wins:100,losses:200,kills:900,assists:100}}});
    f.tick(1000);await f.tracker.refreshSettings();
    f.tracker.observeLocalChat('Rival was killed by Tester.');f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'SKYWARS',immediate:true});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,SkyWars:{wins:101,losses:200,kills:903,assists:102}}});
    await f.tracker.processPendingVerifications({force:true});
    const mode=f.tracker.getSessionDelta().modes.find(mode=>mode.mode==='SKYWARS');
    assert.deepEqual([mode.wins,mode.kills,mode.assists],[1,3,2]);
    f.tracker.detach();assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes.find(mode=>mode.mode==='SKYWARS').assists,2);
});

test('session-only recovery retains API experience without guessing either game\'s gains',async t=>{
    const f=fixture(t);
    const base=f.snapshot().stats;
    f.setPlayer({uuid:f.account.uuid,stats:{...base,Bedwars:{...base.Bedwars,Experience:10000}}});
    for(const key of ['xp-one','xp-two']){
        await f.tracker.onGameStart({...f.start,sessionKey:key});f.tick(60000);
        f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    }
    f.setPlayer({uuid:f.account.uuid,stats:{...base,Bedwars:{wins_bedwars:12,losses_bedwars:10,kills_bedwars:22,Experience:10500}}});
    await f.tracker.processPendingVerifications({force:true});
    assert.equal(f.tracker.getSessionDelta().modes[0].stars,0.1);
    assert(f.tracker.getActiveSession().games.every(game=>!game.delta));
});

test('one reply verifies different game modes without skipping later successful entries',async t=>{
    let player,reads=0;
    const f=fixture(t,{fetchOwnStats:async()=>{reads++;return player;}});
    player={uuid:f.account.uuid,stats:{Bedwars:{wins_bedwars:10,losses_bedwars:10,kills_bedwars:20},
        SkyWars:{wins:10,losses:10,kills:20},Duels:{wins:10,losses:10,kills:20}}};
    for(const mode of ['BEDWARS','SKYWARS','DUELS']){
        await f.tracker.onGameStart({...f.start,mode,sessionKey:mode});f.tick(60000);
        f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode,immediate:true});
    }
    player={...player,stats:{Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:22},
        SkyWars:{wins:11,losses:10,kills:22},Duels:{wins:11,losses:10,kills:22}}};
    const before=reads;await Promise.all([f.tracker.processPendingVerifications({force:true}),f.tracker.processPendingVerifications({force:true})]);
    assert.equal(reads-before,1);assert(f.tracker.getActiveSession().games.every(game=>game.verificationStatus==='verified'));
    assert(f.tracker.getSessionDelta().modes.every(mode=>mode.kills===2));
});

test('a second game ending during the shared request prevents attribution to the first',async t=>{
    let resolve,hold=false;
    const f=fixture(t,{fetchOwnStats:async()=>hold?new Promise(done=>{resolve=done;}):{uuid:f.account.uuid,stats:f.snapshot().stats}});
    await f.tracker.onGameStart({...f.start,sessionKey:'before-request'});f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    await f.tracker.onGameStart({...f.start,sessionKey:'during-request'});hold=true;
    const checking=f.tracker.processPendingVerifications({force:true});f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    resolve({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:25}}});await checking;
    assert(f.tracker.getActiveSession().games.every(game=>!game.delta));
    assert.equal(f.tracker.getSessionDelta().modes[0].wins,2);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,0,'A reply missing the second result is not a complete session window');
});

test('disconnect cancels a shared reply before it can change saved observations',async t=>{
    let resolve,hold=false;
    const f=fixture(t,{fetchOwnStats:async()=>hold?new Promise(done=>{resolve=done;}):{uuid:f.account.uuid,stats:f.snapshot().stats}});
    await f.tracker.onGameStart({...f.start,sessionKey:'cancel-request'});f.tick(60000);
    f.tracker.observeLocalChat('Rival was killed by Tester.');f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});hold=true;
    const checking=f.tracker.processPendingVerifications({force:true});await f.tracker.quiesce();
    resolve({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:25}}});await checking;
    assert.equal(f.store.getLastGame(f.account.uuid).delta,null);
    assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].kills,1);
});

test('an API-owned game resumes locally when API requests were disabled before reconnect',async t=>{
    const f=fixture(t);
    await f.tracker.onGameStart({...f.start,sessionKey:'resume-off'});
    f.tracker.observeLocalChat('First was killed by Tester.');const id=f.tracker.getActiveSessionId();
    f.tick(10000);f.tracker.detach();
    const resumed=createSessionTracker({store:f.reload(),now:f.now,getIdentity:()=>f.account,isApiAvailable:()=>false,
        fetchOwnStats:async()=>{throw Error('API-off resume must not fetch');},setTimeoutImpl:()=>1,clearTimeoutImpl(){}});
    t.after(()=>resumed.detach());
    await resumed.onGameStart({...f.start,sessionKey:'resume-off',resume:true});
    resumed.observeLocalChat('Second was killed by Tester.');f.tick(60000);
    resumed.observeLocalResult('VICTORY!');await resumed.onGameEnd({mode:'BEDWARS',immediate:true});
    assert.equal(resumed.getActiveSessionId(),id);
    assert.equal(resumed.getActiveSession().trackingSource,'api');
    assert.deepEqual([resumed.getSessionDelta().modes[0].games,resumed.getSessionDelta().modes[0].kills],[1,2]);
});

test('confirmed ends with unknown results allow bounded session recovery without invented per-game stats',async t=>{
    const f=fixture(t);
    for(const key of ['unknown-one','unknown-two']){
        await f.tracker.onGameStart({...f.start,mode:'DUELS',sessionKey:key});f.tick(60000);
        f.tracker.observeLocalResult('GAME OVER!');await f.tracker.onGameEnd({mode:'DUELS',immediate:true});
    }
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Duels:{wins:11,losses:11,kills:24}}});
    await f.tracker.processPendingVerifications({force:true});
    const mode=f.tracker.getSessionDelta().modes.find(mode=>mode.mode==='DUELS');
    assert.deepEqual([mode.games,mode.wins,mode.losses,mode.kills],[2,1,1,4]);
    assert(f.tracker.getActiveSession().games.every(game=>game.result===null && !game.delta));
});

test('a stale reply cannot reverse an accepted weak-result session correction',async t=>{
    const f=fixture(t);
    for(const [key,title] of [['weak-stale','GAME OVER!'],['strong-stale','VICTORY!']]){
        await f.tracker.onGameStart({...f.start,sessionKey:key});f.tick(60000);
        f.tracker.observeLocalResult(title);await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    }
    const publish=(wins,losses)=>f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,
        Bedwars:{wins_bedwars:wins,losses_bedwars:losses,kills_bedwars:24}}});
    publish(12,10);await f.tracker.processPendingVerifications({force:true});
    publish(11,11);await f.tracker.refresh({force:true});
    const mode=f.tracker.getSessionDelta().modes[0];assert.deepEqual([mode.wins,mode.losses],[2,0]);
});

test('API recovery metadata stays outside launcher history and its compact transport',async t=>{
    const f=fixture(t,{apiSettleMs:30000});
    await f.tracker.onGameStart({...f.start,sessionKey:'private-metadata'});f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:24}}});
    await f.tracker.processPendingVerifications({force:true});
    assert(f.store.getLastGame(f.account.uuid).verificationCandidate);
    const history=buildLauncherSessionHistory(f.store.getHistory(f.account.uuid),{now:f.now()});
    const compact=require('../../src/session/historyResponse').compactHistory(history,{epoch:'test',generation:1});
    for(const view of [history,compact])assert(!/verificationBaseline|verificationCandidate|apiBaseline|apiBoundaries|apiTotals|observation|reconciliationBaseline/.test(JSON.stringify(view)));
});

test('bounded result corrections reach different modes without distributing combined combat between games',async t=>{
    const f=fixture(t),base=f.snapshot().stats;
    f.setPlayer({uuid:f.account.uuid,stats:{...base,Bedwars:{...base.Bedwars,
        eight_one_wins_bedwars:4,eight_one_losses_bedwars:4,eight_one_kills_bedwars:8,
        eight_two_wins_bedwars:6,eight_two_losses_bedwars:6,eight_two_kills_bedwars:12}}});
    for(const [key,variant,title] of [['weak-solo','Solos','GAME OVER!'],['strong-double','Doubles','VICTORY!']]){
        await f.tracker.onGameStart({...f.start,sessionKey:key,variant});f.tick(60000);
        f.tracker.observeLocalResult(title);await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    }
    f.setPlayer({uuid:f.account.uuid,stats:{...base,Bedwars:{wins_bedwars:12,losses_bedwars:10,kills_bedwars:26,
        eight_one_wins_bedwars:5,eight_one_losses_bedwars:4,eight_one_kills_bedwars:11,
        eight_two_wins_bedwars:7,eight_two_losses_bedwars:6,eight_two_kills_bedwars:15}}});
    await f.tracker.processPendingVerifications({force:true});
    const mode=f.tracker.getSessionDelta().modes[0];
    assert.deepEqual([mode.wins,mode.losses,mode.kills],[2,0,6]);
    assert(mode.submodes.every(sub=>sub.wins===1 && sub.losses===0 && sub.kills===3));
    const games=buildLauncherSessionHistory(f.store.getHistory(f.account.uuid),{now:f.now()}).sessions[0].games;
    assert(games.every(game=>game.result==='win' && game.stats.wins===1 && game.stats.losses===0 && game.stats.kills===0));
});

test('conflicting local titles do not block a complete session window or invent combat for either game',async t=>{
    let enabled=false;
    const f=fixture(t,{isApiAvailable:()=>enabled});
    await f.tracker.onGameStart({...f.start,sessionKey:'local-conflict'});
    enabled=true;await f.tracker.refreshSettings();f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');f.tracker.observeLocalResult('DEFEAT!');
    await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    await f.tracker.onGameStart({...f.start,sessionKey:'local-known'});f.tick(60000);
    f.tracker.observeLocalResult('VICTORY!');await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:11,kills_bedwars:25}}});
    await f.tracker.processPendingVerifications({force:true});
    const mode=f.tracker.getSessionDelta().modes[0];assert.deepEqual([mode.wins,mode.losses,mode.games,mode.kills],[1,1,2,5]);
    const games=f.tracker.getActiveSession().games;
    assert.deepEqual(games.map(game=>game.result),['loss','win']);assert(games.every(game=>!game.delta));
});

test('the first readable profile cannot move an earlier API-off game into the current game',async t=>{
    let enabled=false;
    const f=fixture(t,{isApiAvailable:()=>enabled});
    await f.tracker.onGameStart({...f.start,sessionKey:'before-enable'});f.tick(60000);
    f.tracker.observeLocalChat('First was killed by Tester.');f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    await f.tracker.onGameStart({...f.start,sessionKey:'after-enable'});enabled=true;await f.tracker.refreshSettings();
    f.tick(60000);f.tracker.observeLocalChat('Second was killed by Tester.');f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({mode:'BEDWARS',immediate:true});
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:11,losses_bedwars:10,kills_bedwars:25}}});
    await f.tracker.processPendingVerifications({force:true});
    assert(f.tracker.getActiveSession().games.every(game=>!game.delta));
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,2,'A reply covering only one result cannot correct this two-game window');
    f.setPlayer({uuid:f.account.uuid,stats:{...f.snapshot().stats,Bedwars:{wins_bedwars:12,losses_bedwars:10,kills_bedwars:27}}});
    await f.tracker.processPendingVerifications({force:true});
    assert(f.tracker.getActiveSession().games.every(game=>!game.delta));
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,7,'The complete window replaces both raw totals without adding the old prefix twice');
});

test('disconnect during the initial API lookup preserves live observations immediately', async t => {
    let resolveFetch;
    const f = fixture(t, { fetchOwnStats: () => new Promise(resolve => { resolveFetch = resolve; }) });
    const starting = f.tracker.onGameStart({ ...f.start, sessionKey: 'slow-start' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000);
    await f.tracker.quiesce();
    assert.equal(f.reload().getHistory(f.account.uuid)[0]?.delta.modes[0].kills, 1);
    resolveFetch({ uuid: f.account.uuid, stats: { Bedwars: { wins_bedwars: 500, kills_bedwars: 9000 } } });
    await starting;
    assert.equal(f.reload().getHistory(f.account.uuid)[0]?.delta.modes[0].kills, 1, 'A stale initial response cannot import lifetime stats');
});

test('an initial API response attaches without clearing progress saved while it loaded', async t => {
    let resolveFetch, requests = 0;
    const f = fixture(t, { fetchOwnStats: () => { requests++; return new Promise(resolve => { resolveFetch = resolve; }); } });
    const starting = f.tracker.onGameStart({ ...f.start, sessionKey: 'loading' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(1000);
    resolveFetch({ uuid: f.account.uuid, stats: f.snapshot().stats });
    await starting;
    f.tracker.observeLocalChat('Other was killed by Tester.');
    assert.equal(requests,1);
    assert.equal(f.tracker.getActiveSession().baseline.stats.Bedwars.kills_bedwars,20);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills,2);
    f.tracker.detach();
    assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].kills,2);
});

test('resuming a legacy API baseline without presence flags keeps its original gains', async t => {
    const f = fixture(t);
    const base = f.snapshot(); delete base.present;
    const session = f.store.startSession(base);
    f.tick(1000);
    f.setPlayer({ uuid: f.account.uuid, stats: { ...base.stats, Bedwars: { ...base.stats.Bedwars, wins_bedwars: 11 } } });
    await f.tracker.ensureSession();
    assert.equal(f.tracker.getActiveSession().id,session.id);
    assert.equal(f.tracker.getSessionDelta().stats.Bedwars.wins_bedwars,1);
});

test('retained raw observations recover old missing projections without rewriting games', () => {
    const observation = localStats.createGame({ mode: 'BEDWARS', key: 'raw-only', startedAt: 1000,
        ownName: 'Tester', observedFromStart: false, identityKnown: true, variant: 'Doubles' });
    localStats.observe(observation,'Rival was killed by Tester.',{ at: 2000 });
    const game = { id: 'raw', mode: 'BEDWARS', at: 61000, durationMs: 60000, observation,
        result: null, localModes: null, metadata: { variant: 'Doubles' } };
    const session = { games: [game], startedAt: 1000, lastSeen: 61000 };
    assert.equal(observedSessionDelta(session,null).modes[0].kills,1);
    const verified = { ...game, result: 'win', verificationStatus: 'verified', delta: { stats: { Bedwars: { wins_bedwars: 1 } } } };
    assert.equal(observedSessionDelta({ ...session, games: [verified] },null).modes[0].kills,1);
    assert.equal(game.localModes,null);
});

for (const [title, eliminated] of [['GAME OVER!',false], ['DEFEAT!',false], ['GAME OVER!',true]]) test(`isolated API win can correct only a weak result (${title}, eliminated ${eliminated})`, async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'weak-result' });
    f.tick(60000); f.tracker.observeLocalResult(title);
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true, metadata: { team: 'Red' },
        events: eliminated ? [{ type: 'team_eliminated', targetTeam: 'Red', at: f.now() }] : [] });
    f.setPlayer({ uuid: f.account.uuid, stats: { ...f.snapshot().stats, Bedwars: { wins_bedwars: 11, losses_bedwars: 10, kills_bedwars: 20 } } });
    await f.tracker.processPendingVerifications({ force: true });
    const saved = f.store.getLastGame(f.account.uuid);
    assert.equal(saved.result, title === 'GAME OVER!' && !eliminated ? 'win' : 'loss');
});

test('rapid requeue retains combat from a late-joined unfinished game', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, observedFromStart: false, sessionKey: 'late-old' });
    f.tracker.observeLocalChat('Rival was killed by Tester.'); f.tick(60000);
    await f.tracker.onGameEnd({ mode: 'BEDWARS', durationMs: 60000 });
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'next' });
    f.tracker.observeLocalChat('Other was killed by Tester.');
    f.tick(15000); await f.fireDue();
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 2);
    assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].kills, 2);
});

test('overview uses full game totals after old match details are pruned', async t => {
    const f = fixture(t, { storeOptions: { maxGamesPerSession: 2 } });
    for (let i = 0; i < 4; i++) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: `retained-${i}` });
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    }
    const history = buildLauncherSessionHistory(f.store.getHistory(f.account.uuid), { now: f.now() });
    assert.equal(history.sessions[0].games.length, 2);
    assert.equal(history.sessions[0].metrics.games, 4);
    assert.equal(history.sessions[0].metrics.winRate, 100);
    assert.equal(history.summary.games, 4);
});

for (const apiAvailable of [true, false]) {
    test(`confirmed start keeps a server ID learned during activation (API ${apiAvailable})`, async t => {
        const f = fixture(t, { isApiAvailable: () => apiAvailable });
        await f.tracker.onGameStart({ ...f.start, observedFromStart: false, sessionKey: `game:${f.now()}` });
        f.tracker.noteServerId('m123A');
        f.tick(1000);
        await f.tracker.onGameStart({ ...f.start, sessionKey: 'game:1000000' });
        f.tracker.detach();
        assert.equal(f.tracker.getResumableGame({ mode: 'BEDWARS', serverId: 'm123A' })?.key, 'game:1000000');
    });

    test(`a server ID learned later keeps match identity through reconnect and trailing chat (API ${apiAvailable})`, async t => {
        const f = fixture(t, { isApiAvailable: () => apiAvailable });
        const startedAt = f.now(), key = `game:${startedAt}`;
        await f.tracker.onGameStart({ ...f.start, sessionKey: key });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tracker.noteServerId('m123A');
        f.tick(60000); f.tracker.detach();
        const resume = f.tracker.getResumableGame({ mode: 'BEDWARS', serverId: 'm123A' });
        assert.equal(resume?.key, key);
        assert.equal(f.tracker.getResumableGame({ mode: 'BEDWARS', serverId: 'm999A' }), null);
        await f.tracker.onGameStart({ ...f.start, sessionKey: resume.key, serverId: 'm123A', startedAt, resume: true });
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
        assert(f.tracker.observeTrailingChat('Other was killed by Tester.', { mode: 'BEDWARS', sessionKey: key, serverId: 'm123A' }));
        assert.equal(f.tracker.getSessionDelta().modes[0].kills, 2);
        assert.equal(f.tracker.getActiveSession().games.length, 1);
    });
}

test('combined session API correction also updates the one known mode', async t => {
    const f = fixture(t, { storeOptions: { maxGamesPerSession: 2 } });
    for (const key of ['doubles-one', 'doubles-two']) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: key, variant: 'Doubles' });
        f.tracker.observeLocalChat('Rival was killed by Tester. FINAL KILL!');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    }
    f.setPlayer({ uuid: f.account.uuid, stats: { ...f.snapshot().stats, Bedwars: {
        wins_bedwars: 12, losses_bedwars: 10, kills_bedwars: 20, final_kills_bedwars: 7
    } } });
    await f.tracker.processPendingVerifications({ force: true });
    const mode = f.tracker.getSessionDelta().modes[0];
    assert.equal(mode.finals, 7);
    assert.equal(mode.submodes.find(sub => sub.id === 'eight_two').finals, 7);
    for (const key of ['doubles-three', 'doubles-four', 'doubles-five']) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: key, variant: 'Doubles' });
        f.tracker.observeLocalChat('Other was killed by Tester. FINAL KILL!');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    }
    assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].submodes[0].finals, 10);
});

test('an archived unfinished mode prevents guessing where session-only gains belong', async t => {
    const f = fixture(t, { storeOptions: { maxGamesPerSession: 2 } });
    for (const [index,variant] of ['Solos','Doubles','Doubles'].entries()) {
        await f.tracker.onGameStart({ ...f.start, variant, sessionKey: `ambiguous-${index}` });
        f.tracker.observeLocalChat('Rival was killed by Tester.'); f.tick(60000);
        if (index) f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    }
    f.setPlayer({ uuid: f.account.uuid, stats: { ...f.snapshot().stats,
        Bedwars: { wins_bedwars: 12, losses_bedwars: 10, kills_bedwars: 27 } } });
    await f.tracker.refresh({ force: true });
    const mode = f.tracker.getSessionDelta().modes[0];
    assert.equal(mode.kills,7);
    assert.equal(mode.submodes.find(sub => sub.id === 'eight_two').kills,2);
    assert.equal(mode.submodes.find(sub => sub.id === 'eight_one').kills,1);
});

test('API-off late join saves a clear victory as a win', async t => {
    const f = fixture(t, { isApiAvailable: () => false });
    await f.tracker.onGameStart({ ...f.start, observedFromStart: false, sessionKey: 'late-win' });
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    assert.equal(f.store.getLastGame(f.account.uuid).result, 'win');
    assert.equal(f.tracker.getSessionDelta().modes[0].wins, 1);
});

test('cross-midnight calendar retains located observations without spreading session corrections', () => {
    const { buildCalendarStats } = require('../../src/session/calendarStats');
    const stamp = Date.parse('2026-09-14T23:30:00Z');
    const stats = { mode: 'BEDWARS', label: 'BedWars', local: true, wins: 1, losses: 0, games: 1, finals: 1, kills: 2 };
    const session = { id: 'midnight', startedAt: stamp, endedAt: stamp + 3600000,
        modes: [{ ...stats, wins: 2, games: 2, finals: 7, kills: 4 }], games: [
            { id: 'before', mode: 'BEDWARS', at: stamp + 600000, stats, statsSource: 'local', verificationStatus: 'pending' },
            { id: 'after', mode: 'BEDWARS', at: stamp + 2400000, stats, statsSource: 'local', verificationStatus: 'pending' }
        ] };
    const days = buildCalendarStats([session], { kind: 'daily', timeZone: 'UTC', now: stamp + 7200000 });
    assert.equal(days.length, 2);
    for (const day of days) assert.deepEqual([day.modes[0].games, day.modes[0].finals, day.modes[0].kills], [1, 1, 2]);
    const week = buildCalendarStats([session], { kind: 'weekly', timeZone: 'UTC', now: stamp + 7200000 });
    assert.equal(week[0].modes[0].finals, 7, 'Session-only correction fits in the whole week');
});

for (const config of [
    { mode: 'BEDWARS', key: 'Bedwars', variants: ['Solos','Doubles'], ids: ['eight_one','eight_two'],
        overall: field => `${field}_bedwars`, field: (id,field) => `${id}_${field}_bedwars` },
    { mode: 'SKYWARS', key: 'SkyWars', variants: ['Normal Solo','Normal Doubles'], ids: ['solo_normal','team_normal'],
        overall: field => field, field: (id,field) => `${field}_${id}` },
    { mode: 'DUELS', key: 'Duels', variants: ['Classic 1v1','Bridge 1v1'], ids: ['classic_duel','bridge_duel'],
        overall: field => field, field: (id,field) => `${id}_${field}` }
]) test(`mixed ${config.mode} modes receive only bounded mode-specific API corrections`, async t => {
    const f = fixture(t, { storeOptions: { maxGamesPerSession: 2 } });
    const localIds = config.variants.map(label => normalizeVariant(config.mode,label).id);
    const base = { [config.overall('wins')]: 10, [config.overall('losses')]: 10, [config.overall('kills')]: 20 };
    for (const [index,id] of config.ids.entries()) Object.assign(base, {
        [config.field(id,'wins')]: 5, [config.field(id,'losses')]: 5, [config.field(id,'kills')]: 10
    });
    if (config.mode === 'DUELS') Object.assign(base, { bridge_wins: 5, bridge_losses: 5, bridge_kills: 10 });
    f.setPlayer({ uuid: f.account.uuid, stats: { ...f.snapshot().stats, [config.key]: base } });
    async function play(index, key) {
        await f.tracker.onGameStart({ ...f.start, mode: config.mode, sessionKey: key,
            variant: { id: config.ids[index], label: config.variants[index] } });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: config.mode, immediate: true });
    }
    await play(0,'mixed-first'); await play(1,'mixed-second');
    const updated = { ...base, [config.overall('wins')]: 12, [config.overall('kills')]: 27 };
    for (const [index,id] of config.ids.entries()) Object.assign(updated, {
        [config.field(id,'wins')]: 6, [config.field(id,'kills')]: 13 + index
    });
    if (config.mode === 'DUELS') Object.assign(updated, { bridge_wins: 6, bridge_kills: 14 });
    const snapshot = captureSessionSnapshot({ uuid: f.account.uuid, stats: { ...f.snapshot().stats, [config.key]: updated } }, { now: f.now });
    const session = f.tracker.getActiveSession();
    const incomplete = structuredClone(session.reconciliationBaseline);
    for (const id of config.ids) delete incomplete.stats[config.key][config.field(id,'kills')];
    const { reconciliationForSnapshot } = require('../../src/session/observedStats');
    assert.deepEqual(reconciliationForSnapshot({ ...session, reconciliationBaseline: incomplete },snapshot)[config.mode].variants, {},
        'Missing old mode counters cannot turn lifetime numbers into mode gains');
    f.setPlayer({ uuid: f.account.uuid, stats: snapshot.stats });
    await f.tracker.refresh({ force: true });
    let mode = f.tracker.getSessionDelta().modes.find(mode => mode.mode === config.mode);
    assert.equal(mode.kills,7);
    assert.deepEqual(localIds.map(id => mode.submodes.find(sub => sub.id === id).kills),[3,4]);
    assert(session.games.every(game => game.localModes[0].kills === 1 && !game.delta));
    // A later stale response must not erase an accepted mode correction.
    const stale = { ...updated, [config.overall('kills')]: 24 };
    for (const id of config.ids) stale[config.field(id,'kills')] = 12;
    if (config.mode === 'DUELS') stale.bridge_kills = 12;
    f.setPlayer({ uuid: f.account.uuid, stats: { ...snapshot.stats, [config.key]: stale } });
    await f.tracker.refresh({ force: true });
    mode = f.tracker.getSessionDelta().modes.find(mode => mode.mode === config.mode);
    assert.deepEqual(localIds.map(id => mode.submodes.find(sub => sub.id === id).kills),[3,4]);
    await play(0,'mixed-third'); await play(0,'mixed-fourth'); await play(0,'mixed-fifth');
    mode = f.reload().getHistory(f.account.uuid)[0].delta.modes.find(mode => mode.mode === config.mode);
    assert.equal(mode.kills,10);
    assert.deepEqual(localIds.map(id => mode.submodes.find(sub => sub.id === id).kills),[6,4]);
});

for (const apiAvailable of [true, false]) {
    test(`trailing updates stop at queue, reset and exclusion boundaries (API ${apiAvailable})`, async t => {
        const f = fixture(t, { isApiAvailable: () => apiAvailable });
        for (const boundary of ['queue','reset','exclude']) {
            await f.tracker.onGameStart({ ...f.start, sessionKey: boundary });
            f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
            await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
            if (boundary === 'queue') await f.tracker.onQueueStart({ mode: 'BEDWARS' });
            if (boundary === 'reset') await f.tracker.reset();
            if (boundary === 'exclude') f.tracker.excludeCurrentGame();
            assert.equal(f.tracker.observeTrailingChat('Rival was killed by Tester. FINAL KILL!'), false);
        }
    });

    test(`a different server preserves old counts without resuming that game (API ${apiAvailable})`, async t => {
        const f = fixture(t, { isApiAvailable: () => apiAvailable });
        const startedAt = f.now();
        await f.tracker.onGameStart({ ...f.start, sessionKey: `m1:${startedAt}` });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.detach();
        assert.equal(f.tracker.getResumableGame({ mode: 'BEDWARS', serverId: 'm1' }).startedAt, startedAt);
        assert.equal(f.tracker.getResumableGame({ mode: 'BEDWARS', serverId: 'm2' }), null);
        await f.tracker.onGameStart({ ...f.start, sessionKey: `m2:${f.now()}` });
        f.tracker.observeLocalChat('Other was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
        assert.equal(f.tracker.getActiveSession().games.length, 2);
        assert.equal(f.tracker.getSessionDelta().modes[0].kills, 2);
    });

    test(`late combat updates a saved game once, without another recap (API ${apiAvailable})`, async t => {
        const recaps = [], f = fixture(t, { isApiAvailable: () => apiAvailable, onGameRecap: recap => recaps.push(recap) });
        await f.tracker.onGameStart({ ...f.start, sessionKey: 'tail' });
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
        const before = f.store.getLastGame(f.account.uuid).id;
        assert(f.tracker.observeTrailingChat('Rival was killed by Tester. FINAL KILL!', { mode: 'BEDWARS', sessionKey: 'tail' }));
        f.tracker.observeTrailingChat('Rival was killed by Tester. FINAL KILL!', { mode: 'BEDWARS', sessionKey: 'tail' });
        assert.equal(f.tracker.getSessionDelta().modes[0].finals, 1);
        assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].finals, 1);
        assert.equal(f.store.getLastGame(f.account.uuid).id, before);
        assert.equal(f.store.getLastGame(f.account.uuid).events.filter(event => event.type === 'final_kill').length, 1);
        assert.equal(f.tracker.getActiveSession().games.length, 1);
        assert.equal(recaps.length, 1);
        f.tick(2001);
        assert.equal(f.tracker.observeTrailingChat('Other was killed by Tester. FINAL KILL!'), false);
        await f.tracker.onGameStart({ ...f.start, sessionKey: 'next' });
        assert.equal(f.tracker.observeTrailingChat('Enemy was killed by Tester. FINAL KILL!'), false);
    });

    for (const departure of ['disconnect', 'leave']) test(`same-match ${departure} resumes saved counts (API ${apiAvailable})`, async t => {
        const f = fixture(t, { isApiAvailable: () => apiAvailable });
        const startedAt = f.now();
        await f.tracker.onGameStart({ ...f.start, sessionKey: 'rejoin' });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000);
        if (departure === 'leave') {
            await f.tracker.onGameEnd({ mode: 'BEDWARS', sessionKey: 'first-end', durationMs: 60000 });
            f.tick(15000); await f.fireDue();
        }
        f.tracker.detach();
        const resumed = createSessionTracker({ store: f.reload(), now: f.now, getIdentity: () => f.account,
            isApiAvailable: () => apiAvailable, fetchOwnStats: async () => ({ uuid: f.account.uuid, stats: f.snapshot().stats }),
            setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {} });
        t.after(() => resumed.detach());
        await resumed.onGameStart({ ...f.start, sessionKey: 'rejoin', resume: true, observedFromStart: false, startedAt });
        resumed.observeLocalChat('Other was killed by Tester.');
        f.tick(60000); resumed.observeLocalResult('VICTORY!');
        await resumed.onGameEnd({ mode: 'BEDWARS', immediate: true });
        assert.equal(resumed.getActiveSession().games.length, 1);
        const record = resumed.getActiveSession().games[0];
        assert.equal(record.localModes[0].kills, 2);
        assert.equal(resumed.getSessionDelta().modes[0].kills, 2);
        assert(record.localModes[0].unavailable.includes('kills'), 'The disconnected interval is tracked internally');
    });
}

test('combined API windows correct session totals without altering match counters or adding twice', async t => {
    const f = fixture(t);
    for (const key of ['one', 'two']) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: key });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    }
    const player = { uuid: f.account.uuid, stats: { ...f.snapshot().stats, Bedwars: { wins_bedwars: 12, losses_bedwars: 10, kills_bedwars: 27 } } };
    f.setPlayer(player);
    await f.tracker.processPendingVerifications({ force: true });
    await f.tracker.processPendingVerifications({ force: true });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 7);
    assert(f.tracker.getActiveSession().games.every(game => game.localModes[0].kills === 1 && !game.delta));
    await f.tracker.refresh({ force: true });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 7);
    f.setPlayer({ ...player, stats: { ...player.stats, Bedwars: { ...player.stats.Bedwars, kills_bedwars: 25 } } });
    await f.tracker.refresh({ force: true });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 7, 'A stale combat count cannot undo an accepted checkpoint');
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'three' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 8, 'A live game adds to the checkpoint before finalization');
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 8, 'New observations add to the covered API total');
    f.setPlayer({ uuid: f.account.uuid, stats: { ...player.stats, Bedwars: { wins_bedwars: 13, losses_bedwars: 10, kills_bedwars: 28 } } });
    await f.tracker.refresh({ force: true });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 8);
    assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].kills, 8);
});

test('live stats remain numeric and internal observation state stays out of history transport', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'transport' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    const history = buildLauncherSessionHistory(f.store.getHistory(f.account.uuid), { account: f.account, accountScoped: true, now: f.now() });
    const { compactHistory } = require('../../src/session/historyResponse');
    const wire = compactHistory(history, { epoch: 'fixture', generation: 1, accountKey: f.account.uuid });
    assert.equal(wire.history.sessions[0].modes[0].kills, 1);
    assert(!/"(?:liveGame|observation|unresolved|apiTotals|baseSnapshot|reconciliationBaseline)"/.test(JSON.stringify(wire)));
    const html = fs.readFileSync(path.resolve(__dirname, '../../launcher.html'), 'utf8');
    const context = vm.createContext({ numberText: value => String(value || 0) });
    for (const name of ['sessionGameStatsText','sessionGamePresentation']) {
        const start = html.indexOf(`        function ${name}(`), end = html.indexOf('\n        function ', start + 1);
        vm.runInContext(html.slice(start, end), context);
    }
    for (const status of ['pending','unverified','local']) {
        const shown = context.sessionGamePresentation({ mode: 'BEDWARS', result: 'win', verificationStatus: status,
            stats: { finals: 5, beds: 1, kills: 2 } });
        assert(shown.statsText.includes('5 finals'));
        assert.equal(shown.resultLabel, 'win');
        assert(!/uncertain|at least|incomplete|pending|unverified|waiting/i.test([shown.statsText, shown.sourceLabel, shown.resultLabel].join(' ')));
    }
});

test('API correction guards reject unbounded, active, partial and foreign snapshots', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'guard' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    const base = f.snapshot();
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    const session = f.tracker.getActiveSession();
    const snapshot = { ...base, at: f.now(), stats: { ...base.stats, Bedwars: { ...base.stats.Bedwars,
        wins_bedwars: 11, kills_bedwars: 25 } } };
    const { reconciliationForSnapshot } = require('../../src/session/observedStats');
    assert(reconciliationForSnapshot(session, snapshot)?.BEDWARS);
    assert.equal(reconciliationForSnapshot(session, { ...snapshot, uuid: 'b'.repeat(32) }), null);
    assert.equal(reconciliationForSnapshot(session, snapshot, ['BEDWARS']), null);
    assert.equal(reconciliationForSnapshot({ ...session, liveGame: { mode: 'BEDWARS' } }, snapshot), null);
    assert.equal(reconciliationForSnapshot(session, { ...snapshot, stats: { ...snapshot.stats,
        Bedwars: { ...snapshot.stats.Bedwars, wins_bedwars: 12 } } }), null);
    assert.equal(reconciliationForSnapshot({ ...session, apiBoundaries:{}, reconciliationBaseline: { ...session.reconciliationBaseline,
        present: { ...session.reconciliationBaseline.present, Bedwars: false } } }, snapshot), null);
});

test('checkpoint corrections survive match verification, pruning, close and reload', async t => {
    const f = fixture(t, { storeOptions: { maxGamesPerSession: 2 } });
    async function play(key) {
        await f.tracker.onGameStart({ ...f.start, sessionKey: key });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    }
    await play('first'); await play('second');
    f.setPlayer({ uuid: f.account.uuid, stats: { ...f.snapshot().stats,
        Bedwars: { wins_bedwars: 12, losses_bedwars: 10, kills_bedwars: 27 } } });
    await f.tracker.refresh({ force: true });
    const session = f.tracker.getActiveSession();
    f.store.updateGame(session.id, session.games[0].id, { verificationStatus: 'verified',
        delta: { stats: { Bedwars: { wins_bedwars: 1, kills_bedwars: 6 } } } });
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 7, 'Per-match correction cannot add the session correction twice');
    for (const key of ['third','fourth','fifth']) await play(key);
    assert.equal(f.tracker.getSessionDelta().modes[0].kills, 10);
    assert.equal(session.games.length, 2);
    await f.tracker.finish();
    assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].kills, 10);
});

for (const apiAvailable of [true, false]) {
    test(`game mode survives saving, reload and the next match (API ${apiAvailable})`, async t => {
        const f = fixture(t, { isApiAvailable: () => apiAvailable });
        await f.tracker.onGameStart({ ...f.start, sessionKey: 'doubles', variant: 'Doubles' });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true, metadata: { variant: null } });
        const record = f.store.getLastGame(f.account.uuid);
        assert.equal(record.metadata.variant, 'Doubles');
        assert.equal(f.tracker.getSessionDelta().modes[0].breakdown.entries[0].id, 'eight_two');
        assert.equal(f.reload().getHistory(f.account.uuid)[0].delta.modes[0].submodes[0].games, 1);
        await f.tracker.onGameStart({ ...f.start, sessionKey: 'unknown', variant: null });
        f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
        const breakdown = f.tracker.getSessionDelta().modes[0].breakdown;
        assert.equal(breakdown.entries.find(entry => entry.id === 'eight_two').games, 1);
        assert.equal(breakdown.entries.find(entry => entry.unknown).games, 1, 'No mode leaks into the next game');
    });

    for (const evidence of ['start', 'chat', 'end']) test(`late ${evidence} mode evidence preserves counts (API ${apiAvailable})`, async t => {
        const f = fixture(t, { isApiAvailable: () => apiAvailable });
        await f.tracker.onGameStart({ ...f.start, sessionKey: 'late', variant: null });
        f.tracker.observeLocalChat('Rival was killed by Tester.');
        f.tick(10000);
        if (evidence === 'start') await f.tracker.onGameStart({ ...f.start, sessionKey: 'late', variant: 'Fours' });
        if (evidence === 'chat') f.tracker.observeLocalChat('Ordinary server notice', { variant: 'Fours' });
        f.tick(50000); f.tracker.observeLocalResult('VICTORY!');
        await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true,
            metadata: evidence === 'end' ? { variant: 'Fours' } : null });
        const record = f.store.getLastGame(f.account.uuid);
        assert.equal(record.metadata.variant, 'Fours');
        const mode = f.tracker.getSessionDelta().modes[0];
        assert.equal(mode.kills, 1);
        assert.equal(mode.games, 1);
        assert.equal(mode.submodes[0].id, 'four_four');
        assert.equal(mode.submodes[0].kills, 1);
    });
}

test('retained records recover mode labels without changing saved records or inventing a mode', () => {
    const record = patch => ({ id: 'old', mode: 'BEDWARS', at: 61000, durationMs: 60000, result: 'win',
        verificationStatus: 'unverified', metadata: { variant: null },
        localModes: [{ mode: 'BEDWARS', games: 1, wins: 1, losses: 0, kills: 2 }], ...patch });
    const project = game => {
        const session = { startedAt: 1000, lastSeen: 61000, games: [game] };
        const before = JSON.stringify(session);
        const out = observedSessionDelta(session, null).modes[0];
        assert.equal(JSON.stringify(session), before, 'Read-time recovery must not mutate persisted records');
        return out;
    };
    const observed = record({ localModes: [{ mode: 'BEDWARS', games: 1, wins: 1, kills: 2,
        breakdown: { entries: [{ id: 'eight_two', label: 'Doubles', games: 1 }] } }] });
    assert.equal(project(observed).submodes[0].id, 'eight_two');
    const verified = record({ verificationStatus: 'verified', delta: { stats: { Bedwars: {
        wins_bedwars: 1, kills_bedwars: 2, eight_two_games_played_bedwars: 1, eight_two_wins_bedwars: 1
    } } } });
    assert.equal(project(verified).submodes[0].id, 'eight_two');
    assert.equal(project(verified).kills, 2);
    assert.equal(project({ ...verified, delta: { stats: { Bedwars: {
        wins_bedwars: 1, eight_two_wins_bedwars: 1
    } } } }).submodes[0].id, 'eight_two', 'Completed results suffice without a games-started counter');
    assert.equal(project(record({ ...verified, metadata: { variant: 'Unspecified' } })).submodes[0].id, 'eight_two');
    assert.equal(project(record()).breakdown.entries[0].unknown, true);
    assert.equal(project({ ...verified, verificationStatus: 'pending' }).breakdown.entries[0].unknown, true);
    assert.equal(project({ ...verified, delta: { stats: { Bedwars: {
        wins_bedwars: 2, eight_two_wins_bedwars: 2, eight_two_games_played_bedwars: 2
    } } } }).breakdown.entries[0].unknown, true, 'Combined API windows are never assigned to a mode');
    assert.equal(project({ ...verified, delta: { stats: { Bedwars: {
        wins_bedwars: 1, eight_two_wins_bedwars: 1, four_four_wins_bedwars: 1,
        eight_two_games_played_bedwars: 1, four_four_games_played_bedwars: 1
    } } } }).breakdown.entries[0].unknown, true, 'Conflicting mode evidence stays unknown');
    assert.equal(project({ ...verified, metadata: { variant: 'Solos' } }).submodes[0].id, 'eight_one',
        'API fallback cannot replace an already detected game mode');
    const retained = { startedAt: 1000, lastSeen: 61000, games: [verified, observed] };
    archiveObservedGames(retained, [verified]);
    retained.games = [observed];
    assert.equal(observedSessionDelta(retained, null).modes[0].submodes[0].games, 2,
        'Pruning old game details retains their recovered mode totals exactly once');
    for (const raw of [null, 'Unknown', 'Unspecified', { id: 'unavailable', label: 'Unspecified', unknown: true }]) {
        assert.equal(normalizeVariant('BEDWARS', raw).unknown, true);
    }
});

test('mode recovery refreshes when a pending record is replaced by verified stats', async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'verify-mode', variant: null });
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    const pending = f.store.getLastGame(f.account.uuid);
    assert.equal(f.tracker.getSessionDelta().modes[0].breakdown.entries[0].unknown, true);
    f.store.updateGame(f.tracker.getActiveSessionId(), pending.id, { verificationStatus: 'verified',
        delta: { stats: { Bedwars: { wins_bedwars: 1, eight_two_wins_bedwars: 1 } } } });
    assert.equal(f.tracker.getSessionDelta().modes[0].submodes[0].id, 'eight_two');
});

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

for (const scenario of [
    { name: 'late-joined win', observedFromStart: false, titles: [], result: 'win' },
    { name: 'conflicting titles confirmed as a win', observedFromStart: true, titles: ['VICTORY!','DEFEAT!'], result: 'win' },
    { name: 'conflicting titles confirmed as a loss', observedFromStart: true, titles: ['VICTORY!','DEFEAT!'], result: 'loss' },
    { name: 'a provisional loss replaced by a win', observedFromStart: true, titles: ['DEFEAT!','VICTORY!'], result: 'win' }
]) test(`manual result replaces one game's contribution: ${scenario.name}`, async t => {
    const f = fixture(t, { isApiAvailable: () => false });
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'prior', variant: 'Solos' });
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate: true });
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'manual-target', variant: 'Doubles',
        observedFromStart: scenario.observedFromStart });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000);
    for (const title of scenario.titles) f.tracker.observeLocalResult(title);
    const ticket = f.tracker.onQueueStart({ mode: 'BEDWARS' });
    await f.tracker.onGameStart({ ...f.start, sessionKey: 'current', variant: 'Fours' });
    f.tracker.observeLocalChat('Other was killed by Tester.');
    const record = f.tracker.confirmPreviousGameResult({ result: scenario.result, localTicket: ticket });
    const mode = f.tracker.getSessionDelta().modes[0], doubles = mode.submodes.find(sub => sub.id === 'eight_two');
    const won = scenario.result === 'win';
    assert.deepEqual([mode.wins, mode.losses, mode.games, mode.winRate], [won ? 2 : 1, won ? 0 : 1, 2, won ? 100 : 50]);
    assert.deepEqual([doubles.wins, doubles.losses, doubles.games, doubles.winRate], [won ? 1 : 0, won ? 0 : 1, 1, won ? 100 : 0]);
    assert.equal(mode.submodes.find(sub => sub.id === 'eight_one').wins,1);
    assert.equal(record.observation.result,scenario.result);
    assert.equal(record.observation.resultConflict,false);
    assert.equal(record.observation.counts.games.value,1);
    assert.equal(f.tracker.getActiveSession().localTracking.current.key,'current');
    assert.equal(f.tracker.getActiveSession().localTracking.current.counts.kills.value,1);
    assert.equal(f.tracker.confirmPreviousGameResult({ result: 'loss', localTicket: ticket }),null);
    await f.store.flush();
    const saved = f.reload().getHistory(f.account.uuid)[0].delta.modes[0];
    assert.deepEqual([saved.wins,saved.losses,saved.games], [mode.wins,mode.losses,mode.games]);
});

for (const [mode, key, wins, kills] of [
    ['BEDWARS','Bedwars','wins_bedwars','kills_bedwars'],
    ['SKYWARS','SkyWars','wins','kills'],
    ['DUELS','Duels','wins','kills']
]) test(`saved ${mode} details follow observed trailing counts and later usable API stats`, async t => {
    const f = fixture(t);
    const base = { ...f.snapshot().stats, [key]: { [wins]: 10, [kills]: 20 } };
    f.setPlayer({ uuid: f.account.uuid, stats: base });
    await f.tracker.onGameStart({ ...f.start, mode, sessionKey: 'verified-tail' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000); f.tracker.observeLocalResult('VICTORY!');
    await f.tracker.onGameEnd({ mode, immediate: true });
    f.setPlayer({ uuid: f.account.uuid, stats: { ...base, [key]: { [wins]: 11, [kills]: 21 } } });
    await f.tracker.processPendingVerifications({ force: true });
    const { createLauncherSessionHistoryCache } = require('../../src/session/launcherSessionHistory');
    const cache = createLauncherSessionHistoryCache({ now: f.now });
    const options = { account: f.account, accountScoped: true };
    const before = cache.get(f.store,options);
    assert.equal(before.history.sessions[0].games[0].stats.kills,1);
    assert(f.tracker.observeTrailingChat('Other was killed by Tester.', { mode, sessionKey: 'verified-tail' }));
    const after = cache.get(f.store,{ ...options, knownRevision: before.revision });
    assert.notEqual(after.revision,before.revision);
    assert.equal(after.history.sessions[0].modes[0].kills,2);
    assert.equal(after.history.sessions[0].games[0].stats.kills,2);
    assert.equal(after.history.sessions[0].games[0].statsSource,'local');
    assert.equal(after.history.calendarSessions[0].games[0].stats.kills,2);
    await f.store.flush();
    const reloaded = buildLauncherSessionHistory(f.reload().getHistory(f.account.uuid),{ now: f.now() });
    assert.equal(reloaded.sessions[0].games[0].stats.kills,2);
    const record = f.store.getLastGame(f.account.uuid);
    f.store.updateGame(f.tracker.getActiveSessionId(),record.id,{ delta: { stats: { [key]: { [wins]: 1, [kills]: 3 } } } });
    const caughtUp = cache.get(f.store,options).history;
    assert.equal(caughtUp.sessions[0].modes[0].kills,3);
    assert.equal(caughtUp.sessions[0].games[0].stats.kills,3);
    assert.equal(caughtUp.sessions[0].games[0].statsSource,'api');
});

for (const [name, verificationStatus, apiWins, rawOnly] of [
    ['pending API sample','pending',1,false],
    ['combined API sample','verified',2,false],
    ['raw observation','verified',1,true]
]) test(`game details use the session's counter selection for a ${name}`, () => {
    const observation = localStats.createGame({ mode: 'BEDWARS', key: 'detail', startedAt: 1000,
        ownName: 'Tester', observedFromStart: true, identityKnown: true, standardBedwars: true });
    localStats.observe(observation,'Rival was killed by Tester.',{ at: 2000 });
    localStats.observe(observation,'Other was killed by Tester.',{ at: 3000 });
    localStats.observeResult(observation,'VICTORY!',{ at: 61000 });
    const record = { id: 'detail', mode: 'BEDWARS', at: 61000, durationMs: 60000, result: 'win', observation,
        localModes: rawOnly ? null : localStats.localModes({ current: observation }), verificationStatus,
        delta: { stats: { Bedwars: { wins_bedwars: apiWins, kills_bedwars: rawOnly ? 1 : 7 } } } };
    const original = JSON.stringify(record);
    const session = { id: 'details', name: 'Tester', startedAt: 1000, lastSeen: 61000, games: [record] };
    const history = buildLauncherSessionHistory([{ session, delta: observedSessionDelta(session,null), active: true }],{ now: 61000 });
    assert.equal(history.sessions[0].modes[0].kills,2);
    assert.equal(history.sessions[0].games[0].stats.kills,2);
    assert.equal(history.calendarSessions[0].games[0].stats.kills,2);
    assert.equal(JSON.stringify(record),original,'Projecting details must not mutate the saved record');
});

for (const result of ['win','loss']) for (const [immediate,published] of [[true,false],[false,false],[false,true]]) test(`manually confirmed API-game details match the session's ${result} and game counts (immediate ${immediate}, API published ${published})`, async t => {
    const f = fixture(t);
    await f.tracker.onGameStart({ ...f.start, observedFromStart: false, sessionKey: 'api-manual' });
    f.tracker.observeLocalChat('Rival was killed by Tester.');
    f.tick(60000);
    await f.tracker.onGameEnd({ mode: 'BEDWARS', immediate });
    f.tracker.confirmPreviousGameResult({ result, at: f.now() });
    if (published) f.setPlayer({ uuid: f.account.uuid, stats: { ...f.snapshot().stats,
        Bedwars: { ...f.snapshot().stats.Bedwars, [result === 'win' ? 'wins_bedwars' : 'losses_bedwars']: 11, kills_bedwars: 21 } } });
    if (!immediate) { f.tick(15000); await f.fireDue(); }
    assert.equal(f.tracker.getActiveSession().liveGame,null);
    const history = buildLauncherSessionHistory(f.store.getHistory(f.account.uuid),{ now: f.now() });
    const session = history.sessions[0], details = session.games[0].stats;
    assert.deepEqual([details.wins,details.losses,details.games,details.winRate],
        [session.modes[0].wins,session.modes[0].losses,1,result === 'win' ? 100 : 0]);
    assert.deepEqual([details.wins,details.losses],result === 'win' ? [1,0] : [0,1]);
    assert.equal(details.kills,1);
    assert.equal(session.modes[0].kills,1,'The paused copy must not count this saved game twice');
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
