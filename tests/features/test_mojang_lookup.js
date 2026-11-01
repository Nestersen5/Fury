'use strict';

const assert = require('node:assert/strict');
const { fixture: clockFixture } = require('./test_hypixel_api_coordinator');
const { createMojangLookup } = require('../../src/stats/mojangLookup');
const uuid = 'a'.repeat(32);
const failure = status => status
    ? Object.assign(new Error(String(status)), { response: { status, headers: {} } })
    : Object.assign(new Error('Timeout'), { code: 'ECONNABORTED' });
function fixture(handler) {
    const { clock } = clockFixture(), calls = [], notices = [], controller = new AbortController();
    let current = true;
    const resolver = createMojangLookup({ now: () => clock.now, setTimeoutImpl: clock.setTimeout,
        clearTimeoutImpl: clock.clearTimeout,
        onFailure: info => notices.push(info),
        isRetryable: e => e.mojangRetryable || e.code === 'ECONNABORTED' || e.response?.status === 429 || e.response?.status >= 500,
        retryAfterMs: e => Number(e.response?.headers?.['retry-after'] || 0) * 1000 + (e.response?.headers?.['retry-after'] ? 350 : 0),
        request(url, options) {
            const index = new URL(url).hostname === 'api.mojang.com' ? 0 : 1;
            const call = { index, at: clock.now - 1000000, options, aborted: false };
            calls.push(call);
            return new Promise((resolve, reject) => {
                const spec = handler(index, calls.length, url);
                const abort = () => { call.aborted = true; clock.clearTimeout(timer); reject(Object.assign(new Error('Cancelled'), { code: 'ERR_CANCELED' })); };
                const timer = clock.setTimeout(() => {
                    options.signal.removeEventListener('abort', abort);
                    if (spec.error) reject(spec.error);
                    else resolve({ status: spec.status ?? 200, data: spec.data ?? { id: uuid, name: url.split('/').pop() } });
                }, spec.ms);
                options.signal.addEventListener('abort', abort, { once: true });
            });
        }
    });
    return { clock, calls, notices, controller, resolver,
        leave: () => { current = false; },
        resolve: (name = 'Example') => resolver.resolve(name, { signal: controller.signal, canRetry: () => current }) };
}

async function run() {
    let f = fixture(() => ({ ms: 50 }));
    let promise = f.resolve(); await f.clock.until(5000); assert.equal(await promise, uuid);
    assert.equal(f.calls.length, 1, 'Healthy requests never dispatch a fallback or retry.');

    for (const primaryWins of [false, true]) {
        f = fixture(i => ({ ms: i ? (primaryWins ? 2000 : 100) : primaryWins ? 1500 : 3000 }));
        let finishedAt;
        promise = f.resolve().then(value => { finishedAt = f.clock.now - 1000000; return value; });
        await f.clock.until(9000); assert.equal(await promise, uuid);
        assert.deepEqual(f.calls.map(c => c.at), [0, 1000]);
        assert.equal(finishedAt, primaryWins ? 1500 : 1100);
        assert(f.calls[primaryWins ? 1 : 0].aborted, 'The unfinished loser is aborted.');
        assert.equal(f.calls.length, 2);
    }
    f = fixture((i, n) => n === 1 ? { ms: 20, error: failure(503) } : { ms: 100 });
    promise = f.resolve(); await f.clock.until(5000); await promise;
    assert.deepEqual(f.calls.map(c => c.at), [0, 20], 'Temporary failures start fallback immediately.');

    f = fixture(() => ({ ms: 3000, error: failure() }));
    promise = f.resolve().catch(e => e); await f.clock.until(20000);
    assert.equal((await promise).code, 'ECONNABORTED');
    assert.deepEqual(f.calls.map(c => c.at), [0, 1000, 5000], 'Both routes share a maximum of three physical attempts.');
    assert.equal(f.notices.length, 1); assert.equal(f.notices[0].attempts.length, 3);
    assert(f.notices[0].attempts.every(a => a.code === 'ECONNABORTED'));
    assert(!JSON.stringify(f.notices).includes('Example'), 'Failure diagnostics omit player identities.');
    promise = f.resolve('Another').catch(e => e); await f.clock.until(30000); await promise;
    assert.equal(f.notices.length, 1, 'Failures across names share the thirty-second log throttle.');

    f = fixture((i, n) => n <= 2 ? { ms: i ? 100 : 3000 } : { ms: 20, error: failure(503) });
    promise = f.resolve(); await f.clock.until(2000); await promise;
    promise = f.resolve('Another').catch(e => e); await f.clock.until(8000); await promise;
    assert.deepEqual(f.calls.map(c => c.index), [0, 1, 0, 1, 1], 'The last recovery favors the recently successful endpoint.');

    for (const status of [404, 204, 400, 401]) {
        f = fixture(() => ({ ms: 100, ...(status === 204 ? { status } : { error: failure(status) }) }));
        promise = f.resolve().catch(e => e); await f.clock.until(5000);
        assert.equal((await promise).response.status, status === 204 ? 404 : status);
        assert.equal(f.calls.length, 1, 'Definitive misses and permanent errors do not trigger duplicates.');
    }
    f = fixture(i => i ? { ms: 100 } : { ms: 20, error: failure(403) });
    promise = f.resolve(); await f.clock.until(5000); assert.equal(await promise, uuid);
    assert.deepEqual(f.calls.map(c => c.index), [0, 1], 'Public-endpoint 403 must try the other official route.');
    f = fixture(i => i ? { ms: 100, error: failure(403) } : { ms: 2500 });
    promise = f.resolve(); await f.clock.until(5000); assert.equal(await promise, uuid);
    assert.equal(f.calls.length, 2, 'A fallback 403 cannot terminate a valid pending primary.');
    // A quick fallback miss does not outrun a valid primary already in flight.
    f = fixture(i => i ? { ms: 100, error: failure(404) } : { ms: 2500 });
    promise = f.resolve(); await f.clock.until(5000); assert.equal(await promise, uuid);
    f = fixture(i => ({ ms: i ? 100 : 3000, error: failure(i ? 404 : 0) }));
    promise = f.resolve().catch(e => e); await f.clock.until(10000);
    assert.equal((await promise).code, 'ECONNABORTED', 'A conflicting missing response cannot turn transport failure into nick evidence.');
    assert.equal(f.calls.length, 3);

    for (const data of [{ id: 'bad', name: 'Example' }, { id: uuid, name: 'WrongPlayer' }, { id: uuid }]) {
        f = fixture((i, n) => n === 1 ? { ms: 20, data } : { ms: 50 });
        promise = f.resolve(); await f.clock.until(5000); assert.equal(await promise, uuid);
        assert.equal(f.calls.length, 2, 'Malformed identities use recovery, never nick detection.');
    }
    f = fixture((i, n) => {
        const error = failure(429); error.response.headers['retry-after'] = '2';
        return n === 1 ? { ms: 20, error } : { ms: 100 };
    });
    promise = f.resolve(); await f.clock.until(500);
    const other = f.resolve('Another'); await f.clock.until(2000);
    assert.equal(f.calls.length, 1, '429 pauses the other endpoint and new players.');
    await f.clock.until(5000); await Promise.all([promise, other]);
    assert(f.calls.slice(1).every(c => c.at >= 2370));
    assert.equal(f.calls.length, 3);

    // A rate limit from the delayed route cancels the original, and its
    // shared cooldown still applies to the one permitted recovery request.
    f = fixture((i, n) => n === 1 ? { ms: 3000 } : { ms: 20, error: failure(429) });
    promise = f.resolve().catch(e => e); await f.clock.until(2000);
    assert(f.calls[0].aborted); assert.equal(f.calls.length, 2);
    await f.clock.until(60000); assert.equal(f.calls.length, 2);
    await f.clock.until(65000); assert.equal((await promise).response.status, 429);
    assert.equal(f.calls.length, 3);

    f = fixture(() => ({ ms: 3000 }));
    promise = f.resolve().catch(e => e); await f.clock.until(500); f.controller.abort();
    await f.clock.until(10000);
    assert.equal((await promise).code, 'STATS_LOOKUP_CANCELLED'); assert.equal(f.calls.length, 1);
    assert(f.calls[0].aborted, 'Leaving cancels the active lookup and pending hedge.');
    f = fixture(() => ({ ms: 3000 }));
    promise = f.resolve().catch(e => e); await f.clock.until(1500); f.controller.abort();
    await f.clock.until(10000); await promise;
    assert.equal(f.calls.length, 2); assert(f.calls.every(c => c.aborted));
    f = fixture(() => ({ ms: 3000 }));
    promise = f.resolve().catch(e => e); await f.clock.until(500); f.leave();
    await f.clock.until(10000);
    assert.equal((await promise).code, 'STATS_LOOKUP_CANCELLED'); assert.equal(f.calls.length, 1);
    console.log('Mojang lookup tests passed: hedging, immediate fallback, validation, shared retry budget, cooldowns and cancellation.');
}
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { run };
