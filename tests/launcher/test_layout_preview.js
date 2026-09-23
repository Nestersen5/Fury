'use strict';
const assert = require('assert');
const { createQuickBuyPreview, previewItems, POSITIONS } = require('../../src/menu/quickBuyPreview');
const { parseQuickBuy } = require('../../src/menu/quickBuyImport');
const { parseHotbar } = require('../../src/menu/hotbarLayout');
const { createProxyTabCompleter } = require('../../features/command_completion');
const mc = require('minecraft-protocol');
const serializer = mc.createSerializer({ state: 'play', isServer: true, version: '1.8.9' });
const player = { stats: { Bedwars: {
    favourites_2: ['wool', 'golden_apple', ...Array(19).fill('null')].join(','),
    favorite_slots: 'Melee,Blocks,Pickaxe,Axe,Utility,Shears,Potions,null,Utility'
} } };
const empty = () => ({ blockId: -1 });
function harness(options = {}) {
    let time = 1000, blocked = null, calls = 0;
    const sent = [], messages = [], disconnected = [];
    const p = createQuickBuyPreview({ sendClient(name, data) {
        // Every generated client packet must fit the actual 1.8.9 wire schema.
        serializer.createPacketBuffer({ name, params: data });
        sent.push([name, structuredClone(data)]);
    }, sendChat: m => messages.push(m), now: () => time, timeoutMs: options.timeoutMs || 5000,
        canStart: () => blocked, disconnect: m => disconnected.push(m),
        fetchPlayer: async name => { calls++; return options.fetch ? options.fetch(name) : player; } });
    const server = (name, data) => p.observeServer(data, { name });
    const client = (name, data) => p.observeClient(data, { name });
    server('login', { entityId: 42 });
    const inventory = Array.from({ length: 45 }, empty);
    inventory[36] = { blockId: 345, itemCount: 1, itemDamage: 0 };
    server('window_items', { windowId: 0, items: inventory });
    client('position', { x: 1, y: 64, z: 1, onGround: true });
    time += 1000;
    return { p, sent, messages, disconnected, server, client, inventory,
        block: value => { blocked = value; }, advance: ms => { time += ms; }, calls: () => calls,
        id: () => sent.filter(e => e[0] === 'open_window').at(-1)?.[1].windowId };
}
(async () => {
    const slots = parseQuickBuy(player), hotbar = parseHotbar(player);
    assert.strictEqual(previewItems(slots)[POSITIONS[0]].blockId, 35);
    assert.strictEqual(previewItems(slots)[POSITIONS[1]].blockId, 322);
    assert.strictEqual(previewItems(slots)[POSITIONS[2]].blockId, 160);
    const unknown = [...slots]; unknown[0] = { databaseName: 'future_item' };
    assert.strictEqual(previewItems(unknown)[10].blockId, 166);
    assert.strictEqual(previewItems(null, hotbar)[27].blockId, 283);
    const combined = previewItems(slots, hotbar);
    assert.strictEqual(combined[45].blockId, 283);
    assert(combined.slice(36, 45).every(i => i.blockId === -1), 'empty separator row');
    assert.strictEqual(combined[49].nbtData.value.display.value.Name.value, '§a5: Utility', 'close button must not overwrite hotbar');
    const tabs = createProxyTabCompleter({ knownPlayerNames: () => ['Someone'] });
    for (const command of ['/qb', '/quickbuy', '/hb', '/hotbar', '/qbahb', '/quickbuyandhotbar']) {
        assert(tabs(command + ' pre').includes('preview'));
        assert(tabs(command + ' preview So').includes('Someone'));
    }
    for (const mode of ['quickbuy', 'hotbar', 'quickbuyandhotbar']) {
        const h = harness();
        try {
            await h.p.command('Someone', mode);
            assert(h.p.isActive()); assert.strictEqual(h.calls(), 1);
            const id = h.id();
            for (let clickMode = 0; clickMode <= 6; clickMode++) {
                const click = { windowId: id, slot: 10, mouseButton: clickMode === 2 ? 8 : 0, mode: clickMode, action: clickMode + 1, item: empty() };
                assert(h.client('window_click', click));
                assert(!h.p.allowOutbound('window_click', click));
            }
            for (const name of ['block_dig', 'block_place', 'use_entity', 'arm_animation', 'entity_action', 'abilities',
                'set_creative_slot', 'held_item_slot', 'custom_payload', 'chat', 'tab_complete', 'enchant_item', 'unknown_packet']) {
                assert(h.client(name, { slot: 36, slotId: 3, item: empty() }), name);
                assert(!h.p.allowOutbound(name, {}), name + ' blocked through central transport');
            }
            assert(h.p.allowOutbound('position', { x: 2, y: 64, z: 1, onGround: true }));
            for (const packet of ['position', 'position_look', 'look', 'flying']) {
                const data = { x: 2, y: 65, z: 3, yaw: 20, pitch: 10, onGround: false };
                assert(!h.client(packet, data), 'movement reaches normal relay');
                assert(h.p.allowOutbound(packet, data), 'airborne movement passes transport');
            }
            assert(h.p.allowOutbound('position', { x: 1, y: 64, z: 1, onGround: true }));
            assert(h.p.allowOutbound('keep_alive', {}));
            assert(!h.p.allowOutbound('transaction', { windowId: 0, action: 20 }));
            h.server('transaction', { windowId: 0, action: 20, accepted: false });
            assert(h.p.allowOutbound('transaction', { windowId: 0, action: 20, accepted: true }));
            assert(h.server('set_slot', { windowId: 0, slot: 36, item: { blockId: 388, itemCount: 1, itemDamage: 0 } }));
            assert(h.p.isActive(), 'background inventory updates keep preview open');
            assert(h.client('close_window', { windowId: id }));
            assert(!h.p.isActive());
            assert.strictEqual(h.sent.filter(e => e[0] === 'window_items' && e[1].windowId === 0).at(-1)[1].items[36].blockId, 388);
            for (const name of ['window_click', 'close_window', 'transaction']) {
                assert(h.client(name, { windowId: id, action: 1 }));
                assert(!h.p.allowOutbound(name, { windowId: id }), 'late fake packets never forwarded');
            }
            await h.p.command('Someone', mode);
            assert.notStrictEqual(h.id(), id);
            h.client('window_click', { windowId: h.id(), slot: mode === 'quickbuyandhotbar' ? 8 : 49, mode: 0, mouseButton: 0, action: 1 });
            assert(!h.p.isActive());
        } finally { h.p.dispose(); }
    }
    for (const [name, data] of [['open_window', { windowId: 4, slotCount: 54 }], ['position', { x: 3, y: 70, z: 4 }],
        ['respawn', {}], ['login', { entityId: 43 }], ['kick_disconnect', {}],
        ['update_health', { health: 0 }], ['custom_payload', { channel: 'MC|BOpen' }]]) {
        const h = harness();
        try {
            await h.p.command('Someone');
            const before = h.sent.length;
            assert(!h.server(name, data)); assert(!h.p.isActive(), name);
            if (name === 'position') assert(!h.sent.slice(before).some(e => e[0] === 'position'), 'do not overwrite server teleport');
        } finally { h.p.dispose(); }
    }
    let h = harness();
    try {
        await h.p.command('Someone');
        const before = h.sent.length;
        for (let i = 0; i < 20; i++) {
            h.server('set_slot', { windowId: 0, slot: 36, item: h.inventory[36] });
            h.server('window_items', { windowId: 0, items: h.inventory });
            h.server('held_item_slot', { slot: i % 9 });
            h.server('entity_velocity', { entityId: 42, velocity: { x: 0, y: 0, z: 0 } });
            h.server('entity_velocity', { entityId: 99, velocity: { x: 100, y: 100, z: 0 } });
            h.server('explosion', { playerMotionX: 0, playerMotionY: 0, playerMotionZ: 0 });
            assert(!h.server('entity_velocity', { entityId: 42, velocity: { x: 100, y: 200, z: 50 } }));
            assert(!h.server('explosion', { playerMotionX: 0.1, playerMotionY: 0.2, playerMotionZ: 0 }));
        }
        assert(h.p.isActive(), 'harmless lobby updates keep preview open');
        assert.strictEqual(h.sent.length, before, 'unchanged lobby inventory does not repaint preview or reset selection');
        h.server('set_slot', { windowId: 0, slot: 36, item: { blockId: 388, itemCount: 1, itemDamage: 0 } });
        assert.strictEqual(h.sent.length, before + 1);
        assert.strictEqual(h.sent.at(-1)[0], 'set_slot');
        assert.strictEqual(h.sent.at(-1)[1].slot, 81);
        h.p.close();
        assert(!h.sent.some(e => e[0] === 'position'), 'preview never freezes or snaps player back on close');
        assert.strictEqual(h.sent.filter(e => e[0] === 'held_item_slot').at(-1)[1].slot, 1, 'restore latest server selection');
    } finally { h.p.dispose(); }
    h = harness();
    try {
        h.block('Editing is busy'); await h.p.command('Someone'); assert.strictEqual(h.calls(), 0);
        h.block(null); await h.p.command('Someone'); h.block('Game started'); h.server('chat', {}); assert(!h.p.isActive());
    } finally { h.p.dispose(); }
    h = harness();
    try {
        await h.p.command('Someone'); h.server('open_window', { windowId: h.id(), slotCount: 54 });
        assert.strictEqual(h.disconnected.length, 1, 'ID collision fails closed');
    } finally { h.p.dispose(); }
    let resolve;
    h = harness({ fetch: () => new Promise(r => { resolve = r; }) });
    try {
        const pending = h.p.command('Someone'); h.p.close(); resolve(player); await pending;
        assert(!h.sent.some(e => e[0] === 'open_window'), 'cancelled lookup never opens late preview');
    } finally { h.p.dispose(); }
    h = harness({ fetch: async () => ({ stats: { Bedwars: { favourites_2: player.stats.Bedwars.favourites_2 } } }) });
    try {
        await h.p.command('Someone', 'quickbuyandhotbar'); assert(!h.p.isActive());
        assert(h.messages.some(m => m.includes('unavailable')));
    } finally { h.p.dispose(); }
    h = harness({ timeoutMs: 10 });
    try {
        await h.p.command('Someone');
        await new Promise(resolve => setTimeout(resolve, 20));
        assert(!h.p.isActive(), 'idle previews auto-close');
    } finally { h.p.dispose(); }
    for (const action of ['disconnect', 'teleport', 'move']) {
        h = harness({ fetch: () => new Promise(r => { resolve = r; }) });
        try {
            const pending = h.p.command('Someone');
            if (action === 'disconnect') h.p.dispose();
            else if (action === 'teleport') h.server('position', { x: 5, y: 64, z: 5 });
            else h.client('position', { x: 2, y: 64, z: 1, onGround: true });
            resolve(player); await pending;
            assert.strictEqual(h.sent.some(e => e[0] === 'open_window'), action === 'move', 'movement allowed but relocation/disconnect cancels lookup');
        } finally { h.p.dispose(); }
    }
    h = harness();
    try {
        h.server('set_slot', { windowId: -1, slot: -1, item: { blockId: 1, itemCount: 1, itemDamage: 0 } });
        await h.p.command('Someone'); assert.strictEqual(h.calls(), 0, 'nonempty cursor blocks preview');
        h.server('set_slot', { windowId: -1, slot: -1, item: empty() });
        await h.p.command('Someone');
        const id = h.id();
        h.server('open_window', { windowId: 5, slotCount: 54 });
        assert(h.client('window_click', { windowId: id, slot: 10 }), 'stale fake click swallowed after real menu opens');
        assert(!h.client('window_click', { windowId: 5, slot: 10 }), 'real menu remains interactive');
        const realItems = Array.from({ length: 90 }, empty);
        realItems[81] = { blockId: 388, itemCount: 1, itemDamage: 0 };
        h.server('window_items', { windowId: 5, items: realItems });
        h.client('close_window', { windowId: 5 });
        await h.p.command('Someone'); h.p.close();
        assert.strictEqual(h.sent.filter(e => e[0] === 'window_items' && e[1].windowId === 0).at(-1)[1].items[36].blockId, 388,
            'inventory restored from latest real-container contents');
    } finally { h.p.dispose(); }
    console.log('Layout preview packet isolation tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
