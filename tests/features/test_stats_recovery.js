'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const axios = require('axios');
const { fixture: apiFixture } = require('./test_hypixel_api_coordinator');
const { createStatsFetch } = require('../../src/stats/fetch');
const { createStatsLookup } = require('../../src/stats/lookup');
const { isTransientPlayerLookupFailure } = require('../../src/stats/lookupStatus');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const uuid = '1234567890abcdef1234567890abcdef';
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const timeout = () => Object.assign(new Error('Synthetic timeout'), { code: 'ECONNABORTED' });
const httpError = (status, headers = {}) => Object.assign(new Error(`Synthetic ${status}`), {
    response: { status, headers, data: { success: false, cause: `Synthetic ${status}` } }
});
const playerResponse = () => ({ data: { player: { uuid, displayname: 'Example', stats: { Bedwars: { wins_bedwars: 10 } } } }, status: 200, headers: {} });

function fixture({ mojang, hypixel, api, getKey = () => 'test-key', getRetrySignal, captureRetryGuard } = {}) {
    const { clock, createClient } = api || apiFixture();
    const calls = { mojang: [], hypixel: [], status: 0, urchin: 0, ping: 0, observed: 0 };
    const helpers = createStatsLookup({ getPlayerData: async () => null, makeUrchinData: () => ({}), makePingData: () => ({}) });
    axios.get = async (url, options) => {
        assert(url.startsWith('https://api.mojang.com/users/profiles/minecraft/')
            || url.startsWith('https://api.minecraftservices.com/minecraft/profile/lookup/name/'), 'No external request may escape the fixture.');
        calls.mojang.push({ at: clock.now, options, url });
        const response = mojang ? await mojang(url, options, calls.mojang.length) : { data: { id: uuid } };
        if (response.data?.id && !response.data.name) response.data.name = url.split('/').pop();
        return response;
    };
    const globalCache = new Map();
    const stats = createStatsFetch({
        globalCache, cacheDuration: 300000, getHypixelKey: getKey, hasHypixelApiKeyConfigured: () => Boolean(getKey()),
        hypixelApiGet: async (url, options) => {
            calls.hypixel.push({ at: clock.now, options });
            return hypixel ? hypixel(url, options, calls.hypixel.length) : playerResponse();
        },
        getUrchinRaw: async () => { calls.urchin++; return { ok: true }; },
        getAuroraPingRaw: async () => { calls.ping++; return { ok: true }; },
        getHypixelStatusRaw: async () => { calls.status++; return 'Online'; },
        makePingData: value => value, mergeUrchinOverride: (a, b) => ({ ...a, ...b }),
        notifyUrchinOutageOnce() {}, observeHypixelPlayerData() { calls.observed++; return false; },
        classifyPlayerLookupError: helpers.classifyPlayerLookupError, playerLookupDeduper: new InFlightDeduper(),
        now: () => clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
        getRetrySignal, captureRetryGuard
    });
    return { ...stats, calls, clock, createClient, globalCache, helpers };
}

async function run() {
    const originalGet = axios.get;
    try {
        // Plain/error/status consumers all await one recovery, with no failed row in between.
        let f = fixture({ hypixel: async (url, options, n) => { if (n === 1) throw timeout(); return playerResponse(); } });
        let resolved = false;
        const consumers = Promise.all([
            f.getPlayerData('Example'),
            f.getPlayerData('example', { includeErrors: true }),
            f.getPlayerData('Example', { includeErrors: true, includeStatus: true, urchinOverride: { ok: true, tag: 'batch' } })
        ]).then(value => { resolved = true; return value; });
        await f.clock.until(500);
        assert.equal(resolved, false);
        assert.equal(f.calls.hypixel.length, 1);
        await f.clock.until(1100);
        const results = await consumers;
        assert(results.every(result => result.data?.player && !result.error));
        assert.equal(f.calls.mojang.length, 1);
        assert.equal(f.calls.hypixel.length, 2);
        assert.equal(f.calls.urchin, 0);
        assert.equal(f.calls.ping, 1);
        assert.equal(f.calls.status, 1);
        assert.equal(f.calls.observed, 1);
        assert.equal(results[2].data.status, 'Online');

        // A forced stats refresh reuses the verified UUID, but not expired identity data.
        await f.getPlayerData('Example', { forceRefresh: true });
        assert.equal(f.calls.mojang.length, 1);
        await f.clock.until(302000);
        await f.getPlayerData('Example', { forceRefresh: true });
        assert.equal(f.calls.mojang.length, 2);

        f = fixture({ mojang: async (url, options, n) => { if (n === 1) throw timeout(); return { data: { id: uuid } }; } });
        const mojangRecovered = f.getPlayerData('Example', { includeErrors: true });
        await f.clock.until(1100);
        assert((await mojangRecovered).data.player);
        assert.equal(f.calls.mojang.length, 2);
        assert.equal(f.calls.hypixel.length, 1);

        // Exhausted failures have one bounded cycle even with repeated surface updates.
        f = fixture({ hypixel: async () => { throw timeout(); } });
        const exhausted = f.getPlayerData('Example', { includeErrors: true });
        await f.clock.until(4100);
        assert.equal((await exhausted).errorType, 'lookup_failed');
        for (let i = 0; i < 10; i++) {
            const answer = await f.getPlayerData('Example', { includeErrors: true, includeStatus: i % 2 === 0 });
            assert.equal(answer.error, true);
        }
        assert.equal(await f.getPlayerData('Example'), null);
        assert.equal(f.calls.mojang.length, 1);
        assert.equal(f.calls.hypixel.length, 3);
        assert.equal(f.calls.status, 0);
        await f.clock.until(34200);
        const nextCycle = f.getPlayerData('Example', { includeErrors: true });
        await f.clock.until(38300); await nextCycle;
        assert.equal(f.calls.hypixel.length, 6);
        assert.equal(f.calls.mojang.length, 1);

        // HTTP errors from Mojang never become Hypixel/key errors or nick evidence.
        for (const [status, expected] of [[429, 'mojang_rate_limited'], [503, 'mojang_api_error']]) {
            f = fixture({ mojang: async () => { throw httpError(status, { 'retry-after': '2' }); } });
            const failed = f.getPlayerData('Example', { includeErrors: true });
            await f.clock.until(6000);
            const answer = await failed;
            assert.equal(answer.errorType, expected);
            assert.equal(f.calls.mojang.length, status === 429 ? 2 : 3);
            assert.equal(f.calls.hypixel.length, 0);
            assert(isTransientPlayerLookupFailure({ lookupFailed: true, lookupErrorType: answer.errorType }));
        }
        f = fixture({ mojang: async () => { throw httpError(404); } });
        assert.equal((await f.getPlayerData('Missing', { includeErrors: true })).errorType, 'player_not_found');
        assert.equal(f.calls.mojang.length, 1, 'Real misses remain the nick detector’s separate confirmation path.');
        f = fixture({ hypixel: async () => { throw httpError(403); } });
        assert.equal((await f.getPlayerData('Example', { includeErrors: true })).errorType, 'hypixel_key_failed');
        assert.equal(f.calls.hypixel.length, 1, 'Rejected keys must never be automatically retried.');
        const quotaError = httpError(429);
        quotaError.response.data.cause = 'API key request limit reached';
        assert.equal(f.helpers.classifyPlayerLookupError(quotaError).errorType, 'hypixel_rate_limited');

        // One Mojang 429 also pauses new names, respecting a later reset extension.
        f = fixture({ mojang: async (url, options, n) => { if (n <= 2) throw httpError(429, { 'retry-after': '2' }); return { data: { id: uuid } }; } });
        const limited1 = f.getPlayerData('Example', { includeErrors: true });
        await f.clock.until(500);
        const limited2 = f.getPlayerData('Another', { includeErrors: true });
        await f.clock.until(2000);
        assert.equal(f.calls.mojang.length, 1);
        await f.clock.until(4500);
        assert.equal(f.calls.mojang.length, 2, 'Other names must honor the extended provider cooldown.');
        await f.clock.until(6000);
        assert.equal((await limited1).errorType, 'mojang_rate_limited', 'One retry cannot bypass a second 429.');
        assert((await limited2).data.player);

        // The real Hypixel scheduler holds queued requests during a server cooldown.
        const api = apiFixture();
        let transportStarts = 0;
        const apiClient = api.createClient({
            axios: { async get() { if (++transportStarts === 1) throw httpError(500); return playerResponse(); } },
            getKeys: () => ({ hypixel: 'test-key' }), logger: { warn() {} }
        });
        f = fixture({ api, hypixel: (url, options) => apiClient.hypixelApiGet(url, options) });
        const group = Promise.all(['Example', 'Another', 'Third'].map(name => f.getPlayerData(name, { includeErrors: true, apiPriority: 'game' })));
        await f.clock.until(4900);
        assert.equal(transportStarts, 1);
        await f.clock.until(6500);
        assert((await group).every(result => result.data?.player && !result.error));
        assert.equal(transportStarts, 4);
        assert.equal(f.calls.mojang.length, 3, 'Retrying the failed player must reuse its verified UUID.');
        assert.equal(apiClient.getHypixelApiUsageSnapshot().lastFiveMinutes, 4, 'All HTTP attempts still consume the shared budget.');

        // Leaving a game cancels a retry already queued for its Hypixel grant.
        const cancelledApi = apiFixture();
        let oldCalls = 0, scope = new AbortController();
        const oldClient = cancelledApi.createClient({
            axios: { async get() { oldCalls++; throw httpError(500); } },
            getKeys: () => ({ hypixel: 'test-key' }), logger: { warn() {} }
        });
        f = fixture({ api: cancelledApi, getRetrySignal: () => scope.signal, hypixel: (url, options) => oldClient.hypixelApiGet(url, options) });
        const cancelled = f.getPlayerData('Example', { includeErrors: true, apiPriority: 'game' });
        await f.clock.until(1500);
        assert.equal(oldClient.getHypixelApiUsageSnapshot().queue.queued, 1);
        scope.abort(); await flush();
        await cancelled;
        await f.clock.until(7000);
        assert.equal(oldCalls, 1);
        assert.equal(oldClient.getHypixelApiUsageSnapshot().queue.queued, 0);

        // A new scope does not inherit the previous game's exhausted failure.
        scope = new AbortController();
        f = fixture({ getRetrySignal: () => scope.signal, hypixel: async (url, options, n) => { if (n <= 3) throw timeout(); return playerResponse(); } });
        const previous = f.getPlayerData('Example', { includeErrors: true });
        await f.clock.until(4100); await previous;
        scope.abort(); scope = new AbortController();
        const fresh = await f.getPlayerData('Example', { includeErrors: true });
        assert(fresh.data.player);
        assert.equal(f.calls.mojang.length, 1);

        // A late initial response may complete for its caller, but cannot replace
        // a newer game's cached profile or consume the next game's retry state.
        scope = new AbortController();
        let releaseOld;
        f = fixture({ getRetrySignal: () => scope.signal, hypixel: async (url, options, n) => {
            if (n === 1) return new Promise(resolve => { releaseOld = resolve; });
            const response = playerResponse(); response.data.player.stats.Bedwars.wins_bedwars = 20; return response;
        } });
        const late = f.getPlayerData('Example', { includeErrors: true });
        await flush();
        scope.abort(); scope = new AbortController();
        await f.getPlayerData('Example', { includeErrors: true });
        releaseOld(playerResponse()); await late;
        assert.equal(f.globalCache.get('example').data.player.stats.Bedwars.wins_bedwars, 20);

        // Shutdown and a changed API key stop further recovery, without new network work.
        let key = 'test-key';
        f = fixture({ getKey: () => key, hypixel: async () => { throw timeout(); } });
        const changed = f.getPlayerData('Example', { includeErrors: true });
        await f.clock.until(500); key = 'replacement-key';
        await f.clock.until(1100); await changed;
        assert.equal(f.calls.hypixel.length, 1);
        f = fixture({ mojang: async () => { throw timeout(); } });
        const quitting = f.getPlayerData('Example', { includeErrors: true });
        await f.clock.until(500); f.cancelPendingRetries(); await flush(); await quitting;
        await f.clock.until(10000);
        assert.equal(f.calls.mojang.length, 2, 'Immediate transport failure starts the fallback before shutdown.');

        // Execute the production tab renderer/retry gate: keep a last good row
        // through transient errors, while allowing a later bounded retry.
        const source = fs.readFileSync(path.resolve(__dirname, '../../proxy.js'), 'utf8');
        const extract = (start, end) => {
            const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
            assert(from >= 0 && to > from);
            return source.slice(from, to);
        };
        const good = { data: playerResponse().data };
        const failed = { data: { player: { uuid }, lookupFailed: true, lookupErrorType: 'mojang_api_error' } };
        let current = failed, rendered, retryCount = 0;
        const context = {
            console, gameSessionId: 1, currentGamemode: 'BEDWARS', gameRoster: new Set(['Example']),
            lobbyPlayers: new Map([['Example', { uuid }]]), tabStatsAppliedNames: new Set(['Example']),
            tabStatsProfileCache: new Map([['Example', { profile: good, mode: 'BEDWARS', denickRealName: '' }]]),
            tabLatencyRetriedAt: new Map(), tabStatsSupplementalGeneration: 0, TAB_LATENCY_RETRY_MS: 30000, Date: { now: () => 1000000 },
            isTabStatsActiveInGame: () => true, isDenickAliasDuplicate: () => false,
            isCurrentGameSession: () => true, isEligibleForCurrentGameRoster: () => true,
            applyKnownDenickFromHistory() {}, getAutoDenickResult: () => null,
            getStatsProfileForRosterPlayer: async () => current,
            rememberPlayerActiveCosmetics() {}, ensureTabStatsSupplementalData: async () => {},
            rememberOverlayPlayer() {}, scheduleNametagSync() {},
            buildTabStatsDisplay: (name, profile) => profile, writeTabDisplayName: (id, value) => { rendered = value; },
            isTransientPlayerLookupFailure, queueTabStatsUpdate: () => { retryCount++; }
        };
        vm.createContext(context);
        vm.runInContext(
            extract('        function hasRealPlayerLookupData(', '\n        // The single')
            + extract('        async function updateTabStatsForPlayer(', '\n        function cachedTabStatsProfileForPlayer(')
            + extract('        function retryTabStatsFromLatency(', '\n        function refreshTabStatsForRoster('), context
        );
        await context.updateTabStatsForPlayer('Example');
        assert.equal(rendered, good);
        assert.equal(context.tabStatsProfileCache.get('Example').retryLookup, true);
        context.retryTabStatsFromLatency('Example');
        assert.equal(retryCount, 1, 'Keeping an old row must not prevent recovery later.');
        current = good; await context.updateTabStatsForPlayer('Example');
        assert.equal(context.tabStatsProfileCache.get('Example').retryLookup, false);
        current = failed;
        context.tabStatsProfileCache.set('Example', { profile: good, mode: 'BEDWARS', denickRealName: 'OldIdentity' });
        await context.updateTabStatsForPlayer('Example');
        assert.equal(rendered, failed, 'An old nickname identity must not be reused for a different account.');

        console.log('Stats recovery tests passed: shared retries, quota waits, UUID reuse, provider errors and cancellation.');
    } finally { axios.get = originalGet; }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
