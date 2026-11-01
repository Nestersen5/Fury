'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { fixture } = require('./test_hypixel_api_coordinator');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const { BoundedTtlMap } = require('../../src/util/bounded_ttl_map');
const root = path.resolve(__dirname, '../..');
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const uuid = 'a'.repeat(32);

function harness(baselineDir) {
    const { clock } = fixture();
    const source = rel => fs.readFileSync(baselineDir
        ? path.join(baselineDir, path.basename(rel)) : path.join(root, rel), 'utf8');
    function load(rel, overrides = {}) {
        const file = path.join(root, rel), local = createRequire(file), module = { exports: {} };
        class ClockDate extends Date { static now() { return clock.now; } }
        class ClockMap extends BoundedTtlMap { constructor(options) { super({ ...options, now: () => clock.now }); } }
        vm.runInNewContext(source(rel), { module, exports: module.exports, console, URL, AbortController, AbortSignal,
            Date: ClockDate, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
            require: name => Object.hasOwn(overrides, name) ? overrides[name]
                : name.endsWith('/bounded_ttl_map.js') ? { BoundedTtlMap: ClockMap } : local(name)
        }, { filename: file });
        return module.exports;
    }
    const sleep = (ms, value) => new Promise(resolve => clock.setTimeout(() => resolve(value), ms));
    const extract = name => {
        const text = source('proxy.js');
        const begin = text.search(new RegExp(`        (?:async )?function ${name}\\(`));
        assert(begin >= 0, name);
        const rest = text.slice(begin + 1), next = rest.search(/\n        (?:async )?function /);
        return text.slice(begin, next < 0 ? undefined : begin + 1 + next);
    };
    return { clock, load, sleep, source, extract, elapsed: () => clock.now - 1000000 };
}

function profiles(h, options = {}) {
    const cache = new Map(), calls = { mojang: 0, hypixel: 0, tags: 0, ping: 0 };
    let owner = true;
    const stats = h.load('src/stats/fetch.js', { axios: { get: async url => {
        calls.mojang++; return h.sleep(50, { data: { id: uuid, name: url.split('/').pop() } });
    } } }).createStatsFetch({
        globalCache: cache, cacheDuration: 300000, getHypixelKey: () => 'synthetic', hasHypixelApiKeyConfigured: () => true,
        hypixelApiGet: async () => { calls.hypixel++; return h.sleep(150, { data: { player: { uuid, displayname: 'Fixture',
            stats: { Bedwars: { final_kills_bedwars: 20, final_deaths_bedwars: 10,
                slumber: { minion: { ender_dust: 123 } } } } } } }); },
        getUrchinRaw: async () => { calls.tags++; return h.sleep(options.tagsMs ?? 10000, { ok: true, tag: 'SNIPER' }); },
        getAuroraPingRaw: async () => { calls.ping++; return h.sleep(options.pingMs ?? 3500, { ok: true, requestStatus: 'ok', avgPing: 42 }); },
        getHypixelStatusRaw: async () => 'Online', makePingData: value => value, mergeUrchinOverride: (a, b) => ({ ...a, ...b }),
        notifyUrchinOutageOnce() {}, classifyPlayerLookupError: () => ({ error: true }), playerLookupDeduper: new InFlightDeduper(),
        captureRetryGuard: () => () => owner, now: () => h.clock.now,
        setTimeoutImpl: h.clock.setTimeout, clearTimeoutImpl: h.clock.clearTimeout
    });
    return { ...stats, cache, calls, leave: () => { owner = false; } };
}

async function primaryTests() {
    const h = harness(), f = profiles(h), previews = [];
    let completed = false;
    const full = f.getPlayerData('Fixture', { onPrimaryProfile: p => previews.push(p) });
    const other = f.getPlayerData('fixture').then(p => { completed = true; return p; });
    await h.clock.until(500);
    assert.equal(previews.length, 1);
    assert.equal(completed, false, 'Full consumers keep waiting for tags/ping');
    assert.equal(previews[0].data.urchin.ok, false);
    assert.equal(previews[0].data.urchin.requestStatus, 'pending');
    assert.equal(previews[0].data.player.stats.Bedwars.slumber.minion.ender_dust, undefined, 'Preview privacy matches full profiles');
    assert.equal(f.cache.size, 0, 'Incomplete profiles never enter the shared completed cache');
    let pendingPreview;
    const unsubscribe = f.observePendingPlayerProfile('Fixture', p => { pendingPreview = p; });
    assert.equal(pendingPreview, previews[0], 'A pending pregame consumer can reuse the already-ready primary');
    unsubscribe();
    await h.clock.until(11000);
    const [a, b] = await Promise.all([full, other]);
    assert.equal(a.data.urchin.tag, 'SNIPER'); assert.equal(b.data.ping.avgPing, 42);
    assert.deepEqual(f.calls, { mojang: 1, hypixel: 1, tags: 1, ping: 1 });
    assert.equal(f.cache.size, 1);
    let stale = false;
    f.observePendingPlayerProfile('Fixture', () => { stale = true; });
    assert.equal(stale, false, 'Completed lookups release their preview ownership');

    const h2 = harness(), f2 = profiles(h2);
    let afterLeave = false;
    const abandoned = f2.getPlayerData('Fixture', { onPrimaryProfile: () => { afterLeave = true; } });
    f2.leave(); await h2.clock.until(11000); await abandoned;
    assert.equal(afterLeave, false, 'Late primary data cannot notify a different connection');

    const h3 = harness(), f3 = profiles(h3);
    const cancelled = f3.getPlayerData('Fixture');
    await h3.clock.until(500); f3.cancelPendingRetries();
    let cancelledPreview = false;
    f3.observePendingPlayerProfile('Fixture', () => { cancelledPreview = true; });
    assert.equal(cancelledPreview, false, 'Cancelled work cannot supply a new preview subscriber');
    await h3.clock.until(11000); await cancelled;

    const h4 = harness(), f4 = profiles(h4, { tagsMs: 80 });
    let knownTag;
    const pingPending = f4.getPlayerData('Fixture', { onPrimaryProfile: p => { knownTag = p; } });
    await h4.clock.until(500);
    assert.equal(knownTag.data.urchin.tag, 'SNIPER', 'An already-checked tag stays visible while ping is pending');
    await h4.clock.until(11000); await pingPending;
}

async function tagTests() {
    const h = harness(), calls = [];
    let key = 'first';
    const tags = h.load('features/urchin_client.js').createUrchinClient({
        axios: { post: async () => { throw Error('Unexpected POST'); }, get: async (url, options) => {
            calls.push(options.params.player);
            return h.sleep(options.params.player === 'Slow' ? 10000 : 80,
                { status: 200, headers: { 'x-ratelimit-remaining': options.params.player === 'Slow' ? '119' : '110' }, data: { tags: [key] } });
        } }, getKey: () => key, getGameState: () => ({ gameActive: true }),
        makeUrchinData: data => data, parseBatchTags: data => ({ ok: true, tag: data[0] })
    });
    // Exercise out-of-order replies with two slots; production defaults may serialize reads.
    tags.configureUrchinRequests({ urchinRequestConcurrency: 2 });
    const batch = tags.getUrchinBatchRaw(['Slow', 'Fast']);
    await h.clock.until(60);
    let ready;
    const fast = tags.getUrchinRaw('Fast').then(data => { ready = data; });
    await h.clock.until(700);
    assert.equal(ready.tag, 'first', 'A fast tag settles while another player is still pending');
    assert.equal(calls.filter(name => name === 'Fast').length, 1, 'In-flight tag prefetch and row consumers share one request');
    await h.clock.until(11000); await fast; await batch;
    assert.equal(tags.getUrchinRateLimitSnapshot().remaining, 109, 'A late older header cannot increase the available budget or release the other active reservation');
    tags.resetUrchinLookupState();
    const oldKey = tags.getUrchinRaw('Slow');
    await h.clock.until(11100);
    key = 'replacement'; tags.resetUrchinLookupState();
    const replaced = tags.getUrchinRaw('Slow');
    await h.clock.until(32000);
    assert.equal((await oldKey).requestStatus, 'reset');
    assert.equal((await replaced).tag, 'replacement', 'Old replies cannot populate the new key cache');
}

async function pregameTests() {
    const h = harness(), f = profiles(h), pending = f.getPlayerData('Fixture');
    const context = vm.createContext({ nickKey: name => name.toLowerCase(), getCachedPregameChatProfile: () => null,
        pregameChatLookupPromises: new Map([['fixture', pending]]), observePendingPlayerProfile: f.observePendingPlayerProfile });
    vm.runInContext(h.extract('getCachedOrPendingPregameChatProfile'), context);
    let early;
    const reused = context.getCachedOrPendingPregameChatProfile('Fixture', profile => { early = profile; });
    await h.clock.until(500);
    assert.equal(early?.data.player.uuid, uuid, 'The actual pending-pregame path forwards an early primary preview');
    assert.equal(f.calls.hypixel, 1);
    await h.clock.until(11000); await reused;
    assert.deepEqual(f.calls, { mojang: 1, hypixel: 1, tags: 1, ping: 1 }, 'Rejoining a pending pregame profile starts no second lookup');
}

async function tabScenario(baselineDir, interrupt = null) {
    const h = harness(baselineDir), f = profiles(h), writes = [], published = [];
    const context = vm.createContext({ console, gameSessionId: 1, currentGamemode: 'BEDWARS', gameRoster: new Set(['Fixture']),
        lobbyPlayers: new Map([['Fixture', { uuid }]]), tabStatsAppliedNames: new Set(), tabStatsProfileCache: new Map(), tabStatsSupplementalGeneration: 0,
        isTabStatsActiveInGame: () => true, isDenickAliasDuplicate: () => false, isCurrentGameSession: id => id === context.gameSessionId,
        isEligibleForCurrentGameRoster: () => true, applyKnownDenickFromHistory() {}, getAutoDenickResult: () => null,
        getStatsProfileForRosterPlayer: (name, options) => f.getPlayerData(name, options.lookup),
        rememberPlayerActiveCosmetics() {}, ensureTabStatsSupplementalData: async () => {},
        rememberOverlayPlayer: (name, profile) => published.push(profile), scheduleNametagSync() {},
        isTransientPlayerLookupFailure: () => false,
        buildTabStatsDisplay: (name, profile) => `${profile.data.player.stats.Bedwars.final_kills_bedwars}:${profile.data.urchin.tag || profile.data.urchin.requestStatus}`,
        writeTabDisplayName: (id, text) => writes.push({ at: h.elapsed(), text })
    });
    vm.runInContext(h.extract('updateTabStatsForPlayer'), context);
    const done = context.updateTabStatsForPlayer('Fixture');
    await h.clock.until(500);
    const primaryAt = writes[0]?.at;
    if (!baselineDir) {
        assert.equal(writes[0]?.text, '20:pending');
        assert.equal(published.length, 0, 'Partial display rows cannot publish into threat/overlay consumers');
        assert.equal(context.tabStatsProfileCache.size, 0);
    }
    if (interrupt) {
        interrupt(context);
        const count = writes.length;
        await h.clock.until(11000); await done;
        assert.equal(writes.length, count, 'Late final data cannot rewrite a stale row');
        assert.equal(published.length, 0);
        return;
    }
    await h.clock.until(11000); await done;
    assert.equal(writes.at(-1).text, '20:SNIPER');
    assert.equal(published.length, 1);
    return { primaryAt: primaryAt ?? writes[0].at, completeAt: writes.at(-1).at, writes: writes.length, requests: f.calls };
}

async function scanScenario(baselineDir, { tagDelay = 10000, cancelAt = null, tiedStats = false } = {}) {
    const h = harness(baselineDir), names = Array.from({ length: 15 }, (_, i) => 'Fixture' + i), lines = [], starts = [], shares = [];
    let final, active = true, activeLookups = 0, maximumLookups = 0, lastLookupFinishedAt = 0;
    const runner = h.load('src/overlay/scan.js').createScanRunner({
        state: { scanMode: 'all', threatConfig: { countTags: true, minStars: 500, minFkdr: 5 } },
        sendChat: (client, message) => lines.push({ at: h.elapsed(), message }), isSupportedTabStatsMode: () => true,
        getPlayerTeam: (map, name) => map.get(name).team, playerLookupKey: n => n.toLowerCase(),
        getUrchinBatchRaw: () => h.sleep(tagDelay, new Map()),
        getPlayerDataWithNickDetection: async name => {
            starts.push({ name, at: h.elapsed() });
            maximumLookups = Math.max(maximumLookups, ++activeLookups);
            const profile = await h.sleep(name === names[0] ? 10000 : 100, { data: { player: { displayname: name,
                achievements: { bedwars_level: 10 }, stats: { Bedwars: { final_kills_bedwars: tiedStats ? 1 : Number(name.slice(7)) + 1, final_deaths_bedwars: 1 } } },
                urchin: { ok: true, tag: name === names[0] ? 'SNIPER' : '' } } });
            activeLookups--; lastLookupFinishedAt = h.elapsed(); return profile;
        }, isLikelyBot: () => false, inferTeamFromColor: (map, name) => map.get(name).team,
        getTabNameColor: () => '\u00a79', extractDisplayColor: () => null, getInteractiveTags: () => [{ text: ' tag', hoverEvent: { action: 'show_text', value: 'Info' } }],
        setLastScanSummary() {}, setLastScanResults: result => { final = result; }
    });
    const lobby = new Map(names.map(name => [name, { team: 'Blue', color: '\u00a79', inTab: true }]));
    const done = runner.performFullScan({ username: 'Self' }, lobby, new Map(), 'Red', { gameMode: 'BEDWARS', gameActive: true,
        gameRoster: new Set(names), isStillActive: () => active, shareStream: { onRow: row => shares.push(row), onTeam() {} } });
    if (cancelAt !== null) {
        await h.clock.until(cancelAt); active = false;
        const count = lines.length;
        await h.clock.until(30000); await done;
        assert.equal(lines.length, count, 'Cancelled scans emit no late rows, headings or completion');
        assert.equal(final, undefined);
        return;
    }
    await h.clock.until(2000);
    const earlyRows = lines.filter(line => typeof line.message === 'object');
    if (!baselineDir) {
        assert.equal(earlyRows.length, 0, 'Local scan rows wait until every player has finished');
        assert(!lines.some(row => typeof row.message === 'string' && /SCAN RESULTS|SCAN COMPLETE|TEAM/.test(row.message)), 'Scan headers also wait for the complete batch');
        assert.equal(final, undefined, 'The complete scan snapshot is not published prematurely');
        assert.equal(shares.length, 14);
    }
    await h.clock.until(30000); await done;
    assert.equal(final.results.length, 15);
    assert(maximumLookups <= 5, 'Buffered output does not increase lookup concurrency');
    assert.equal(shares.length, 15);
    const playerRows = lines.filter(line => typeof line.message === 'object');
    assert.equal(playerRows.length, 15, 'Every completed scan row is printed once');
    if (!baselineDir) {
        assert(!lines.some(row => typeof row.message === 'string' && /SCAN COMPLETE/.test(row.message)));
        const header = lines.findIndex(row => row.message === '\u00a7a\u00a7lSCAN RESULTS\u00a7r');
        assert(header >= 0);
        assert.equal(lines[header + 1].message, '\u00a7r ', 'Blank line after the results heading');
        assert.match(lines[header + 2].message, /TEAM/);
        assert.equal(lines.at(-1).message, '\u00a7r ', 'Blank line after the final player');
        assert.equal(lines.filter(row => row.message === '\u00a7r ').length, 2, 'One-team scans have no extra separators');
    }
    if (!baselineDir) assert(playerRows.every(row => row.at >= lastLookupFinishedAt), 'No local result precedes the last lookup completion');
    assert(playerRows.every(row => row.message.extra.some(part => part.hoverEvent)), 'Buffered rows retain interactive tags');
    if (tiedStats) assert.deepEqual(Array.from(final.results, row => row.name), names, 'Equal stats retain source order in the final snapshot');
    else assert.equal(final.results[0].sortValue, 15, 'Stored results retain the final stats ordering');
    return { firstRowAt: playerRows[0].at, lastRowAt: playerRows.at(-1).at, rows: playerRows.length, lookups: starts.length };
}

function tabSchedulingHarness(baselineDir) {
    const h = harness(baselineDir), updates = [];
    const context = vm.createContext({ console, gameSessionId: 1,
        gameRoster: new Set(Array.from({ length: 16 }, (_, i) => `Player${i}`)), tabStatsTimers: new Map(),
        Date: { now: () => h.clock.now }, setTimeout: h.clock.setTimeout, clearTimeout: h.clock.clearTimeout,
        isDenickAliasDuplicate: () => false, isTabStatsActiveInGame: () => true,
        isEligibleForCurrentGameRoster: () => true, isCurrentGameSession: id => id === context.gameSessionId,
        updateTabStatsForPlayer: async (name, sessionId, options) => updates.push({ name, at: h.elapsed(), sessionId, options })
    });
    if (h.source('proxy.js').includes('        function clearTabStatsUpdate(')) {
        vm.runInContext(h.extract('clearTabStatsUpdate'), context);
    }
    vm.runInContext(h.extract('queueTabStatsUpdate'), context);
    return { h, context, updates };
}

async function tabSchedulingScenario(baselineDir) {
    const { h, context, updates } = tabSchedulingHarness(baselineDir);
    for (let second = 0; second < 20; second++) {
        Array.from(context.gameRoster).forEach((name, index) => context.queueTabStatsUpdate(name, index * 175));
        await h.clock.until((second + 1) * 1000);
    }
    const firstByName = new Map();
    for (const update of updates) if (!firstByName.has(update.name)) firstByName.set(update.name, update.at);
    if (!baselineDir) assert.equal(firstByName.size, 16, 'Repeated server updates must not starve the later tab rows');
    return { players: 16, rendered: firstByName.size, lastFirstUpdateAt: Math.max(...firstByName.values()), pending: context.tabStatsTimers.size };
}

async function tabSchedulingTests() {
    let f = tabSchedulingHarness();
    f.context.queueTabStatsUpdate('Player0', 1000, { first: true });
    await f.h.clock.until(100);
    f.context.queueTabStatsUpdate('Player0', 5000, { latest: true });
    await f.h.clock.until(1100);
    assert.equal(f.updates.length, 1, 'Later requests preserve the original deadline');
    assert.equal(f.updates[0].at, 1000);
    assert.deepEqual({ ...f.updates[0].options }, { first: true, latest: true });
    assert.equal(f.context.tabStatsTimers.size, 0);

    f = tabSchedulingHarness();
    f.context.queueTabStatsUpdate('Player0', 5000);
    await f.h.clock.until(100);
    f.context.queueTabStatsUpdate('Player0', 50);
    await f.h.clock.until(200);
    assert.equal(f.updates[0].at, 150, 'An earlier request can still bring the update forward');
    await f.h.clock.until(6000);
    assert.equal(f.updates.length, 1, 'The replaced timer cannot fire later');

    f = tabSchedulingHarness();
    f.context.queueTabStatsUpdate('Player0', 1000);
    f.context.clearTabStatsUpdate('Player0');
    f.context.queueTabStatsUpdate('Player1', 1000);
    f.context.gameSessionId++;
    await f.h.clock.until(1100);
    assert.equal(f.updates.length, 0, 'Removal and stale game timers cannot render');
    assert.equal(f.context.tabStatsTimers.size, 0);
    f = tabSchedulingHarness();
    f.context.queueTabStatsUpdate('Player0', 500, { oldGame: true });
    f.context.gameSessionId++;
    f.context.queueTabStatsUpdate('Player0', 1000, { newGame: true });
    await f.h.clock.until(1100);
    assert.equal(f.updates.length, 1);
    assert.equal(f.updates[0].sessionId, 2);
    assert.deepEqual({ ...f.updates[0].options }, { newGame: true }, 'A new game must not inherit the old pending request');
    await tabSchedulingScenario();
}

async function tabRestoreTests() {
    const h = harness(), f = profiles(h), writes = [];
    const pending = f.getPlayerData('Fixture');
    await h.clock.until(500);
    let eligible = true, denick = null;
    const context = vm.createContext({ currentGamemode: 'BEDWARS', gameRoster: new Set(['Fixture']),
        lobbyPlayers: new Map([['Fixture', { uuid }]]), tabStatsAppliedNames: new Set(),
        isTabStatsActiveInGame: () => true, isDenickAliasDuplicate: () => false,
        isEligibleForCurrentGameRoster: () => eligible, cachedTabStatsProfileForPlayer: () => null,
        observePendingPlayerProfile: f.observePendingPlayerProfile, getAutoDenickResult: () => denick,
        nickKey: name => String(name || '').toLowerCase(),
        buildTabStatsDisplay: (name, profile) => `${profile.data.player.stats.Bedwars.final_kills_bedwars}:${profile.data.urchin.requestStatus}`,
        writeTabDisplayName: (id, text) => writes.push({ id, text })
    });
    vm.runInContext(h.extract('reapplyCachedTabStatsForPlayer'), context);
    assert.equal(context.reapplyCachedTabStatsForPlayer('Fixture'), true);
    assert.deepEqual(writes, [{ id: uuid, text: '20:pending' }], 'A server replacement cannot hide a ready primary while tags load');
    assert.equal(f.cache.size, 0, 'Restoring a preview cannot publish it into the completed cache');
    eligible = false;
    assert.equal(context.reapplyCachedTabStatsForPlayer('Fixture'), false);
    eligible = true; denick = { realName: 'DifferentName' };
    assert.equal(context.reapplyCachedTabStatsForPlayer('Fixture'), false, 'A changed identity cannot reuse the old preview');
    await h.clock.until(11000); await pending;
    assert.equal(writes.length, 1, 'A synchronous restore leaves no extra listener behind');
    assert.deepEqual(f.calls, { mojang: 1, hypixel: 1, tags: 1, ping: 1 });
}

async function run() {
    await primaryTests(); await tagTests(); await pregameTests();
    await tabSchedulingTests();
    await tabRestoreTests();
    await tabScenario(null, c => { c.gameSessionId++; });
    await tabScenario(null, c => { c.tabStatsSupplementalGeneration++; });
    await tabScenario(null, c => { c.lobbyPlayers.set('Fixture', { uuid: 'b'.repeat(32) }); c.gameRoster.clear(); });
    await scanScenario(null, { cancelAt: 500 });
    await scanScenario(null, { cancelAt: 9500 });
    await scanScenario(null, { tiedStats: true });
    console.log(JSON.stringify({ tab: await tabScenario(), scan: await scanScenario() }));
    console.log('Stats/scan checks passed: early private previews, independent tags, deduplication, complete scan batches, cancellation, non-postponed tab timers and immediate row restoration.');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { harness, profiles, tabScenario, scanScenario, tabSchedulingScenario, flush };
