'use strict';
const assert = require('assert');
const {
    createReplayResultAnnotator, parseReplayLore, normalizeServerId, findReplayClips
} = require('../../src/menu/replayResults.js');
const { simplifyNbt } = require('../../src/menu/menuMonitor.js');

function replayItem(lines) {
    return {
        blockId: 355, itemCount: 1, itemDamage: 14,
        nbtData: {
            type: 'compound', name: '', value: {
                display: { type: 'compound', value: {
                    Name: { type: 'string', value: '§aBed Wars (#0355)' },
                    Lore: { type: 'list', value: { type: 'string', value: lines } }
                } }
            }
        }
    };
}

// Lore as shown in Hypixel's Recent Games menu (times are US Eastern).
const LORE = [
    '§72026-09-17 16:02', '§7Duration: 07:50', '',
    '§7Mode: §aDoubles', '§7Map: §aSky Rise', '',
    '§7Server: §amini144AN', '§7Players: §a16', '',
    '§eClick to view replay!'
];
const loreOf = item => simplifyNbt(item.nbtData).display.Lore;

assert.strictEqual(normalizeServerId('mini144AN'), 'm144AN');
assert.strictEqual(normalizeServerId('mega12A'), 'M12A');
assert.deepStrictEqual(parseReplayLore(LORE), {
    serverId: 'm144AN', startNaiveMs: Date.UTC(2026, 8, 17, 16, 2), durationMs: 470000
});
assert.strictEqual(parseReplayLore(['§7Cost: 4 Iron']), null);

// Real tracked record: started 20:02:10Z (16:02 EDT), 475.8s long.
const games = [
    { at: Date.parse('2026-09-17T20:02:10.874Z') + 475769, durationMs: 475769, result: 'win',
        mode: 'BEDWARS', teammates: ['Mate1'],
        delta: { stats: { Bedwars: { kills_bedwars: 4, final_kills_bedwars: 2, beds_broken_bedwars: 1 } } },
        metadata: { serverId: 'm144AN' } },
    // Same server hours later: must not be picked.
    { at: Date.parse('2026-09-17T23:30:00Z'), durationMs: 300000, result: 'loss',
        metadata: { serverId: 'm144AN' } },
    // Result and K/F/B known only from chat events (API delta still pending).
    { at: Date.parse('2026-01-10T15:10:00Z'), durationMs: 600000, result: null, mode: 'BEDWARS',
        teammates: ['A1', 'B2', 'Me', 'C3', 'D4'],
        events: [
            { type: 'kill', actor: 'me' }, { type: 'kill', actor: 'Me' }, { type: 'kill', actor: 'A1' },
            { type: 'final_kill', actor: 'Me' }, { type: 'bed_break', actor: 'A1' }, { type: 'defeat' }
        ],
        metadata: { serverId: 'm7B' } },
    // Older record: relations never resolved, teammates come from the own team.
    { at: Date.parse('2026-09-18T19:50:45Z'), durationMs: 172000, result: 'win', mode: 'BEDWARS', teammates: [],
        roster: [
            { name: 'GirlyPieLife', team: 'Green', relation: 'unknown' },
            { name: 'rahhmann', team: 'Blue', relation: 'unknown' }
        ],
        metadata: { serverId: 'm106DV', team: 'Green' } },
    // Ranks: saved at game end, a nick denicked at game end, a nick denicked
    // only now (live), and a nick whose real account has no cached profile.
    { at: Date.parse('2026-09-19T12:10:00Z'), durationMs: 600000, result: 'loss', mode: 'BEDWARS',
        teammates: ['Ranked', 'OldNick', 'NewNick'],
        roster: [
            { name: 'Ranked', display: '§b[MVP§c+§b] Ranked', relation: 'teammate' },
            { name: 'OldNick', realName: 'OldReal', display: '§a[VIP] OldReal', relation: 'teammate' },
            { name: 'NewNick', relation: 'teammate' }
        ],
        metadata: { serverId: 'm8R', team: 'Red' } },
    { at: Date.parse('2026-09-19T13:10:00Z'), durationMs: 600000, result: 'win', mode: 'BEDWARS',
        teammates: ['BareNick', 'Me2'],
        metadata: { serverId: 'm8S', team: 'Red' } },
    // Non-BedWars game: result only, no stats or teammates line.
    { at: Date.parse('2026-02-01T12:05:00Z'), durationMs: 300000, result: 'win', mode: 'DUELS',
        metadata: { serverId: 'm3C' } }
];
// Clips: one on the tracked Victory game, one on a game with no tracked result.
const clipGames = [
    { serverId: 'm144AN', mode: 'BEDWARS', startedAt: Date.parse('2026-09-17T20:02:30Z'), clips: [
        { offsetMs: 465000, label: 'late one', at: 1 },
        { offsetMs: 192000, label: 'Clip 1', at: 1 }
    ] },
    { serverId: 'm5Q', mode: 'BEDWARS', startedAt: Date.parse('2026-09-18T14:00:10Z'), clips: [
        { offsetMs: 60000, label: 'a', at: 1 }, { offsetMs: 120000, label: 'b', at: 1 },
        { offsetMs: 180000, label: 'c', at: 1 }, { offsetMs: 240000, label: 'd', at: 1 },
        { offsetMs: 300000, label: 'e', at: 1 }, { offsetMs: 360000, label: 'f', at: 1 }
    ] }
];
const LIVE = {
    NewNick: { realName: 'NewReal', display: '§6[MVP§0++§6] NewReal' },
    BareNick: { realName: 'BareReal', display: null },
    // A nick that turns out to be you is dropped.
    Me2: { realName: 'Me', display: null }
};
const annotator = createReplayResultAnnotator({
    getGames: () => games, getClipGames: () => clipGames, getSelfName: () => 'Me',
    resolvePlayer: name => LIVE[name] || { realName: name, display: null }
});

const packet = { windowId: 3, items: [replayItem(LORE), { blockId: -1 }] };
const out = annotator.rewriteClientbound('window_items', packet);
assert.notStrictEqual(out, packet);
assert.deepStrictEqual(loreOf(out.items[0]).slice(7, 18), [
    '§7Players: §a16',
    '',
    '§7Result: §a§lVictory',
    '§7Kills §a4 §8· §7Finals §a2 §8· §7Beds §a1',
    '',
    '§7With:',
    '§8- §fMate1',
    '',
    '§7Clips:',
    '§8- §e03:12 §fClip 1',
    '§8- §e07:45 §flate one'
]);
assert.strictEqual(loreOf(packet.items[0]).length, LORE.length, 'server-side item untouched');

// Already annotated items are left alone.
assert.strictEqual(annotator.rewriteClientbound('set_slot', { windowId: 3, slot: 0, item: out.items[0] }).item, out.items[0]);

// EST (winter) offset + event-derived result via set_slot.
const winter = replayItem(['§72026-01-10 10:00', '§7Duration: 10:00', '§7Server: §amini7B', '§7Players: §a8', '§eClick to view replay!']);
const slot = annotator.rewriteClientbound('set_slot', { windowId: 5, slot: 11, item: winter });
assert.deepStrictEqual(loreOf(slot.item).slice(4, 13), [
    '',
    '§7Result: §c§lDefeat',
    '§7Kills §a2 §8· §7Finals §a1 §8· §7Beds §a0',
    '',
    '§7With:', '§8- §fA1', '§8- §fB2', '§8- §fC3', '§8+1 more'
]);

// Clips alone, no tracked game: capped at four with a "+N more" line.
const clipOnly = replayItem(['§72026-09-18 10:00', '§7Duration: 20:00', '§7Server: §amini5Q', '§eClick to view replay!']);
const clipOnlyOut = annotator.rewriteClientbound('set_slot', { windowId: 5, slot: 13, item: clipOnly });
assert.deepStrictEqual(loreOf(clipOnlyOut.item).slice(3, 10), [
    '', '§7Clips:', '§8- §e01:00 §fa', '§8- §e02:00 §fb', '§8- §e03:00 §fc', '§8- §e04:00 §fd', '§8+2 more'
]);
assert.strictEqual(annotator.rewriteClientbound('set_slot', { windowId: 5, slot: 13, item: clipOnlyOut.item }).item,
    clipOnlyOut.item, 'clip-only items are not annotated twice');

const old = replayItem(['§72026-09-18 15:47', '§7Duration: 02:52', '§7Server: §amini106DV', '§7Players: §a12', '§eClick to view replay!']);
const oldOut = annotator.rewriteClientbound('set_slot', { windowId: 5, slot: 14, item: old });
assert.deepStrictEqual(loreOf(oldOut.item).slice(4, 9), ['', '§7Result: §a§lVictory', '', '§7With:', '§8- §fGirlyPieLife']);

const ranked = replayItem(['§72026-09-19 08:00', '§7Duration: 10:00', '§7Server: §amini8R', '§7Players: §a16', '§eClick to view replay!']);
assert.deepStrictEqual(loreOf(annotator.rewriteClientbound('set_slot', { windowId: 5, slot: 15, item: ranked }).item).slice(7, 11), [
    '§7With:', '§8- §b[MVP§c+§b] Ranked', '§8- §a[VIP] OldReal', '§8- §6[MVP§0++§6] NewReal'
]);
const bare = replayItem(['§72026-09-19 09:00', '§7Duration: 10:00', '§7Server: §amini8S', '§7Players: §a16', '§eClick to view replay!']);
assert.deepStrictEqual(loreOf(annotator.rewriteClientbound('set_slot', { windowId: 5, slot: 16, item: bare }).item).slice(7, 10), [
    '§7With:', '§8- §fBareReal', '§eClick to view replay!'
]);

// A throwing resolver must not break the menu.
const broken = createReplayResultAnnotator({ getGames: () => games, resolvePlayer: () => { throw new Error('x'); } });
assert.deepStrictEqual(loreOf(broken.rewriteClientbound('set_slot', { windowId: 5, slot: 16, item: bare }).item).slice(7, 10), [
    '§7With:', '§8- §fBareNick', '§8- §fMe2'
]);

const duel = replayItem(['§72026-02-01 07:00', '§7Duration: 05:00', '§7Server: §amini3C', '§eClick to view replay!']);
const duelOut = annotator.rewriteClientbound('set_slot', { windowId: 5, slot: 12, item: duel });
assert.deepStrictEqual(loreOf(duelOut.item).slice(3, 6), ['', '§7Result: §a§lVictory', '§eClick to view replay!']);

// Untracked games and player inventory are untouched.
const unknown = { windowId: 3, items: [replayItem(LORE.map(line => line.replace('mini144AN', 'mini9Z')))] };
assert.strictEqual(annotator.rewriteClientbound('window_items', unknown), unknown);
const inventory = { windowId: 0, items: [replayItem(LORE)] };
assert.strictEqual(annotator.rewriteClientbound('window_items', inventory), inventory);

// Entering a replay: its sidebar gives the server and Eastern start time;
// the clips come back oldest first, and other games give none.
const replayStart = Date.UTC(2026, 8, 17, 16, 2);
assert.deepStrictEqual(findReplayClips(clipGames, { serverId: 'mini144AN', startNaiveMs: replayStart }).map(clip => clip.label), ['Clip 1', 'late one']);
assert.deepStrictEqual(findReplayClips(clipGames, { serverId: 'mini144AN', startNaiveMs: replayStart + 3600000 }), []);
assert.deepStrictEqual(findReplayClips(clipGames, { serverId: 'mini9Z', startNaiveMs: replayStart }), []);
assert.deepStrictEqual(findReplayClips(clipGames, { serverId: null, startNaiveMs: replayStart }), []);

console.log('Replay result tests passed.');
