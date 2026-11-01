'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInspector, readSavedKeys, validateSettings, validateTargets, safeError, DEFAULTS } = require('../../scripts/denick-inspector/service');
const { options } = require('../../scripts/denick-inspector/fixture');
const targets = { finals: 4529, beds: 1874 };
const hold = setInterval(() => {}, 1000);
test.after(() => clearInterval(hold));

test('inspector reads keys without migrating or writing the configuration', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-inspector-'));
    const file = path.join(directory, 'statmod_key.txt');
    try {
        for (const text of ['# keys\nHypixel API key: private-h\nAurora API key: private-a\nSeraph API key: retained\n', 'private-h\nprivate-u\nprivate-a\nlegacy-line\n']) {
            fs.writeFileSync(file, text);
            assert.deepEqual(readSavedKeys(directory), { hypixel: 'private-h', aurora: 'private-a' });
            assert.equal(fs.readFileSync(file, 'utf8'), text);
        }
    } finally {
        assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'fury-inspector-')));
        fs.rmSync(directory, { recursive: true });
    }
});

test('opening and re-analyzing the inspector send no requests; validation precedes HTTP', async () => {
    const inspector = createInspector(options());
    assert.equal(DEFAULTS.lookupLimit, 50);
    assert.equal(DEFAULTS.verifyLimit, 25);
    assert.equal(DEFAULTS.verifyBedsAhead, 0, 'current-proxy inspector defaults must forbid extra beds');
    assert.deepEqual((await inspector.dispatch('info')).usage, { aurora: 0, mojang: 0, hypixel: 0, cacheHits: 0 });
    const result = await inspector.dispatch('analyze', { targets });
    assert.equal(result.rows.length, 0);
    assert.equal(result.usage.hypixel, 0);
    for (const invalid of [{ finals: -1 }, { beds: '1.5' }, { finals: '1e3' }, {}]) assert.throws(() => validateTargets(invalid));
    assert.throws(() => validateSettings({ verifyLimit: 101 }));
    assert.throws(() => validateSettings({ verifyFinalsAhead: -1 }));
    await assert.rejects(inspector.dispatch('fetch', { targets: { finals: -1 } }));
    assert.equal(inspector.info().usage.aurora, 0);
});

test('inspector discovery limits participate in validation, cache keys and stale-list detection', async () => {
    const inspector = createInspector(options());
    const first = await inspector.dispatch('fetch', { targets });
    assert(first.lists.every(list => list.requestedMax === 50));
    const changed = await inspector.dispatch('fetch', { targets, settings: { lookupLimit: 25 } });
    assert.equal(changed.usage.aurora, 4, 'a different requested candidate count requires new discovery');
    assert(changed.lists.every(list => list.requestedMax === 25));
    assert.equal((await inspector.dispatch('fetch', { targets, settings: { lookupLimit: 25 } })).usage.aurora, 4);
    const stale = await inspector.dispatch('analyze', { targets });
    assert.equal(stale.stale, true);
    assert.equal(stale.usage.aurora, 4);
    assert.throws(() => validateSettings({ lookupLimit: 0 }));
    assert.throws(() => validateSettings({ lookupLimit: 51 }));
    assert.throws(() => validateSettings({ lookupLimit: 101 }));
});

test('discovery considers players from either list and exposes provider snapshots without Hypixel requests', async () => {
    const inspector = createInspector(options());
    const result = await inspector.dispatch('fetch', { targets });
    assert.equal(result.lists.length, 2);
    assert.equal(result.usage.aurora, 2);
    assert.equal(result.usage.mojang, 0);
    assert.equal(result.usage.hypixel, 0);
    assert.equal(result.rows.length, 3);
    const hidden = result.rows.find(row => row.name === 'HiddenPlayer');
    assert.equal(hidden.considered, true);
    assert.equal(hidden.status, 'unchecked');
    assert.equal(hidden.aurora.beds.value, 1874);
    assert.equal(hidden.aurora.beds.lastUpdated, '2026-10-01T12:00:00Z');
    assert(!hidden.profile);
    assert(result.rows.find(row => row.position === 1).proxyStatus.includes('profile not verified'));
    assert.equal(result.rows.find(row => row.position === 1).name, 'SharedPlayer');
    assert.equal(result.rows.find(row => row.name === 'HiddenPlayer').priority.reason, 'one stored stat in range');
    assert(!JSON.stringify(result).includes('offline-fixture'), 'credentials must never reach the renderer/report');
    const again = await inspector.dispatch('fetch', { targets });
    assert.equal(again.usage.aurora, 2, 'identical discoveries reuse the one-minute cache');
    assert(again.lists.every(list => list.fromCache));
});

test('explicit verification obeys the fresh-profile budget and exposes real rejection reasons', async () => {
    const inspector = createInspector(options());
    await inspector.dispatch('fetch', { targets });
    const names = ['NearPlayer', 'SharedPlayer', 'HiddenPlayer'];
    const first = await inspector.dispatch('verify', { targets, names, budget: 1 });
    assert.equal(first.usage.hypixel, 1);
    assert.equal(first.usage.mojang, 1);
    assert.equal(first.checks[1].status, 'budget');
    const second = await inspector.dispatch('verify', { targets, names, budget: 1 });
    assert.equal(second.usage.hypixel, 2);
    assert.equal(second.checks[0].fromCache, true);
    const shared = second.rows.find(row => row.name === 'SharedPlayer');
    assert.equal(shared.profile.finals, 4600);
    assert.equal(shared.deltas.finals, 71);
    assert(shared.proxyStatus.includes('finals outside range'));
    const third = await inspector.dispatch('verify', { targets, names: ['SharedPlayer', 'HiddenPlayer'], budget: 1 });
    assert.equal(third.usage.hypixel, 3);
    const hidden = third.rows.find(row => row.name === 'HiddenPlayer');
    assert.equal(hidden.profile.finals, 4467);
    assert.equal(hidden.cachedVerdict, 'Matches entered tolerances');
    assert.equal(hidden.status, 'accepted', 'current proxy can verify a player present in only the beds list');
    const cached = await inspector.dispatch('verify', { targets, names: ['HiddenPlayer'], budget: 0 });
    assert.equal(cached.usage.hypixel, 3);
    assert.equal(cached.freshProfiles, 0);
    await assert.rejects(inspector.dispatch('verify', { targets, names: ['NotInTheList'], budget: 10 }));
});

test('current either-list lookup and legacy overlap experiments share the production evaluator without new requests', async () => {
    const inspector = createInspector(options());
    await inspector.dispatch('fetch', { targets });
    await inspector.dispatch('verify', { targets, names: ['NearPlayer', 'SharedPlayer', 'HiddenPlayer'], budget: 3 });
    const before = inspector.info().usage;
    const proxy = await inspector.dispatch('analyze', { targets });
    assert.equal(proxy.experimental, false);
    assert.deepEqual(proxy.result.acceptedNames, ['hiddenplayer']);
    const union = await inspector.dispatch('analyze', { targets, settings: { candidateMode: 'union' } });
    assert.equal(union.experimental, false);
    assert.deepEqual(union.result.acceptedNames, ['hiddenplayer']);
    assert(union.outcome.startsWith('Current proxy would confirm'));
    const legacy = await inspector.dispatch('analyze', { targets, settings: { candidateMode: 'intersection' } });
    assert.equal(legacy.experimental, true);
    assert.equal(legacy.result.acceptedNames.length, 0);
    assert.equal(legacy.rows.find(row => row.name === 'HiddenPlayer').status, 'excluded');
    const wider = await inspector.dispatch('analyze', { targets, settings: { candidateMode: 'intersection', verifyFinalsAhead: 100 } });
    assert.deepEqual(wider.result.acceptedNames, ['sharedplayer']);
    assert.equal(wider.rows.find(row => row.name === 'SharedPlayer').chatStatus, 'Would show a confirmed match');
    assert.deepEqual(inspector.info().usage, before);
    assert.equal((await inspector.dispatch('analyze', { targets })).settings.verifyFinalsAhead, DEFAULTS.verifyFinalsAhead);
});

test('full Aurora lists do not block an inspector confirmation when one checked candidate matches both stats', async () => {
    const config = options();
    const inspector = createInspector({ ...config, axios: { get: async (url, settings) => {
        const response = await config.axios.get(url, settings);
        if (!url.includes('bordic.xyz')) return response;
        return { ...response, data: { ...response.data, data: Array.from({ length: 10 }, (_, i) => response.data.data[i % response.data.data.length]) } };
    } } });
    await inspector.dispatch('fetch', { targets });
    const result = await inspector.dispatch('verify', { targets, names: ['NearPlayer', 'SharedPlayer', 'HiddenPlayer'], budget: 3 });
    assert(result.lists.every(list => list.rows.length === 10));
    assert.equal(result.result.complete, true);
    assert.deepEqual(result.result.acceptedNames, ['hiddenplayer']);
    assert(result.outcome.includes('would confirm'));
    assert.equal(result.rows.find(row => row.name === 'HiddenPlayer').chatStatus, 'Would show a confirmed match');
    assert(!result.coverageNote.includes('cannot confirm'));
    assert.equal(result.usage.aurora, 2);
    assert.equal(result.usage.hypixel, 3);
});

test('profile expiry, explicit refresh and key changes cannot silently reuse old verification', async () => {
    let time = Date.now(), keys = { aurora: 'first-a', hypixel: 'first-h' };
    const config = options();
    const inspector = createInspector({ ...config, now: () => time, readKeys: () => keys });
    const initial = await inspector.dispatch('player', { name: 'HiddenPlayer' });
    assert.equal(initial.fromCache, false);
    assert.equal((await inspector.dispatch('player', { name: 'HiddenPlayer' })).fromCache, true);
    await inspector.dispatch('player', { name: 'HiddenPlayer', force: true });
    assert.equal(inspector.info().usage.hypixel, 2);
    time += 5 * 60000 + 1;
    assert.equal((await inspector.dispatch('player', { name: 'HiddenPlayer' })).fromCache, false);
    await inspector.dispatch('fetch', { targets });
    keys = { aurora: 'second-a', hypixel: 'second-h' };
    const cleared = await inspector.dispatch('analyze', { targets });
    assert.equal(cleared.rows.length, 0);
    assert.equal((await inspector.dispatch('player', { name: 'HiddenPlayer' })).fromCache, false);
});

test('inspector explains Aurora gap exclusions before HTTP and replays the 25 percent rule from cached profiles', async () => {
    const people = [{ name: 'Vnsw', finals: 4497, beds: 1796 }, { name: 'Siennawr', finals: 4467, beds: 1874 }];
    const ids = ['a'.repeat(32), 'b'.repeat(32)];
    const inspector = createInspector({ readKeys: () => ({ aurora: 'offline-fixture', hypixel: 'offline-fixture' }), axios: { get: async url => {
        if (url.includes('bordic.xyz')) return { data: { success: true, data: people } };
        if (url.includes('mojang.com')) return { data: { id: ids[people.findIndex(person => person.name.toLowerCase() === url.split('/').at(-1).toLowerCase())] } };
        const person = people[ids.indexOf(new URL(url).searchParams.get('uuid'))];
        return { status: 200, headers: { 'ratelimit-remaining': '299', 'ratelimit-limit': '300' }, data: { success: true,
            player: { displayname: person.name, stats: { Bedwars: { final_kills_bedwars: person.finals, beds_broken_bedwars: person.beds } } } } };
    } } });
    const targets = { finals: 4500, beds: 1882 };
    const fetched = await inspector.dispatch('fetch', { targets });
    assert.equal(fetched.settings.bedsGapAllowancePercent, 25);
    assert.equal(fetched.usage.hypixel, 0);
    const skipped = fetched.rows.find(row => row.name === 'Vnsw');
    assert.equal(skipped.considered, false);
    assert(skipped.proxyStatus.includes('Aurora beds gap 86 exceeds 3.75'));
    await inspector.dispatch('verify', { targets, names: people.map(person => person.name), budget: 2 });
    const before = inspector.info().usage;
    const normal = await inspector.dispatch('analyze', { targets });
    assert.deepEqual(normal.result.acceptedNames, ['siennawr']);
    assert(normal.outcome.includes('would confirm'));
    const wider = await inspector.dispatch('analyze', { targets, settings: { bedsGapAllowancePercent: 3000 } });
    assert.deepEqual(wider.result.acceptedNames, ['siennawr', 'vnsw']);
    assert(!wider.outcome.includes('would confirm'));
    assert.deepEqual(inspector.info().usage, before);
    assert.throws(() => validateSettings({ bedsGapAllowancePercent: -1 }));
});

test('single-stat inspector replays conditional expansion and the three-candidate limit without extra HTTP', async () => {
    const names = ['First', 'Second', 'Outer', 'Fourth'];
    const counts = [1000, 950, 850, 800];
    const ids = names.map((_, i) => String(i + 1).padStart(32, '0'));
    const inspector = createInspector({ readKeys: () => ({ aurora: 'offline-fixture', hypixel: 'offline-fixture' }),
        axios: { get: async url => {
            if (url.includes('bordic.xyz')) return { data: { success: true, data: names.map((name, i) => ({ name, finals: counts[i] })) } };
            if (url.includes('mojang.com')) return { data: { id: ids[names.findIndex(name => name.toLowerCase() === url.split('/').at(-1).toLowerCase())] } };
            const index = ids.indexOf(new URL(url).searchParams.get('uuid'));
            return { status: 200, headers: { 'ratelimit-remaining': '299', 'ratelimit-limit': '300' },
                data: { success: true, player: { displayname: names[index], stats: { Bedwars: { final_kills_bedwars: counts[index] } } } } };
        } } });
    const targets = { finals: 1000 };
    await inspector.dispatch('fetch', { targets });
    const expanded = await inspector.dispatch('verify', { targets, names, budget: 4 });
    assert.equal(expanded.result.singleStat.primaryCount, 2);
    assert.equal(expanded.result.singleStat.expanded, true);
    assert.equal(expanded.result.acceptedNames.length, 4);
    assert(expanded.outcome.includes('Too many players match'));
    assert(expanded.rows.every(row => row.chatStatus.includes('No suggestions')));
    assert.equal(expanded.rows.find(row => row.name === 'Outer').proxyStatus, 'Accepted by expanded single-stat range');
    assert.equal(expanded.rows.find(row => row.name === 'Outer').cachedVerdict, 'Matches entered tolerances');
    const usage = inspector.info().usage;
    assert.equal(usage.aurora, 1);
    assert.equal(usage.hypixel, 4);
    const primary = await inspector.dispatch('analyze', { targets, settings: { singleStatFallbackRange: 0 } });
    assert.deepEqual(primary.result.acceptedNames, ['first', 'second']);
    assert.equal(primary.rows.filter(row => row.chatStatus === 'Would show a possible match').length, 2);
    const three = await inspector.dispatch('analyze', { targets, settings: { verifyFinalsBehind: 150 } });
    assert.equal(three.result.singleStat.primaryCount, 3);
    assert.equal(three.result.singleStat.expanded, false);
    assert.equal(three.rows.filter(row => row.chatStatus === 'Would show a possible match').length, 3);
    assert.deepEqual(inspector.info().usage, usage);
});

test('missing discovery for a newly added stat stays unknown and requires a new fetch', async () => {
    const inspector = createInspector(options());
    await inspector.dispatch('fetch', { targets: { finals: 4529 } });
    const result = await inspector.dispatch('analyze', { targets });
    assert.equal(result.stale, true);
    assert(result.result.error);
    assert.equal(result.usage.aurora, 1);
    assert(result.outcome.includes('cannot finish'));
});

test('stop aborts a pending verification and sends no requests for subsequent selected players', async () => {
    const config = options();
    let started;
    const waiting = new Promise(resolve => { started = resolve; });
    const inspector = createInspector({ ...config, axios: { get: (url, settings) => {
        if (!url.includes('mojang.com')) return config.axios.get(url, settings);
        started();
        return new Promise((resolve, reject) => settings.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' })), { once: true }));
    } } });
    await inspector.dispatch('fetch', { targets });
    const pending = inspector.dispatch('verify', { targets, names: ['SharedPlayer', 'HiddenPlayer'], budget: 2 });
    await waiting;
    await inspector.dispatch('cancel');
    const result = await pending;
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].status, 'error');
    assert.equal(result.usage.mojang, 1);
    assert.equal(result.usage.hypixel, 0);
    assert.equal(safeError({ isAxiosError: true, message: 'secret-key' }), 'API request failed. No automatic retry was sent.');
});
