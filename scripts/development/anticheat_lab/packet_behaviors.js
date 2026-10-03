'use strict';

// Independent packet state machines. Only an owned local client may attach
// these. Calls preserve packet order; no original code is loaded or executed.
const v8 = require('v8');
const { JavaRandom } = require('./random');
const MOVEMENT = new Set(['flying', 'position', 'look', 'position_look']);
const copy = data => v8.deserialize(v8.serialize(data));

class BlinkBuffer {
    constructor({ type = 'all', direction = 'outgoing', autoSend = false, threshold = 50, maxQueued = 10000 } = {}) {
        if (!['all', 'movement'].includes(type) || !['outgoing', 'both'].includes(direction)
            || !Number.isInteger(threshold) || threshold < 0 || threshold > 100) throw new Error('Invalid Blink settings');
        Object.assign(this, { type, direction, autoSend, threshold, maxQueued });
        this.enabled = false; this.queue = []; this.count = 0; this.pending = false; this.dispatching = false;
    }
    enable() {
        if (this.enabled) throw new Error('Blink already enabled');
        this.queue = []; this.count = 0; this.pending = false; this.enabled = true;
    }
    enqueue(name, data, deliver) {
        if (this.queue.length >= this.maxQueued) throw new Error('Lab packet queue limit exceeded; invalidate trial');
        this.queue.push({ name, data: copy(data), deliver });
        if (++this.count >= this.threshold && this.autoSend && this.threshold > 0) {
            this.count = 0; this.pending = true;
        }
    }
    flush() {
        const queue = this.queue;
        this.queue = []; this.pending = false;
        this.dispatching = true;
        try { for (const packet of queue) packet.deliver(packet.name, packet.data); }
        finally { this.dispatching = false; }
    }
    outgoing(name, data, deliver) {
        if (!this.enabled || this.dispatching || (this.type === 'movement' && !MOVEMENT.has(name))) return deliver(name, data);
        this.enqueue(name, data, deliver);
        if (this.pending) this.flush();
    }
    incoming(name, data, deliver) {
        if (!this.enabled || this.dispatching) return deliver(name, data);
        if (name === 'position') {
            this.flush();
            if (!this.autoSend) this.enabled = false;
            return deliver(name, data);
        }
        if (this.direction !== 'both') return deliver(name, data);
        // Source Type filter does not apply to incoming packets. The pending
        // threshold flush happens on a later eligible outgoing callback.
        this.enqueue(name, data, deliver);
    }
    disable() { this.flush(); this.enabled = false; }
}

class BlockHitLagBuffer {
    constructor({ minDelay = 50, maxDelay = 100, seed = 1, maxQueued = 10000 } = {}) {
        if (!Number.isFinite(minDelay) || !Number.isFinite(maxDelay) || minDelay < 0 || maxDelay > 500
            || minDelay > maxDelay) throw new Error('Invalid BlockHit Lag delay');
        Object.assign(this, { minDelay, maxDelay, maxQueued });
        this.rng = new JavaRandom(seed);
        this.queue = []; this.buffering = false; this.started = 0; this.delay = 0;
    }
    add(name, data, deliver) {
        if (this.queue.length >= this.maxQueued) throw new Error('Lab packet queue limit exceeded; invalidate trial');
        this.queue.push({ name, data: copy(data), deliver });
    }
    flush() {
        const queue = this.queue; this.queue = [];
        for (const packet of queue) packet.deliver(packet.name, packet.data);
    }
    outgoing(name, data, deliver, { now, targetPresent = true, holdingSword = true, eligible = true }) {
        if (!eligible || name === 'keep_alive') return deliver(name, data);
        if (this.buffering) {
            if (!targetPresent || !holdingSword || now - this.started >= this.delay) {
                this.flush(); this.buffering = false;
                // This triggering packet passes through; a release on this
                // branch does not start another buffer in the same callback.
                return deliver(name, data);
            }
            this.add(name, data, deliver); return;
        }
        if (name === 'block_dig' && data.status === 5) {
            this.add(name, data, deliver);
            this.buffering = true;
            this.delay = Math.trunc(this.minDelay + (this.maxDelay - this.minDelay) * this.rng.nextDouble());
            this.started = now;
            return;
        }
        return deliver(name, data);
    }
    shouldReblock(now) { return this.buffering && now - this.started >= this.delay - 50; }
    finishTrial() {
        // Trial cleanup, not a claim about the original module's disable hook.
        this.flush(); this.buffering = false;
    }
}

module.exports = { BlinkBuffer, BlockHitLagBuffer, MOVEMENT };
