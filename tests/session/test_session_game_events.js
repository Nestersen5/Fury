'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    parseGameEvents,
    eventTotals,
    reconcileGameStats,
    normalizeGameEvent,
    resolveSessionGameVariant
} = require('../../src/session/gameEvents.js');
const { createSessionStore } = require('../../src/session/sessionStore.js');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory.js');

const STARTED_AT = 1_000_000;
const context = {
    at: STARTED_AT + 125_000,
    startedAt: STARTED_AT,
    ownTeam: 'Aqua',
    resolveTeam: name => ({ Tester: 'Aqua', Rival: 'Red', Enemy: 'Blue' })[name] || null,
    resolveKillOwner: line => line.match(/\bby ([A-Za-z0-9_]+)/i)?.[1] || null
};

assert.strictEqual(
    resolveSessionGameVariant('SKYWARS', { bedwarsQueue: null, previousVariant: null }),
    null,
    'SkyWars game-end metadata never dereferences a missing BedWars queue'
);
assert.strictEqual(
    resolveSessionGameVariant('SKYWARS', { previousVariant: 'Solo Insane' }),
    'Solo Insane',
    'SkyWars preserves a previously observed variant'
);
assert.strictEqual(
    resolveSessionGameVariant('BEDWARS', { bedwarsQueue: { label: 'Doubles', fallback: false } }),
    'Doubles',
    'BedWars still takes its detected queue label'
);
assert.strictEqual(resolveSessionGameVariant('DUELS', { duelsModeName: 'Bridge Duel' }), 'Bridge Duel');

const final = parseGameEvents("Rival was Tester's final #42. FINAL KILL!", context)[0];
assert.strictEqual(final.type, 'final_kill');
assert.strictEqual(final.actor, 'Tester');
assert.strictEqual(final.victim, 'Rival');
assert.strictEqual(final.actorTeam, 'Aqua');
assert.strictEqual(final.offsetMs, 125_000);

const bed = parseGameEvents('BED DESTRUCTION > Your Bed was bed #5 destroyed by Enemy!', context)[0];
assert.strictEqual(bed.type, 'bed_break');
assert.strictEqual(bed.targetTeam, 'Aqua', 'Your Bed resolves to the tracked player team');

const kill = parseGameEvents('Rival was knocked into the void by Tester.', context)[0];
assert.strictEqual(kill.type, 'kill');
assert.strictEqual(kill.cause, 'void');

const events = [
    final,
    bed,
    kill,
    parseGameEvents('VICTORY!', context)[0],
    normalizeGameEvent({ type: 'bed_break', actor: 'Tester', targetTeam: 'Red', at: STARTED_AT + 40_000 }, { startedAt: STARTED_AT })
];
const totals = eventTotals(events, { ownName: 'Tester', ownTeam: 'Aqua' });
assert.deepStrictEqual(totals, {
    wins: 1,
    losses: 0,
    kills: 1,
    deaths: 0,
    finals: 1,
    finalDeaths: 0,
    beds: 1,
    bedsLost: 1
});

const matched = reconcileGameStats(totals, events, { ownName: 'Tester', ownTeam: 'Aqua' });
assert.strictEqual(matched.status, 'matched');
const partial = reconcileGameStats({ ...totals, kills: 2 }, events, { ownName: 'Tester', ownTeam: 'Aqua' });
assert.strictEqual(partial.status, 'partial');
assert.strictEqual(partial.differences.kills, 1);

const sessionFile = path.join(os.tmpdir(), `fury_game_events_${process.pid}_${Date.now()}.json`);
let stamp = STARTED_AT;
const store = createSessionStore({
    sessionFile,
    now: () => stamp,
    saveDelayMs: 0,
    writeJsonOffThread: (file, value, label, done) => {
        fs.writeFileSync(file, JSON.stringify(value));
        done(null, { version: 1, stamp: require('../../src/storage/filePublication').readPublicationStamp(file) });
    }
});
assert.strictEqual(typeof store.mutateGameEvent, 'undefined', 'session storage has no manual game-event mutation API');
const snapshot = {
    at: stamp,
    uuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Tester',
    stats: { Bedwars: {}, SkyWars: {}, Duels: {} },
    achievements: {},
    present: { Bedwars: true, SkyWars: false, Duels: false }
};
const session = store.startSession(snapshot);
stamp += 180_000;
const game = store.appendGame(session.id, {
    at: stamp,
    mode: 'BEDWARS',
    durationMs: 180_000,
    result: 'win',
    metadata: { serverId: 'mini12A', map: 'Airshow', team: 'Aqua', variant: 'Doubles' },
    roster: [{ name: 'Rival', team: 'Red', relation: 'opponent' }],
    events,
    delta: {
        stats: {
            Bedwars: {
                wins_bedwars: 1,
                kills_bedwars: 1,
                final_kills_bedwars: 1,
                beds_broken_bedwars: 1,
                beds_lost_bedwars: 1,
                games_played_bedwars: 1
            }
        }
    }
});

const history = buildLauncherSessionHistory(store.getHistory(), { now: stamp });
const projected = history.sessions[0].games[0];
assert.strictEqual(projected.metadata.serverId, 'mini12A');
assert.strictEqual(projected.metadata.map, 'Airshow');
assert.strictEqual(projected.events.length, events.length);
assert.strictEqual(projected.reconciliation.status, 'matched');
assert.strictEqual(projected.statsSource, 'api');

const launcherHtml = fs.readFileSync(path.join(REPOSITORY_ROOT, 'launcher.html'), 'utf8');
assert(!launcherHtml.includes('id="session-game-drawer"'), 'launcher must not include the removed game detail drawer');
assert(!launcherHtml.includes('data-session-game-id="${escapeHtml(game.id)}"'), 'saved-game summaries must not be clickable detail entries');
assert(!launcherHtml.includes('session-event-form'), 'launcher has no manual game-event form');
assert(launcherHtml.includes('sessionReconciliationMarkup'), 'launcher renders API/local reconciliation');
const healthSource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'src/health/httpServer.js'), 'utf8');
assert(!healthSource.includes("app.post('/session/game-event'"), 'health API exposes no manual game correction route');
const proxySource = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8');
assert(proxySource.includes('observeSessionGameChat(text)'), 'live chat is connected to the session event parser');

try { fs.unlinkSync(sessionFile); } catch (error) {}
console.log('test_session_game_events.js: all assertions passed');
