'use strict';

// Custom display names for people you know ("friend aliases").
//
// Keyed on the REAL IGN rather than on whatever Hypixel happens to be showing,
// so one entry covers a friend whether they are nicked or not: the resolver in
// proxy.js denicks first and looks the answer up here second, which is what
// makes _xAurora and their nick GoodRider both render as FattyAurora. A nick
// may be used as the key too - that is the shortcut for someone you have not
// denicked yet, and it only ever matches that one nick.
//
// Storage mirrors src/denick/history.js: a JsonFileCache for reads, which
// re-normalizes on every mtime change so an edit made outside the proxy is
// picked up without a restart, and the off-thread JSON writer for writes.
//
// Display-only, exactly like the denick rename this rides on. Nothing here may
// reach internal state, stat lookups, or anything published to other people -
// an alias is your private name for someone, not their identity.

const { JsonFileCache } = require('../storage/json_file_cache.js');

// The alias replaces the GameProfile name the client binds to the entity, and
// scoreboard teams and score entries are keyed by that same string. So an alias
// has to look like a Minecraft name; anything else risks the client dropping
// the player out of their team. Colour lives in a separate field for the
// surfaces the proxy composes itself (chat and the tab row), never in the name.
const VALID_NAME = /^[A-Za-z0-9_]{3,16}$/;
const VALID_COLOR = /^§[0-9a-f]$/i;

function aliasKey(value) {
    return String(value || '').trim().toLowerCase();
}

function isValidAliasName(value) {
    return typeof value === 'string' && VALID_NAME.test(value);
}

// Accepts "§d", "d" or "light_purple"-free shorthand; anything else is dropped
// rather than rejected, so a stray colour never blocks setting the alias.
function normalizeAliasColor(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const code = text.startsWith('§') ? text : `§${text}`;
    return VALID_COLOR.test(code) ? code.toLowerCase() : null;
}

function normalizeAliasEntry(item = {}) {
    const name = String(item.realIGN || item.name || '').trim();
    const alias = String(item.alias || '').trim();
    if (!isValidAliasName(name) || !isValidAliasName(alias)) return null;
    return {
        realIGN: name,
        alias,
        color: normalizeAliasColor(item.color),
        note: String(item.note || '').trim().slice(0, 120) || null,
        uuid: item.uuid ? String(item.uuid) : null,
        addedAt: item.addedAt || new Date().toISOString()
    };
}

function normalizeAliasBook(raw) {
    const rows = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.aliases) ? raw.aliases : []);

    const byName = new Map();
    rows.forEach(item => {
        const entry = normalizeAliasEntry(item);
        // Last write wins for a duplicated key: the file is hand-editable and
        // silently keeping the first copy would make an edit look ignored.
        if (entry) byName.set(aliasKey(entry.realIGN), entry);
    });
    return byName;
}

function createFriendAliasBook({ aliasFile, writeJsonOffThread }) {
    if (!aliasFile) throw new Error('createFriendAliasBook: aliasFile is required');
    if (typeof writeJsonOffThread !== 'function') {
        throw new Error('createFriendAliasBook: writeJsonOffThread is required');
    }

    const aliasFileCache = new JsonFileCache(aliasFile, {
        fallback: () => new Map(),
        checkIntervalMs: 250,
        transform: normalizeAliasBook
    });

    function loadAliasBook() {
        return aliasFileCache.get();
    }

    function listAliases() {
        return Array.from(loadAliasBook().values())
            .sort((a, b) => a.realIGN.localeCompare(b.realIGN));
    }

    function findAlias(name) {
        const key = aliasKey(name);
        if (!key) return null;
        return loadAliasBook().get(key) || null;
    }

    // Is `name` already somebody's alias? Two entries rendering under one name
    // would put two players under it, and the client keys team membership by
    // name - it would then shuffle membership between them.
    function aliasOwner(name) {
        const key = aliasKey(name);
        if (!key) return null;
        return Array.from(loadAliasBook().values()).find(entry => aliasKey(entry.alias) === key) || null;
    }

    function persist(byName) {
        aliasFileCache.set(byName);
        try {
            writeJsonOffThread(aliasFile, Array.from(byName.values()), 'FriendAliases');
        } catch (ignore) {}
    }

    function setAlias({ name, alias, color = null, note = null, uuid = null } = {}) {
        const realIGN = String(name || '').trim();
        const aliasName = String(alias || '').trim();
        if (!isValidAliasName(realIGN)) return { ok: false, reason: 'invalid_name' };
        if (!isValidAliasName(aliasName)) return { ok: false, reason: 'invalid_alias' };
        if (aliasKey(realIGN) === aliasKey(aliasName)) return { ok: false, reason: 'same_name' };

        const owner = aliasOwner(aliasName);
        if (owner && aliasKey(owner.realIGN) !== aliasKey(realIGN)) {
            return { ok: false, reason: 'alias_taken', conflict: owner };
        }

        const byName = new Map(loadAliasBook());
        const previous = byName.get(aliasKey(realIGN)) || null;
        const entry = normalizeAliasEntry({
            realIGN,
            alias: aliasName,
            color: color === null ? previous?.color : color,
            note: note === null ? previous?.note : note,
            uuid: uuid || previous?.uuid || null,
            addedAt: previous?.addedAt
        });
        if (!entry) return { ok: false, reason: 'invalid_alias' };

        byName.set(aliasKey(realIGN), entry);
        persist(byName);
        return { ok: true, entry, previous };
    }

    function removeAlias(name) {
        const key = aliasKey(name);
        const byName = new Map(loadAliasBook());
        const entry = byName.get(key) || null;
        if (!entry) return { removed: false, reason: 'not_found' };
        byName.delete(key);
        persist(byName);
        return { removed: true, entry };
    }

    return {
        loadAliasBook,
        listAliases,
        findAlias,
        aliasOwner,
        setAlias,
        removeAlias,
        aliasFileCache
    };
}

module.exports = {
    createFriendAliasBook,
    normalizeAliasBook,
    normalizeAliasEntry,
    normalizeAliasColor,
    isValidAliasName,
    aliasKey,
    VALID_NAME,
    VALID_COLOR
};
