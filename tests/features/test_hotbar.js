'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createQuickBuy } = require('../../src/menu/quickBuy');
const { parseHotbar, normalizeSlots } = require('../../src/menu/hotbarLayout');
const { createQuickBuyPlayerLookup } = require('../../src/menu/quickBuyImport');
const { createProxyTabCompleter } = require('../../features/command_completion');
const fixture = require('../../src/menu/fixtures/hotbar-menu.json');
const qbFixture = require('../../src/menu/fixtures/quickbuy-menus.json');
const empty = () => ({ blockId: -1 });
function item(name, lore = []) {
    return { blockId: 262, itemCount: 1, itemDamage: 0, nbtData: { type: 'compound', name: '', value: {
        display: { type: 'compound', value: { Name: { type: 'string', value: name },
            Lore: { type: 'list', value: { type: 'string', value: lore } } } }
    } } };
}
function harness(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-test-'));
    let win = 0, title, current, held = empty();
    const hot = structuredClone(fixture);
    const qb = Array.from({ length: 54 }, empty);
    for (const i of qbFixture['Edit Quick Buy'].items) qb[i.slot] = item(i.name, i.lore);
    const sent = [], messages = [], failures = [], events = [];
    let lookups = 0;
    const q = createQuickBuy({ presetDir: dir, canStart: () => null, minimumStillMs: 0,
        timeoutMs: options.stallPlace ? 100 : 8000, totalTimeoutMs: 3000, settleMs: 0,
        fetchPlayer: async () => { lookups++; return options.player; },
        sendChat: m => messages.push(m), sendClient: () => {}, disconnect: m => failures.push(m),
        sendUpstream(name, d) {
            sent.push([name, structuredClone(d)]);
            if (name === 'chat') setImmediate(() => open('Bed Wars Settings'));
            if (name === 'close_window') setImmediate(() => {
                assert(q.isActive(), 'lock retained until close response');
                cursor(empty());
            });
            if (name !== 'window_click') return;
            assert.deepStrictEqual(d.item, current[d.slot], 'echo destination item, not held category');
            assert.strictEqual(d.mode, 0);
            assert.strictEqual(d.mouseButton, title === 'Edit Quick Buy' && d.slot !== 49 ? 1 : 0);
            events.push([title, d.slot]);
            setImmediate(() => {
                if (title === 'Bed Wars Settings') return open(d.slot === 28 ? 'Hotbar Manager' : 'Edit Quick Buy');
                if (title === 'Edit Quick Buy') {
                    if (d.slot === 49) return open('Bed Wars Settings');
                    qb[d.slot] = item(qbFixture.emptySlot.name, qbFixture.emptySlot.lore);
                    return open('Edit Quick Buy');
                }
                if (d.slot < 18) {
                    held = structuredClone(hot[d.slot]);
                    cursor(held);
                    emit('window_items', { windowId: win, items: [...hot, ...Array.from({ length: 36 }, empty)] });
                    cursor(held); // duplicate update in real trace
                    if (options.cancelPickup) q.observeClient({ windowId: win }, { name: 'close_window' });
                    return;
                }
                if (options.stallPlace) return;
                hot[d.slot] = held.blockId === -1 ? empty() : item(held.nbtData.value.display.value.Name.value,
                    ['§7Category items will prioritize this slot!', '', '§eClick to remove!']);
                held = empty();
                cursor(empty());
                // Separate packet turn: clearing cursor alone cannot advance.
                const before = sent.length;
                setImmediate(() => {
                    assert.strictEqual(sent.length, before, 'wait for destination update too');
                    emit('set_slot', { windowId: win, slot: d.slot, item: hot[d.slot] });
                });
            });
        }
    });
    function emit(name, data) { q.observeServer(data, { name }); }
    function cursor(value) { emit('set_slot', { windowId: -1, slot: -1, item: value }); }
    function open(next) {
        title = next; win++;
        current = next === 'Hotbar Manager' ? hot : next === 'Edit Quick Buy' ? qb : Array.from({ length: 54 }, empty);
        if (next === 'Bed Wars Settings') { current[27] = item('§aEdit Quick Buy'); current[28] = item('§aHotbar Manager'); }
        emit('open_window', { windowId: win, windowTitle: JSON.stringify({ text: title }), slotCount: 54 });
        emit('window_items', { windowId: win, items: [...current, ...Array.from({ length: 36 }, empty)] });
        cursor(empty());
    }
    q.observeClient({ x: 1, y: 64, z: 1, onGround: true }, { name: 'position' });
    return { q, dir, hot, sent, messages, failures, events, lookups: () => lookups,
        cleanup() { q.dispose(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
(async () => {
    const text = 'Melee,Blocks,Pickaxe,Axe,Utility,Shears,Potions,null,Utility';
    const player = { stats: { Bedwars: { favorite_slots: text, favourites_2: Array(21).fill('null').join(',') } } };
    assert.strictEqual(parseHotbar(player)[7], null);
    assert.strictEqual(parseHotbar(player)[8], 'Utility');
    assert.throws(() => parseHotbar({}), /unavailable/);
    assert.throws(() => normalizeSlots(['Melee']), /9/);
    assert.throws(() => normalizeSlots(Array(9).fill('unknown')), /Unknown/);
    const lookup = createQuickBuyPlayerLookup({ globalCache: new Map([['someone', { timestamp: Date.now(), data: { player } }]]),
        cacheDuration: 300000, getPlayerData: () => { throw Error('Cache must avoid API request'); } });
    assert.deepStrictEqual(parseHotbar(await lookup('Someone')), parseHotbar(player));
    const tabs = createProxyTabCompleter({ knownPlayerNames: () => ['Someone'], layoutPresets: () => ['example'] });
    assert(tabs('/qba').includes('/qbahb'));
    assert(tabs('/hb lo').includes('load'));
    assert(tabs('/qbahb load ex').includes('example'));
    assert(tabs('/qb So').includes('Someone'));

    let h = harness({ player });
    try {
        await h.q.command(['/hb', 'save', 'example']);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(h.dir, 'hotbar/example.json'))).hotbar, parseHotbar(player));
        h.hot[27] = empty(); h.hot[28] = item('§aRanged'); h.hot[34] = item('§aBlocks');
        h.events.length = 0;
        await h.q.command(['/hotbar', 'load', 'example']);
        assert.deepStrictEqual(h.events.filter(e => e[0] === 'Hotbar Manager').map(e => e[1]), [11, 27, 10, 28, 34]);
        assert.deepStrictEqual(h.failures, []);
        h.events.length = 0;
        await h.q.command(['/hb', 'Someone']);
        assert.strictEqual(h.lookups(), 1);
        assert(!h.events.some(e => e[0] === 'Hotbar Manager'), 'unchanged layout skips every edit');
    } finally { h.cleanup(); }

    h = harness({ player });
    try {
        await h.q.command(['/qbahb', 'save', 'both']);
        const saved = JSON.parse(fs.readFileSync(path.join(h.dir, 'quickbuyandhotbar/both.json')));
        assert.strictEqual(saved.slots.length, 21); assert.strictEqual(saved.hotbar.length, 9);
        h.events.length = 0;
        await h.q.command(['/quickbuyandhotbar', 'load', 'both']);
        assert.deepStrictEqual(h.failures, []);
        h.events.length = 0;
        h.hot[27] = empty();
        await h.q.command(['/qbahb', 'Someone']);
        assert.strictEqual(h.lookups(), 1, 'one profile for both layouts');
        const lastQB = h.events.findLastIndex(e => e[0] === 'Edit Quick Buy');
        const firstHB = h.events.findIndex(e => e[0] === 'Hotbar Manager');
        assert(lastQB >= 0 && firstHB > lastQB, 'Quick Buy completes before hotbar');
        assert.deepStrictEqual(h.failures, []);
    } finally { h.cleanup(); }
    for (const option of ['cancelPickup', 'stallPlace']) {
        h = harness({ player, [option]: true });
        try {
            h.hot[27] = empty();
            await h.q.command(['/hb', 'Someone']);
            if (option === 'cancelPickup') {
                assert(!h.events.some(e => e[0] === 'Hotbar Manager' && e[1] === 27));
                assert(!h.q.isActive()); assert.deepStrictEqual(h.failures, []);
            } else assert(h.failures.some(m => /Timed out/.test(m)));
        } finally { h.cleanup(); }
    }
    h = harness({ player: { stats: { Bedwars: { favourites_2: player.stats.Bedwars.favourites_2 } } } });
    try {
        await h.q.command(['/qbahb', 'Someone']);
        assert.strictEqual(h.sent.length, 0, 'missing hotbar rejected before Quick Buy editing');
        assert(h.messages.some(m => m.includes('unavailable')));
    } finally { h.cleanup(); }
    console.log('Hotbar and combined layout tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
