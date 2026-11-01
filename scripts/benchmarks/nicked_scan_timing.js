'use strict';

// Offline timings of production lookup + nick confirmation + complete Scan.
// Matched synthetic services isolate nick handling; no player/API requests.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { fixture } = require('../../tests/features/test_hypixel_api_coordinator');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const root = path.resolve(__dirname, '../..');
const baseline = path.join(root, 'output/mojang-fallback/before');

async function measure(scenario, before) {
    const { clock } = fixture();
    const calls = { primary: 0, fallback: 0, hypixel: 0, tags: 0, ping: 0 };
    const elapsed = () => clock.now - 1000000;
    const sleep = (ms, value, error, signal) => new Promise((resolve, reject) => {
        const abort = () => { clock.clearTimeout(timer); reject(Object.assign(new Error('Cancelled'), { code: 'ERR_CANCELED' })); };
        const timer = clock.setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            error ? reject(error) : resolve(value);
        }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
    const names = Array.from({ length: 15 }, (_, i) => `Player${i}`);
    const missing = new Set(scenario.first ? names.slice(0, scenario.nicks || 0) : names.slice(15 - (scenario.nicks || 0)));
    const ids = new Map([...names, 'RealName'].map((n, i) => [n, (i + 1).toString(16).padStart(32, '0')]));
    const profiles = new Map(), denicks = new Map();
    function profile(name) {
        return { data: { player: { uuid: ids.get(name), displayname: name,
            achievements: { bedwars_level: 10 }, stats: { Bedwars: { final_kills_bedwars: 20, final_deaths_bedwars: 10 } } },
            urchin: { ok: true }, ping: { ok: true } } };
    }
    if (scenario.warm) for (const name of names) if (!missing.has(name)) profiles.set(name.toLowerCase(), { ...profile(name), timestamp: clock.now });
    if (scenario.known) denicks.set('player14', { realName: 'RealName' });
    if (scenario.late) clock.setTimeout(() => denicks.set('player14', { realName: 'RealName' }), 200);
    const transport = { get(url, options = {}) {
        const u = new URL(url), name = u.pathname.split('/').pop();
        const primary = u.hostname === 'api.mojang.com';
        calls[primary ? 'primary' : 'fallback']++;
        if (scenario.slow && name === 'Player14' && primary) {
            return sleep(3000, null, Object.assign(new Error('Timeout'), { code: 'ECONNABORTED' }), options.signal);
        }
        if (missing.has(name) && !scenario.hypixelMissing) {
            return sleep(100, null, Object.assign(new Error('Missing'), { response: { status: 404 } }), options.signal);
        }
        return sleep(100, { status: 200, data: { id: ids.get(name), name } }, null, options.signal);
    } };
    function load(rel) {
        const file = path.join(root, rel), module = { exports: {} }, local = createRequire(file);
        vm.runInNewContext(fs.readFileSync(before ? path.join(baseline, path.basename(rel)) : file, 'utf8'), {
            module, exports: module.exports, console, URL, AbortController, AbortSignal,
            setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
            require: name => name === 'axios' ? transport : local(name)
        }, { filename: file });
        return module.exports;
    }
    let stats;
    const lookup = load('src/stats/lookup.js').createStatsLookup({
        getPlayerData: (...args) => stats.getPlayerData(...args), makeUrchinData: () => ({}), makePingData: x => x
    });
    stats = load('src/stats/fetch.js').createStatsFetch({
        globalCache: profiles, cacheDuration: 300000, getHypixelKey: () => 'fixture', hasHypixelApiKeyConfigured: () => true,
        hypixelApiGet: async url => {
            calls.hypixel++;
            const uuid = new URL(url).searchParams.get('uuid'), name = [...ids].find(([, id]) => id === uuid)?.[0];
            return sleep(150, { data: { player: scenario.hypixelMissing && missing.has(name) ? null : profile(name).data.player } });
        },
        getUrchinRaw: async () => { calls.tags++; return sleep(100, { ok: true }); },
        getAuroraPingRaw: async () => { calls.ping++; return sleep(100, { ok: true }); },
        getHypixelStatusRaw: async () => 'Online', makePingData: x => x, mergeUrchinOverride: (a, b) => ({ ...a, ...b }),
        notifyUrchinOutageOnce() {}, classifyPlayerLookupError: lookup.classifyPlayerLookupError,
        playerLookupDeduper: new InFlightDeduper(), now: () => clock.now,
        setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout
    });
    // Use the actual host gate as well: recently settled nicks can bypass
    // confirmation; cold/unconfirmed nicks still use the two-read check.
    const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
    const begin = proxy.indexOf('        async function getStatsProfileForRosterPlayer(');
    const end = proxy.indexOf('\n        function leaveBedwarsPregame(', begin);
    assert(begin >= 0 && end > begin);
    const host = vm.createContext({ Date: { now: () => clock.now }, nickKey: n => n.toLowerCase(),
        getAutoDenickResult: n => denicks.get(n.toLowerCase()),
        isKnownNickedPlayer: n => scenario.settled && missing.has(n),
        settledNickVerifiedAt: new Map(scenario.settled ? [...missing].map(n => [n.toLowerCase(), clock.now]) : []),
        SETTLED_NICK_RECHECK_MS: 60000, makeFallbackPlayerProfile: lookup.makeFallbackPlayerProfile,
        getCachedOrPendingPregameChatProfile: async n => profiles.get(n.toLowerCase()) || null,
        getPlayerDataWithNickDetection: lookup.getPlayerDataWithNickDetection
    });
    vm.runInContext(proxy.slice(begin, end), host);
    const lines = [], resolved = [], lobby = new Map(names.map(n => [n, { team: 'Blue', color: '\u00a79', inTab: true }]));
    let finishedAt, snapshot;
    const runner = load('src/overlay/scan.js').createScanRunner({
        state: { scanMode: 'all', threatConfig: {} }, sendChat: (c, message) => lines.push({ at: elapsed(), message }),
        isSupportedTabStatsMode: () => true, getPlayerTeam: (m, n) => m.get(n)?.team,
        playerLookupKey: n => n.toLowerCase(), getUrchinBatchRaw: async () => new Map(),
        getPlayerDataWithNickDetection: lookup.getPlayerDataWithNickDetection,
        isLikelyBot: () => false, inferTeamFromColor: (m, n) => m.get(n)?.team,
        getTabNameColor: () => '\u00a79', getInteractiveTags: () => [],
        setLastScanSummary() {}, setLastScanResults: s => { snapshot = s; }
    });
    const done = runner.performFullScan({ username: 'Self' }, lobby, new Map(), 'Red', {
        gameMode: 'BEDWARS', gameActive: true, gameRoster: new Set(names), autoDenickResults: denicks,
        getPlayerProfile: async (name, options) => {
            const result = await host.getStatsProfileForRosterPlayer(name, { denickResult: null, lookup: options });
            if (result.data?.isNicked) host.settledNickVerifiedAt.set(name.toLowerCase(), clock.now);
            resolved.push({ at: elapsed(), name }); return result;
        },
        getCachedPlayerProfile: n => profiles.get(n.toLowerCase())
    }).then(() => { finishedAt = elapsed(); });
    await clock.until(60000); await done;
    assert.equal(snapshot.results.length, 15);
    const rows = lines.filter(l => typeof l.message === 'object');
    assert.equal(rows.length, 15);
    assert(rows.every(r => r.at === finishedAt), 'Complete Scan must retain atomic publication.');
    return { fullScanMs: finishedAt, firstResolvedMs: resolved[0]?.at, calls,
        nicks: snapshot.results.filter(r => r.isNicked).length,
        failures: snapshot.results.filter(r => r.lookupFailed).length };
}

async function run() {
    const scenarios = [
        { label: 'Cold / no nicks' }, { label: 'Cold / 1 missing-name nick', nicks: 1 },
        { label: 'Cold / 1 early missing-name nick', nicks: 1, first: true },
        { label: 'Cold / 5 missing-name nicks', nicks: 5 },
        { label: 'Warm / no nicks', warm: true }, { label: 'Warm / 1 missing-name nick', warm: true, nicks: 1 },
        { label: 'Warm / 5 missing-name nicks', warm: true, nicks: 5 },
        { label: 'Warm / 1 recently settled nick', warm: true, nicks: 1, settled: true },
        { label: 'Cold / 1 missing-Hypixel-profile nick', nicks: 1, hypixelMissing: true },
        { label: 'Cold / known denick', nicks: 1, known: true },
        { label: 'Cold / denick arrives during scan', nicks: 1, late: true },
        { label: 'Cold / slow primary, real player', slow: true }
    ];
    const results = [];
    for (const scenario of scenarios) {
        const before = await measure(scenario, true), after = await measure(scenario, false);
        if (!scenario.slow) assert.deepEqual(after, before, 'Healthy/nicked behavior must retain timing, results and request counts.');
        else { assert.equal(before.failures, 1); assert.equal(after.failures, 0); assert(after.fullScanMs < before.fullScanMs); }
        results.push({ ...scenario, before, after });
    }
    const report = { runtime: process.version, method: 'Deterministic virtual clock; production fetch, nick detection and full Scan; 16-player game, 15 opponents; synthetic 100ms identity/tags/ping and 150ms Hypixel. No live APIs or Minecraft rendering.', results };
    const out = path.join(root, 'output/mojang-fallback/nicked-scan-timings.json');
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(results.map(r => ({ label: r.label, beforeMs: r.before.fullScanMs, afterMs: r.after.fullScanMs,
        beforeMojang: r.before.calls.primary + r.before.calls.fallback,
        afterMojang: r.after.calls.primary + r.after.calls.fallback, nicks: r.after.nicks, failures: r.after.failures })), null, 2));
}
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { measure };
