'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert');
const {
    createClipStore, bedwarsElapsedFromSidebar, isStandardBedwarsVariant,
    cleanClipLabel, formatClipTime, MAX_GAME_MS
} = require('../../src/session/gameClips.js');

const MIN = 60000;

// Sidebar countdown -> time since game start. 3:20 left to Emerald II means
// 6 minutes of Diamond II plus 2:40 of Emerald II.
assert.strictEqual(bedwarsElapsedFromSidebar(['§fEmerald II in §a3:20']), 8 * MIN + 40000);
assert.strictEqual(bedwarsElapsedFromSidebar(['Diamond II in 5:59']), 1000);
assert.strictEqual(bedwarsElapsedFromSidebar(['Diamond III in 6:00']), 12 * MIN);
assert.strictEqual(bedwarsElapsedFromSidebar(['Emerald III in 0:30']), 23 * MIN + 30000);
assert.strictEqual(bedwarsElapsedFromSidebar(['Bed Gone in 1:00']), 29 * MIN);
assert.strictEqual(bedwarsElapsedFromSidebar(['Sudden Death in 10:00']), 30 * MIN);
assert.strictEqual(bedwarsElapsedFromSidebar(['Game End in 2:00']), 48 * MIN);
// Sidebar entries arrive with an emoji between the team prefix and suffix.
assert.strictEqual(bedwarsElapsedFromSidebar(['09/17/26 m144AN', '§fDiamond II in \u{1F52E}§a4:00']), 2 * MIN);
// Unknown lines, impossible countdowns and nothing at all give no answer.
assert.strictEqual(bedwarsElapsedFromSidebar(['Red: ✔', 'Kills: 3']), null);
assert.strictEqual(bedwarsElapsedFromSidebar(['Emerald II in 9:00']), null);
assert.strictEqual(bedwarsElapsedFromSidebar(null), null);

assert.ok(isStandardBedwarsVariant('Doubles'));
assert.ok(!isStandardBedwarsVariant('4v4'));
assert.ok(!isStandardBedwarsVariant(null));

assert.strictEqual(cleanClipLabel('  §cfour  man \u0007clutch  '), 'four man clutch');
assert.strictEqual(cleanClipLabel('x'.repeat(40)).length, 24);
assert.strictEqual(formatClipTime(8 * MIN + 40000), '08:40');
assert.strictEqual(formatClipTime(65 * MIN), '1:05:00');

// Store: in-memory writer, controllable clock.
let clock = Date.parse('2026-09-17T20:10:00Z');
const writes = [];
const store = createClipStore({
    clipFile: `${REPOSITORY_ROOT}/tmp/__missing_clip_test__/game_clips.json`,
    writeJsonOffThread: (file, data) => writes.push(data),
    now: () => clock
});

const first = store.addClip({ serverId: 'm144AN', mode: 'BEDWARS', elapsedMs: 8 * MIN, label: '' });
assert.ok(first.ok);
assert.strictEqual(first.clip.label, 'Clip 1');
assert.strictEqual(first.clip.offsetMs, 8 * MIN);
assert.strictEqual(writes.length, 1, 'saved immediately');

// Within the cooldown: refused.
clock += 1000;
assert.deepStrictEqual(store.addClip({ serverId: 'm144AN', mode: 'BEDWARS', elapsedMs: 8 * MIN + 1000 }), { ok: false, reason: 'cooldown' });

// After a 10 minute disconnect the offset still counts the time away, and
// the clip lands in the same game.
clock += 10 * MIN;
const second = store.addClip({ serverId: 'm144AN', mode: 'BEDWARS', elapsedMs: 18 * MIN + 1000, label: 'triple clutch' });
assert.ok(second.ok);
assert.strictEqual(second.number, 2);
assert.strictEqual(store.listGames().length, 1);
assert.deepStrictEqual(store.listGames()[0].clips.map(clip => clip.label), ['Clip 1', 'triple clutch']);

// A game past the maximum length is refused rather than stamped.
assert.deepStrictEqual(store.addClip({ serverId: 'm144AN', mode: 'BEDWARS', elapsedMs: MAX_GAME_MS + 1 }), { ok: false, reason: 'too_long' });
assert.deepStrictEqual(store.addClip({ serverId: 'm1', mode: 'BEDWARS', elapsedMs: NaN }), { ok: false, reason: 'no_game' });

// Next game on another server starts its own numbering.
clock += 30 * MIN;
const next = store.addClip({ serverId: 'm9Z', mode: 'BEDWARS', elapsedMs: 2 * MIN });
assert.strictEqual(next.clip.label, 'Clip 1');
assert.strictEqual(store.listGames().length, 2);

// Ten clips per game at most.
for (let i = 0; i < 9; i += 1) {
    clock += 5000;
    assert.ok(store.addClip({ serverId: 'm9Z', mode: 'BEDWARS', elapsedMs: 2 * MIN + (i + 1) * 5000 }).ok);
}
clock += 5000;
assert.deepStrictEqual(store.addClip({ serverId: 'm9Z', mode: 'BEDWARS', elapsedMs: 3 * MIN }), { ok: false, reason: 'full' });

// Games older than 30 days are dropped on the next write.
clock += 31 * 24 * 3600000;
store.addClip({ serverId: 'm1A', mode: 'BEDWARS', elapsedMs: MIN });
assert.deepStrictEqual(store.listGames().map(game => game.serverId), ['m1A']);

console.log('Game clip tests passed.');
