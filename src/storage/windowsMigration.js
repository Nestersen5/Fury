'use strict';

// Filesystem transaction engine. The Windows host owns SID checks, private ACLs,
// writer exclusion and the maintenance lock. No discovery or user-data defaults
// live here, so tests can exercise the same engine entirely in temporary trees.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT_FILES, TREES, NESTED_FILES, excluded } = require('./migrationInventory');
const VERSION = 1;
const LIMIT_FILES = 100000;
const LIMIT_BYTES = 64 * 1024 ** 3;
const MAX_TRANSACTIONS = 64;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function checked(file) {
    if (!path.isAbsolute(file)) fail('ABSOLUTE_PATH_REQUIRED');
    const absolute = path.resolve(file);
    let current = path.parse(absolute).root;
    for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        if (exists(current)) {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) fail('UNSAFE_LINK');
        }
    }
    return absolute;
}
function overlaps(a, b) {
    const left = path.resolve(a).toLowerCase() + path.sep;
    const right = path.resolve(b).toLowerCase() + path.sep;
    return left.startsWith(right) || right.startsWith(left);
}
function validateRoots(options) {
    const destination = checked(options.destination), control = checked(options.control);
    if (overlaps(destination, control)) fail('OVERLAPPING_ROOTS');
    for (const installation of [...options.installations, ...(options.newInstallation ? [options.newInstallation] : [])]) {
        checked(installation);
        if (overlaps(installation, destination) || overlaps(installation, control)) fail('INSTALL_DATA_OVERLAP');
    }
    return { destination, control };
}
function digest(file) {
    checked(file);
    const fd = fs.openSync(file, 'r'), hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let count;
        while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
    } finally { fs.closeSync(fd); }
    return hash.digest('hex');
}
function inventory(root, selected = false) {
    checked(root);
    if (!exists(root)) return [];
    const entries = [];
    let bytes = 0, visited = 0;
    function visit(relative) {
        if (++visited > LIMIT_FILES * 2 || relative.split('/').length > 64) fail('PAYLOAD_LIMIT');
        if (selected && excluded(relative)) return;
        const file = checked(path.join(root, relative));
        if (!exists(file)) return;
        const before = fs.lstatSync(file);
        if (before.isDirectory()) {
            for (const name of fs.readdirSync(file).sort()) visit(relative ? relative + '/' + name : name);
        } else if (before.isFile()) {
            bytes += before.size;
            if (entries.length >= LIMIT_FILES || bytes > LIMIT_BYTES) fail('PAYLOAD_LIMIT');
            const hash = digest(file), after = fs.statSync(file);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) fail('SOURCE_CHANGED');
            entries.push({ path: relative, size: before.size, sha256: hash });
        } else fail('UNSAFE_FILE');
    }
    if (selected) [...ROOT_FILES, ...TREES, ...NESTED_FILES].sort().forEach(visit);
    else fs.readdirSync(root).sort().forEach(visit);
    return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function writeJson(file, value) {
    checked(file);
    const temporary = checked(file + '.tmp');
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
}
function readJson(file) {
    checked(file);
    if (fs.statSync(file).size > 32 * 1024 * 1024) fail('INVALID_MANIFEST');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function validateEntries(entries) {
    if (!Array.isArray(entries) || entries.length > LIMIT_FILES) fail('INVALID_MANIFEST');
    let previous = '', bytes = 0;
    for (const entry of entries) {
        if (typeof entry.path !== 'string' || entry.path <= previous || entry.path.includes('\\') ||
            entry.path.includes(':') || entry.path.split('/').some(part => !part || part === '.' || part === '..') ||
            !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('INVALID_MANIFEST');
        bytes += entry.size;
        if (bytes > LIMIT_BYTES) fail('PAYLOAD_LIMIT');
        previous = entry.path;
    }
}
function checkpoint(options, point) { options.checkpoint?.(point); }
function copyEntry(source, target, entry, options) {
    const from = checked(path.join(source, entry.path)), to = checked(path.join(target, entry.path));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (exists(to)) { if (digest(to) === entry.sha256) return; fail('STAGING_CHANGED'); }
    const partial = checked(to + '.partial');
    const timestamps = fs.statSync(from);
    fs.copyFileSync(from, partial);
    // launcher.js uses auth-cache mtime when selecting the most recently used
    // account. Preserve that ordering, in addition to preserving file bytes.
    fs.utimesSync(partial, timestamps.atime, timestamps.mtime);
    const fd = fs.openSync(partial, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (digest(partial) !== entry.sha256) fail('COPY_VERIFICATION_FAILED');
    fs.renameSync(partial, to);
    checkpoint(options, 'copied:' + entry.path);
}
function freeSpace(root) {
    let ancestor = root;
    while (!exists(ancestor)) ancestor = path.dirname(ancestor);
    const stat = fs.statfsSync(ancestor, { bigint: true });
    return Number(stat.bavail * stat.bsize);
}
function requiredSpace(entries) {
    const bytes = entries.reduce((total, entry) => total + entry.size, 0);
    return bytes * 2 + Math.max(64 * 1024 ** 2, Math.ceil(bytes * 0.05));
}
function plan(options) {
    validateRoots(options);
    const sources = [...new Set(options.installations.map(value => path.resolve(value)))].sort().map(installation => {
        const source = path.join(installation, 'resources', 'app');
        return { installation, source, entries: inventory(source, true) };
    });
    const needed = requiredSpace(sources.flatMap(source => source.entries));
    if ((options.availableBytes ?? freeSpace(options.control)) < needed) fail('INSUFFICIENT_SPACE');
    return { schema: VERSION, owner: options.owner, sources, requiredBytes: needed };
}
function transactionId(source, entries, owner) {
    return sha(JSON.stringify({ schema: VERSION, source: path.resolve(source).toLowerCase(), owner, entries })).slice(0, 32);
}
function preserve(options, planned) {
    validateRoots(options);
    if (!options.quiescent || !options.owner || planned.owner !== options.owner) fail('OWNERSHIP_OR_WRITERS');
    fs.mkdirSync(options.control, { recursive: true });
    const transactions = [];
    for (const item of planned.sources) {
        validateEntries(item.entries);
        if (!same(inventory(item.source, true), item.entries)) fail('SOURCE_CHANGED');
        if (!item.entries.length) continue;
        const id = transactionId(item.source, item.entries, options.owner);
        const transaction = checked(path.join(options.control, id)), payload = checked(path.join(transaction, 'payload'));
        if (fs.readdirSync(options.control).filter(name => /^[a-f0-9]{32}$/.test(name)).length >= MAX_TRANSACTIONS && !exists(transaction)) fail('RECOVERY_LIMIT');
        fs.mkdirSync(payload, { recursive: true });
        const readyFile = path.join(transaction, 'ready.json');
        if (exists(readyFile)) {
            const ready = loadReady(options, id);
            if (!same(ready.entries, item.entries)) fail('STAGING_CHANGED');
        } else {
            for (const entry of item.entries) copyEntry(item.source, payload, entry, options);
            checkpoint(options, 'before-verify');
            if (!same(inventory(item.source, true), item.entries)) fail('SOURCE_CHANGED');
            if (!same(inventory(payload), item.entries)) fail('STAGING_CHANGED');
            checkpoint(options, 'before-ready');
            writeJson(readyFile, { schema: VERSION, owner: options.owner, source: item.source, id, entries: item.entries });
            checkpoint(options, 'ready');
        }
        transactions.push(id);
    }
    // The pending index is atomic; ready snapshots also survive a crash before
    // this index and are rediscovered once by the maintenance host on retry.
    writeJson(path.join(options.control, 'pending.json'), { schema: VERSION, owner: options.owner, transactions });
    return transactions;
}
function loadReady(options, id) {
    if (!/^[a-f0-9]{32}$/.test(id)) fail('INVALID_MANIFEST');
    const transaction = checked(path.join(options.control, id));
    const ready = readJson(path.join(transaction, 'ready.json'));
    validateEntries(ready.entries);
    if (ready.schema !== VERSION || ready.owner !== options.owner || ready.id !== id ||
        transactionId(ready.source, ready.entries, ready.owner) !== id) fail('INVALID_MANIFEST');
    if (!same(inventory(path.join(transaction, 'payload')), ready.entries)) fail('STAGING_CHANGED');
    return ready;
}
function activate(options, ids) {
    const { destination, control } = validateRoots(options);
    if (!options.quiescent || !options.owner) fail('OWNERSHIP_OR_WRITERS');
    const results = [];
    const active = ids.map(id => ({ id, ready: loadReady(options, id) }));
    // Multiple distinct legacy profiles never choose an arbitrary account.
    const ambiguous = new Set(active.map(({ ready }) => sha(JSON.stringify(ready.entries)))).size > 1;
    for (const { id, ready } of active) {
        const transaction = path.join(control, id), receipt = path.join(transaction, 'receipt.json');
        if (exists(receipt)) {
            const done = readJson(receipt);
            if (done.schema !== VERSION || done.id !== id || done.owner !== options.owner) fail('INVALID_MANIFEST');
            results.push(done); continue; // Never replay an old profile over subsequent account deletions.
        }
        const current = inventory(destination);
        let outcome = 'preserved-conflict';
        if (current.length || (exists(destination) && fs.readdirSync(destination).length)) {
            outcome = same(current, ready.entries) ? 'already-identical' : 'preserved-conflict';
        }
        else if (!ambiguous) {
            const activation = checked(path.join(transaction, 'activation'));
            fs.mkdirSync(activation, { recursive: true });
            for (const entry of ready.entries) copyEntry(path.join(transaction, 'payload'), activation, entry, options);
            if (!same(inventory(activation), ready.entries)) fail('STAGING_CHANGED');
            checkpoint(options, 'before-publish');
            if (exists(destination)) {
                if (fs.readdirSync(destination).length) fail('DESTINATION_CHANGED');
                const probe = path.join(destination, '.fury-migration-write-check');
                const fd = fs.openSync(probe, 'wx', 0o600); fs.closeSync(fd); fs.unlinkSync(probe);
                fs.rmdirSync(destination);
            }
            fs.renameSync(activation, destination);
            checkpoint(options, 'published');
            outcome = 'migrated';
        }
        const result = { schema: VERSION, id, owner: options.owner, outcome };
        writeJson(receipt, result);
        checkpoint(options, 'receipt');
        results.push(result);
    }
    writeJson(path.join(control, 'complete.json'), { schema: VERSION, owner: options.owner, transactions: ids });
    if (exists(path.join(control, 'pending.json'))) fs.unlinkSync(path.join(control, 'pending.json'));
    return results;
}
function pending(options) {
    const names = fs.readdirSync(checked(options.control)).filter(name => /^[a-f0-9]{32}$/.test(name));
    if (names.length > MAX_TRANSACTIONS) fail('RECOVERY_LIMIT');
    return names.filter(id => exists(path.join(options.control, id, 'ready.json')) && !exists(path.join(options.control, id, 'receipt.json'))).sort();
}
function needsMaintenance(control) {
    checked(control);
    return exists(path.join(control, 'busy')) || exists(path.join(control, 'pending.json')) || !exists(path.join(control, 'complete.json'));
}
module.exports = { VERSION, plan, preserve, activate, pending, needsMaintenance, inventory, digest,
    checked, validateRoots, writeJson, readJson, requiredSpace, exists, fail };
