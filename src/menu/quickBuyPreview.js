'use strict';

const { parseQuickBuy } = require('./quickBuyImport');
const { parseHotbar } = require('./hotbarLayout');
const hotbarFixture = require('./fixtures/hotbar-menu.json');
const fixtures = require('./fixtures/quickbuy-menus.json');
const EMPTY = () => ({ blockId: -1 });
const { isDeepStrictEqual } = require('util');
const POSITIONS = Array.from({ length: 21 }, (_, i) => 10 + Math.floor(i / 7) * 9 + i % 7);
const catalog = new Map(Object.values(fixtures).flatMap(menu => menu.items || [])
    .filter(i => i.databaseName).map(i => [i.databaseName, i]));

function icon(id, name, damage = 0, count = 1) {
    return { blockId: id, itemDamage: damage, itemCount: count, nbtData: { type: 'compound', name: '', value: {
        display: { type: 'compound', value: { Name: { type: 'string', value: name },
            Lore: { type: 'list', value: { type: 'string', value: ['§7Preview only'] } } } }
    } } };
}
function previewItems(slots, hotbarSlots = null) {
    const items = Array.from({ length: 54 }, () => icon(160, ' ', 7));
    slots?.forEach((entry, index) => {
        const known = entry && catalog.get(entry.databaseName);
        items[POSITIONS[index]] = !entry ? icon(160, '§7Empty slot', 8)
            : known ? icon(known.id, known.name, known.dmg || 0, known.n || 1)
                : icon(166, `§e${entry.databaseName.replace(/_/g, ' ')}`);
    });
    hotbarSlots?.forEach((category, index) => {
        const source = category && hotbarFixture.slice(10, 18).find(i => i.nbtData?.value?.ExtraAttributes?.value?.hotbarCategory?.value === category);
        items[(slots ? 45 : 27) + index] = source
            ? icon(source.blockId, `§a${index + 1}: ${category}`, source.itemDamage || 0)
            : icon(160, `§7${index + 1}: Empty slot`, 8);
    });
    if (slots && hotbarSlots) for (let slot = 36; slot < 45; slot++) items[slot] = EMPTY();
    items[slots && hotbarSlots ? 8 : 49] = icon(166, '§cClose preview');
    return items;
}

// No server transport is available here: fake inventory actions cannot be replayed.
function createQuickBuyPreview({ sendClient, sendChat, fetchPlayer, canStart,
    disconnect, timeoutMs = 60000 }) {
    let active = null, pending = false, disposed = false, token = 0;
    let inventory = null, cursor = EMPTY(), heldSlot = 0;
    let serverWindow = null, serverSize = 0, epoch = 0;
    const usedIds = new Set(), serverIds = new Set(), transactions = new Set();
    const say = text => sendChat(`§b§lQuick Buy §8» §7${text}`);
    function paint() {
        if (!active) return;
        sendClient('window_items', { windowId: active.id, items: [...active.items, ...inventory.slice(9, 45)] });
        sendClient('set_slot', { windowId: -1, slot: -1, item: EMPTY() });
        sendClient('held_item_slot', { slot: heldSlot });
    }
    function close(restore = true, reason = null) {
        token++; pending = false;
        if (!active) return;
        const saved = active;
        active = null;
        clearTimeout(saved.timer);
        if (disposed) return;
        sendClient('close_window', { windowId: saved.id });
        if (reason) say(`Preview closed: ${reason}.`);
        if (restore && inventory) {
            sendClient('window_items', { windowId: 0, items: inventory });
            sendClient('set_slot', { windowId: -1, slot: -1, item: cursor });
            sendClient('held_item_slot', { slot: heldSlot });
        }
    }
    function reason() {
        return canStart() || (serverWindow !== null ? 'Close your current menu first.' : null)
            || (!inventory ? 'Wait for your inventory to load, then retry.' : null)
            || (cursor.blockId !== -1 ? 'Put down the item on your cursor first.' : null);
    }
    async function command(name, mode = 'quickbuy') {
        if (disposed) return;
        if (name === 'close' || name === 'cancel') { close(); return; }
        if (active || pending) { say('Close the preview with Esc or §f/qb preview close§7.'); return; }
        if (!/^[a-zA-Z0-9_]{1,16}$/.test(name || '')) { say(`Usage: §f/${mode} preview <player>`); return; }
        const blocked = reason();
        if (blocked) { say(blocked); return; }
        pending = true;
        const request = ++token, startEpoch = epoch;
        let lookupTimer;
        try {
            say(`Looking up §f${name}§7…`);
            const player = await Promise.race([fetchPlayer(name), new Promise((_, reject) => {
                lookupTimer = setTimeout(() => reject(new Error('Player lookup timed out. Try again.')), 15000);
            })]);
            if (request !== token || disposed) return;
            const slots = mode !== 'hotbar' ? parseQuickBuy(player) : null;
            const hotbarSlots = mode !== 'quickbuy' ? parseHotbar(player) : null;
            const blocked = reason();
            if (blocked || startEpoch !== epoch) throw new Error(blocked || 'Your game state changed. Try again.');
            // Never reuse a fake ID during a connection: delayed clicks remain local.
            let id = 127;
            while (id > 0 && (usedIds.has(id) || serverIds.has(id))) id--;
            if (!id) throw new Error('Reconnect before opening another preview.');
            usedIds.add(id);
            active = { id, items: previewItems(slots, hotbarSlots),
                closeSlot: slots && hotbarSlots ? 8 : 49,
                timer: setTimeout(() => close(true, 'time limit reached'), timeoutMs) };
            sendClient('open_window', { windowId: id, inventoryType: 'minecraft:chest',
                windowTitle: JSON.stringify({ text: `${name} · ${mode === 'hotbar' ? 'Hotbar' : mode === 'quickbuy' ? 'Quick Buy' : 'Quick Buy + Hotbar'}` }), slotCount: 54 });
            paint();
        } catch (error) {
            if (request === token && !disposed) { close(); say(error.message); }
        } finally { clearTimeout(lookupTimer); if (request === token) pending = false; }
    }
    function allowOutbound(name, data) {
        if (disposed) return false;
        if (['window_click', 'close_window', 'transaction'].includes(name) && usedIds.has(data.windowId)) return false;
        if (!active) return true;
        if (['keep_alive', 'settings', 'resource_pack_receive'].includes(name)) return true;
        if (name === 'transaction') return transactions.has(`${data.windowId}:${data.action}`);
        // The server has no preview container: preserve normal movement physics.
        if (['flying', 'position', 'position_look', 'look'].includes(name)) return true;
        return false;
    }
    function observeClient(data, meta) {
        const name = meta.name;
        if (['window_click', 'close_window', 'transaction'].includes(name) && usedIds.has(data.windowId)) {
            if (active && data.windowId === active.id) {
                if (name === 'close_window' || name === 'window_click' && data.slot === active.closeSlot && data.mode === 0 && data.mouseButton === 0) close();
                else if (name === 'window_click') {
                    sendClient('transaction', { windowId: data.windowId, action: data.action, accepted: false });
                    paint();
                }
            }
            return true;
        }
        if (active) {
            if (name === 'window_click' || name === 'set_creative_slot' || name === 'held_item_slot') paint();
            return !allowOutbound(name, data);
        }
        if (name === 'held_item_slot') heldSlot = data.slotId;
        if (name === 'close_window' && data.windowId === serverWindow) serverWindow = null;
        return false;
    }
    function observeServer(data, meta) {
        const name = meta.name;
        const blocked = active && canStart();
        if (blocked) close(true, blocked.replace(/[.!]$/, ''));
        if ((active || pending) && (name === 'update_health' && data.health <= 0
            || name === 'custom_payload' && data.channel === 'MC|BOpen')) {
            epoch++; close(true, name === 'update_health' ? 'you died' : 'server opened a book');
        }
        if (name === 'transaction') {
            transactions.add(`${data.windowId}:${data.action}`);
            if (transactions.size > 2048) transactions.delete(transactions.values().next().value);
        }
        if (name === 'open_window') {
            epoch++;
            if (usedIds.has(data.windowId)) {
                disposed = true; close(false);
                disconnect('Preview window ID conflicted with a server menu. Reconnect to continue.');
                return true;
            }
            serverIds.add(data.windowId); close(true, 'server opened a menu'); serverWindow = data.windowId; serverSize = data.slotCount;
        }
        if (name === 'close_window') {
            if (serverWindow === data.windowId) serverWindow = null;
            if (active) return true; // No real container is open during a preview.
        }
        if (['position', 'respawn', 'login', 'kick_disconnect'].includes(name)) {
            epoch++; close(true, name === 'position' ? 'server moved you' : 'connection or world changed');
            if (name !== 'position') { inventory = null; cursor = EMPTY(); serverWindow = null; }
        }
        if (name === 'window_items' && data.windowId === 0 && Array.isArray(data.items) && data.items.length >= 45) {
            const previous = inventory;
            inventory = structuredClone(data.items);
            if (active) {
                for (let slot = 9; slot < 45; slot++) if (!isDeepStrictEqual(previous?.[slot], inventory[slot])) {
                    sendClient('set_slot', { windowId: active.id, slot: 54 + slot - 9, item: inventory[slot] });
                }
                return true;
            }
        }
        if (name === 'window_items' && data.windowId === serverWindow && inventory && data.items?.length >= serverSize + 36) {
            for (let i = 0; i < 36; i++) inventory[9 + i] = structuredClone(data.items[serverSize + i]);
        }
        if (name === 'set_slot') {
            if (data.windowId === -1 && data.slot === -1) {
                cursor = structuredClone(data.item || EMPTY());
                if (active) {
                    if (cursor.blockId !== -1) close(true, 'server changed the cursor item');
                    else return true;
                }
            } else if ((data.windowId === 0 || data.windowId === -2 || data.windowId === serverWindow) && inventory) {
                if (data.windowId === -2 && data.slot > 39) return false;
                const slot = data.windowId === -2 ? (data.slot < 9 ? data.slot + 36 : data.slot < 36 ? data.slot : 44 - data.slot)
                    : data.windowId === serverWindow ? data.slot - serverSize + 9 : data.slot;
                if (slot < 0 || slot >= inventory.length || data.slot < 0 || data.windowId === serverWindow && data.slot < serverSize) return false;
                const item = structuredClone(data.item || EMPTY());
                const changed = !isDeepStrictEqual(inventory[slot], item);
                inventory[slot] = item;
                if (active) {
                    if (changed && slot >= 9 && slot < 45) sendClient('set_slot', { windowId: active.id, slot: 54 + slot - 9, item });
                    return true;
                }
            }
        }
        // A server-selected hotbar slot does not invalidate a read-only chest.
        if (name === 'held_item_slot') heldSlot = data.slot;
        return false;
    }
    function dispose() { disposed = true; close(false); inventory = null; transactions.clear(); }
    return { command, close, observeClient, observeServer, allowOutbound, dispose,
        isActive: () => !!active, isBusy: () => !!active || pending };
}
module.exports = { createQuickBuyPreview, previewItems, POSITIONS };
