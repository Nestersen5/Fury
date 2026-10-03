'use strict';

// Denick history store extracted from proxy.js. Owns the on-disk denicked.json
// file: publication-aware cached reads and coalesced, acknowledged off-thread
// writes. The history is a list of
// real-IGN-keyed players, each with the nicks they've used, the detection
// methods, and a capped event log.
//
// The factory takes the file path and writer as DI so tests can supply
// in-memory equivalents. Pure helpers (timestamp parsing, event de-duping,
// normalization) sit at module scope because they have no external deps and
// the test suite asserts on their text shape inside this file.

const { JsonFileCache } = require('../storage/json_file_cache.js');
const { createDenickHistoryIndex } = require('./denick_history_index.js');

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
            events: [],
            manualNicks: Object.create(null)
        };

        for (const [nick, at] of Object.entries(item.manualNicks || {})) {
            const key = String(nick).trim().toLowerCase();
            if (key && denickEventTimestamp({ at }) >= denickEventTimestamp({ at: current.manualNicks[key] })) current.manualNicks[key] = at;
        }
        const nickKeys = new Set(current.nicks.map(nick => String(nick).toLowerCase()));
        for (const method of Array.isArray(item.methods) ? item.methods : (item.method ? [item.method] : [])) {
            if (method && !current.methods.includes(method)) current.methods.push(method);
        }
        const nicks = Array.isArray(item.nicks) ? item.nicks : (item.nick ? [item.nick] : []);
        nicks.filter(Boolean).forEach(nick => {
            const nickKey = String(nick).toLowerCase();
            if (!nickKeys.has(nickKey)) {
                nickKeys.add(nickKey);
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
            const eventNickKey = normalizedEvent.nick.toLowerCase();
            if (!nickKeys.has(eventNickKey)) {
                nickKeys.add(eventNickKey);
                current.nicks.push(normalizedEvent.nick);
            }
            if (normalizedEvent.method === 'manual') {
                const key = normalizedEvent.nick.toLowerCase();
                if (denickEventTimestamp(normalizedEvent) >= denickEventTimestamp({ at: current.manualNicks[key] })) current.manualNicks[key] = normalizedEvent.at;
            }
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

function createDenickHistory({ historyFile, writeJsonOffThread, saveDelayMs = 75, onError = () => {} }) {
    if (!historyFile) throw new Error('createDenickHistory: historyFile is required');
    if (typeof writeJsonOffThread !== 'function') throw new Error('createDenickHistory: writeJsonOffThread is required');
    let dirty = false, inFlight = null, saveTimer = null;
    const listeners = new Set();
    const makeStore = players => ({
        players,
        byReal: new Map(players.map(player => [String(player.realIGN).toLowerCase(), player])),
        ...createDenickHistoryIndex(players)
    });
    const denickHistoryFileCache = new JsonFileCache(historyFile, {
        fallback: () => makeStore([]), checkIntervalMs: 250, publicationAware: true,
        transform: raw => makeStore(normalizeDenickHistory(raw)), onError
    });

    function loadDenickHistoryStore() {
        // A completed older snapshot must not replace mutations awaiting a save.
        return dirty || inFlight ? denickHistoryFileCache.value : denickHistoryFileCache.get();
    }
    function findKnownDenickByNick(nick) {
        const key = String(nick || '').trim().toLowerCase();
        if (!key) return null;
        const known = loadDenickHistoryStore().byNick.get(key);
        return known ? { ...known, nick, at: Date.now() } : null;
    }
    function scheduleSave() {
        if (saveTimer || inFlight) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void persist().catch(onError);
        }, saveDelayMs);
        saveTimer.unref?.();
    }
    function changed(store, nick, previous, reason) {
        dirty = true;
        denickHistoryFileCache.set(store);
        scheduleSave();
        const next = store.byNick.get(String(nick).toLowerCase()) || null;
        // Automatic sightings of an unchanged identity don't repaint live views.
        if (reason !== 'automatic' || previous?.realName !== next?.realName || previous?.source !== next?.source) {
            for (const listener of listeners) {
                try { listener({ nick, previous, next, reason }); } catch (error) { onError(error); }
            }
        }
    }
    function appendDenickHistory(entry = {}) {
        if (!entry.nick || !entry.realIGN) return;
        const store = loadDenickHistoryStore();
        if (denickHistoryFileCache.failedStamp) throw new Error('Saved nick history could not be read. No mappings were overwritten.');
        const key = String(entry.nick).toLowerCase();
        const previous = store.byNick.get(key);
        const previousOwner = previous && store.byReal.get(previous.realName.toLowerCase());
        const previousManualAt = previous?.source === 'manual'
            ? denickEventTimestamp({ at: previousOwner?.manualNicks?.[key] || previousOwner?.lastSeen }) : 0;
        // Two explicit corrections can arrive in the same clock tick.
        const now = new Date(entry.method === 'manual' ? Math.max(Date.now(), previousManualAt + 1) : Date.now()).toISOString();
        const record = {
            at: now, nick: String(entry.nick), realIGN: String(entry.realIGN),
            method: entry.method || 'unknown', stats: entry.stats || null,
            gameMode: entry.gameMode || null, account: entry.account || null
        };
        const realKey = record.realIGN.toLowerCase();
        let player = store.byReal.get(realKey);
        if (!player) {
            player = { realIGN: record.realIGN, nicks: [], methods: [], firstSeen: now, lastSeen: now, events: [], manualNicks: Object.create(null) };
            store.byReal.set(realKey, player);
            store.players.push(player);
        }
        player.lastSeen = now;
        if (!player.nicks.some(nick => String(nick).toLowerCase() === key)) player.nicks.push(record.nick);
        if (!player.methods.includes(record.method)) player.methods.push(record.method);
        if (record.method === 'manual') {
            // Keep explicit ownership outside the capped evidence log.
            player.manualNicks ||= Object.create(null);
            player.manualNicks[key] = now;
        }
        player.events.push(record);
        finalizeDenickPlayerEvents(player);
        store.updatePlayer(player);
        changed(store, record.nick, previous, record.method === 'manual' ? 'manual' : 'automatic');
        return { ok: true, nick: record.nick, realIGN: player.realIGN };
    }
    function removeDenickMapping(realRaw, nickRaw) {
        const realKey = String(realRaw || '').trim().toLowerCase();
        const nickKey = String(nickRaw || '').trim().toLowerCase();
        if (!realKey || !nickKey) return { removed: false, reason: 'invalid' };
        const store = loadDenickHistoryStore(), player = store.byReal.get(realKey);
        if (!player || !player.nicks.some(nick => String(nick).toLowerCase() === nickKey)) return { removed: false, reason: 'not_found' };
        if (denickHistoryFileCache.failedStamp) throw new Error('Saved nick history could not be read.');
        const previous = store.byNick.get(nickKey);
        player.nicks = player.nicks.filter(nick => String(nick).toLowerCase() !== nickKey);
        player.events = player.events.filter(event => String(event.nick).toLowerCase() !== nickKey);
        if (player.manualNicks) delete player.manualNicks[nickKey];
        if (!player.nicks.length) {
            store.players.splice(store.players.indexOf(player), 1);
            store.byReal.delete(realKey);
        } else {
            player.methods = [...new Set(player.events.map(event => event.method || 'unknown'))];
            finalizeDenickPlayerEvents(player);
        }
        store.updatePlayer(player);
        changed(store, nickRaw, previous, 'remove');
        return { removed: true, removedPlayer: !player.nicks.length, realIGN: player.realIGN, nick: nickRaw, remainingNicks: player.nicks.length };
    }
    function persist() {
        if (inFlight) return inFlight;
        if (!dirty) return Promise.resolve();
        const players = denickHistoryFileCache.value.players.slice()
            .sort((a, b) => String(a.realIGN).localeCompare(String(b.realIGN)));
        dirty = false;
        // postMessage clones once per batch. The acknowledgement identifies the
        // exact publication, even if more mappings arrive while it is writing.
        const writing = new Promise((resolve, reject) => {
            try {
                writeJsonOffThread(historyFile, players, 'DenickHistory', (error, publication) => {
                    if (error) reject(new Error(String(error)));
                    else {
                        if (publication) denickHistoryFileCache.markWritten(publication);
                        else denickHistoryFileCache.invalidate();
                        resolve();
                    }
                }, { publication: true });
            } catch (error) { reject(error); }
        });
        inFlight = writing.catch(error => { dirty = true; throw error; }).finally(() => { inFlight = null; });
        inFlight.then(() => { if (dirty) scheduleSave(); }, () => {});
        return inFlight;
    }
    async function flush({ strict = false } = {}) {
        try {
            do {
                clearTimeout(saveTimer); saveTimer = null;
                await (inFlight || persist());
            } while (dirty);
        } catch (error) {
            if (strict) throw error;
            onError(error);
        }
    }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    return { loadDenickHistoryStore, findKnownDenickByNick, appendDenickHistory, removeDenickMapping, denickHistoryFileCache, flush, subscribe };
}

module.exports = { createDenickHistory, denickEventTimestamp, dedupeDenickEventsByNick, finalizeDenickPlayerEvents, normalizeDenickHistory };
