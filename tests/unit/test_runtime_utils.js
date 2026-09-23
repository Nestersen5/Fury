'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BoundedTtlMap } = require('../../src/util/bounded_ttl_map.js');
const { JsonFileCache } = require('../../src/storage/json_file_cache.js');

let now = 1000;
const bounded = new BoundedTtlMap({
    ttlMs: 100,
    maxEntries: 2,
    now: () => now
});

bounded.set('a', { timestamp: now, value: 1 });
bounded.set('b', { timestamp: now, value: 2 });
assert.strictEqual(bounded.get('a').value, 1, 'cached values should be readable');
bounded.set('c', { timestamp: now, value: 3 });
assert.strictEqual(bounded.has('b'), false, 'least recently used entries should be evicted');
assert.strictEqual(bounded.has('a'), true, 'recently read entries should stay cached');

now += 101;
assert.strictEqual(bounded.get('a'), undefined, 'expired entries should be removed on access');
bounded.prune();
assert.strictEqual(bounded.size, 0, 'pruning should remove all expired entries');

const customTimestamp = new BoundedTtlMap({
    ttlMs: 50,
    maxEntries: 2,
    timestampKey: 'at',
    now: () => now
});
customTimestamp.set('ping', { at: now, value: 25 });
now += 51;
assert.strictEqual(customTimestamp.get('ping'), undefined, 'custom timestamp keys should expire correctly');

const primitiveTimestamp = new BoundedTtlMap({
    ttlMs: 25,
    maxEntries: 2,
    timestampKey: value => value,
    now: () => now
});
primitiveTimestamp.set('notice', now);
now += 26;
assert.strictEqual(primitiveTimestamp.get('notice'), undefined, 'timestamp selectors should support primitive values');

let cacheNow = 0;
let cacheStatCalls = 0;
let cacheContent = '{"value":1}';
let cacheMtime = 1;
const intervalCache = new JsonFileCache('virtual.json', {
    checkIntervalMs: 100,
    now: () => cacheNow,
    fsImpl: {
        statSync: () => {
            cacheStatCalls += 1;
            return { mtimeMs: cacheMtime, size: cacheContent.length };
        },
        readFileSync: () => cacheContent
    }
});
assert.deepStrictEqual(intervalCache.get(), { value: 1 });
cacheContent = '{"value":2}';
cacheMtime = 2;
cacheNow = 50;
assert.deepStrictEqual(intervalCache.get(), { value: 1 }, 'metadata checks should be throttled inside the interval');
assert.strictEqual(cacheStatCalls, 1);
cacheNow = 101;
assert.deepStrictEqual(intervalCache.get(), { value: 2 }, 'changed files should reload after the interval');
assert.strictEqual(cacheStatCalls, 2);

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nester-json-cache-'));
const jsonPath = path.join(tempDirectory, 'samples.json');
let transformCalls = 0;
let readCalls = 0;
let statError = false;
const jsonCache = new JsonFileCache(jsonPath, {
    fallback: () => [],
    fsImpl: {
        statSync: filePath => {
            if (statError) {
                const error = new Error('temporary stat failure');
                error.code = 'EACCES';
                throw error;
            }
            return fs.statSync(filePath);
        },
        readFileSync: (filePath, encoding) => {
            readCalls += 1;
            return fs.readFileSync(filePath, encoding);
        }
    },
    transform: value => {
        transformCalls += 1;
        return value.entries;
    }
});

try {
    fs.writeFileSync(jsonPath, JSON.stringify({ entries: ['first'] }), 'utf8');
    const first = jsonCache.get();
    assert.deepStrictEqual(first, ['first']);
    assert.strictEqual(jsonCache.get(), first, 'unchanged files should reuse the cached object');
    assert.strictEqual(transformCalls, 1, 'unchanged files should not be reparsed');

    fs.writeFileSync(jsonPath, '{invalid json', 'utf8');
    assert.strictEqual(jsonCache.get(), first, 'malformed writes should keep the last known-good value');
    assert.strictEqual(jsonCache.get(), first, 'unchanged malformed files should keep using the last good value');
    assert.strictEqual(readCalls, 2, 'the same malformed file should not be parsed repeatedly');

    fs.writeFileSync(jsonPath, JSON.stringify({ entries: ['second', 'third'] }), 'utf8');
    const second = jsonCache.get();
    assert.deepStrictEqual(second, ['second', 'third'], 'changed valid files should reload');
    assert.strictEqual(transformCalls, 2);

    statError = true;
    assert.strictEqual(jsonCache.get(), second, 'temporary filesystem errors should preserve cached data');
    statError = false;
    fs.unlinkSync(jsonPath);
    assert.deepStrictEqual(jsonCache.get(), [], 'missing files should use the configured fallback');
} finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log('Runtime cache utility tests passed.');
