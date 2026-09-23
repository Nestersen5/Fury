'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const { inferGameResult, resolveGameResult } = require('../../src/session/gameResult.js');
const { parseResultBanner } = require('../../src/session/gameEvents.js');
const { createSessionStore } = require('../../src/session/sessionStore.js');
const { createSessionTracker } = require('../../src/session/sessionTracker.js');

const victory = { type: 'victory' };
const defeat = { type: 'defeat' };
const gameOver = { type: 'defeat', cause: 'game_over' };
const out = team => ({ type: 'team_eliminated', targetTeam: team });
const roster = [
    { name: 'A', team: 'Red' }, { name: 'B', team: 'Blue' }, { name: 'C', team: 'Green' }, { name: 'Mate', team: 'Aqua' }
];

// Title banners.
assert.deepStrictEqual(inferGameResult({ mode: 'BEDWARS', events: [victory] }), { result: 'win', source: 'title' });
assert.deepStrictEqual(inferGameResult({ mode: 'SKYWARS', events: [defeat] }), { result: 'loss', source: 'title' });
assert.deepStrictEqual(inferGameResult({ mode: 'BEDWARS', events: [gameOver] }), { result: 'loss', source: 'title' });
assert.deepStrictEqual(inferGameResult({ mode: 'BEDWARS', events: [gameOver, victory] }), { result: 'win', source: 'title' },
    'VICTORY! outranks a stray GAME OVER!');
assert.strictEqual(inferGameResult({ mode: 'SKYWARS', events: [victory, defeat] }), null, 'conflicting banners settle nothing');

// Own-team elimination.
assert.deepStrictEqual(inferGameResult({ mode: 'BEDWARS', ownTeam: 'Aqua', roster, events: [out('Red'), out('Aqua')] }),
    { result: 'loss', source: 'elimination' });
assert.strictEqual(inferGameResult({ mode: 'BEDWARS', ownTeam: null, roster, events: [out('Aqua')] }), null,
    'no own team, no elimination inference');

// Last team standing.
assert.deepStrictEqual(inferGameResult({ mode: 'BEDWARS', ownTeam: 'aqua', roster, events: [out('Red'), out('Blue'), out('Green')] }),
    { result: 'win', source: 'last_team' });
assert.strictEqual(inferGameResult({ mode: 'BEDWARS', ownTeam: 'Aqua', roster, events: [out('Red'), out('Blue')] }), null,
    'Green is still alive');
assert.strictEqual(inferGameResult({ mode: 'BEDWARS', ownTeam: 'Aqua', roster: [], events: [out('Red')] }), null,
    'an empty roster proves nothing');

// The API delta is authoritative.
assert.deepStrictEqual(resolveGameResult('loss', { mode: 'BEDWARS', events: [victory] }), { result: 'loss', source: 'api' });
assert.deepStrictEqual(resolveGameResult(null, { mode: 'BEDWARS', events: [], metadata: { team: 'Aqua' }, roster }),
    { result: null, source: null });

// Title packets become events.
assert.strictEqual(parseResultBanner('§6§lVICTORY!', { mode: 'BEDWARS' }).type, 'victory');
const over = parseResultBanner('§c§lGAME OVER!', { mode: 'BEDWARS' });
assert.strictEqual(over.type, 'defeat');
assert.strictEqual(over.cause, 'game_over');
assert.strictEqual(parseResultBanner('GAME OVER!', { mode: 'SKYWARS' }), null, 'GAME OVER! is only a loss in BedWars');
assert.strictEqual(parseResultBanner('VICTORY! gg', { mode: 'BEDWARS' }), null);

// Tracker: an API delta that cannot settle the game keeps the watched result.
(async () => {
    const player = {
        player: {
            uuid: 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa', displayname: 'Tester', networkExp: 1, karma: 1,
            achievements: {}, stats: { Bedwars: { wins_bedwars: 10, losses_bedwars: 5, games_played_bedwars: 15 } }
        }
    };
    const clock = { value: 1000 };
    const store = createSessionStore({
        sessionFile: path.join(os.tmpdir(), `fury_game_result_${process.pid}.json`),
        writeJsonOffThread: () => {},
        saveDelayMs: 0,
        now: () => clock.value
    });
    const tracker = createSessionTracker({
        store,
        now: () => clock.value,
        gameEndDelayMs: 0,
        minRefreshIntervalMs: 0,
        verificationRetryDelaysMs: [],
        fetchOwnStats: async () => player,
        logger: { error: () => {}, warn: () => {} }
    });
    await tracker.ensureSession();
    tracker.onGameStart({ mode: 'BEDWARS' });
    clock.value = 400000;
    const record = await tracker.onGameEnd({
        mode: 'BEDWARS', roster, metadata: { team: 'Aqua' },
        events: [out('Red'), out('Blue'), out('Green')]
    });
    assert.strictEqual(record.verificationStatus, 'unverified');
    assert.strictEqual(record.result, 'win');
    assert.strictEqual(record.resultSource, 'last_team');
    const stored = store.getLastGame('aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(stored.resultSource, 'last_team', 'result source survives normalization');
    console.log('Game result inference tests passed.');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
