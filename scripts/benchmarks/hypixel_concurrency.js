'use strict';

// Analysis only: production schedulers and lookup/scan paths, injected time,
// synthetic players/providers. Only the Hypixel concurrency constant varies
// in memory. No real API keys, requests or application settings are used.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { fixture } = require('../../tests/features/test_hypixel_api_coordinator');
const { BoundedTtlMap } = require('../../src/util/bounded_ttl_map');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const { makeUrchinData, parseUrchinBatchTags, classifyUrchinRequestError } = require('../../src/stats/urchin');
const colors = require('../../src/stats/colors');
const format = require('../../src/stats/format');
const root = path.resolve(__dirname, '../..');
const files = ['features/hypixel_api_client.js', 'features/urchin_client.js', 'src/stats/fetch.js', 'src/overlay/scan.js'];
const sources = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const limits = [1, 2, 3, 4, 5, 6, 8, 16], trials = 5;
const scenarios = [
    { id: 'fast', label: 'Every reply: 0.25 s', delay: 250 },
    { id: 'half_second', label: 'Every reply: 0.5 s', delay: 500 },
    { id: 'one_second', label: 'Every reply: 1 s', delay: 1000 },
    { id: 'slow', label: 'Every reply: 2 s', delay: 2000 },
    { id: 'near_timeout', label: 'Every reply: 4.5 s', delay: 4500 },
    { id: 'mixed', label: '75% at 0.25 s; 25% at 2 s', mixed: true },
    { id: 'slow_front', label: 'First two replies: 2 s; rest: 0.25 s', front: 2 },
    { id: 'timeouts', label: '75% at 0.25 s; 25% time out at 5 s', mixed: true, timeout: true },
    { id: 'used_budget', label: '1 s replies after 225 prior requests', delay: 1000, warmup: 225 }
];
const pipelineCases = [
    { id: 'fast', label: 'Hypixel 0.5 s / Urchin 0.25 s', hypixel: 500 },
    { id: 'slow_hypixel', label: 'Hypixel 2 s / Urchin 0.25 s', hypixel: 2000 },
    { id: 'near_timeout_hypixel', label: 'Hypixel 4.5 s / Urchin 0.25 s', hypixel: 4500 },
    { id: 'slow_urchin', label: 'Hypixel 0.5 s / some slow Urchin replies', hypixel: 500, slowTags: true },
    { id: 'slow_front_hypixel', label: 'First five Hypixel replies slow; others fast', front: 5 }
];

function random(seed) {
    let value = seed;
    return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function shuffledDelays(scenario, count, seed) {
    if (scenario.front) return Array.from({ length: count }, (_, i) => i < scenario.front ? (scenario.delay || 2000) : 250);
    const list = Array.from({ length: count }, (_, i) => scenario.mixed
        ? (i < count / 4 ? (scenario.timeout ? 5000 : 2000) : 250) : scenario.delay);
    const rng = random(seed);
    for (let i = count - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
}
function environment(cap, seed) {
    const { clock } = fixture(sources['features/hypixel_api_client.js']);
    const math = Object.create(Math); math.random = random(seed + 1000);
    function load(file, overrides = {}) {
        const fullPath = path.join(root, file), local = createRequire(fullPath), module = { exports: {} };
        let source = sources[file];
        if (file === 'features/hypixel_api_client.js') {
            const pattern = /const HYPIXEL_API_BURST_CONCURRENCY = \d+;/g;
            assert.equal([...source.matchAll(pattern)].length, 1);
            source = source.replace(pattern, `const HYPIXEL_API_BURST_CONCURRENCY = ${cap};`);
        }
        class ClockDate extends Date { static now() { return clock.now; } }
        class ClockCache extends BoundedTtlMap { constructor(options) { super({ ...options, now: () => clock.now }); } }
        vm.runInNewContext(source, { module, exports: module.exports, Date: ClockDate, Math: math,
            URL, AbortController, AbortSignal, console, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
            require: name => Object.hasOwn(overrides, name) ? overrides[name]
                : name.endsWith('/bounded_ttl_map.js') ? { BoundedTtlMap: ClockCache } : local(name)
        }, { filename: fullPath });
        return module.exports;
    }
    const elapsed = () => clock.now - 1000000;
    const sleep = (ms, value) => new Promise(resolve => clock.setTimeout(() => resolve(value), ms));
    async function settle(promises) {
        let done = false;
        const all = Promise.all(promises).then(value => { done = true; return value; }, error => { done = true; throw error; });
        all.catch(() => {});
        for (let until = elapsed() + 1000; !done && until <= 500000; until += 1000) await clock.until(until);
        assert(done, 'Workload must settle without a stuck queue'); return all;
    }
    return { clock, load, elapsed, sleep, settle };
}
const quietLogger = { log() {}, warn() {}, error() {} };
const uuidFor = i => (i + 1).toString(16).padStart(32, '0');
const urlFor = i => `https://api.hypixel.net/v2/player?uuid=${uuidFor(i)}`;
const player = (uuid, name) => ({ uuid, displayname: name, achievements: { bedwars_level: 100 },
    stats: { Bedwars: { final_kills_bedwars: 200, final_deaths_bedwars: 20 } } });

async function rawCase(cap, scenario, count, seed) {
    const e = environment(cap, seed), delays = shuffledDelays(scenario, count, seed), starts = [], finished = [];
    let warming = Boolean(scenario.warmup), base = 0, active = 0, peak = 0, warmupCalls = 0;
    const client = e.load('features/hypixel_api_client.js').createHypixelApiClient({
        getKeys: () => ({ hypixel: 'synthetic-key' }), getGameState: () => ({ gameActive: true }), logger: quietLogger,
        axios: { get: async (url, options) => {
            const uuid = new URL(url).searchParams.get('uuid');
            if (warming) { warmupCalls++; return e.sleep(1, { status: 200, headers: {}, data: { player: player(uuid, 'Warmup') } }); }
            const index = Number.parseInt(uuid, 16) - 1; assert(index >= 0 && index < count);
            starts.push(e.elapsed() - base); peak = Math.max(peak, ++active);
            try {
                await e.sleep(delays[index]);
                if (scenario.timeout && delays[index] >= options.timeout) throw Object.assign(Error('Synthetic timeout'), { code: 'ECONNABORTED' });
                return { status: 200, headers: {}, data: { player: player(uuid, `Bench${index}`) } };
            } finally { active--; }
        } }
    });
    if (warming) {
        await e.settle(Array.from({ length: scenario.warmup }, (_, i) => client.hypixelApiGet(urlFor(i + 1000), { apiPriority: 'game', timeout: 5000 })));
        warming = false; base = e.elapsed();
    }
    await e.settle(Array.from({ length: count }, (_, i) => client.hypixelApiGet(urlFor(i), { apiPriority: 'game', timeout: 5000 })
        .then(() => finished.push({ at: e.elapsed() - base, ok: true }), () => finished.push({ at: e.elapsed() - base, ok: false }))));
    assert.equal(starts.length, count); assert.equal(finished.length, count); assert(peak <= cap);
    // The production 200 ms base includes +/-15% jitter and can stretch as
    // the budget drains; do not replace it with a different benchmark rate.
    for (let i = 1; i < starts.length; i++) assert(starts[i] - starts[i - 1] >= 170);
    const times = finished.map(x => x.at).sort((a, b) => a - b);
    return { cap, scenario: scenario.id, players: count, seed, firstMs: times[0], medianMs: times[Math.ceil(count / 2) - 1],
        completeMs: times.at(-1), peakConcurrency: peak, requests: count, warmupCalls,
        success: finished.filter(x => x.ok).length, failures: finished.filter(x => !x.ok).length };
}

async function pipelineCase(cap, scenario, seed = 100) {
    const e = environment(cap, seed), count = 16;
    const names = Array.from({ length: count }, (_, i) => `Bench${String(i).padStart(2, '0')}`);
    const ids = names.map((_, i) => uuidFor(i)), ready = new Map(), completed = new Map(), rows = [], messages = [];
    const calls = { hypixel: 0, mojang: 0, tags: 0, ping: 0 };
    const hypixel = e.load('features/hypixel_api_client.js').createHypixelApiClient({
        getKeys: () => ({ hypixel: 'synthetic-key' }), getGameState: () => ({ gameActive: true }), logger: quietLogger,
        axios: { get: url => {
            calls.hypixel++; const uuid = new URL(url).searchParams.get('uuid'), index = ids.indexOf(uuid); assert(index >= 0);
            const delay = scenario.front ? (index < scenario.front ? 4500 : 250) : scenario.hypixel;
            return e.sleep(delay, { status: 200, headers: {}, data: { player: player(uuid, names[index]) } });
        } }
    });
    const urchin = e.load('features/urchin_client.js').createUrchinClient({ getKey: () => 'synthetic-key',
        getGameState: () => ({ gameActive: true }), makeUrchinData, parseBatchTags: parseUrchinBatchTags,
        classifyRequestError: classifyUrchinRequestError,
        axios: { post: async () => { throw Error('Unexpected POST'); }, get: (_url, options) => {
            calls.tags++; const index = names.indexOf(options.params.player); assert(index >= 0);
            return e.sleep(scenario.slowTags && index % 4 === 0 ? 5000 : 250, { status: 200, headers: {}, data: { tags: [] } });
        } }
    });
    const fetcher = e.load('src/stats/fetch.js', { axios: { get: url => {
        calls.mojang++; const index = names.indexOf(url.split('/').pop()); assert(index >= 0);
        return e.sleep(50, { data: { id: ids[index], name: names[index] } });
    } } }).createStatsFetch({ globalCache: new Map(), cacheDuration: 300000,
        getHypixelKey: () => 'synthetic-key', hasHypixelApiKeyConfigured: () => true, hypixelApiGet: hypixel.hypixelApiGet,
        getUrchinRaw: urchin.getUrchinRaw, getAuroraPingRaw: () => { calls.ping++; return e.sleep(100, { ok: true, requestStatus: 'ok', avgPing: 42 }); },
        getHypixelStatusRaw: () => { throw Error('Unrequested status lookup'); }, makePingData: x => x,
        mergeUrchinOverride: (a, b) => ({ ...a, ...b }), notifyUrchinOutageOnce() {}, classifyPlayerLookupError: error => { throw error; },
        playerLookupDeduper: new InFlightDeduper(), now: () => e.clock.now, setTimeoutImpl: e.clock.setTimeout, clearTimeoutImpl: e.clock.clearTimeout
    });
    const prefetched = urchin.getUrchinBatchRaw(names);
    const profiles = names.map(name => {
        const display = p => { assert.equal(p.data.player.stats.Bedwars.final_kills_bedwars, 200); if (!ready.has(name)) ready.set(name, e.elapsed()); };
        return fetcher.getPlayerData(name, { includeErrors: true, apiPriority: 'game', onPrimaryProfile: display })
            .then(p => { display(p); completed.set(name, e.elapsed()); });
    });
    const teams = ['Blue', 'Red', 'Green', 'Yellow'], teamColors = ['§9', '§c', '§a', '§e'];
    const lobby = new Map(names.map((name, i) => [name, { uuid: ids[i], team: teams[Math.floor(i / 4)], color: teamColors[Math.floor(i / 4)], inTab: true }]));
    let scanCompleteAt = null;
    const runner = e.load('src/overlay/scan.js').createScanRunner({ state: { scanMode: 'all', threatConfig: { countTags: true, minStars: 500, minFkdr: 5 } },
        sendChat: (_client, message) => { messages.push({ at: e.elapsed(), message }); if (typeof message === 'object') rows.push({ at: e.elapsed(), message }); },
        isSupportedTabStatsMode: mode => mode === 'BEDWARS', getPlayerTeam: (map, name) => map.get(name)?.team,
        playerLookupKey: name => name.toLowerCase(), getUrchinBatchRaw: urchin.getUrchinBatchRaw,
        getPlayerDataWithNickDetection: (name, options) => fetcher.getPlayerData(name, { includeErrors: true, ...options }),
        isLikelyBot: () => false, inferTeamFromColor: (map, name) => map.get(name)?.team,
        getTabNameColor: info => info.color, extractDisplayColor: () => null, getInteractiveTags: () => [],
        ...colors, getSkyWarsLevelValue: format.getSkyWarsLevelValue, formatSkyWarsLevel: format.formatSkyWarsLevel,
        setLastScanSummary() {}, setLastScanResults() { scanCompleteAt = e.elapsed(); }
    });
    const scan = runner.performFullScan({ username: names[0] }, lobby, new Map(), 'Blue', {
        gameMode: 'BEDWARS', gameActive: true, gameRoster: new Set(names), isStillActive: () => true
    });
    await e.settle([prefetched, ...profiles, scan]);
    assert.equal(rows.length, 12); assert.equal(ready.size, 16);
    const lastEnemyReady = Math.max(...names.slice(4).map(name => completed.get(name)));
    assert(rows.every(row => row.at >= lastEnemyReady), 'Buffered local scans must wait for every enemy profile');
    for (const total of Object.values(calls)) assert.equal(total, 16, 'Concurrent consumers reuse the same provider lookup');
    assert.notEqual(scanCompleteAt, null);
    return { cap, scenario: scenario.id, label: scenario.label, firstStatsMs: Math.min(...ready.values()), allStatsMs: Math.max(...ready.values()),
        scanCompleteMs: scanCompleteAt, enemies: 12, players: 16, providerCalls: calls };
}

function median(list) { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
async function run() {
    const raw = [], pipeline = [];
    for (const players of [16, 40]) for (const scenario of scenarios) for (const cap of limits) {
        for (let trial = 0; trial < trials; trial++) raw.push(await rawCase(cap, scenario, players, 100 + trial));
    }
    for (const scenario of pipelineCases) for (const cap of limits) pipeline.push(await pipelineCase(cap, scenario));
    const summary = [];
    for (const players of [16, 40]) for (const scenario of scenarios) for (const cap of limits) {
        const selected = raw.filter(x => x.players === players && x.scenario === scenario.id && x.cap === cap);
        summary.push({ cap, players, scenario: scenario.id, label: scenario.label,
            firstMs: median(selected.map(x => x.firstMs)), medianMs: median(selected.map(x => x.medianMs)), completeMs: median(selected.map(x => x.completeMs)),
            minMs: Math.min(...selected.map(x => x.completeMs)), maxMs: Math.max(...selected.map(x => x.completeMs)),
            peakConcurrency: Math.max(...selected.map(x => x.peakConcurrency)), successes: selected[0].success, failures: selected[0].failures });
    }
    for (const file of files) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), sources[file], 'Benchmark cannot change production files');
    const arg = process.argv.find(x => x.startsWith('--output='));
    const output = path.resolve(arg ? arg.slice('--output='.length) : 'output/hypixel-concurrency-study/node.json');
    const result = { runtime: process.versions, limits, trials, baseSpacingMs: 200, spacingJitter: 0.15,
        configuredLimit: Number(sources['features/hypixel_api_client.js'].match(/HYPIXEL_API_BURST_CONCURRENCY = (\d+)/)[1]),
        urchinLimit: Number(sources['features/urchin_client.js'].match(/URCHIN_REQUEST_CONCURRENCY = (\d+)/)[1]),
        budget: 'Production rolling fallback and header gates; adaptive spacing retained',
        limitations: ['Synthetic fixed provider latencies and injected time, not live Hypixel or renderer/IPC timings.',
            'Seeded production jitter; the same response order and random sequence are used for each limit.',
            'Provider overload and concurrency-dependent failure probabilities are not modeled.',
            'Raw timeouts are single settled attempts, not successful stats or the full recovery workflow.'],
        sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(sources[file]).digest('hex')])), summary, pipeline, raw };
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, runs: raw.length + pipeline.length, configuredHypixel: result.configuredLimit,
        configuredUrchin: result.urchinLimit, rawTrials: raw.length, pipelineCases: pipeline.length }));
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { rawCase, pipelineCase };
