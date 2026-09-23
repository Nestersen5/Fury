'use strict';

const fs = require('fs');
const path = require('path');

function normalizeUuid(value) {
    const uuid = String(value || '').replace(/-/g, '').toLowerCase();
    return /^[a-f0-9]{32}$/.test(uuid) ? uuid : null;
}

function normalizeAccount(value) {
    if (!value) return null;
    const name = String(typeof value === 'string' ? value : value.profileName || value.name || value.username || '').trim();
    const uuid = normalizeUuid(typeof value === 'object' ? value.uuid : null);
    if (!uuid && !/^[A-Za-z0-9_]{3,16}$/.test(name)) return null;
    return { uuid, name, key: uuid || `name:${name.toLowerCase()}` };
}

// UUIDs are authoritative, including after an IGN change. Name matching is
// reserved for genuinely legacy records without a UUID on either side.
function sameAccount(left, right) {
    left = normalizeAccount(left);
    right = normalizeAccount(right);
    if (!left || !right) return false;
    if (left.uuid && right.uuid) return left.uuid === right.uuid;
    if (left.uuid || right.uuid) return false;
    return left.name.toLowerCase() === right.name.toLowerCase();
}

function sessionBelongsToAccount(session, account) {
    if (sameAccount(session, account)) return true;
    const owner = normalizeAccount(session);
    const viewed = normalizeAccount(account);
    // Old session exports sometimes omit UUIDs. Never use a name to override
    // a different recorded UUID (Minecraft names can be transferred).
    return Boolean(owner && viewed && !owner.uuid && owner.name
        && owner.name.toLowerCase() === viewed.name.toLowerCase());
}

function buildAccountCatalog({ authAccounts = [], sessions = [], remembered = null } = {}) {
    const byKey = new Map();
    const add = (source, auth = false) => {
        const identity = normalizeAccount(source);
        if (!identity) return;
        const previous = byKey.get(identity.key);
        const next = { ...previous, ...identity };
        if (auth) Object.assign(next, {
            username: source.username || identity.name,
            state: source.state || 'missing', label: source.label || 'Sign-in needed',
            signInRequired: Boolean(source.signInRequired),
            kind: source.kind || 'bad', hasLogin: Boolean(source.folderExists),
            minecraft: source.minecraft, microsoft: source.microsoft, xbox: source.xbox
        });
        byKey.set(identity.key, next);
    };
    sessions.forEach(session => add(session));
    if (remembered) add(remembered);
    authAccounts.forEach(account => add(account, true));
    // An expired login may no longer expose a profile UUID. Join it to a
    // historical identity only when its name has exactly one known owner.
    for (const [key, account] of byKey) {
        if (account.uuid) continue;
        const candidates = [...byKey.values()].filter(other => other.uuid
            && other.name.toLowerCase() === account.name.toLowerCase());
        if (candidates.length === 1) {
            const known = candidates[0];
            byKey.set(known.key, { ...known, ...account, uuid: known.uuid, key: known.key });
            byKey.delete(key);
        }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function createViewedAccountStore(file) {
    function read() {
        try { return normalizeAccount(JSON.parse(fs.readFileSync(file, 'utf8'))); }
        catch { return null; }
    }
    function select(value, catalog) {
        const key = typeof value === 'string' ? value : normalizeAccount(value)?.key;
        const account = catalog.find(item => item.key === key);
        if (!account) throw new Error('That account is no longer available. Refresh the account list.');
        const identity = normalizeAccount(account);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(temporary, JSON.stringify(identity), 'utf8');
            fs.renameSync(temporary, file);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        return account;
    }
    function resolve(catalog, fallback = null) {
        const saved = read();
        const account = saved && catalog.find(item => sameAccount(item, saved));
        if (account) return account;
        // Preserve a missing selected identity rather than silently displaying
        // another account's history after its login cache is removed.
        if (saved) return saved;
        const preferred = normalizeAccount(fallback);
        const first = catalog.find(item => sameAccount(item, preferred)) || catalog[0];
        return first ? select(first.key, catalog) : null;
    }
    function clear() { if (fs.existsSync(file)) fs.unlinkSync(file); }
    return { read, select, resolve, clear };
}

module.exports = { normalizeUuid, normalizeAccount, sameAccount, sessionBelongsToAccount, buildAccountCatalog, createViewedAccountStore };
