'use strict';

const assert = require('assert');
const { DEFAULT_COMMAND_GAP_MS, createHypixelCommandQueue } = require('../../src/net/hypixelCommandQueue.js');

function createFakeClock() {
    let time = 0;
    let nextId = 0;
    const timers = new Map();
    return {
        now: () => time,
        setTimeout(callback, delay) {
            const id = ++nextId;
            timers.set(id, { at: time + Math.max(0, Number(delay) || 0), callback });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        runNext() {
            const next = [...timers.entries()]
                .sort(([, a], [, b]) => a.at - b.at)[0];
            if (!next) return false;
            const [id, timer] = next;
            timers.delete(id);
            time = timer.at;
            timer.callback();
            return true;
        },
        runAll() {
            while (this.runNext()) {}
        }
    };
}

async function main() {
    assert.strictEqual(DEFAULT_COMMAND_GAP_MS, 400, 'Hypixel command spacing should default to 400ms');

    const clock = createFakeClock();
    const sent = [];
    const queue = createHypixelCommandQueue({
        minIntervalMs: 400,
        now: clock.now,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        send: (command) => sent.push({ command, at: clock.now() })
    });

    const first = queue.enqueue('/p list', { priority: 70, dedupeKey: 'party-list', dedupeMs: 10_000 });
    const second = queue.enqueue('/pc queued announcement', { priority: 80 });
    const urgent = queue.enqueue('/l', { priority: 0 });
    clock.runAll();
    const results = await Promise.all([first, second, urgent]);

    assert.deepStrictEqual(sent.map(item => item.command), ['/p list', '/l', '/pc queued announcement'], 'Urgent dodge commands should jump ahead of already queued low-priority commands');
    assert.deepStrictEqual(sent.map(item => item.at), [0, 400, 800], 'Every sent command must be at least 400ms apart');
    assert(results.every(result => result.sent), 'Queued commands should resolve as sent');

    const duplicate = await queue.enqueue('/p list', { priority: 70, dedupeKey: 'party-list', dedupeMs: 10_000 });
    assert.strictEqual(duplicate.reason, 'deduped', 'Repeated party-list commands should collapse inside their cooldown');
    assert.strictEqual(sent.length, 3, 'Deduped commands must not be sent');

    const unavailableClock = createFakeClock();
    let ready = false;
    const unavailableQueue = createHypixelCommandQueue({
        now: unavailableClock.now,
        setTimeout: unavailableClock.setTimeout,
        clearTimeout: unavailableClock.clearTimeout,
        canSend: () => ready,
        send: () => { throw new Error('must not send while disconnected'); }
    });
    const unavailable = await unavailableQueue.enqueue('/l');
    assert.strictEqual(unavailable.reason, 'not-ready', 'Commands must be dropped instead of leaking into a disconnected session');
    ready = true;

    const closeClock = createFakeClock();
    const closeQueue = createHypixelCommandQueue({
        minIntervalMs: 400,
        now: closeClock.now,
        setTimeout: closeClock.setTimeout,
        clearTimeout: closeClock.clearTimeout,
        send: () => {}
    });
    await closeQueue.enqueue('/first');
    const pending = closeQueue.enqueue('/second');
    closeQueue.close('connection-ended');
    assert.strictEqual((await pending).reason, 'connection-ended', 'Disconnecting must cancel queued commands');

    console.log('Hypixel command queue tests passed.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
