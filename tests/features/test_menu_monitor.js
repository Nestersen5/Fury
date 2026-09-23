'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createMenuMonitor,
    describeItem,
    describeClick,
    simplifyNbt,
    decodeTitle,
    slotLabel
} = require('../../src/menu/menuMonitor.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-monitor-test-'));

let fakeNow = 2_000_000;

// Synchronous stream stand-in so the test can read the JSONL back immediately.
const syncWriteStream = (file) => ({
    write: (chunk) => fs.appendFileSync(file, chunk),
    end: () => {},
    on: () => {}
});

function nbtString(value) {
    return { type: 'string', value };
}

function guiItem(name, lore = [], { blockId = 35, itemDamage = 5, itemCount = 1 } = {}) {
    return {
        blockId,
        itemCount,
        itemDamage,
        nbtData: {
            type: 'compound',
            name: '',
            value: {
                display: {
                    type: 'compound',
                    value: {
                        Name: nbtString(name),
                        Lore: { type: 'list', value: { type: 'string', value: lore } }
                    }
                }
            }
        }
    };
}

// ------------------------------------------------------------ pure helpers

assert.strictEqual(decodeTitle('{"text":"Settings"}'), 'Settings');
assert.strictEqual(decodeTitle('{"text":"A","extra":[{"text":"B"}]}'), 'AB');
assert.strictEqual(decodeTitle('Plain Title'), 'Plain Title');
assert.strictEqual(decodeTitle('{not json'), '{not json');

assert.deepStrictEqual(
    simplifyNbt({ type: 'compound', value: { a: { type: 'int', value: 4 } } }),
    { a: 4 }
);
assert.deepStrictEqual(
    simplifyNbt({ type: 'list', value: { type: 'string', value: ['x', 'y'] } }),
    ['x', 'y']
);

assert.strictEqual(describeItem({ blockId: -1 }), null);
assert.strictEqual(describeItem(null), null);
const described = describeItem(guiItem('§aAuto Respawn', ['§7Currently: §aON', '§eClick to toggle']));
assert.strictEqual(described.plainName, 'Auto Respawn');
assert.deepStrictEqual(described.plainLore, ['Currently: ON', 'Click to toggle']);
assert.strictEqual(described.count, 1);
assert.strictEqual(described.damage, 5);

assert.strictEqual(describeClick(0, 0, 11), 'left click');
assert.strictEqual(describeClick(0, 1, 11), 'right click');
assert.strictEqual(describeClick(1, 0, 11), 'shift + left click');
assert.strictEqual(describeClick(2, 3, 11), 'number key 4 (hotbar slot 3)');
assert.strictEqual(describeClick(4, 0, 11), 'drop one (Q)');
assert.strictEqual(describeClick(6, 0, 11), 'double click');
assert.strictEqual(describeClick(0, 0, -999), 'drop stack (outside)');

const chestWindow = { windowId: 3, slotCount: 54 };
assert.strictEqual(slotLabel(0, chestWindow), '0 (r1c1)');
assert.strictEqual(slotLabel(11, chestWindow), '11 (r2c3)');
assert.strictEqual(slotLabel(54, chestWindow), '54 (inventory)');
assert.strictEqual(slotLabel(81, chestWindow), '81 (hotbar 0)');
assert.strictEqual(slotLabel(-999, chestWindow), 'outside');
assert.strictEqual(slotLabel(6, { windowId: 0, slotCount: 45 }), '6 (armor)');

// ------------------------------------------------------------ live monitor

const chat = [];
const upstream = [];
const monitor = createMenuMonitor({
    sendChat: (line) => chat.push(line),
    sendUpstream: (name, data) => upstream.push({ name, data }),
    dir,
    now: () => fakeNow,
    createWriteStream: syncWriteStream,
    itemNameLookup: (id) => (id === 35 ? 'wool' : null),
    log: () => {}
});

// Non-menu packets are ignored in both directions.
assert.strictEqual(monitor.observeServerPacket({ x: 1 }, { name: 'position' }), false);
assert.strictEqual(monitor.observeClientPacket({ x: 1 }, { name: 'flying' }), false);
assert.strictEqual(chat.length, 0);

// Window state is tracked even while reporting is off.
monitor.observeServerPacket(
    { windowId: 3, inventoryType: 'minecraft:chest', windowTitle: '{"text":"Settings"}', slotCount: 54 },
    { name: 'open_window' }
);
const items = new Array(54).fill({ blockId: -1 });
items[11] = guiItem('§aAuto Respawn', ['§7Currently: §aON']);
items[13] = guiItem('§bParticle Quality', ['§7Currently: §aHigh'], { blockId: 35, itemDamage: 3 });
monitor.observeServerPacket({ windowId: 3, items }, { name: 'window_items' });
assert.strictEqual(chat.length, 0, 'reporting off means no chat echo');

const tracked = monitor.getWindow();
assert.strictEqual(tracked.windowId, 3);
assert.strictEqual(tracked.plainTitle, 'Settings');
assert.strictEqual(tracked.slotCount, 54);
assert.strictEqual(tracked.slots.size, 2);
assert.strictEqual(tracked.slots.get(11).plainName, 'Auto Respawn');
assert.strictEqual(tracked.slots.get(11).type, 'wool');

// find matches on name, on lore, and by explicit slot.
assert.deepStrictEqual(monitor.findSlots('auto respawn').map(m => m.slot), [11]);
assert.deepStrictEqual(monitor.findSlots('currently').map(m => m.slot), [11, 13]);
assert.deepStrictEqual(monitor.findSlots('#13').map(m => m.slot), [13]);
assert.deepStrictEqual(monitor.findSlots('nothing here'), []);

// A synthesised click carries the exact slot item the server last sent.
const click = monitor.clickSlot({ slot: 11 });
assert.strictEqual(click.ok, true);
assert.strictEqual(upstream.length, 1);
assert.strictEqual(upstream[0].name, 'window_click');
assert.strictEqual(upstream[0].data.windowId, 3);
assert.strictEqual(upstream[0].data.slot, 11);
assert.strictEqual(upstream[0].data.mode, 0);
assert.strictEqual(upstream[0].data.mouseButton, 0);
assert.deepStrictEqual(upstream[0].data.item, items[11], 'click must echo back the tracked wire item');

// The transaction answering our click is swallowed and confirmed for the client.
fakeNow += 40;
const swallowed = monitor.observeServerPacket(
    { windowId: 3, action: upstream[0].data.action, accepted: false },
    { name: 'transaction' }
);
assert.strictEqual(swallowed, true, 'synthetic transactions must not reach the client');
assert.strictEqual(upstream[1].name, 'transaction');
assert.deepStrictEqual(upstream[1].data, { windowId: 3, action: upstream[0].data.action, accepted: true });

// A transaction for a click the real client made is forwarded untouched.
monitor.observeClientPacket(
    { windowId: 3, slot: 13, mouseButton: 0, action: 7, mode: 0, item: items[13] },
    { name: 'window_click' }
);
assert.strictEqual(
    monitor.observeServerPacket({ windowId: 3, action: 7, accepted: true }, { name: 'transaction' }),
    false
);

// Synthetic action numbers stay clear of the client's own counter.
const secondClick = monitor.clickSlot({ slot: 13, mode: 1, button: 0 });
assert.ok(secondClick.action > 7, 'synthetic actions must not collide with client action numbers');
assert.strictEqual(secondClick.click, 'shift + left click');

// Out-of-range slots are rejected rather than sent.
const beforeBadClick = upstream.length;
assert.strictEqual(monitor.clickSlot({ slot: 999 }).ok, false);
assert.strictEqual(monitor.clickSlot({ slot: Number.NaN }).ok, false);
assert.strictEqual(upstream.length, beforeBadClick, 'a rejected click sends nothing');

// ------------------------------------------------------------------- hold

// With hold off, the client's close_window passes through and clears state.
assert.strictEqual(monitor.observeClientPacket({ windowId: 3 }, { name: 'close_window' }), false);
assert.strictEqual(monitor.getWindow(), null);

monitor.observeServerPacket(
    { windowId: 4, inventoryType: 'minecraft:chest', windowTitle: '{"text":"Settings"}', slotCount: 54 },
    { name: 'open_window' }
);
monitor.setHold(true);
assert.strictEqual(
    monitor.observeClientPacket({ windowId: 4 }, { name: 'close_window' }),
    true,
    'hold must swallow the close so the menu stays open server-side'
);
assert.ok(monitor.getWindow(), 'held window stays tracked');
// A close for some other window id is never held back.
assert.strictEqual(monitor.observeClientPacket({ windowId: 9 }, { name: 'close_window' }), false);
monitor.setHold(false);

// ---------------------------------------------------------------- commands

chat.length = 0;
monitor.handleCommand(null, ['/menudebug', 'on']);
assert.ok(monitor.isEnabled());
assert.ok(chat.some(line => line.includes('enabled')));

chat.length = 0;
monitor.handleCommand(null, ['/menudebug', 'dump']);
assert.ok(chat[0].includes('Settings'), 'dump should name the open window');

chat.length = 0;
monitor.handleCommand(null, ['/menudebug', 'close']);
assert.strictEqual(upstream[upstream.length - 1].name, 'close_window');
assert.strictEqual(monitor.getWindow(), null);

chat.length = 0;
monitor.handleCommand(null, ['/menudebug', 'dump']);
assert.ok(chat[0].includes('No container window'), 'dump with nothing open should say so');

chat.length = 0;
monitor.handleCommand(null, ['/menudebug', 'status']);
assert.ok(chat.some(line => line.includes('Monitor')));

// ------------------------------------------------------------- nav walking

const nav = createMenuMonitor({
    sendChat: () => {},
    sendUpstream: (name, data) => upstream.push({ name, data }),
    dir: null,
    now: () => fakeNow,
    log: () => {}
});
const navItems = new Array(54).fill({ blockId: -1 });
navItems[20] = guiItem('§aGeneral Settings');
nav.observeServerPacket(
    { windowId: 5, inventoryType: 'minecraft:chest', windowTitle: 'Main', slotCount: 54 },
    { name: 'open_window' }
);
nav.observeServerPacket({ windowId: 5, items: navItems }, { name: 'window_items' });
upstream.length = 0;
nav.handleCommand(null, ['/menudebug', 'nav', 'General Settings', '>', 'Auto Respawn']);
assert.strictEqual(upstream.length, 1, 'nav clicks the first step immediately');
assert.strictEqual(upstream[0].data.slot, 20);
assert.deepStrictEqual(nav.getDebugState().menuNavStep, '2/2');
nav.dispose();

// ------------------------------------------------------------------- state

const debugState = monitor.getDebugState();
assert.strictEqual(debugState.menuMonitor, true);
assert.strictEqual(debugState.menuWindow, 'none');
assert.strictEqual(debugState.menuNavStep, 'idle');

// ------------------------------------------------------------- jsonl output

monitor.flush();
monitor.dispose();
const logFiles = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'));
assert.strictEqual(logFiles.length, 1, 'one JSONL file per session');
const lines = fs.readFileSync(path.join(dir, logFiles[0]), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
const kinds = lines.map(line => `${line.dir}:${line.p}`);
assert.ok(kinds.includes('s2c:open_window'));
assert.ok(kinds.includes('s2c:window_items'));
assert.ok(kinds.includes('c2s:window_click'));
assert.ok(kinds.includes('s2c:transaction'));
assert.ok(kinds.includes('c2s:close_window_suppressed'), 'held closes are recorded');
const windowItemsLine = lines.find(line => line.p === 'window_items');
assert.strictEqual(windowItemsLine.count, 54);
assert.strictEqual(windowItemsLine.items.length, 2);
assert.strictEqual(windowItemsLine.items[0].slot, 11);
assert.deepStrictEqual(windowItemsLine.items[0].lore, ['§7Currently: §aON']);

// A monitor with no directory logs nothing and still works.
const quiet = createMenuMonitor({ dir: null, now: () => fakeNow, log: () => {} });
quiet.observeServerPacket(
    { windowId: 1, inventoryType: 'minecraft:chest', windowTitle: 'X', slotCount: 9 },
    { name: 'open_window' }
);
assert.ok(quiet.getWindow());
quiet.dispose();

fs.rmSync(dir, { recursive: true, force: true });
console.log('Menu monitor tests passed.');
