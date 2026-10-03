'use strict';

function eventTimestamp(event = {}) {
    const parsed = Date.parse(event.at || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

const nickKey = value => String(value || '').trim().toLowerCase();

// Explicit corrections win, then newest evidence, then a stable identity tie
// break. Changing the file's row order must never change an identity match.
function preferred(a, b) {
    if (!b) return true;
    if (a.manual !== b.manual) return a.manual;
    if (a.at !== b.at) return a.at > b.at;
    return a.realKey < b.realKey;
}

function createDenickHistoryIndex(players = []) {
    const byNick = new Map(), candidates = new Map(), keysByReal = new Map();
    function updatePlayer(player) {
        const realKey = nickKey(player?.realIGN);
        if (!realKey) return;
        const affected = new Set(keysByReal.get(realKey) || []);
        for (const key of affected) candidates.get(key)?.delete(realKey);
        const names = new Map(), events = new Map(), manual = new Map();
        for (const nick of player.nicks || []) if (nickKey(nick)) names.set(nickKey(nick), nick);
        for (const event of player.events || []) {
            const key = nickKey(event?.nick);
            if (!key) continue;
            names.set(key, event.nick);
            if (!events.has(key) || eventTimestamp(event) >= eventTimestamp(events.get(key))) events.set(key, event);
            if (event.method === 'manual') manual.set(key, Math.max(manual.get(key) || 0, eventTimestamp(event)));
        }
        for (const [nick, at] of Object.entries(player.manualNicks || {})) {
            const key = nickKey(nick);
            if (names.has(key)) manual.set(key, Math.max(manual.get(key) || 0, eventTimestamp({ at })));
        }
        for (const [key, nick] of names) {
            const event = events.get(key);
            const method = manual.has(key) ? 'manual' : event?.method || player.methods?.[0] || 'history';
            const entry = {
                realKey, manual: method === 'manual',
                at: manual.has(key) ? manual.get(key) : eventTimestamp(event || { at: player.lastSeen }),
                known: { nick, realName: player.realIGN, source: method === 'manual' ? 'manual' : 'history', method }
            };
            if (!candidates.has(key)) candidates.set(key, new Map());
            candidates.get(key).set(realKey, entry);
            affected.add(key);
        }
        if (names.size) keysByReal.set(realKey, new Set(names.keys()));
        else keysByReal.delete(realKey);
        for (const key of affected) {
            let winner = null;
            for (const candidate of candidates.get(key)?.values() || []) if (preferred(candidate, winner)) winner = candidate;
            if (winner) byNick.set(key, winner.known);
            else { byNick.delete(key); candidates.delete(key); }
        }
    }
    for (const player of Array.isArray(players) ? players : []) updatePlayer(player);
    return { byNick, updatePlayer };
}

function buildDenickHistoryIndex(players = []) { return createDenickHistoryIndex(players).byNick; }

module.exports = {
    buildDenickHistoryIndex,
    createDenickHistoryIndex,
    eventTimestamp
};
