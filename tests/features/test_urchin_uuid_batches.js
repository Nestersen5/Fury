'use strict';

const assert = require('node:assert/strict');
const { harness } = require('./test_progressive_stats');
const { makeUrchinData, parseUrchinBatchTags, classifyUrchinRequestError } = require('../../src/stats/urchin');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper');
const { createStatsLookup } = require('../../src/stats/lookup');
const id = index => (index + 1).toString(16).padStart(32, '0');

function fixture({ baselineDir, delay = 100, response, fail } = {}) {
    const h = harness(baselineDir), calls = [];
    let key = 'fixture-key', active = 0, peak = 0;
    function request(method, names, uuids, options) {
        const call = { method, names, uuids, at: h.elapsed(), signal: options.signal };
        calls.push(call); peak = Math.max(peak, ++active);
        return new Promise((resolve, reject) => {
            const abort = () => { h.clock.clearTimeout(timer); active--; reject(Object.assign(new Error('Cancelled'), { code: 'ERR_CANCELED' })); };
            const timer = h.clock.setTimeout(() => {
                options.signal.removeEventListener('abort', abort); active--;
                const error = fail?.(call);
                if (error) reject(error);
                else resolve(response?.(call) || { status: 200, headers: {}, data: method === 'POST'
                    ? { players: Object.fromEntries(uuids.map(uuid => [uuid, []])) } : { tags: [] } });
            }, typeof delay === 'function' ? delay(call) : delay);
            options.signal.addEventListener('abort', abort, { once: true });
        });
    }
    const client = h.load('features/urchin_client.js').createUrchinClient({
        getKey: () => key, getGameState: () => ({ gameActive: true }),
        makeUrchinData, parseBatchTags: parseUrchinBatchTags, classifyRequestError: classifyUrchinRequestError,
        axios: {
            get(url, options) { assert(url.endsWith('/player/tags')); return request('GET', [options.params.player], [], options); },
            post(url, body, options) {
                assert.equal(url, 'https://api.urchin.gg/v3/players');
                assert(body.uuids.length >= 1 && body.uuids.length <= 2);
                assert.equal(new Set(body.uuids).size, body.uuids.length);
                assert(body.uuids.every(uuid => /^[0-9a-f]{32}$/.test(uuid)));
                assert.equal(options.headers['X-API-Key'], key);
                return request('POST', [], body.uuids, options);
            }
        }
    });
    return { h, calls, client, peak: () => peak, setKey: value => { key = value; } };
}

async function timing(baselineDir, stagger = 0) {
    const f = fixture({ baselineDir }), completed = [];
    const jobs = Array.from({ length: 16 }, (_, i) => (stagger ? f.h.sleep(i * stagger) : Promise.resolve())
        .then(() => f.client.getUrchinRaw(`Player${i}`, id(i)))
        .then(data => { assert.equal(data.ok, true); completed.push(f.h.elapsed()); }));
    await f.h.clock.until(10000); await Promise.all(jobs);
    return { requests: f.calls.length, firstTagsMs: Math.min(...completed), allTagsMs: Math.max(...completed), peak: f.peak(),
        batchSizes: f.calls.map(call => call.method === 'POST' ? call.uuids.length : 1) };
}

async function run() {
    let f = fixture();
    const jobs = Array.from({ length: 5 }, (_, i) => f.client.getUrchinRaw(`Player${i}`, id(i)));
    const duplicate = f.client.getUrchinRaw('player0', id(0));
    await f.h.clock.until(1000); assert((await Promise.all([...jobs, duplicate])).every(data => data.ok));
    assert.deepEqual(f.calls.map(c => c.uuids.length), [2, 2, 1]);
    assert.deepEqual(f.calls.map(c => c.at), [40, 240, 440]);
    await f.client.getUrchinRaw('Player0', id(0)); assert.equal(f.calls.length, 3);
    const changedIdentity = f.client.getUrchinRaw('Player0', id(99));
    await f.h.clock.until(2000); await changedIdentity;
    assert.equal(f.calls.length, 4, 'A tag cache cannot cross verified identities.');

    f = fixture();
    let firstReady = false;
    const lone = f.client.getUrchinRaw('Alone', id(0)).then(data => { firstReady = true; return data; });
    await f.h.clock.until(200); assert(firstReady, 'A singleton never waits for another UUID.'); await lone;
    const later = f.client.getUrchinRaw('Later', id(1));
    await f.h.clock.until(1000); await later;
    assert.deepEqual(f.calls.map(c => c.uuids.length), [1, 1]);
    const invalid = await f.client.getUrchinRaw('Nick', 'not-a-verified-uuid');
    assert.equal(invalid.ok, false); assert.equal(f.calls.length, 2);

    f = fixture({ delay: call => call.uuids.includes(id(0)) ? 10000 : 50 });
    f.client.configureUrchinRequests({ urchinRequestConcurrency: 2 });
    let fastReady = false;
    const slowPair = [f.client.getUrchinRaw('Slow', id(0)), f.client.getUrchinRaw('Partner', id(1))];
    const fastPair = Promise.all([f.client.getUrchinRaw('Fast', id(2)), f.client.getUrchinRaw('Other', id(3))])
        .then(data => { fastReady = true; return data; });
    await f.h.clock.until(500); assert(fastReady, 'A slow pair cannot block the next independent pair.');
    await f.h.clock.until(11000); await Promise.all([...slowPair, fastPair]);

    for (const broken of ['missing', 'malformed', 'unreadable']) {
        f = fixture({ response: call => ({ status: 200, headers: {}, data: { players: {
            [call.uuids[0].toUpperCase().replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')]: [],
            ...(broken === 'missing' ? {} : { [call.uuids[1]]: broken === 'malformed' ? null : [null] })
        } } }) });
        const pair = [f.client.getUrchinRaw('Good', id(0)), f.client.getUrchinRaw('Broken', id(1))];
        await f.h.clock.until(1000); const [good, bad] = await Promise.all(pair);
        assert.equal(good.ok, true); assert.equal(bad.ok, false);
        assert.equal(bad.requestStatus, 'failed', 'Missing entries are never reported as clean.');
    }

    f = fixture({ delay: 10000 });
    f.client.configureUrchinRequests({ urchinRequestConcurrency: 4 });
    const slow = Array.from({ length: 12 }, (_, i) => f.client.getUrchinRaw(`Slow${i}`, id(i)));
    await f.h.clock.until(2000); assert.equal(f.calls.length, 4); assert.equal(f.peak(), 4);
    f.client.configureUrchinRequests({ urchinRequestConcurrency: 1 });
    await f.h.clock.until(9000); assert.equal(f.calls.length, 4);
    await f.h.clock.until(40000); await Promise.all(slow);
    assert.equal(f.calls.length, 6); assert(f.calls.every(c => c.uuids.length === 2));

    f = fixture({ delay: 1000 });
    const singleSlot = Array.from({ length: 4 }, (_, i) => f.client.getUrchinRaw(`Default${i}`, id(i)));
    await f.h.clock.until(500);
    assert.equal(f.calls.length, 1, 'The default allows one physical batch request at a time.');
    await f.h.clock.until(2500); await Promise.all(singleSlot);
    assert.equal(f.peak(), 1); assert.deepEqual(f.calls.map(c => c.uuids.length), [2, 2]);

    f = fixture({ delay: 10000 });
    const old = [f.client.getUrchinRaw('One', id(0)), f.client.getUrchinRaw('Two', id(1))];
    await f.h.clock.until(100); f.client.resetUrchinLookupState();
    assert((await Promise.all(old)).every(data => data.requestStatus === 'reset'));
    await f.h.clock.until(12000);
    assert.equal(f.client.getUrchinRateLimitSnapshot().cachedPlayers, 0);
    assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.remaining, 299);

    f = fixture({ fail: () => Object.assign(new Error('Limited'), { response: { status: 429, headers: { 'retry-after': '2' } } }) });
    const limited = Array.from({ length: 8 }, (_, i) => f.client.getUrchinRaw(`Limit${i}`, id(i)));
    await f.h.clock.until(1000); assert((await Promise.all(limited)).every(data => data.requestStatus === 'rate_limited'));
    assert.equal(f.calls.length, 1, 'A batch 429 pauses the shared queue.');
    const paused = await f.client.getUrchinRaw('Paused', id(99)); assert.equal(paused.requestStatus, 'rate_limited');
    assert.equal(f.calls.length, 1);

    f = fixture(); f.client.configureUrchinRequests({ urchinRequestDelayMs: 0, urchinRequestConcurrency: 16 });
    const budget = Array.from({ length: 610 }, (_, i) => f.client.getUrchinRaw(`Budget${i}`, id(i)));
    await f.h.clock.until(10000); const answers = await Promise.all(budget);
    assert.equal(f.calls.length, 300, 'The local request allowance is not multiplied by batch size.');
    assert.equal(answers.filter(data => data.ok).length, 600);
    assert.equal(answers.filter(data => data.requestStatus === 'rate_limited').length, 10);
    assert(f.calls.flatMap(c => c.uuids).length < 1000, 'Two-player batches stay below the documented distinct-player allowance.');
    assert((await f.client.fetchUrchinSession('Session', 'monthly')).error.includes('cooling down'));

    // Actual profile pipeline: a failed identity cannot hold up tag checks
    // or the primary previews of the players whose identities are ready.
    f = fixture({ delay: 1000 });
    const previews = [];
    const helpers = createStatsLookup({ getPlayerData: async () => null, makeUrchinData, makePingData: x => x });
    const stats = f.h.load('src/stats/fetch.js', { axios: { get: async url => {
        const name = url.split('/').pop(); await f.h.sleep(20);
        if (name === 'Missing') throw Object.assign(new Error('Missing'), { response: { status: 404 } });
        return { data: { id: name === 'One' ? id(0) : id(1), name } };
    } } }).createStatsFetch({ globalCache: new Map(), cacheDuration: 300000,
        getHypixelKey: () => 'fixture', hasHypixelApiKeyConfigured: () => true,
        hypixelApiGet: async url => f.h.sleep(60, { data: { player: { uuid: new URL(url).searchParams.get('uuid') } } }),
        getUrchinRaw: f.client.getUrchinRaw, getAuroraPingRaw: async () => ({}), getHypixelStatusRaw: async () => '',
        makePingData: x => x, mergeUrchinOverride: (a, b) => ({ ...a, ...b }), notifyUrchinOutageOnce() {},
        classifyPlayerLookupError: helpers.classifyPlayerLookupError, playerLookupDeduper: new InFlightDeduper(),
        now: () => f.h.clock.now, setTimeoutImpl: f.h.clock.setTimeout, clearTimeoutImpl: f.h.clock.clearTimeout });
    const profiles = ['One', 'Missing', 'Two'].map(name => stats.getPlayerData(name, { includeErrors: true,
        onPrimaryProfile: p => previews.push(p) }));
    await f.h.clock.until(200); assert.equal(previews.length, 2);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].uuids.length, 2);
    await f.h.clock.until(2000);
    const results = await Promise.all(profiles);
    assert(results[0].data.urchin.ok && results[2].data.urchin.ok);
    assert.equal(results[1].errorType, 'player_not_found');
    console.log('Urchin UUID batches passed: pairs/singletons, independent identities, partial responses, cache isolation, cancellation, pacing and quotas.');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { timing, fixture };
