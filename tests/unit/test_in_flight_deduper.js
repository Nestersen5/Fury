'use strict';

const assert = require('assert');
const { InFlightDeduper } = require('../../src/util/in_flight_deduper.js');

(async () => {
    const deduper = new InFlightDeduper();
    let calls = 0;
    const first = deduper.run('player', async () => {
        calls += 1;
        await new Promise(resolve => setTimeout(resolve, 5));
        return { ok: true };
    });
    const second = deduper.run('player', () => {
        calls += 1;
        return { ok: false };
    });

    assert.strictEqual(first, second, 'concurrent requests should share one promise');
    assert.deepStrictEqual(await second, { ok: true });
    assert.strictEqual(calls, 1);
    assert.strictEqual(deduper.size, 0, 'completed requests should be removed');

    await assert.rejects(deduper.run('failure', () => Promise.reject(new Error('failed'))), /failed/);
    assert.strictEqual(deduper.size, 0, 'failed requests should also be removed');

    console.log('In-flight deduper tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
