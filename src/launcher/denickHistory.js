'use strict';
const { randomUUID } = require('crypto');
const { JsonFileCache } = require('../storage/json_file_cache');

function uniquePushCaseInsensitive(items, value) {
    const clean = String(value || '').trim();
    if (!clean) return;
    if (!items.some(item => String(item).toLowerCase() === clean.toLowerCase())) {
        items.push(clean);
    }
}

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
        .sort((a, b) => denickEventTimestamp(b) - denickEventTimestamp(a))
        .slice(0, 100);
    if (player.events.length > 0) {
        const sortedAscending = player.events.slice().sort((a, b) => denickEventTimestamp(a) - denickEventTimestamp(b));
        player.firstSeen = sortedAscending[0].at || player.firstSeen;
        player.lastSeen = sortedAscending[sortedAscending.length - 1].at || player.lastSeen;
    }
    return player;
}

function normalizeDenickHistory(raw) {
    const rows = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.players) ? raw.players : []);
    const byRealName = new Map();

    rows.forEach((item) => {
        const realIGN = String(item.realIGN || item.realName || '').trim();
        if (!realIGN) return;
        const key = realIGN.toLowerCase();
        const current = byRealName.get(key) || {
            realIGN,
            nicks: [],
            methods: [],
            firstSeen: item.firstSeen || item.at || '',
            lastSeen: item.lastSeen || item.at || '',
            events: []
        };

        const nicks = Array.isArray(item.nicks) ? item.nicks : (item.nick ? [item.nick] : []);
        nicks.forEach(nick => uniquePushCaseInsensitive(current.nicks, nick));

        const methods = Array.isArray(item.methods) ? item.methods : (item.method ? [item.method] : []);
        methods.forEach(method => uniquePushCaseInsensitive(current.methods, method));

        const events = Array.isArray(item.events) ? item.events : (item.nick ? [item] : []);
        events.forEach((event) => {
            const nick = String(event.nick || item.nick || '').trim();
            const at = event.at || item.lastSeen || item.firstSeen || '';
            const method = String(event.method || item.method || 'unknown').trim() || 'unknown';
            const normalized = {
                at,
                nick,
                realIGN,
                method,
                stats: event.stats || null,
                gameMode: event.gameMode || null,
                account: event.account || null
            };
            if (nick) uniquePushCaseInsensitive(current.nicks, nick);
            uniquePushCaseInsensitive(current.methods, method);
            current.events.push(normalized);
            if (at && (!current.firstSeen || String(at) < String(current.firstSeen))) current.firstSeen = at;
            if (at && (!current.lastSeen || String(at) > String(current.lastSeen))) current.lastSeen = at;
        });

        finalizeDenickPlayerEvents(current);
        byRealName.set(key, current);
    });

    return Array.from(byRealName.values())
        .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
}

function projectDenickHistory(raw, fileExists = true) {
    const players = normalizeDenickHistory(raw);
    const methods = {};
    let totalNicks = 0;
    let totalEvents = 0;

    players.forEach((player) => {
        const events = Array.isArray(player.events) ? player.events : [];
        totalNicks += Array.isArray(player.nicks) ? player.nicks.length : 0;
        totalEvents += events.length;
        const countedMethods = events.length ? events.map(event => event.method) : (player.methods || []);
        countedMethods.forEach((method) => {
            const key = String(method || 'unknown');
            methods[key] = (methods[key] || 0) + 1;
        });
    });

    return {
        players,
        totalPlayers: players.length,
        totalNicks,
        totalEvents,
        methods,
        fileExists
    };
}


function createLauncherDenickHistory(historyFile) {
    const epoch = randomUUID();
    let generation = 0;
    const project = (raw, exists) => ({ ...projectDenickHistory(raw, exists), revision: epoch + ':' + (++generation) });
    const cache = new JsonFileCache(historyFile, {
        publicationAware: true,
        fallback: () => project([], false),
        transform: raw => project(raw, true)
    });
    return {
        get(knownRevision) {
            const history = cache.get();
            return knownRevision === history.revision ? null : history;
        }
    };
}
module.exports = { createLauncherDenickHistory, projectDenickHistory, normalizeDenickHistory };
