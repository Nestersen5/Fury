'use strict';
const assert = require('assert');
const { createRankBook, STALE_AFTER_MS } = require('../../src/stats/rankBook.js');
const { createReplayResultAnnotator } = require('../../src/menu/replayResults.js');
const { simplifyNbt } = require('../../src/menu/menuMonitor.js');

// Rank book: in-memory file, controllable clock and save timer.
let clock = Date.parse('2026-09-19T12:00:00Z');
let pendingSave = null;
const writes = [];
const files = {
    'ranks.json': JSON.stringify({ version: 1, players: {
        nestersen: { name: 'Nestersen', display: '§6[MVP§0++§6] Nestersen', at: clock - 1000 },
        broken: { name: 'bad name!', display: '§a[VIP] x', at: clock }
    } })
};
const book = createRankBook({
    rankFile: 'ranks.json',
    writeJsonOffThread: (file, data) => writes.push(data),
    now: () => clock,
    fsImpl: { readFileSync: name => files[name] },
    setTimeoutImpl: fn => { pendingSave = fn; return 1; },
    clearTimeoutImpl: () => { pendingSave = null; }
});

assert.strictEqual(book.get('NESTERSEN').display, '§6[MVP§0++§6] Nestersen', 'loads saved entries, case-insensitive');
assert.strictEqual(book.get('bad name!'), null, 'invalid names are dropped on load');
assert.strictEqual(book.isStale('Nestersen'), false);
assert.strictEqual(book.isStale('Unknown'), true, 'unknown names count as stale');

// A rank change replaces the old display and is saved.
book.record('Nestersen', '§b[MVP§c+§b] Nestersen');
assert.strictEqual(book.get('nestersen').display, '§b[MVP§c+§b] Nestersen');
assert.ok(pendingSave, 'a changed rank schedules a save');
pendingSave();
pendingSave = null;
assert.strictEqual(writes.length, 1);
assert.strictEqual(writes[0].players.nestersen.display, '§b[MVP§c+§b] Nestersen');

// An unchanged, recent rank refreshes the timestamp without another write.
clock += 1000;
book.record('Nestersen', '§b[MVP§c+§b] Nestersen');
assert.strictEqual(pendingSave, null);

// After three days the entry is stale, so it gets refreshed when shown.
clock += STALE_AFTER_MS + 1;
assert.strictEqual(book.isStale('Nestersen'), true);
assert.strictEqual(STALE_AFTER_MS, 3 * 24 * 3600000);

book.record('bad name!', '§a[VIP] x');
assert.strictEqual(book.get('bad name!'), null, 'invalid names are never recorded');

// Annotator: teammates with an unknown or stale rank are reported for a
// background lookup; undenicked nicks never are.
function replayItem(lines) {
    return {
        blockId: 355, itemCount: 1, itemDamage: 14,
        nbtData: { type: 'compound', name: '', value: { display: { type: 'compound', value: {
            Name: { type: 'string', value: '§aBed Wars' },
            Lore: { type: 'list', value: { type: 'string', value: lines } }
        } } } }
    };
}
const loreOf = item => simplifyNbt(item.nbtData).display.Lore;
const games = [{
    at: Date.parse('2026-09-18T19:00:00Z'), durationMs: 600000, result: 'win', mode: 'BEDWARS',
    teammates: ['Fresh', 'Stale', 'Unknown', 'SomeNick'],
    roster: [{ name: 'SomeNick', realName: 'SomeNick', nicked: true, relation: 'teammate' }],
    metadata: { serverId: 'm1A', team: 'Red' }
}];
const ranks = {
    Fresh: { realName: 'Fresh', display: '§a[VIP] Fresh', stale: false },
    Stale: { realName: 'Stale', display: '§b[MVP] Stale', stale: true }
};
const reported = [];
let enabled = true;
const annotator = createReplayResultAnnotator({
    getGames: () => games,
    resolvePlayer: name => ranks[name] || { realName: name, display: null, stale: true },
    onMissingPlayers: names => reported.push(names),
    isEnabled: () => enabled
});
const item = replayItem(['§72026-09-18 14:50', '§7Duration: 10:00', '§7Server: §amini1A', '§eClick to view replay!']);
const out = annotator.rewriteClientbound('set_slot', { windowId: 4, slot: 10, item });
assert.deepStrictEqual(loreOf(out.item).slice(3, 10), [
    '', '§7Result: §a§lVictory', '', '§7With:', '§8- §a[VIP] Fresh', '§8- §b[MVP] Stale', '§8- §fUnknown'
]);
assert.deepStrictEqual(reported, [['Stale', 'Unknown']], 'stale and unknown ranks are looked up, nicks are not');

// Once the lookups land, the redraw hook shows the new rank.
ranks.Unknown = { realName: 'Unknown', display: '§6[MVP§0++§6] Unknown', stale: false };
annotator.invalidate();
assert.strictEqual(loreOf(annotator.annotate(item))[9], '§8- §6[MVP§0++§6] Unknown');

// Setting off: menus pass through untouched.
enabled = false;
const packet = { windowId: 4, slot: 10, item };
assert.strictEqual(annotator.rewriteClientbound('set_slot', packet), packet);
assert.strictEqual(annotator.annotate(item), null);

console.log('Rank book tests passed.');
