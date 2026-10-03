'use strict';
const net = require('net');
const { once } = require('events');
const { JavaRandom } = require('./random');

// Delay TCP chunks without parsing/reordering packets. A byte-stream stall is a
// legitimate transport condition, separate from the selective Blink queue.
class LocalTransport {
    constructor(targetPort, log = () => {}) {
        this.targetPort = targetPort; this.log = log; this.sockets = new Set(); this.queues = new Set();
        this.configure({ seed: 421, latencyMs: 0, jitterMs: 0, label: 'startup' });
    }
    configure({ seed, latencyMs = 0, jitterMs = 0, label, stallMs = 0, stallEveryMs = 0 }) {
        for (const value of [latencyMs, jitterMs, stallMs, stallEveryMs]) if (!Number.isFinite(value) || value < 0 || value > 60000) throw new Error('Invalid local transport delay');
        this.condition = { latencyMs, jitterMs, stallMs, stallEveryMs, label };
        this.rng = { upstream: new JavaRandom(seed), downstream: new JavaRandom(BigInt(seed) ^ 0xabc123n) };
        this.startedAt = Date.now();
    }
    async start() {
        this.server = net.createServer(client => {
            const upstream = net.connect({ host: '127.0.0.1', port: this.targetPort });
            client.setNoDelay(true); upstream.setNoDelay(true);
            this.sockets.add(client); this.sockets.add(upstream);
            for (const socket of [client, upstream]) {
                socket.on('error', error => this.log({ type: 'socket-error', message: error.message }));
                socket.on('close', () => { this.sockets.delete(socket); client.destroy(); upstream.destroy(); });
            }
            this.pipe(client, upstream, 'upstream'); this.pipe(upstream, client, 'downstream');
        });
        this.server.listen(0, '127.0.0.1'); await once(this.server, 'listening');
        this.port = this.server.address().port; return this;
    }
    pipe(source, destination, direction) {
        const queue = { rows: [], bytes: 0, timer: null }; this.queues.add(queue);
        const pump = () => {
            queue.timer = null;
            while (queue.rows.length && queue.rows[0].due <= Date.now()) {
                const item = queue.rows.shift(); queue.bytes -= item.bytes.length;
                const sentAt = Date.now();
                if (!destination.destroyed) destination.write(item.bytes);
                this.log({ type: 'delivery', direction, receivedAt: item.receivedAt, sentAt,
                    requestedDelayMs: item.requestedDelayMs, actualDelayMs: sentAt - item.receivedAt,
                    bytes: item.bytes.length, label: item.label });
            }
            if (queue.bytes < 1024 * 1024 && !source.destroyed) source.resume();
            if (queue.rows.length) queue.timer = setTimeout(pump, Math.max(1, queue.rows[0].due - Date.now()));
        };
        source.on('data', bytes => {
            const receivedAt = Date.now(), c = this.condition, rng = this.rng[direction];
            const sampled = Math.max(0, c.latencyMs + (c.jitterMs ? rng.nextInt(2 * c.jitterMs + 1) - c.jitterMs : 0));
            let due = receivedAt + sampled;
            if (c.stallEveryMs > 0 && c.stallMs > 0) {
                const phase = (receivedAt - this.startedAt) % c.stallEveryMs;
                if (phase < c.stallMs) due = Math.max(due, receivedAt + c.stallMs - phase);
            }
            // TCP byte order always takes precedence over independently drawn jitter.
            due = Math.max(due, queue.rows.at(-1)?.due || 0);
            queue.rows.push({ bytes: Buffer.from(bytes), receivedAt, due,
                requestedDelayMs: due - receivedAt, label: c.label });
            queue.bytes += bytes.length;
            if (queue.bytes > 1024 * 1024) source.pause();
            if (!queue.timer) pump();
        });
        source.on('close', () => { clearTimeout(queue.timer); queue.rows.length = 0; this.queues.delete(queue); });
    }
    async close() {
        for (const queue of this.queues) clearTimeout(queue.timer);
        for (const socket of this.sockets) socket.destroy();
        if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
    }
}
module.exports = { LocalTransport };
