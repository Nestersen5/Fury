'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { createObserverPacketClock } = require('./observer_packet_clock_candidate');
let calls = 0;
const clock = createObserverPacketClock({ now: () => 1000 + ++calls });
clock.begin(); clock.end(); assert.strictEqual(calls, 0, 'An inactive-consumer packet must not read time');
clock.begin(); const recordedAt = clock.now(), scaffoldAt = clock.now(), combatAt = clock.now();
assert.strictEqual(recordedAt, scaffoldAt); assert.strictEqual(recordedAt, combatAt); assert.strictEqual(calls, 1);
clock.end(); assert.strictEqual(clock.now(), 1002, 'Record starts outside the packet get fresh time');
assert.strictEqual(clock.now(), 1003, 'Out-of-packet operations do not reuse a stale timestamp');
clock.begin(); assert.strictEqual(clock.now(), 1004); clock.end();
try { clock.begin(); clock.now(); throw new Error('Consumer exception'); } catch (_) {} finally { clock.end(); }
assert.strictEqual(clock.now(), 1006, 'Finally cleanup must release the packet clock after a consumer exception');
const output = { generatedAt: new Date().toISOString(), passed: true,
    checks: ['lazy time read', 'all synchronous packet consumers share time', 'fresh start/stop/flush time',
        'next packet reads anew', 'exception cleanup'],
    interpretation: 'Clock ownership checks, not extra gameplay trials or a latency benchmark.' };
const file = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/overnight/PACKET_CLOCK_CHECK.json');
fs.writeFileSync(file, JSON.stringify(output, null, 2) + '\n'); console.log(JSON.stringify(output));
