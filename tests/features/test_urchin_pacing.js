'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { harness } = require('./test_progressive_stats');
const { makeUrchinData, parseUrchinBatchTags, classifyUrchinRequestError } = require('../../src/stats/urchin');

function setup({ baselineDir, delay = 100, respond, game = true } = {}) {
    const h = harness(baselineDir), calls = [];
    let key = 'synthetic-key', inGame = game, active = 0, peak = 0;
    const client = h.load('features/urchin_client.js').createUrchinClient({
        getKey: () => key, getGameState: () => ({ gameActive: inGame }),
        makeUrchinData, parseBatchTags: parseUrchinBatchTags, classifyRequestError: classifyUrchinRequestError,
        resolveSessionEndpoint: period => period,
        axios: { post: async () => { throw Error('Unexpected POST'); }, get: async (url, options) => {
            const call = { at: h.elapsed(), url, player: options.params.player, signal: options.signal };
            calls.push(call); peak = Math.max(peak, ++active);
            try {
                await h.sleep(typeof delay === 'function' ? delay(call) : delay);
                return respond ? await respond(call, calls.length) : { status: 200, headers: {}, data: { tags: [] } };
            } finally { active--; }
        } }
    });
    return { h, client, calls, peak: () => peak, setKey: value => { key = value; }, setGame: value => { inGame = value; } };
}

async function burstScenario(baselineDir) {
    const f = setup({ baselineDir, delay: 1000 });
    const names = Array.from({ length: 40 }, (_, i) => `Player${i}`);
    const first = f.client.getUrchinBatchRaw(names), duplicate = f.client.getUrchinBatchRaw(names);
    await f.h.clock.until(45000);
    await Promise.all([first, duplicate]);
    if (!baselineDir) {
        assert(f.peak() <= 1, 'Only one HTTP request may run by default');
        for (let i = 1; i < f.calls.length; i++) assert(f.calls[i].at - f.calls[i - 1].at >= 200, 'Every HTTP start is paced');
        assert.equal(f.calls.length, 40, 'Overlapping consumers share one lookup per player');
        await f.client.getUrchinBatchRaw(names);
        assert.equal(f.calls.length, 40, 'Cached players spend no extra request slots');
    }
    return { requests: f.calls.length, peakConcurrency: f.peak(), firstSecondStarts: f.calls.filter(c => c.at < 1000).length,
        firstStartMs: f.calls[0].at, lastStartMs: f.calls.at(-1).at };
}

async function pausedLookup(f, name) {
    let settled = false, result;
    const pending = f.client.getUrchinRaw(name).then(data => { settled = true; result = data; });
    await f.h.clock.until(f.h.elapsed() + 50);
    assert(settled, 'Paused lookups must settle without starting a request or holding the profile indefinitely');
    await pending;
    return result;
}

async function slowConcurrencyScenario(baselineDir) {
    const f = setup({ baselineDir, delay: 10000 });
    let completedAt;
    const names = Array.from({ length: 8 }, (_, i) => `Slow${i}`);
    const pending = f.client.getUrchinBatchRaw(names).then(() => { completedAt = f.h.elapsed(); });
    await f.h.clock.until(90000);
    await pending;
    if (!baselineDir) {
        assert.equal(f.peak(), 1, 'Slow requests retain the single-request default cap');
        assert.equal(f.calls.length, 8);
        for (let i = 1; i < f.calls.length; i++) assert(f.calls[i].at - f.calls[i - 1].at >= 200);
        assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.limit, 300);
    }
    return { requests: f.calls.length, peakConcurrency: f.peak(), completedAt };
}

async function run() {
    const baselineArg = process.argv.find(arg => arg.startsWith('--baseline-dir='));
    if (baselineArg) {
        console.log(JSON.stringify(await burstScenario(path.resolve(baselineArg.slice('--baseline-dir='.length)))));
        return;
    }
    const burst = await burstScenario();
    await slowConcurrencyScenario();

    // One slow response must not hold the next fast player behind a batch.
    let f = setup({ delay: call => call.player === 'Slow' ? 10000 : 50 });
    f.client.configureUrchinRequests({ urchinRequestConcurrency: 2 });
    const slow = f.client.getUrchinRaw('Slow');
    let fastReady = false;
    const fast = f.client.getUrchinRaw('Fast').then(() => { fastReady = true; });
    await f.h.clock.until(700);
    assert(fastReady);
    assert.equal(f.calls.length, 2);
    await f.h.clock.until(11000); await Promise.all([slow, fast]);

    f = setup({ respond: call => ({ status: 200, headers: {},
        data: { tags: call.player === 'Malformed' ? [null] : [] } }) });
    let malformedDone = false;
    const malformed = f.client.getUrchinBatchRaw(['Malformed', 'Healthy']).then(data => { malformedDone = true; return data; });
    await f.h.clock.until(1000);
    assert(malformedDone, 'An unreadable response must not leave one player pending forever');
    assert.equal((await malformed).get('malformed').requestStatus, 'failed');
    assert.equal((await malformed).get('healthy').ok, true);

    // Missing headers never disable the local rolling request cap. Sessions
    // share that same cap; no waiting profile is held for a five-minute window.
    f = setup();
    const many = f.client.getUrchinBatchRaw(Array.from({ length: 305 }, (_, i) => `Budget${i}`));
    const session = f.client.fetchUrchinSession('SessionUser', 'weekly');
    await f.h.clock.until(200000);
    const results = await many;
    assert.equal(f.calls.length, 300);
    assert.equal([...results.values()].filter(x => x.requestStatus === 'rate_limited').length, 5);
    assert((await session).error.includes('cooling down'));
    assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.remaining, 0);
    f.client.configureUrchinRequests({ urchinRequestDelayMs: 0, urchinRequestConcurrency: 16 });
    assert.equal((await pausedLookup(f, 'ConfiguredBudget')).requestStatus, 'rate_limited', 'Changing speed cannot refill a spent budget');
    f.client.configureUrchinRequests({ urchinRequestDelayMs: 200, urchinRequestConcurrency: 2 });
    f.client.resetUrchinLookupState();
    assert.equal((await pausedLookup(f, 'ResetBudget')).requestStatus, 'rate_limited', 'Resetting the same key cannot erase its budget');
    await f.h.clock.until(300041);
    const renewed = f.client.getUrchinRaw('NewWindow');
    await f.h.clock.until(300700); await renewed;
    assert.equal(f.calls.length, 301, 'Capacity returns when the oldest request leaves the rolling window');

    // Smaller server allowances override the fallback; absent later headers
    // cannot refill either the reported or the locally recorded allowance.
    f = setup({ respond: () => ({ status: 200, headers: f.calls.length === 1
        ? { 'X-RateLimit-Limit': '4', 'X-RateLimit-Remaining': '3' } : {}, data: { tags: [] } }) });
    const smaller = f.client.getUrchinBatchRaw(['Small1', 'Small2', 'Small3', 'Small4', 'Small5']);
    await f.h.clock.until(5000);
    assert.equal(f.calls.length, 4);
    assert.equal((await smaller).get('small5').requestStatus, 'rate_limited');
    assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.limit, 4);

    f = setup({ delay: call => call.player === 'Header2' ? 2000 : 100,
        respond: call => ({ status: 200, headers: call.player === 'Header1'
            ? { 'X-RateLimit-Limit': '600', 'X-RateLimit-Remaining': '1' } : {}, data: { tags: [] } }) });
    const reserved = f.client.getUrchinBatchRaw(['Header1', 'Header2', 'Header3']);
    await f.h.clock.until(1100);
    assert.equal(f.calls.length, 2, 'A reported remaining slot is reserved at dispatch');
    f.client.resetUrchinLookupState();
    assert.equal((await pausedLookup(f, 'NoRefill')).requestStatus, 'rate_limited', 'A reset cannot undo a reserved final header slot');
    await f.h.clock.until(3000); await reserved;

    // Transient failures spend slots too. Previously checked tags remain
    // available as stale data while a provider-requested pause is honored.
    f = setup({ respond: () => {
        if (f.calls.length === 1) return { status: 200, headers: {}, data: { tags: [{ type: 'Sniper' }] } };
        throw Object.assign(Error('Synthetic unavailable'), { response: { status: 503, headers: { 'Retry-After': '10' } } });
    } });
    const checked = f.client.getUrchinRaw('KnownPlayer');
    await f.h.clock.until(1000); await checked;
    await f.h.clock.until(300200);
    const unavailable = f.client.getUrchinRaw('KnownPlayer');
    await f.h.clock.until(301000);
    assert.equal((await unavailable).stale, true);
    assert.equal((await unavailable).tag, 'Sniper');
    await pausedLookup(f, 'PausedPlayer');
    assert.equal(f.calls.length, 2, 'Retry-After also pauses a 503 response');
    assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.remaining, 299, 'The failed request still consumes a slot in its current window');

    // An early 429 stops the unstarted queue and its Retry-After survives a
    // same-key reset. Missing headers still produce the fallback cooldown.
    for (const retryAfter of ['10', 'date', null]) {
        let failed = false;
        f = setup({ respond: () => {
            if (!failed) {
                failed = true;
                const headers = retryAfter === null ? undefined : { 'Retry-After': retryAfter === 'date'
                    ? new Date(f.h.clock.now + 10000).toUTCString() : retryAfter };
                throw Object.assign(Error('Synthetic 429'), { response: { status: 429, headers } });
            }
            return { status: 200, headers: {}, data: { tags: [] } };
        } });
        const limited = f.client.getUrchinBatchRaw(['Limit1', 'Limit2', 'Limit3']);
        await f.h.clock.until(1000); await limited;
        assert.equal(f.calls.length, 1, 'A 429 must prevent the remaining requests from starting');
        f.client.resetUrchinLookupState();
        assert.equal((await pausedLookup(f, 'StillWaiting')).requestStatus, 'rate_limited');
        await f.h.clock.until(retryAfter === null ? 31000 : 11000);
        const recovered = f.client.getUrchinRaw('Recovered');
        await f.h.clock.until(retryAfter === null ? 32000 : 12000); await recovered;
        assert.equal(f.calls.length, 2);
    }

    // Background tag and session traffic cannot bypass the shared spacing or
    // concurrency, and an in-game lookup can advance a pending background timer.
    f = setup({ game: false });
    const a = f.client.getUrchinRaw('Background');
    f.setGame(true);
    const joined = f.client.getUrchinRaw('Background');
    await f.h.clock.until(100);
    assert.equal(f.calls[0].at, 40, 'Game priority expedites the old background drain');
    const s1 = f.client.fetchUrchinSession('SessionUser', 'weekly');
    const s2 = f.client.fetchUrchinSession('SessionUser', 'weekly');
    const s3 = f.client.fetchUrchinSession('OtherUser', 'weekly');
    await f.h.clock.until(4000); await Promise.all([a, joined, s1, s2, s3]);
    assert.equal(f.calls.length, 3);
    for (let i = 1; i < f.calls.length; i++) assert(f.calls[i].at - f.calls[i - 1].at >= 200);
    assert(f.calls[2].at - f.calls[1].at >= 900, 'Background reads keep their slower spacing');

    // Old transports may ignore abort, but cannot free a newer owner's slot,
    // refill its cache, or cause the physical concurrency limit to be exceeded.
    f = setup({ delay: 1500 });
    const old = f.client.getUrchinRaw('SharedName');
    await f.h.clock.until(100);
    f.setKey('replacement-key'); f.client.resetUrchinLookupState();
    const fresh = f.client.getUrchinRaw('SharedName');
    await f.h.clock.until(700);
    const other = f.client.getUrchinRaw('ThirdUser');
    assert.equal(f.calls[0].signal.aborted, true);
    await f.h.clock.until(5000); await Promise.all([old, fresh, other]);
    assert.equal((await old).requestStatus, 'reset');
    assert(f.peak() <= 4);
    assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.remaining, 298, 'Key budgets are isolated');

    // Live changes re-evaluate the existing queue without cancelling active
    // reads or forgetting the previous physical request's start time.
    f = setup({ delay: 1000 });
    f.client.configureUrchinRequests({ urchinRequestDelayMs: 500, urchinRequestConcurrency: 1 });
    let adjustable = f.client.getUrchinBatchRaw(Array.from({ length: 8 }, (_, i) => `Adjust${i}`));
    await f.h.clock.until(200);
    assert.equal(f.calls.length, 1);
    f.client.configureUrchinRequests({ urchinRequestDelayMs: 100, urchinRequestConcurrency: 3 });
    await f.h.clock.until(750);
    assert.equal(f.calls.length, 3);
    assert(f.calls[1].at >= 200 && f.calls[1].at <= 202, 'A faster setting advances the old pending queue on the next timer turn');
    assert.equal(f.peak(), 3);
    f.client.configureUrchinRequests({ urchinRequestDelayMs: 350, urchinRequestConcurrency: 1 });
    await f.h.clock.until(1299);
    assert.equal(f.calls.length, 3, 'Lowering the cap lets existing reads finish before another starts');
    assert(f.calls.every(c => !c.signal.aborted));
    await f.h.clock.until(10000); await adjustable;
    assert.equal(f.calls.length, 8);
    assert(f.calls[3].at >= 1300 && f.calls[3].at <= 1305);
    assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.remaining, 292);

    f = setup({ delay: 100 });
    adjustable = f.client.getUrchinBatchRaw(['Later1', 'Later2', 'Later3']);
    await f.h.clock.until(100);
    f.client.configureUrchinRequests({ urchinRequestDelayMs: 600 });
    await f.h.clock.until(639);
    assert.equal(f.calls.length, 1, 'A longer delay postpones an already scheduled drain');
    await f.h.clock.until(2000); await adjustable;
    assert.equal(f.calls[1].at, 640);
    assert.equal(f.calls[2].at, 1240);

    f = setup({ respond: () => { throw Object.assign(Error('Synthetic 429'), {
        response: { status: 429, headers: { 'Retry-After': '10' } }
    }); } });
    adjustable = f.client.getUrchinRaw('LimitedSettings');
    await f.h.clock.until(1000); await adjustable;
    f.client.configureUrchinRequests({ urchinRequestDelayMs: 0, urchinRequestConcurrency: 16 });
    assert.equal((await pausedLookup(f, 'StillLimited')).requestStatus, 'rate_limited');
    assert.equal(f.calls.length, 1, 'Changing speed cannot bypass Retry-After');
    assert.equal(f.client.getUrchinRateLimitSnapshot().localBudget.remaining, 299);

    const output = path.resolve(__dirname, '../../output/urchin-throttle');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'paced.json'), JSON.stringify(burst, null, 2));
    console.log(JSON.stringify(burst));
    console.log('Urchin pacing passed: bounded concurrency, spacing, rolling budget, Retry-After, shared sessions, cache/deduplication and key resets.');
}

if (require.main === module) {
    let finished = false;
    process.once('beforeExit', () => {
        if (!finished) { console.error('Urchin pacing checks did not finish.'); process.exitCode = 1; }
    });
    run().then(() => { finished = true; }, error => { finished = true; console.error(error); process.exitCode = 1; });
}
module.exports = { burstScenario, slowConcurrencyScenario };
