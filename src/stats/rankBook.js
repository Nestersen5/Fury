'use strict';

// Remembered rank displays ("§6[MVP§0++§6] Name") for players the proxy has
// looked up, keyed by IGN. The profile cache only lives five minutes in
// memory; this lets views of past games (the /replay menu's teammates) keep
// showing ranks without a fresh API call per name.
//
// Fed from every Hypixel player lookup, so everyone looked up for tab stats
// during a game is already here by the time the game is over.

const fs = require('fs');

const MAX_ENTRIES = 3000;
const SAVE_DELAY_MS = 5000;
// Ranks change (MVP++ lapses, monthly colours get swapped), so an entry this
// old is still shown but refreshed in the background when it is on screen.
const STALE_AFTER_MS = 3 * 24 * 3600000;
const VALID_NAME = /^[A-Za-z0-9_]{2,16}$/;

function rankKey(name) {
    return String(name || '').trim().toLowerCase();
}

function normalizeEntries(raw) {
    const rows = raw && typeof raw === 'object' && raw.players && typeof raw.players === 'object'
        ? Object.values(raw.players)
        : [];
    const byName = new Map();
    for (const row of rows) {
        const name = String(row?.name || '').trim();
        const display = typeof row?.display === 'string' ? row.display.replace(/[\r\n]/g, '').slice(0, 64) : '';
        const at = Number(row?.at) || 0;
        if (!VALID_NAME.test(name) || !display || !at) continue;
        byName.set(rankKey(name), { name, display, at });
    }
    return byName;
}

function createRankBook({ rankFile, writeJsonOffThread, now = Date.now, fsImpl = fs, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
    if (!rankFile) throw new Error('createRankBook: rankFile is required');
    if (typeof writeJsonOffThread !== 'function') throw new Error('createRankBook: writeJsonOffThread is required');

    let entries = new Map();
    try {
        entries = normalizeEntries(JSON.parse(fsImpl.readFileSync(rankFile, 'utf8')));
    } catch (error) {
        // Missing or unreadable: start empty, the next save rewrites it.
    }
    let saveTimer = null;

    function save() {
        saveTimer = null;
        const kept = Array.from(entries.values())
            .sort((a, b) => b.at - a.at)
            .slice(0, MAX_ENTRIES);
        entries = new Map(kept.map(entry => [rankKey(entry.name), entry]));
        const players = {};
        kept.forEach(entry => { players[rankKey(entry.name)] = entry; });
        try {
            writeJsonOffThread(rankFile, { version: 1, players }, 'RankBook');
        } catch (ignore) {}
    }

    function record(name, display) {
        const clean = String(name || '').trim();
        if (!VALID_NAME.test(clean) || typeof display !== 'string' || !display) return;
        const previous = entries.get(rankKey(clean));
        entries.set(rankKey(clean), { name: clean, display: display.slice(0, 64), at: now() });
        // Unchanged displays still refresh the timestamp, but only need a
        // write when the entry was about to go stale.
        if (previous && previous.display === display && now() - previous.at < STALE_AFTER_MS / 2) return;
        if (!saveTimer) saveTimer = setTimeoutImpl(save, SAVE_DELAY_MS);
    }

    function get(name) {
        return entries.get(rankKey(name)) || null;
    }

    function isStale(name) {
        const entry = get(name);
        return !entry || now() - entry.at > STALE_AFTER_MS;
    }

    function flush() {
        if (!saveTimer) return;
        clearTimeoutImpl(saveTimer);
        save();
    }

    return { record, get, isStale, flush };
}

module.exports = { createRankBook, STALE_AFTER_MS };
