'use strict';

// Analysis only: execute current production queues with injected time and
// synthetic providers. Change only the concurrency constant in memory.
// Never load real API keys, send network traffic, or change app settings.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { fixture } = require('../../tests/features/test_hypixel_api_coordinator');
const { BoundedTtlMap } = require('../../src/util/bounded_ttl_map');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const { makeUrchinData, parseUrchinBatchTags, classifyUrchinRequestError } = require('../../src/stats/urchin');
const root = path.resolve(__dirname, '../..');
const files = ['features/urchin_client.js', 'features/hypixel_api_client.js', 'src/stats/fetch.js'];
const sources = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const limits = [1, 2, 3, 4, 6, 8, 16];
const trials = 5;
const scenarios = [
    { id: 'fast', label: 'Every reply: 0.25 s', delay: 250 },
    { id: 'normal', label: 'Every reply: 1 s', delay: 1000 },
    { id: 'slow', label: 'Every reply: 2 s', delay: 2000 },
    { id: 'very_slow', label: 'Every reply: 5 s', delay: 5000 },
    { id: 'near_timeout', label: 'Every reply: 9.5 s', delay: 9500 },
    { id: 'mixed', label: '75% at 0.25 s; 25% at 5 s', mixed: true },
    { id: 'slow_front', label: 'First two replies: 5 s; remaining replies: 0.25 s', frontSlow: true },
    { id: 'timeouts', label: '75% at 0.25 s; 25% time out at 10 s', mixed: true, timeout: true }
];

function delaysFor(scenario, count, seed) {
    if (scenario.frontSlow) return Array.from({ length: count }, (_, i) => i < 2 ? 5000 : 250);
    const delays = Array.from({ length: count }, (_, i) => scenario.mixed
        ? (i < count / 4 ? (scenario.timeout ? 10000 : 5000) : 250) : scenario.delay);
    let state = seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let i = delays.length - 1; i > 0; i--) {
        const other = Math.floor(random() * (i + 1));
        [delays[i], delays[other]] = [delays[other], delays[i]];
    }
    return delays;
}

async function runCase(cap, scenario, count, seed, withPrimary = false) {
    const { clock, createClient: createHypixelClient } = fixture(sources['features/hypixel_api_client.js']);
    const elapsed = () => clock.now - 1000000;
    const sleep = (ms, value) => new Promise(resolve => clock.setTimeout(() => resolve(value), ms));
    function load(file, overrides = {}) {
        const fullPath = path.join(root, file), local = createRequire(fullPath), module = { exports: {} };
        let source = sources[file];
        if (file === 'features/urchin_client.js') {
            const pattern = /const URCHIN_REQUEST_CONCURRENCY = \d+;/g;
            assert.equal([...source.matchAll(pattern)].length, 1);
            source = source.replace(pattern, `const URCHIN_REQUEST_CONCURRENCY = ${cap};`);
        }
        class ClockDate extends Date { static now() { return clock.now; } }
        class ClockCache extends BoundedTtlMap { constructor(options) { super({ ...options, now: () => clock.now }); } }
        vm.runInNewContext(source, {
            module, exports: module.exports, Date: ClockDate, URL, AbortController, AbortSignal, console,
            setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
            require: name => Object.hasOwn(overrides, name) ? overrides[name]
                : name.endsWith('/bounded_ttl_map.js') ? { BoundedTtlMap: ClockCache } : local(name)
        }, { filename: fullPath });
        return module.exports;
    }

    const names = Array.from({ length: count }, (_, i) => `Bench${String(i).padStart(2, '0')}`);
    const delays = delaysFor(scenario, count, seed), starts = [], finished = [], displayed = new Map();
    const providerCalls = { tags: 0, mojang: 0, hypixel: 0, ping: 0 };
    let active = 0, peak = 0;
    const client = load('features/urchin_client.js').createUrchinClient({
        getKey: () => 'synthetic-key', getGameState: () => ({ gameActive: true }),
        makeUrchinData, parseBatchTags: parseUrchinBatchTags, classifyRequestError: classifyUrchinRequestError,
        axios: {
            post: async () => { throw Error('Unexpected network operation'); },
            get: async (url, options) => {
                assert(url.endsWith('/v3/player/tags'));
                const index = names.indexOf(options.params.player);
                assert(index >= 0);
                providerCalls.tags++; starts.push(elapsed()); peak = Math.max(peak, ++active);
                try {
                    await sleep(delays[index]);
                    if (scenario.timeout && delays[index] === 10000) {
                        throw Object.assign(Error('Synthetic timeout'), { code: 'ECONNABORTED' });
                    }
                    return { status: 200, headers: {}, data: { tags: [{ type: 'Sniper', reason: 'Synthetic benchmark' }] } };
                } finally { active--; }
            }
        }
    });

    // Overlapping prefetch and row lookups must still make one HTTP request
    // per player. Observe individual completions, not only the batch promise.
    const prefetched = client.getUrchinBatchRaw(names);
    const checked = names.map(name => client.getUrchinRaw(name).then(data => {
        finished.push({ at: elapsed(), name, ok: data.ok === true }); return data;
    }));
    let profilePromises = [];
    if (withPrimary) {
        const ids = names.map((_, i) => (i + 1).toString(16).padStart(32, '0'));
        const hypixel = createHypixelClient({ getKeys: () => ({ hypixel: 'synthetic-key' }),
            getGameState: () => ({ gameActive: true }), logger: { log() {}, warn() {} },
            axios: { get: async url => {
                providerCalls.hypixel++;
                const uuid = new URL(url).searchParams.get('uuid'), index = ids.indexOf(uuid);
                assert(index >= 0);
                return sleep(150, { status: 200, headers: {}, data: { player: { uuid, displayname: names[index],
                    achievements: { bedwars_level: 100 }, stats: { Bedwars: { final_kills_bedwars: 200, final_deaths_bedwars: 20 } } } } });
            } }
        });
        const fetcher = load('src/stats/fetch.js', { axios: { get: url => {
            providerCalls.mojang++;
            const index = names.indexOf(url.split('/').pop()); assert(index >= 0);
            return sleep(50, { data: { id: ids[index] } });
        } } }).createStatsFetch({
            globalCache: new Map(), cacheDuration: 300000, getHypixelKey: () => 'synthetic-key',
            hasHypixelApiKeyConfigured: () => true, hypixelApiGet: hypixel.hypixelApiGet,
            getUrchinRaw: client.getUrchinRaw,
            getAuroraPingRaw: () => { providerCalls.ping++; return sleep(100, { ok: true, requestStatus: 'ok', avgPing: 42 }); },
            getHypixelStatusRaw: () => { throw Error('Unrequested status lookup'); },
            makePingData: data => data, mergeUrchinOverride: (a, b) => ({ ...a, ...b }),
            notifyUrchinOutageOnce() {}, classifyPlayerLookupError: error => { throw error; },
            playerLookupDeduper: new InFlightDeduper(), now: () => clock.now,
            setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout
        });
        profilePromises = names.map(name => {
            const display = data => {
                assert.equal(data.player.stats.Bedwars.final_kills_bedwars, 200);
                if (!displayed.has(name)) displayed.set(name, elapsed());
            };
            return fetcher.getPlayerData(name, { includeErrors: true, apiPriority: 'game', onPrimaryProfile: p => display(p.data) })
                .then(profile => { assert(profile.data?.player); display(profile.data); });
        });
    }

    let complete = false;
    const all = Promise.all([prefetched, ...checked, ...profilePromises]).then(() => { complete = true; });
    for (let until = 1000; !complete && until <= 500000; until += 1000) await clock.until(until);
    assert(complete, 'All consumers must settle within the workload bound'); await all;
    assert.equal(providerCalls.tags, count);
    assert.equal(finished.length, count);
    assert(peak <= cap);
    for (let i = 1; i < starts.length; i++) assert(starts[i] - starts[i - 1] >= 500);
    assert.equal(client.getUrchinRateLimitSnapshot().localBudget.limit, 300);

    // A recently completed successful lookup remains a cache hit regardless
    // of the number of HTTP slots; avoid expired early rows in long runs.
    const recentGood = [...finished].reverse().find(row => row.ok);
    const beforeWarm = providerCalls.tags;
    if (recentGood) {
        const cached = await client.getUrchinRaw(recentGood.name);
        assert.equal(cached.ok, true); assert.equal(providerCalls.tags, beforeWarm);
    }
    if (withPrimary) {
        assert.equal(displayed.size, count);
        assert.equal(providerCalls.mojang, count); assert.equal(providerCalls.hypixel, count); assert.equal(providerCalls.ping, count);
    }
    const times = finished.map(row => row.at).sort((a, b) => a - b);
    return { cap, scenario: scenario.id, players: count, seed, firstTagMs: times[0],
        medianTagMs: times[Math.ceil(count / 2) - 1], p95TagMs: times[Math.ceil(count * 0.95) - 1], completeMs: times.at(-1),
        success: finished.filter(row => row.ok).length, failures: finished.filter(row => !row.ok).length,
        peakConcurrency: peak, firstSecondStarts: starts.filter(at => at < 1000).length, requests: providerCalls.tags,
        ...(withPrimary ? { firstStatsMs: Math.min(...displayed.values()), allStatsMs: Math.max(...displayed.values()), providerCalls } : {}) };
}

function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }

async function run() {
    const initial = sources['features/urchin_client.js'];
    const outputArg = process.argv.find(arg => arg.startsWith('--output='));
    const output = path.resolve(outputArg ? outputArg.slice('--output='.length) : 'output/urchin-concurrency-study/node.json');
    const raw = [], primary = [];
    for (const players of [16, 40]) for (const scenario of scenarios) for (const cap of limits) {
        for (let trial = 0; trial < trials; trial++) raw.push(await runCase(cap, scenario, players, 100 + trial));
    }
    for (const cap of limits) primary.push(await runCase(cap, scenarios.find(s => s.id === 'mixed'), 16, 100, true));
    assert.equal(new Set(primary.map(row => row.firstStatsMs)).size, 1, 'Concurrency must not delay first primary stats');
    assert.equal(new Set(primary.map(row => row.allStatsMs)).size, 1, 'Concurrency must not delay the remaining primary stats');
    const summary = [];
    for (const players of [16, 40]) for (const scenario of scenarios) for (const cap of limits) {
        const rows = raw.filter(row => row.players === players && row.scenario === scenario.id && row.cap === cap);
        summary.push({ players, scenario: scenario.id, label: scenario.label, cap,
            firstTagMs: median(rows.map(r => r.firstTagMs)), medianTagMs: median(rows.map(r => r.medianTagMs)),
            completeMs: median(rows.map(r => r.completeMs)), minCompleteMs: Math.min(...rows.map(r => r.completeMs)),
            maxCompleteMs: Math.max(...rows.map(r => r.completeMs)), peakConcurrency: Math.max(...rows.map(r => r.peakConcurrency)),
            successes: rows[0].success, failures: rows[0].failures });
    }
    for (const file of files) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), sources[file], 'Production sources must remain untouched');
    const result = { runtime: process.versions, trials, limits, sizes: [16, 40], spacingMs: 500, budget: '300 per rolling five minutes',
        configuredLimit: Number(initial.match(/const URCHIN_REQUEST_CONCURRENCY = (\d+);/)[1]),
        sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(sources[file]).digest('hex')])),
        limitations: ['Injected-clock simulation with fixed response latencies; not live Urchin or Minecraft latency.',
            'Provider latency and error probabilities do not increase with offered load in this model.',
            'Timeout cases measure all lookups settled, including unknown results, not all tags successfully retrieved.',
            'Primary stats measure production lookup callbacks and the Hypixel queue, not final Minecraft rendering.'],
        summary, primary, raw };
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, runs: raw.length + primary.length, primary,
        completion16: summary.filter(row => row.players === 16).map(({ scenario, cap, completeMs, failures }) => ({ scenario, cap, completeMs, failures })) }));
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runCase };
