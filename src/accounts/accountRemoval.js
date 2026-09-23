'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeAccount, normalizeUuid } = require('./launcherAccounts');

function authBelongsToAccount(auth, account) {
    const uuid = normalizeUuid(auth.uuid);
    if (uuid) return uuid === account.uuid;
    return [account.name, account.username].some(name => name &&
        [auth.username, auth.profileName].some(alias => alias?.toLowerCase() === name.toLowerCase()));
}

function removeAuthCaches(authRoot, authAccounts, account) {
    const root = path.resolve(authRoot);
    const targets = authAccounts.filter(auth => auth.folderExists && authBelongsToAccount(auth, account)).map(auth => {
        if (!/^[A-Za-z0-9_]{3,16}$/.test(auth.username)) throw new Error('Invalid account cache name.');
        const target = path.resolve(root, auth.username);
        if (path.dirname(target) !== root || fs.lstatSync(target).isSymbolicLink()) throw new Error('Unsafe account cache path.');
        return target;
    });
    // Validate every resolved target before removing any saved login files.
    for (const target of new Set(targets)) fs.rmSync(target, { recursive: true, force: true });
}

// Keep session/reminder data intact without rediscovering removed accounts from it.
function createRemovedAccountStore(file) {
    function read() {
        try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(data) ? data : []; }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }
    function write(accounts) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        try { fs.writeFileSync(temporary, JSON.stringify(accounts)); fs.renameSync(temporary, file); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    function matches(removed, source) {
        const account = normalizeAccount(source);
        if (!account) return false;
        if (removed.uuid && account.uuid) return removed.uuid === account.uuid;
        return (removed.aliases || [removed.name]).some(name => name?.toLowerCase() === account.name.toLowerCase());
    }
    return {
        filter(catalog) { const removed = read(); return catalog.filter(account => !removed.some(item => matches(item, account))); },
        remove(account, authAccounts = []) {
            const identity = normalizeAccount(account);
            if (!identity) throw new Error('Invalid account.');
            const aliases = new Set([identity.name, account.username]);
            authAccounts.filter(auth => authBelongsToAccount(auth, identity)).forEach(auth => aliases.add(auth.username));
            write([...read().filter(item => !matches(item, identity)), { ...identity, aliases: [...aliases].filter(Boolean) }]);
        },
        restore(account) { write(read().filter(item => !matches(item, account))); }
    };
}

module.exports = { createRemovedAccountStore, removeAuthCaches, authBelongsToAccount };
