'use strict';

// Denick history store extracted from proxy.js. Owns the on-disk denicked.json
// file: reading via a JsonFileCache that re-normalizes the file on every mtime
// change, and writing via the off-thread JSON writer. The history is a list of
// real-IGN-keyed players, each with the nicks they've used, the detection
// methods, and a capped event log.
//
// The factory takes the file path and writer as DI so tests can supply
// in-memory equivalents. Pure helpers (timestamp parsing, event de-duping,
// normalization) sit at module scope because they have no external deps and
// the test suite asserts on their text shape inside this file.

const { JsonFileCache } = require('../storage/json_file_cache.js');
const { buildDenickHistoryIndex } = require('./denick_history_index.js');

function denickEventTimestamp(event = {}) {
    const parsed = Date.parse(event.at || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeDenickEventsByNick(events = []) {
    const byNick = new Map();
    events.filter(Boolean).forEach((event) => {
        const key = String(event.nick || '').trim().toLowerCase();
        if (!key) return;
        const current = byNick.get(key);
        if (!current || denickEventTimestamp(event) >= denickEventTimestamp(current)) {
            byNick.set(key, event);
        }
    });
    return Array.from(byNick.values());
}

function finalizeDenickPlayerEvents(player = {}) {
    player.events = dedupeDenickEventsByNick(Array.isArray(player.events) ? player.events : [])
        .sort((a, b) => denickEventTimestamp(a) - denickEventTimestamp(b))
        .slice(-100);
    if (player.events.length > 0) {
        player.firstSeen = player.events[0].at || player.firstSeen;
        player.lastSeen = player.events[player.events.length - 1].at || player.lastSeen;
    }
    return player;
}

function normalizeDenickHistory(raw) {
    const rows = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.players) ? raw.players : []);
    const byRealName = new Map();

    rows.forEach(item => {
        const realIGN = item.realIGN || item.realName;
        if (!realIGN) return;
        const key = String(realIGN).toLowerCase();
        const current = byRealName.get(key) || {
            realIGN,
            nicks: [],
            methods: [],
            firstSeen: item.firstSeen || item.at || new Date().toISOString(),
            lastSeen: item.lastSeen || item.at || new Date().toISOString(),
            events: []
        };

        const nicks = Array.isArray(item.nicks) ? item.nicks : (item.nick ? [item.nick] : []);
        nicks.filter(Boolean).forEach(nick => {
            if (!current.nicks.some(existing => String(existing).toLowerCase() === String(nick).toLowerCase())) {
                current.nicks.push(String(nick));
            }
        });

        const events = Array.isArray(item.events) ? item.events : (item.nick ? [item] : []);
        events.filter(Boolean).forEach(event => {
            const normalizedEvent = {
                at: event.at || item.lastSeen || item.firstSeen || new Date().toISOString(),
                nick: String(event.nick || item.nick || '').trim(),
                realIGN,
                method: event.method || item.method || 'unknown',
                stats: event.stats || null,
                gameMode: event.gameMode || null,
                account: event.account || null
            };
            if (!normalizedEvent.nick) return;
            current.events.push(normalizedEvent);
            if (!current.methods.includes(normalizedEvent.method)) current.methods.push(normalizedEvent.method);
            if (String(normalizedEvent.at) < String(current.firstSeen)) current.firstSeen = normalizedEvent.at;
            if (String(normalizedEvent.at) > String(current.lastSeen)) current.lastSeen = normalizedEvent.at;
        });

        finalizeDenickPlayerEvents(current);
        byRealName.set(key, current);
    });

    return Array.from(byRealName.values());
}

function createDenickHistory({ historyFile, writeJsonOffThread }) {
    if (!historyFile) throw new Error('createDenickHistory: historyFile is required');
    if (typeof writeJsonOffThread !== 'function') {
        throw new Error('createDenickHistory: writeJsonOffThread is required');
    }

    const denickHistoryFileCache = new JsonFileCache(historyFile, {
        fallback: () => ({ players: [], byNick: new Map() }),
        checkIntervalMs: 250,
        transform: raw => {
            const players = normalizeDenickHistory(raw);
            return {
                players,
                byNick: buildDenickHistoryIndex(players)
            };
        }
    });

    function loadDenickHistoryStore() {
        return denickHistoryFileCache.get();
    }

    function findKnownDenickByNick(nick) {
        const key = String(nick || '').toLowerCase();
        if (!key) return null;
        const known = loadDenickHistoryStore().byNick.get(key);
        return known ? { ...known, nick, at: Date.now() } : null;
    }

    function appendDenickHistory(entry = {}) {
        if (!entry.nick || !entry.realIGN) return;
        const now = new Date().toISOString();
        const record = {
            at: now,
            nick: String(entry.nick),
            realIGN: String(entry.realIGN),
            method: entry.method || 'unknown',
            stats: entry.stats || null,
            gameMode: entry.gameMode || null,
            account: entry.account || null
        };

        try {
            const players = loadDenickHistoryStore().players;
            const realKey = String(record.realIGN).toLowerCase();
            let player = players.find(item => String(item.realIGN || '').toLowerCase() === realKey);

            if (!player) {
                player = {
                    realIGN: record.realIGN,
                    nicks: [],
                    methods: [],
                    firstSeen: now,
                    lastSeen: now,
                    events: []
                };
                players.push(player);
            }

            player.realIGN = player.realIGN || record.realIGN;
            player.firstSeen = player.firstSeen || now;
            player.lastSeen = now;
            if (!Array.isArray(player.nicks)) player.nicks = [];
            if (!player.nicks.some(nick => String(nick).toLowerCase() === String(record.nick).toLowerCase())) {
                player.nicks.push(record.nick);
            }
            if (!Array.isArray(player.methods)) player.methods = [];
            if (!player.methods.includes(record.method)) player.methods.push(record.method);
            if (!Array.isArray(player.events)) player.events = [];
            player.events.push(record);
            finalizeDenickPlayerEvents(player);

            players.sort((a, b) => String(a.realIGN || '').localeCompare(String(b.realIGN || '')));
            denickHistoryFileCache.set({
                players,
                byNick: buildDenickHistoryIndex(players)
            });
            try {
                writeJsonOffThread(historyFile, players, 'DenickHistory');
            } catch (ignore) {}
        } catch (e) {
            const players = [{
                    realIGN: record.realIGN,
                    nicks: [record.nick],
                    methods: [record.method],
                    firstSeen: now,
                    lastSeen: now,
                    events: [record]
            }];
            denickHistoryFileCache.set({
                players,
                byNick: buildDenickHistoryIndex(players)
            });
            try {
                writeJsonOffThread(historyFile, players, 'DenickHistory');
            } catch (ignore) {}
        }
    }

    function removeDenickMapping(realRaw, nickRaw) {
        const realKey = String(realRaw || '').trim().toLowerCase();
        const nickKey = String(nickRaw || '').trim().toLowerCase();
        if (!realKey || !nickKey) return { removed: false, reason: 'invalid' };

        const players = loadDenickHistoryStore().players;
        const playerIndex = players.findIndex(item => String(item.realIGN || '').trim().toLowerCase() === realKey);
        if (playerIndex < 0) return { removed: false, reason: 'not_found' };

        const player = players[playerIndex];
        const previousNickCount = Array.isArray(player.nicks) ? player.nicks.length : 0;
        player.nicks = (Array.isArray(player.nicks) ? player.nicks : [])
            .filter(nick => String(nick || '').trim().toLowerCase() !== nickKey);
        player.events = (Array.isArray(player.events) ? player.events : [])
            .filter(event => String(event?.nick || '').trim().toLowerCase() !== nickKey);
        if (player.nicks.length === previousNickCount) return { removed: false, reason: 'not_found' };

        if (!player.nicks.length) {
            players.splice(playerIndex, 1);
        } else {
            player.methods = [...new Set(player.events.map(event => String(event?.method || 'unknown')))].filter(Boolean);
            finalizeDenickPlayerEvents(player);
        }

        const nextStore = {
            players,
            byNick: buildDenickHistoryIndex(players)
        };
        denickHistoryFileCache.set(nextStore);
        try {
            writeJsonOffThread(historyFile, players, 'DenickHistory');
        } catch (ignore) {}
        return {
            removed: true,
            removedPlayer: !player.nicks.length,
            realIGN: player.realIGN,
            nick: nickRaw,
            remainingNicks: player.nicks.length
        };
    }

    return {
        loadDenickHistoryStore,
        findKnownDenickByNick,
        appendDenickHistory,
        removeDenickMapping,
        denickHistoryFileCache
    };
}

module.exports = {
    createDenickHistory,
    denickEventTimestamp,
    dedupeDenickEventsByNick,
    finalizeDenickPlayerEvents,
    normalizeDenickHistory
};
