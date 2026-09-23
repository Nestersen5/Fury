'use strict';

const assert = require('assert');
const { buildLauncherSessionHistory } = require('../../src/session/launcherSessionHistory.js');

const entries = [{
    active: false,
    session: {
        id: 'session-1',
        uuid: 'player-uuid',
        name: 'Tester',
        startedAt: 1_000,
        lastSeen: 4_000,
        endedAt: 5_000,
        baseline: { stats: { Bedwars: { wins_bedwars: 100 } } },
        latest: { stats: { Bedwars: { wins_bedwars: 102 } } },
        games: [{
            at: 4_000,
            mode: 'BEDWARS',
            durationMs: 180_000,
            result: 'win',
            opponents: ['Opponent'],
            delta: {
                stats: {
                    Bedwars: {
                        wins_bedwars: 1,
                        final_kills_bedwars: 4,
                        final_deaths_bedwars: 1,
                        games_played_bedwars: 1
                    }
                }
            }
        }]
    },
    delta: {
        stats: {
            Bedwars: {
                wins_bedwars: 2,
                losses_bedwars: 1,
                final_kills_bedwars: 8,
                final_deaths_bedwars: 3,
                beds_broken_bedwars: 2,
                games_played_bedwars: 3
            },
            SkyWars: { coins: 20 },
            Duels: { wins: 1, losses: 1, kills: 3, deaths: 2, rounds_played: 2 }
        }
    }
}];

const history = buildLauncherSessionHistory(entries, { now: 10_000 });
assert.deepStrictEqual(history.accounts, ['Tester']);
assert.strictEqual(history.sessions.length, 1);
assert.strictEqual(history.sessions[0].durationMs, 4_000, 'ended sessions use their actual end time');
assert.deepStrictEqual(history.sessions[0].modes.map(mode => mode.mode), ['BEDWARS', 'DUELS'], 'non-gameplay stat changes are omitted');
assert.strictEqual(history.sessions[0].modes[1].games, 2, 'Duels falls back to rounds when no games counter exists');
assert.strictEqual(history.sessions[0].games[0].stats.finals, 4);
assert.strictEqual(history.summary.wins, 3);
assert.strictEqual(history.summary.games, 1, 'tracked games are counted from saved recap records');
assert.strictEqual(Object.hasOwn(history.sessions[0], 'baseline'), false, 'launcher payload omits raw Hypixel snapshots');
assert.strictEqual(JSON.stringify(history).includes('wins_bedwars'), false, 'launcher payload contains only named display metrics');

// Session deltas omit unchanged counters; count-only legacy data must not invent stats.
const {compactModes}=require('../../src/session/launcherSessionHistory');
const swDetail=compactModes({stats:{SkyWars:{games:2,games_played_skywars:3,games_team:2,wins:2,losses:1,wins_team_normal:2,losses_team_normal:1}}})[0];
assert.strictEqual(swDetail.games,3,'SkyWars results and specific games counter survive a lagging generic counter');
assert.strictEqual(swDetail.breakdown.entries.find(e=>e.id==='team_normal').games,3);
assert(!swDetail.breakdown.entries.some(e=>e.id==='team'),'known Doubles Normal must not collapse into Teams');
const soloDetail=compactModes({stats:{SkyWars:{games:1,games_solo:1,wins:1,wins_solo_normal:1}}})[0];
assert.strictEqual(soloDetail.breakdown.entries.find(e=>e.id==='solo_normal').games,1);
const detail=compactModes({stats:{Bedwars:{wins_bedwars:7,games_played_bedwars:10,eight_one_games_played_bedwars:4,eight_two_games_played_bedwars:6,eight_two_wins_bedwars:4,eight_two_losses_bedwars:2,eight_two_final_kills_bedwars:12}}})[0];
assert.deepStrictEqual(detail.submodes.map(m=>m.label),['Solos','Doubles']);
assert(!('wins' in detail.submodes[0]),'legacy game counts are not proof of zero wins');
assert.strictEqual(detail.submodes[1].finalDeaths,0,'unchanged counters are omitted from sparse deltas');
assert.strictEqual(detail.submodes[1].wlr,2);
assert.strictEqual(detail.submodes[1].fkdr,12);
assert.strictEqual(detail.wins,7,'Overall totals remain independent');
assert.deepStrictEqual(compactModes({stats:{Bedwars:{wins_bedwars:1}}})[0].submodes,[]);

// Repeated analysis must preserve event contents and independently owned output.
const { compactGame } = require('../../src/session/launcherSessionHistory');
const { dedupeGameEvents } = require('../../src/session/gameEvents');
const sharedEvents = [{ type: 'kill', at: 1000, actor: 'Tester', victim: 'Other',
    rawText: 'x'.repeat(319) + ' trailing', note: 'n'.repeat(239) + ' tail' }];
const sharedEntries = [{ active: true, delta: { stats: {} }, session: {
    id: 'shared', name: 'Tester', startedAt: 1,
    games: ['first', 'second'].map(id => ({ id, mode: 'BEDWARS', events: sharedEvents }))
} }];
const originalShared = JSON.stringify(sharedEntries);
const sharedHistory = buildLauncherSessionHistory(sharedEntries, { now: 10000 });
const [firstProjection, secondProjection] = sharedHistory.sessions[0].games;
assert.strictEqual(JSON.stringify(sharedEntries), originalShared, 'projection leaves input untouched');
assert.strictEqual(firstProjection.events[0].rawText, 'x'.repeat(319) + ' ', 'output retains the first normalization');
assert.strictEqual(firstProjection.events[0].note, 'n'.repeat(239) + ' ');
assert.strictEqual(dedupeGameEvents(firstProjection.events)[0].rawText, 'x'.repeat(319), 'the second normalization still trims');
assert.deepStrictEqual(firstProjection.events, secondProjection.events);
assert.notStrictEqual(firstProjection.events, secondProjection.events);
assert.notStrictEqual(firstProjection.events[0], secondProjection.events[0]);
assert.notStrictEqual(firstProjection.stats, sharedHistory.calendarSessions[0].games[1].stats);
const normalizedAgain = dedupeGameEvents(firstProjection.events);
const normalizedYetAgain = dedupeGameEvents(firstProjection.events);
assert.notStrictEqual(normalizedAgain, normalizedYetAgain, 'public deduplication returns fresh arrays after projection');
assert.notStrictEqual(normalizedAgain[0], normalizedYetAgain[0]);
firstProjection.events[0].actor = 'Changed';
firstProjection.stats.kills = 99;
assert.strictEqual(secondProjection.events[0].actor, 'Tester');
assert.strictEqual(sharedHistory.calendarSessions[0].games[1].stats.kills, 1);
assert.strictEqual(sharedEvents[0].actor, 'Tester');
sharedEvents.push({ type: 'victory', at: 2000 });
const updatedHistory = buildLauncherSessionHistory(sharedEntries, { now: 10000 });
assert.strictEqual(updatedHistory.sessions[0].games[0].stats.wins, 1, 'later updates are recalculated');
assert.strictEqual(updatedHistory.calendarSessions[0].games[0].stats.wins, 1);

// Keep the full dedupe/sort/cap behavior, including attribution and reconciliation.
const manyEvents = Array.from({ length: 600 }, (_, index) => ({
    type: 'kill', at: 1000 + index * 1000, offsetMs: index * 1000, actor: 'Tester', victim: 'Other'
}));
manyEvents.push(...manyEvents.slice(0, 20));
const capped = compactGame({ mode: 'BEDWARS', events: manyEvents.reverse() }, { ownName: 'Tester' });
assert.strictEqual(capped.events.length, 512);
assert.strictEqual(capped.events[0].offsetMs, 88000);
assert.strictEqual(capped.events.at(-1).offsetMs, 599000);
assert.strictEqual(capped.stats.kills, 512);
assert.strictEqual(capped.reconciliation.observed.kills, 512);

// A normalized zero timestamp needs a fresh clock read on every original pass.
const originalNow = Date.now;
let clockCalls = 0;
try {
    Date.now = () => 10000 + clockCalls++;
    const clockHistory = buildLauncherSessionHistory([{ active: true, delta: { stats: {} }, session: {
        id: 'clock', name: 'Tester', startedAt: 1, games: [{ mode: 'BEDWARS',
            delta: { stats: { Bedwars: { wins_bedwars: 1 } } },
            events: [{ type: 'victory', at: -1 }, { type: 'note', at: 0 }]
        }]
    } }], { now: 10000 });
    assert.strictEqual(clockCalls, 8, 'clock-sensitive events retain all original normalization passes');
    assert.strictEqual(clockHistory.sessions[0].games[0].events[0].at, 0);
    assert.strictEqual(clockHistory.sessions[0].games[0].events[1].at, 10000);
    assert.strictEqual(clockHistory.sessions[0].games[0].reconciliation.status, 'matched');
} finally {
    Date.now = originalNow;
}

// Encounter callbacks run after detail stats and can change the later calendar projection.
const callbackRecord = { mode: 'BEDWARS', opponents: ['Other'], events: [
    { type: 'kill', at: 1000, actor: 'Tester', victim: 'Other' }
] };
let encounterCalls = 0;
const callbackHistory = buildLauncherSessionHistory([{ active: true, delta: { stats: {} }, session: {
    id: 'callback', name: 'Tester', startedAt: 1, games: [callbackRecord]
} }], { now: 10000, encounterLookup: () => {
    encounterCalls++;
    callbackRecord.events.push({ type: 'victory', at: 2000 });
    return { games: 3 };
} });
assert.strictEqual(encounterCalls, 1);
assert.strictEqual(callbackHistory.sessions[0].games[0].stats.wins, 0);
assert.strictEqual(callbackHistory.calendarSessions[0].games[0].stats.wins, 1);
assert.deepStrictEqual(callbackHistory.sessions[0].games[0].opponentDetails, [{ name: 'Other', encounter: { games: 3 } }]);
console.log('test_launcher_session_history.js: all assertions passed');
