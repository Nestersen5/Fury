'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessionStore, shouldDiscardCompletedSession, recoverSessionSummary, sessionDeltaFor, normalizeStore, sessionHasOnlyZeroStats } = require('../../src/session/sessionStore');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-empty-session-'));
try {
    let persisted;
    const store = createSessionStore({ sessionFile: path.join(directory, 'sessions.json'), saveDelayMs: 0,
        writeJsonOffThread: (file, value, label, done) => {
            persisted = JSON.parse(JSON.stringify(value)); fs.writeFileSync(file, JSON.stringify(value));
            done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
        } });
    const empty = store.startSession({ at: 1000, uuid: 'test', stats: {} });
    assert(store.findSession(empty.id), 'Live baseline stays in memory');
    assert.equal(persisted.sessions.length, 0, 'Empty start is not saved');
    store.cache.invalidate();
    assert(store.findSession(empty.id), 'Disk-cache reload must not lose the live in-memory baseline');
    const pending = store.appendGame(empty.id, { at: 2000, mode: 'BEDWARS', verificationStatus: 'pending' });
    store.endSession(empty.id);
    assert.equal(persisted.sessions.length, 1, 'Keep pending retries recoverable');
    assert.equal(buildLauncherSessionHistory(store.getHistory()).sessions.length, 0, 'Pending empty card is hidden');
    store.updateGame(empty.id, pending.id, { verificationStatus: 'unverified' });
    assert.equal(persisted.sessions.length, 0, 'After retries, a session with a known empty summary is discarded');

    const recovered = { id: 'late', startedAt: 1000, endedAt: 3000, summary: { stats: { Bedwars: {} } },
        games: [{ at: 2000, mode: 'BEDWARS', verificationStatus: 'verified', delta: { stats: { Bedwars: { final_kills_bedwars: 3, beds_broken_bedwars: 1 } } } }] };
    assert.equal(sessionDeltaFor(recovered).stats.Bedwars.final_kills_bedwars, 3, 'Recover late stats');
    assert(!shouldDiscardCompletedSession(recovered), 'Never delete recoverable stats');
    const existing = { stats: { Bedwars: { final_kills_bedwars: 7 } } };
    assert.strictEqual(recoverSessionSummary(recovered, existing), existing, 'Never double-count existing totals');
    const localEmpty = { id: 'local-empty', endedAt: 3000, trackingSource: 'local', localTracking: { totals: { SKYWARS: {} } } };
    assert(!shouldDiscardCompletedSession(localEmpty), 'Unknown local stats are preserved but hidden');
    const localZero = { ...localEmpty, localTracking: { totals: { BEDWARS: { finals: { value: 0, available: true } } } } };
    assert(!shouldDiscardCompletedSession(localZero), 'One zero and two unknown counters do not prove an empty session');
    const allZero={...localZero,id:'all-zero',localTracking:{totals:{BEDWARS:Object.fromEntries(require('../../src/session/localTracking').FIELDS.map(key=>[key,{value:0,available:true}]))}}};
    assert(shouldDiscardCompletedSession(allZero),'All known-zero counters must be discarded');
    assert(sessionHasOnlyZeroStats(allZero));assert(!sessionHasOnlyZeroStats(localZero));
    for(const close of ['end','stale','expired']){
        const current=store.startSession({at:1000,uuid:'zero-'+close,trackingSource:'local'});
        store.updateLocalTracking(current.id,allZero.localTracking,2000);
        assert(!persisted.sessions.some(s=>s.id===current.id),'Known-zero active sessions are never persisted');
        if(close==='end')store.endSession(current.id);
        if(close==='stale')store.closeStaleSessions(current.uuid);
        if(close==='expired')store.closeExpiredSessions(1,current.uuid);
        assert(!store.findSession(current.id),`Known-zero session removed on ${close}`);
    }
    const summaryOnly={id:'summary-only',endedAt:3000,summary:{stats:{Bedwars:{wins_bedwars:1}}},games:[]};
    assert(!shouldDiscardCompletedSession(summaryOnly),'Nonzero summaries survive even without retained game detail');
    const queueOnly={id:'queue-only',startedAt:1000,endedAt:3000,summary:{stats:{Bedwars:{games_played_bedwars_1:1}}},games:[{at:2000,mode:'BEDWARS',verificationStatus:'verified',delta:{stats:{Bedwars:{games_played_bedwars_1:1}}}}]};
    assert(shouldDiscardCompletedSession(queueOnly),'An internal game counter does not create a zero-stat card');
    const mixed={id:'mixed',startedAt:1000,endedAt:3000,summary:{stats:{Bedwars:{wins_bedwars:27,losses_bedwars:2},Duels:{games_played_duels:4,rounds_played:4,melee_hits:80}}},games:[]};
    assert.deepEqual(buildLauncherSessionHistory([{session:mixed,delta:sessionDeltaFor(mixed)}]).sessions[0].modes.map(m=>m.mode),['BEDWARS']);
    const cleaned=require('../../scripts/cleanup_empty_sessions').cleanHistory({version:4,sessions:[queueOnly,mixed,recovered,localZero]});
    assert.deepEqual(cleaned.removed,['queue-only']);assert.deepEqual(cleaned.modes,[{id:'mixed',mode:'Duels'}]);
    assert(!('Duels' in cleaned.data.sessions[0].summary.stats));
    const coinsOnly = { id: 'coins', endedAt: 3000, summary: { stats: { Bedwars: { coins: 50 } } }, games: [{ at: 2000 }] };
    assert(shouldDiscardCompletedSession(coinsOnly), 'Unrelated rewards do not create blank cards');
    assert.deepEqual(normalizeStore({ sessions: [localEmpty, coinsOnly, allZero, recovered] }, Infinity, 250).sessions.map(s => s.id), ['local-empty','late']);
    console.log('PASS zero-session end/stale/expiry/save guards, unknown-data preservation, pending recovery, late stats and nonzero summary retention.');
} finally {
    fs.unlinkSync(path.join(directory, 'sessions.json'));
    fs.rmdirSync(directory);
}
