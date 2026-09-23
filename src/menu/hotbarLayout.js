'use strict';

const CATEGORIES = ['Blocks', 'Melee', 'Pickaxe', 'Axe', 'Shears', 'Ranged', 'Potions', 'Utility'];
const SLOTS = Array.from({ length: 9 }, (_, i) => 27 + i);
function normalizeSlots(slots) {
    if (!Array.isArray(slots) || slots.length !== 9) throw new Error('Expected 9 hotbar positions');
    return slots.map(value => {
        if (value === null || value === 'null') return null;
        const category = typeof value === 'string' && CATEGORIES.find(c => c.toLowerCase() === value.trim().toLowerCase());
        if (!category) throw new Error(`Unknown hotbar category: ${String(value).slice(0, 40)}`);
        return category;
    });
}
function parseHotbar(player) {
    const value = player?.stats?.Bedwars?.favorite_slots;
    if (value == null) throw new Error('Hotbar layout is unavailable in this player’s API data (it may be private)');
    if (typeof value !== 'string' || value.length > 1024) throw new Error('Invalid hotbar API data');
    return normalizeSlots(value.split(',').map(v => v.trim()));
}
const category = item => item ? CATEGORIES.find(c => c.toLowerCase() === item.plainName?.toLowerCase()) : null;
function validate(win) {
    if (!win || win.plainTitle !== 'Hotbar Manager' || win.slotCount !== 54
        || !CATEGORIES.every(c => [...win.slots].some(([s, i]) => s < 18 && i.nbt?.ExtraAttributes?.hotbarCategory === c))
        || !SLOTS.every(s => !win.slots.has(s) || category(win.slots.get(s)))) {
        throw new Error('Unrecognized Hotbar Manager layout; no further clicks sent');
    }
    return win;
}
const layout = win => SLOTS.map(s => category(win.slots.get(s)) || null);
module.exports = { CATEGORIES, SLOTS, normalizeSlots, parseHotbar, category, validate, layout };
