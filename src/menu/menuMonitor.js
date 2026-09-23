'use strict';

// Menu / inventory packet monitor and driver (/menudebug).
//
// Watches ONLY the inventory-GUI slice of the packet stream, in both
// directions, and keeps a live model of the window Hypixel currently has
// open for this connection:
//
//   server -> client : open_window, window_items, set_slot,
//                      craft_progress_bar, close_window, transaction
//   client -> server : window_click, close_window, transaction,
//                      enchant_item, set_creative_slot
//
// Anything else costs one Set lookup and a return, so the relay path is
// untouched outside menus. Window state is tracked even while reporting is
// off, so dump/click work the instant you enable it.
//
// Beyond watching, it can drive a menu the way the vanilla client would:
//   - `hold`  keeps the SERVER-side window open when you close the GUI
//             locally, so you can type commands and keep clicking.
//   - `click` synthesises a window_click for a slot.
//   - `nav`   walks a chain of menu entries by display name.
// Transactions belonging to synthesised clicks are answered by us and
// swallowed, so the real client never sees an action number it never sent.

const fs = require('fs');
const path = require('path');

const SERVER_MENU_PACKETS = new Set([
    'open_window',
    'window_items',
    'set_slot',
    'craft_progress_bar',
    'close_window',
    'transaction'
]);

const CLIENT_MENU_PACKETS = new Set([
    'window_click',
    'close_window',
    'transaction',
    'enchant_item',
    'set_creative_slot'
]);

// Chat echo for these is pure noise during normal play; the JSONL log and
// /menudebug dump always carry them.
const VERBOSE_ONLY_PACKETS = new Set(['set_slot', 'transaction', 'craft_progress_bar']);

const FLUSH_INTERVAL_MS = 500;
const NAV_SETTLE_MS = 350;
const NAV_STEP_TIMEOUT_MS = 6_000;
const PENDING_ACTION_TTL_MS = 15_000;
const MAX_DUMP_LINES = 40;
const MAX_LORE_LINES = 6;

// ---------------------------------------------------------------- helpers

function stripColors(value) {
    return String(value == null ? '' : value).replace(/§[0-9a-fk-or]/gi, '');
}

// 1.8 sends window titles as a JSON chat component inside a string field.
function flattenComponent(node) {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(flattenComponent).join('');
    let text = typeof node.text === 'string' ? node.text : '';
    if (!text && typeof node.translate === 'string') text = node.translate;
    if (Array.isArray(node.extra)) text += node.extra.map(flattenComponent).join('');
    return text;
}

function decodeTitle(raw) {
    const value = String(raw == null ? '' : raw);
    if (!value.startsWith('{') && !value.startsWith('[') && !value.startsWith('"')) return value;
    try {
        return flattenComponent(JSON.parse(value));
    } catch (error) {
        return value;
    }
}

// prismarine-nbt hands back {type, value} nodes; lists wrap their elements in
// one more {type, value}. Collapse both shapes into plain JS.
function simplifyNbt(node) {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) return node.map(simplifyNbt);
    if (typeof node !== 'object') return node;
    if (typeof node.type === 'string' && Object.prototype.hasOwnProperty.call(node, 'value')) {
        if (node.type === 'list') {
            const inner = node.value;
            const items = inner && Array.isArray(inner.value) ? inner.value : [];
            return items.map(simplifyNbt);
        }
        if (node.type === 'compound') {
            const out = {};
            for (const [key, value] of Object.entries(node.value || {})) out[key] = simplifyNbt(value);
            return out;
        }
        if (node.type === 'long' && Array.isArray(node.value)) {
            return Number(node.value[0]) * 4294967296 + Number(node.value[1] >>> 0);
        }
        return simplifyNbt(node.value);
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = simplifyNbt(value);
    return out;
}

function defaultItemNameLookup() {
    let byId = null;
    return (id) => {
        if (byId === null) {
            byId = new Map();
            try {
                const data = require('minecraft-data')('1.8.9');
                for (const item of Object.values(data.itemsByName || {})) byId.set(item.id, item.name);
                for (const block of Object.values(data.blocksByName || {})) {
                    if (!byId.has(block.id)) byId.set(block.id, block.name);
                }
            } catch (error) {
                // minecraft-data is optional here; ids stay numeric.
            }
        }
        return byId.get(id) || null;
    };
}

const EMPTY_ITEM = Object.freeze({ blockId: -1 });

function isEmptyItem(item) {
    return !item || item.blockId === undefined || item.blockId === null || item.blockId < 0;
}

function describeItem(item, itemNameLookup = () => null) {
    if (isEmptyItem(item)) return null;
    const nbt = simplifyNbt(item.nbtData);
    const display = nbt && typeof nbt.display === 'object' && nbt.display ? nbt.display : null;
    const rawName = display && typeof display.Name === 'string' ? display.Name : null;
    const lore = display && Array.isArray(display.Lore)
        ? display.Lore.filter(line => typeof line === 'string')
        : [];
    const skullOwner = nbt && nbt.SkullOwner
        ? (typeof nbt.SkullOwner === 'string' ? nbt.SkullOwner : nbt.SkullOwner.Name || null)
        : null;
    return {
        id: item.blockId,
        type: itemNameLookup(item.blockId),
        count: item.itemCount == null ? 1 : item.itemCount,
        damage: item.itemDamage == null ? 0 : item.itemDamage,
        name: rawName,
        plainName: rawName ? stripColors(rawName) : null,
        lore,
        plainLore: lore.map(stripColors),
        enchanted: Boolean(nbt && (nbt.ench || nbt.StoredEnchantments)),
        skullOwner,
        nbt
    };
}

const CLICK_MODES = {
    0: (button, slot) => {
        if (slot === -999) return button === 0 ? 'drop stack (outside)' : 'drop one (outside)';
        return button === 0 ? 'left click' : 'right click';
    },
    1: (button) => (button === 0 ? 'shift + left click' : 'shift + right click'),
    2: (button) => `number key ${button + 1} (hotbar slot ${button})`,
    3: () => 'middle click (clone)',
    4: (button, slot) => {
        if (slot === -999) return button === 0 ? 'left click outside' : 'right click outside';
        return button === 0 ? 'drop one (Q)' : 'drop stack (ctrl+Q)';
    },
    5: (button) => {
        const names = {
            0: 'drag start (left)', 1: 'drag add (left)', 2: 'drag end (left)',
            4: 'drag start (right)', 5: 'drag add (right)', 6: 'drag end (right)'
        };
        return names[button] || `drag (button ${button})`;
    },
    6: () => 'double click'
};

function describeClick(mode, button, slot) {
    const render = CLICK_MODES[mode];
    return render ? render(button, slot) : `mode ${mode} button ${button}`;
}

// Named click presets for /menudebug click <slot> <preset>.
const CLICK_PRESETS = {
    left: { mode: 0, button: 0 },
    right: { mode: 0, button: 1 },
    shift: { mode: 1, button: 0 },
    shiftleft: { mode: 1, button: 0 },
    shiftright: { mode: 1, button: 1 },
    middle: { mode: 3, button: 2 },
    drop: { mode: 4, button: 0 },
    dropstack: { mode: 4, button: 1 },
    double: { mode: 6, button: 0 }
};

// The player's own inventory (window 0) does not use the chest grid layout.
const PLAYER_WINDOW_ZONES = [
    [0, 0, 'crafting result'],
    [1, 4, 'crafting grid'],
    [5, 8, 'armor'],
    [9, 35, 'inventory'],
    [36, 44, 'hotbar']
];

function slotLabel(slot, window) {
    if (slot === -999) return 'outside';
    if (!window || !window.slotCount) return String(slot);
    if (window.windowId === 0) {
        const zone = PLAYER_WINDOW_ZONES.find(([from, to]) => slot >= from && slot <= to);
        return zone ? `${slot} (${zone[2]})` : String(slot);
    }
    const size = window.slotCount;
    if (slot < size) {
        return `${slot} (r${Math.floor(slot / 9) + 1}c${(slot % 9) + 1})`;
    }
    const offset = slot - size;
    if (offset < 27) return `${slot} (inventory)`;
    return `${slot} (hotbar ${offset - 27})`;
}

function normalizeSearch(value) {
    return stripColors(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function fileStamp(epochMs) {
    const d = new Date(epochMs);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// ---------------------------------------------------------------- factory

function createMenuMonitor({
    sendChat = () => {},
    sendUpstream = () => {},
    dir = null,
    now = Date.now,
    createWriteStream = (file) => fs.createWriteStream(file, { flags: 'a' }),
    itemNameLookup = defaultItemNameLookup(),
    log = (...args) => console.log(...args)
} = {}) {
    let enabled = false;
    let chatEcho = true;
    let verbose = false;
    let logToFile = true;
    let holdOpen = false;

    // The container the SERVER believes is open. windowId 0 is the player's
    // own inventory, which is always "open" and never gets an open_window.
    let window = null;
    const playerWindow = {
        windowId: 0,
        type: 'minecraft:inventory',
        title: 'Player inventory',
        plainTitle: 'Player inventory',
        slotCount: 45,
        slots: new Map(),
        rawSlots: new Map(),
        openedAt: 0,
        nextAction: 0
    };

    const stats = { s2c: new Map(), c2s: new Map(), suppressedCloses: 0, syntheticClicks: 0 };
    const pendingActions = new Map();
    let syntheticActionCounter = 0;
    let lastClientAction = 0;

    let nav = null;
    let navTimer = null;
    let navTimeout = null;

    let logStream = null;
    let logFile = null;
    let logBuffer = [];
    let flushTimer = null;

    // -------------------------------------------------------------- logging

    function currentWindow() {
        return window || playerWindow;
    }

    function windowById(windowId) {
        if (windowId === 0) return playerWindow;
        return window && window.windowId === windowId ? window : null;
    }

    function ensureLogStream() {
        if (logStream || !dir) return logStream;
        try {
            fs.mkdirSync(dir, { recursive: true });
            logFile = path.join(dir, `menu_${fileStamp(now())}.jsonl`);
            logStream = createWriteStream(logFile);
            if (typeof logStream.on === 'function') logStream.on('error', () => { logStream = null; });
        } catch (error) {
            logStream = null;
        }
        return logStream;
    }

    function flushLog() {
        if (!logBuffer.length) return;
        const chunk = logBuffer.join('');
        logBuffer = [];
        const stream = ensureLogStream();
        if (!stream) return;
        try {
            stream.write(chunk);
        } catch (error) {
            // A logging failure must never break packet relay.
        }
    }

    function record(event) {
        if (!logToFile || !dir) return;
        try {
            logBuffer.push(`${JSON.stringify(event)}\n`);
        } catch (error) {
            return;
        }
        if (!flushTimer) {
            flushTimer = setInterval(flushLog, FLUSH_INTERVAL_MS);
            if (typeof flushTimer.unref === 'function') flushTimer.unref();
        }
    }

    function bump(direction, name) {
        const table = stats[direction];
        table.set(name, (table.get(name) || 0) + 1);
    }

    function echo(line, packetName) {
        if (!enabled || !chatEcho) return;
        if (!verbose && packetName && VERBOSE_ONLY_PACKETS.has(packetName)) return;
        sendChat(line);
    }

    function trace(line) {
        if (!enabled) return;
        log(`[Menu] ${line}`);
    }

    // ------------------------------------------------------- window tracking

    function openWindow(data) {
        const title = decodeTitle(data.windowTitle);
        window = {
            windowId: data.windowId,
            type: String(data.inventoryType || ''),
            title,
            plainTitle: stripColors(title),
            slotCount: Number(data.slotCount) || 0,
            entityId: data.entityId == null ? null : data.entityId,
            slots: new Map(),
            rawSlots: new Map(),
            openedAt: now(),
            nextAction: 0
        };
        return window;
    }

    function storeSlot(target, slot, rawItem) {
        const described = describeItem(rawItem, itemNameLookup);
        if (described) {
            target.slots.set(slot, described);
            target.rawSlots.set(slot, rawItem);
        } else {
            target.slots.delete(slot);
            target.rawSlots.delete(slot);
        }
        return described;
    }

    function compactSlot(slot, item) {
        return {
            slot,
            id: item.id,
            type: item.type,
            dmg: item.damage,
            n: item.count,
            name: item.name,
            lore: item.lore
        };
    }

    // ------------------------------------------------------- server packets

    // Returns true when the packet must NOT be forwarded to the real client.
    function observeServerPacket(data, meta) {
        if (!meta || !SERVER_MENU_PACKETS.has(meta.name)) return false;
        try {
            return handleServerPacket(data, meta);
        } catch (error) {
            return false;
        }
    }

    function handleServerPacket(data, meta) {
        bump('s2c', meta.name);
        const at = now();

        if (meta.name === 'open_window') {
            const opened = openWindow(data);
            record({
                t: at, dir: 's2c', p: 'open_window', win: opened.windowId,
                type: opened.type, title: opened.title, slots: opened.slotCount
            });
            echo(`§d[Menu] §aopen_window §8#${opened.windowId} §f${opened.plainTitle} §7(${opened.type}, ${opened.slotCount} slots)`, meta.name);
            trace(`open_window #${opened.windowId} "${opened.plainTitle}" type=${opened.type} slots=${opened.slotCount}`);
            return false;
        }

        if (meta.name === 'window_items') {
            const target = windowById(data.windowId);
            const items = Array.isArray(data.items) ? data.items : [];
            const filled = [];
            if (target) {
                target.slots.clear();
                target.rawSlots.clear();
                items.forEach((raw, index) => {
                    const described = storeSlot(target, index, raw);
                    if (described) filled.push(compactSlot(index, described));
                });
                if (!target.slotCount) target.slotCount = items.length;
            }
            record({ t: at, dir: 's2c', p: 'window_items', win: data.windowId, count: items.length, items: filled });
            echo(`§d[Menu] §bwindow_items §8#${data.windowId} §7${items.length} slots, §f${filled.length}§7 filled §8(/menudebug dump)`, meta.name);
            trace(`window_items #${data.windowId} ${items.length} slots, ${filled.length} filled`);
            onWindowSettled();
            return false;
        }

        if (meta.name === 'set_slot') {
            const target = windowById(data.windowId);
            const described = target ? storeSlot(target, data.slot, data.item) : null;
            record({
                t: at, dir: 's2c', p: 'set_slot', win: data.windowId, slot: data.slot,
                item: described ? compactSlot(data.slot, described) : null
            });
            const label = described
                ? `§f${stripColors(described.name || described.type || described.id)} §8x${described.count}`
                : '§8(cleared)';
            echo(`§d[Menu] §7set_slot §8#${data.windowId} §7slot ${slotLabel(data.slot, target)} ${label}`, meta.name);
            return false;
        }

        if (meta.name === 'craft_progress_bar') {
            record({ t: at, dir: 's2c', p: 'craft_progress_bar', win: data.windowId, property: data.property, value: data.value });
            echo(`§d[Menu] §7craft_progress_bar §8#${data.windowId} §7property ${data.property} = ${data.value}`, meta.name);
            return false;
        }

        if (meta.name === 'close_window') {
            record({ t: at, dir: 's2c', p: 'close_window', win: data.windowId });
            echo(`§d[Menu] §cclose_window §8#${data.windowId} §7(server closed the menu)`, meta.name);
            trace(`close_window #${data.windowId} (server)`);
            if (window && window.windowId === data.windowId) window = null;
            abortNav('the server closed the menu');
            return false;
        }

        if (meta.name === 'transaction') {
            const key = `${data.windowId}:${data.action}`;
            const pending = pendingActions.get(key);
            record({
                t: at, dir: 's2c', p: 'transaction', win: data.windowId, action: data.action,
                accepted: data.accepted, synthetic: Boolean(pending && pending.synthetic),
                rtt: pending ? at - pending.at : null
            });
            if (!pending || !pending.synthetic) {
                pendingActions.delete(key);
                echo(`§d[Menu] §7transaction §8#${data.windowId} §7action ${data.action} ${data.accepted ? '§aaccepted' : '§crejected'}`, meta.name);
                return false;
            }
            pendingActions.delete(key);
            // The click came from us, so the real client must never see this
            // action number. Vanilla answers a rejected transaction with a
            // confirmation; without it the server stops accepting clicks in
            // this window, so we answer on the client's behalf.
            if (data.accepted === false) {
                sendUpstream('transaction', { windowId: data.windowId, action: data.action, accepted: true });
            }
            if (enabled && chatEcho) {
                sendChat(`§d[Menu] §7click on slot §f${pending.slot}§7 ${data.accepted ? '§aaccepted' : '§erejected (normal for GUI menus)'} §8(${at - pending.at}ms)`);
            }
            return true;
        }

        return false;
    }

    // ------------------------------------------------------- client packets

    // Returns true when the packet must NOT be forwarded to Hypixel.
    function observeClientPacket(data, meta) {
        if (!meta || !CLIENT_MENU_PACKETS.has(meta.name)) return false;
        try {
            return handleClientPacket(data, meta);
        } catch (error) {
            return false;
        }
    }

    function handleClientPacket(data, meta) {
        bump('c2s', meta.name);
        const at = now();

        if (meta.name === 'window_click') {
            if (Number.isFinite(data.action)) lastClientAction = Math.max(lastClientAction, data.action);
            const target = windowById(data.windowId);
            const item = describeItem(data.item, itemNameLookup);
            const tracked = target ? target.slots.get(data.slot) : null;
            const click = describeClick(data.mode, data.mouseButton, data.slot);
            record({
                t: at, dir: 'c2s', p: 'window_click', win: data.windowId, slot: data.slot,
                button: data.mouseButton, mode: data.mode, action: data.action, click,
                item: item ? compactSlot(data.slot, item) : null,
                tracked: tracked ? stripColors(tracked.name || tracked.type || '') : null
            });
            pendingActions.set(`${data.windowId}:${data.action}`, { at, slot: data.slot, synthetic: false });
            const name = tracked ? stripColors(tracked.name || tracked.type || String(tracked.id)) : '(empty)';
            echo(`§d[Menu] §ewindow_click §8#${data.windowId} §7slot ${slotLabel(data.slot, target)} §8| §f${name} §8| §7${click} §8| action ${data.action}`, meta.name);
            trace(`window_click #${data.windowId} slot=${data.slot} mode=${data.mode} button=${data.mouseButton} action=${data.action} item="${name}"`);
            return false;
        }

        if (meta.name === 'close_window') {
            record({ t: at, dir: 'c2s', p: 'close_window', win: data.windowId, held: holdOpen });
            if (holdOpen && window && window.windowId === data.windowId) {
                stats.suppressedCloses += 1;
                record({ t: at, dir: 'c2s', p: 'close_window_suppressed', win: data.windowId });
                if (enabled && chatEcho) {
                    sendChat(`§d[Menu] §6held §7#${data.windowId} §f${window.plainTitle}§7 open server-side. §8/menudebug dump §7· §8/menudebug click <slot> §7· §8/menudebug close`);
                }
                return true;
            }
            echo(`§d[Menu] §cclose_window §8#${data.windowId} §7(you closed the menu)`, meta.name);
            if (window && window.windowId === data.windowId) window = null;
            abortNav('the menu was closed');
            return false;
        }

        if (meta.name === 'transaction') {
            record({ t: at, dir: 'c2s', p: 'transaction', win: data.windowId, action: data.action, accepted: data.accepted });
            echo(`§d[Menu] §7transaction §8#${data.windowId} §7confirm action ${data.action}`, meta.name);
            return false;
        }

        if (meta.name === 'enchant_item') {
            record({ t: at, dir: 'c2s', p: 'enchant_item', win: data.windowId, enchantment: data.enchantment });
            echo(`§d[Menu] §eenchant_item §8#${data.windowId} §7option ${data.enchantment}`, meta.name);
            return false;
        }

        if (meta.name === 'set_creative_slot') {
            const item = describeItem(data.item, itemNameLookup);
            record({ t: at, dir: 'c2s', p: 'set_creative_slot', slot: data.slot, item: item ? compactSlot(data.slot, item) : null });
            echo(`§d[Menu] §eset_creative_slot §7slot ${data.slot}`, meta.name);
            return false;
        }

        return false;
    }

    // ------------------------------------------------------------- clicking

    function nextActionNumber(target) {
        syntheticActionCounter += 1;
        // Stay clear of the client's own counter for this window: vanilla
        // increments per click, so we bias well above whatever it has used.
        const base = Math.max(lastClientAction, target.nextAction || 0, 0);
        let action = (base + 1000 + syntheticActionCounter) % 32768;
        // Protocol 1.8 encodes action as a signed short. Long automated menu
        // walks must wrap without reusing an outstanding transaction number.
        while (pendingActions.has(`${target.windowId}:${action}`) || action === lastClientAction) {
            action = (action + 1) % 32768;
        }
        target.nextAction = action;
        return action;
    }

    // The tracked model stores a decoded description; window_click needs the
    // wire shape back, so the raw slot is kept alongside it.
    function rebuildSlotItem(target, slot) {
        const raw = target.rawSlots.get(slot);
        if (raw) return raw;
        const described = target.slots.get(slot);
        if (!described) return EMPTY_ITEM;
        return { blockId: described.id, itemCount: described.count, itemDamage: described.damage };
    }

    function clickSlot({ slot, mode = 0, button = 0, source = 'manual' }) {
        const target = currentWindow();
        if (!Number.isFinite(slot)) return { ok: false, error: 'Slot must be a number.' };
        if (slot !== -999 && (slot < 0 || (target.slotCount && slot >= target.slotCount + 36))) {
            return { ok: false, error: `Slot ${slot} is outside window #${target.windowId}.` };
        }
        const tracked = target.slots.get(slot) || null;
        // The server compares the item we claim is in the slot against its own
        // copy, so echo back exactly what the last window_items/set_slot said.
        const item = tracked ? rebuildSlotItem(target, slot) : EMPTY_ITEM;
        const action = nextActionNumber(target);
        const at = now();
        pendingActions.set(`${target.windowId}:${action}`, { at, slot, synthetic: true, source });
        stats.syntheticClicks += 1;
        record({
            t: at, dir: 'c2s', p: 'window_click', win: target.windowId, slot, button, mode, action,
            click: describeClick(mode, button, slot), synthetic: true, source,
            tracked: tracked ? stripColors(tracked.name || tracked.type || '') : null
        });
        sendUpstream('window_click', { windowId: target.windowId, slot, mouseButton: button, action, mode, item });
        return {
            ok: true,
            action,
            windowId: target.windowId,
            slot,
            item: tracked,
            click: describeClick(mode, button, slot)
        };
    }

    function findSlots(query) {
        const target = currentWindow();
        const compact = String(query == null ? '' : query).replace(/\s+/g, '');
        const exactSlot = /^#(\d+)$/.exec(compact);
        if (exactSlot) {
            const slot = Number(exactSlot[1]);
            return [{ slot, item: target.slots.get(slot) || null, exact: true }];
        }
        const needle = normalizeSearch(query);
        if (!needle) return [];
        const exact = [];
        const partial = [];
        for (const [slot, item] of target.slots) {
            const name = normalizeSearch(item.name || item.type || '');
            const lore = item.plainLore.map(normalizeSearch).join(' | ');
            if (name === needle) exact.push({ slot, item, exact: true });
            else if (name.includes(needle) || lore.includes(needle)) partial.push({ slot, item, exact: false });
        }
        return exact.concat(partial);
    }

    // ------------------------------------------------------------ menu walk

    function clearNavTimers() {
        if (navTimer) { clearTimeout(navTimer); navTimer = null; }
        if (navTimeout) { clearTimeout(navTimeout); navTimeout = null; }
    }

    function abortNav(reason) {
        if (!nav) return;
        const pending = nav;
        nav = null;
        clearNavTimers();
        sendChat(`§d[Menu] §cnav aborted §7at step ${pending.index + 1}/${pending.steps.length} (§f${pending.steps[pending.index]}§7): ${reason}`);
    }

    function startNav(steps) {
        if (!steps.length) return { ok: false, error: 'Give at least one menu entry.' };
        if (nav) abortNav('a new nav was started');
        nav = { steps, index: 0 };
        const result = runNavStep();
        if (!result.ok) nav = null;
        return result;
    }

    function runNavStep() {
        if (!nav) return { ok: false, error: 'No nav running.' };
        const query = nav.steps[nav.index];
        const matches = findSlots(query);
        if (!matches.length) {
            const step = nav.index + 1;
            return { ok: false, error: `No slot in "${currentWindow().plainTitle || 'this window'}" matches "${query}" (step ${step}).` };
        }
        const chosen = matches[0];
        const result = clickSlot({ slot: chosen.slot, source: `nav:${query}` });
        if (!result.ok) return result;
        const label = stripColors(chosen.item && chosen.item.name ? chosen.item.name : query);
        sendChat(`§d[Menu] §7nav ${nav.index + 1}/${nav.steps.length}: clicked slot §f${chosen.slot}§7 §8(${label})`);
        nav.index += 1;
        if (nav.index >= nav.steps.length) {
            nav = null;
            clearNavTimers();
            sendChat('§d[Menu] §anav finished§7.');
            return { ok: true, done: true };
        }
        clearNavTimers();
        navTimeout = setTimeout(() => {
            navTimeout = null;
            abortNav('timed out waiting for the next menu');
        }, NAV_STEP_TIMEOUT_MS);
        if (typeof navTimeout.unref === 'function') navTimeout.unref();
        return { ok: true, done: false };
    }

    // Hypixel answers a click with window_items and then a burst of set_slot
    // packets; wait for that burst to go quiet before clicking the next step.
    function onWindowSettled() {
        if (!nav) return;
        if (navTimer) clearTimeout(navTimer);
        navTimer = setTimeout(() => {
            navTimer = null;
            if (!nav) return;
            if (navTimeout) { clearTimeout(navTimeout); navTimeout = null; }
            const result = runNavStep();
            if (!result.ok && result.error) {
                nav = null;
                clearNavTimers();
                sendChat(`§d[Menu] §cnav stopped§7: ${result.error}`);
            }
        }, NAV_SETTLE_MS);
        if (typeof navTimer.unref === 'function') navTimer.unref();
    }

    // ------------------------------------------------------------- commands

    function renderDump(slotArg) {
        const target = currentWindow();
        if (!window) {
            sendChat('§d[Menu] §7No container window is open. Open a Hypixel menu first §8(its open_window is what starts tracking)§7.');
            return;
        }
        if (slotArg !== undefined && slotArg !== '') {
            const slot = Number(slotArg);
            const item = target.slots.get(slot);
            if (!item) {
                sendChat(`§d[Menu] §7Slot §f${slot}§7 in #${target.windowId} is empty.`);
                return;
            }
            const typeSuffix = item.type ? `, ${item.type}` : '';
            sendChat(`§d[Menu] §7slot ${slotLabel(slot, target)} §8| §f${item.name || item.type || item.id} §8x${item.count} §7(id ${item.id}:${item.damage}${typeSuffix})`);
            item.lore.slice(0, MAX_LORE_LINES).forEach(line => sendChat(`  §8| §7${line}`));
            if (item.lore.length > MAX_LORE_LINES) {
                sendChat(`  §8| §7... ${item.lore.length - MAX_LORE_LINES} more lore lines (see the log)`);
            }
            log('[Menu] slot detail', JSON.stringify({ slot, item }, null, 2));
            return;
        }
        const entries = Array.from(target.slots.entries())
            .filter(([slot]) => !target.slotCount || slot < target.slotCount)
            .sort((a, b) => a[0] - b[0]);
        sendChat(`§d[Menu] §f${target.plainTitle || target.title} §8(#${target.windowId}, ${target.type}, ${target.slotCount} slots, ${entries.length} filled)`);
        entries.slice(0, MAX_DUMP_LINES).forEach(([slot, item]) => {
            const lore = item.plainLore.length ? ` §8- ${item.plainLore[0].slice(0, 40)}` : '';
            sendChat(` §7[§f${slot}§7] §f${item.name || item.type || item.id}§8 x${item.count}${lore}`);
        });
        if (entries.length > MAX_DUMP_LINES) {
            sendChat(` §8... ${entries.length - MAX_DUMP_LINES} more slots §7(full contents in the log file)`);
        }
        record({
            t: now(), dir: 'local', p: 'dump', win: target.windowId, title: target.title,
            items: entries.map(([slot, item]) => compactSlot(slot, item))
        });
        flushLog();
    }

    function renderStatus() {
        const target = currentWindow();
        sendChat('§d[Menu] §8» §fInventory / GUI packet monitor');
        sendChat(` §7Monitor ${enabled ? '§aON' : '§cOFF'} §8| §7chat ${chatEcho ? '§aon' : '§coff'} §8| §7verbose ${verbose ? '§aon' : '§coff'} §8| §7log ${logToFile ? '§aon' : '§coff'} §8| §7hold ${holdOpen ? '§aon' : '§coff'}`);
        sendChat(window
            ? ` §7Open: §f${target.plainTitle} §8(#${target.windowId}, ${target.type}, ${target.slotCount} slots, ${target.slots.size} filled)`
            : ' §7Open: §8none (player inventory only)');
        const s2c = Array.from(stats.s2c.entries()).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
        const c2s = Array.from(stats.c2s.entries()).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
        sendChat(` §7in  §8${s2c}`);
        sendChat(` §7out §8${c2s}`);
        sendChat(` §7Synthetic clicks §f${stats.syntheticClicks}§7, held closes §f${stats.suppressedCloses}`);
        if (logFile) sendChat(` §7Log §8${logFile}`);
        sendChat(' §8/menudebug on|off · chat · verbose · log · hold · dump [slot] · find <text> · click <slot> [type] · nav <a> > <b> · close');
    }

    function parseToggle(value, current) {
        const word = String(value || '').toLowerCase();
        if (['on', 'true', 'enable', 'enabled', '1'].includes(word)) return true;
        if (['off', 'false', 'disable', 'disabled', '0'].includes(word)) return false;
        return !current;
    }

    function handleCommand(client, args = []) {
        const sub = String(args[1] || 'status').toLowerCase();

        if (sub === 'on' || sub === 'off') {
            enabled = sub === 'on';
            sendChat(`§d[Menu] §7Monitor ${enabled ? '§aenabled' : '§cdisabled'}§7. Window state is tracked either way.`);
            return;
        }
        if (sub === 'chat') {
            chatEcho = parseToggle(args[2], chatEcho);
            sendChat(`§d[Menu] §7In-game echo ${chatEcho ? '§aon' : '§coff'}§7.`);
            return;
        }
        if (sub === 'verbose') {
            verbose = parseToggle(args[2], verbose);
            sendChat(`§d[Menu] §7Verbose echo ${verbose ? '§aon' : '§coff'}§7 (set_slot / transaction / properties).`);
            return;
        }
        if (sub === 'log') {
            logToFile = parseToggle(args[2], logToFile);
            if (!logToFile) flushLog();
            sendChat(`§d[Menu] §7JSONL logging ${logToFile ? '§aon' : '§coff'}§7${logFile ? ` §8${logFile}` : ''}`);
            return;
        }
        if (sub === 'hold') {
            holdOpen = parseToggle(args[2], holdOpen);
            sendChat(holdOpen
                ? '§d[Menu] §7Hold §aon§7: closing a menu locally no longer tells Hypixel, so it stays open server-side and you can type §f/menudebug click§7. Use §f/menudebug close§7 to really close it.'
                : '§d[Menu] §7Hold §coff§7: close_window is forwarded normally.');
            return;
        }
        if (sub === 'dump' || sub === 'slots') {
            renderDump(args[2]);
            return;
        }
        if (sub === 'find') {
            const query = args.slice(2).join(' ');
            if (!query) {
                sendChat('§d[Menu] §7Usage: §f/menudebug find <text>');
                return;
            }
            const matches = findSlots(query);
            if (!matches.length) {
                sendChat(`§d[Menu] §7Nothing in this window matches "§f${query}§7".`);
                return;
            }
            sendChat(`§d[Menu] §7${matches.length} match${matches.length === 1 ? '' : 'es'} for "§f${query}§7":`);
            matches.slice(0, 10).forEach(({ slot, item }) => {
                const label = item ? (item.name || item.type || item.id) : '(empty)';
                sendChat(` §7[§f${slot}§7] §f${label} §8→ /menudebug click ${slot}`);
            });
            return;
        }
        if (sub === 'click') {
            if (args[2] === undefined) {
                sendChat('§d[Menu] §7Usage: §f/menudebug click <slot> [left|right|shift|shiftright|middle|drop|dropstack|double|hotbar <0-8>]');
                return;
            }
            const slot = Number(args[2]);
            const presetName = String(args[3] || 'left').toLowerCase();
            let preset = CLICK_PRESETS[presetName];
            if (presetName === 'hotbar' || presetName === 'number') {
                preset = { mode: 2, button: Math.max(0, Math.min(8, Number(args[4]) || 0)) };
            }
            if (!preset) {
                sendChat(`§d[Menu] §cUnknown click type "${presetName}". Try: ${Object.keys(CLICK_PRESETS).join(', ')}, hotbar <0-8>.`);
                return;
            }
            const result = clickSlot({ slot, mode: preset.mode, button: preset.button });
            if (!result.ok) {
                sendChat(`§d[Menu] §c${result.error}`);
                return;
            }
            const name = result.item ? stripColors(result.item.name || result.item.type || String(result.item.id)) : '(empty slot)';
            sendChat(`§d[Menu] §asent window_click §8#${result.windowId} §7slot §f${result.slot} §8| §f${name} §8| §7${result.click} §8| action ${result.action}`);
            return;
        }
        if (sub === 'nav') {
            const steps = args.slice(2).join(' ').split('>').map(part => part.trim()).filter(Boolean);
            if (!steps.length) {
                sendChat('§d[Menu] §7Usage: §f/menudebug nav <entry> > <entry> > ... §8(display names, or #<slot>)');
                return;
            }
            const result = startNav(steps);
            if (!result.ok) sendChat(`§d[Menu] §c${result.error}`);
            return;
        }
        if (sub === 'close') {
            if (!window) {
                sendChat('§d[Menu] §7No container window is open server-side.');
                return;
            }
            const windowId = window.windowId;
            sendUpstream('close_window', { windowId });
            record({ t: now(), dir: 'c2s', p: 'close_window', win: windowId, synthetic: true });
            sendChat(`§d[Menu] §7Sent §fclose_window §8#${windowId}§7.`);
            window = null;
            abortNav('the window was closed manually');
            return;
        }
        if (sub === 'clear' || sub === 'reset') {
            stats.s2c.clear();
            stats.c2s.clear();
            stats.suppressedCloses = 0;
            stats.syntheticClicks = 0;
            pendingActions.clear();
            sendChat('§d[Menu] §7Counters reset.');
            return;
        }
        if (sub === 'flush' || sub === 'file' || sub === 'path') {
            flushLog();
            sendChat(logFile
                ? `§d[Menu] §7Log flushed: §8${logFile}`
                : '§d[Menu] §7Nothing logged yet.');
            return;
        }
        if (sub === 'help') {
            sendChat('§d[Menu] §8» §7Watch and drive Hypixel GUI menus.');
            sendChat(' §f/menudebug on §8- report every inventory packet in both directions');
            sendChat(' §f/menudebug hold on §8- keep the menu open server-side after you close it locally');
            sendChat(' §f/menudebug dump [slot] §8- list tracked slots, or one slot with its lore');
            sendChat(' §f/menudebug find <text> §8- locate a slot by item name or lore');
            sendChat(' §f/menudebug click <slot> [type] §8- send a window_click the way the client would');
            sendChat(' §f/menudebug nav <a> > <b> §8- click through a chain of entries by name');
            sendChat(' §f/menudebug close §8- send close_window   §f/menudebug log off §8- stop the JSONL file');
            return;
        }
        renderStatus();
    }

    function dispose() {
        clearNavTimers();
        nav = null;
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = null;
        clearInterval(sweepTimer);
        flushLog();
        if (logStream && typeof logStream.end === 'function') {
            try { logStream.end(); } catch (error) { /* best effort */ }
        }
        logStream = null;
    }

    // Kept small and explicit for /debugstate.
    function getDebugState() {
        const target = currentWindow();
        return {
            menuMonitor: enabled,
            menuHold: holdOpen,
            menuWindow: window ? `${target.plainTitle} (#${target.windowId})` : 'none',
            menuSlots: window ? target.slots.size : 0,
            menuPendingActions: pendingActions.size,
            menuNavStep: nav ? `${nav.index + 1}/${nav.steps.length}` : 'idle'
        };
    }

    // Drop synthetic actions the server never answered so the map cannot grow
    // without bound on a long session.
    const sweepTimer = setInterval(() => {
        const cutoff = now() - PENDING_ACTION_TTL_MS;
        for (const [key, pending] of pendingActions) {
            if (pending.at < cutoff) pendingActions.delete(key);
        }
    }, PENDING_ACTION_TTL_MS);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

    return {
        observeServerPacket,
        observeClientPacket,
        handleCommand,
        getDebugState,
        dispose,
        // Exposed for tests and for other features that want to drive a menu.
        clickSlot,
        findSlots,
        getWindow: () => (window ? { ...window, slots: new Map(window.slots) } : null),
        isEnabled: () => enabled,
        setEnabled: (value) => { enabled = Boolean(value); },
        setHold: (value) => { holdOpen = Boolean(value); },
        flush: flushLog
    };
}

module.exports = {
    createMenuMonitor,
    SERVER_MENU_PACKETS,
    CLIENT_MENU_PACKETS,
    describeItem,
    describeClick,
    simplifyNbt,
    decodeTitle,
    slotLabel
};
