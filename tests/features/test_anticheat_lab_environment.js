'use strict';
const assert = require('assert');
const net = require('net');
const { once } = require('events');
const { LocalTransport } = require('../../scripts/development/anticheat_lab/transport');
const { GameClock } = require('../../scripts/development/anticheat_lab/game_clock');

async function main() {
    for (const speed of [0.1, 1, 1.07, 2]) {
        const clock = new GameClock(speed); let ticks = 0;
        for (let i = 0; i < 1000; i++) ticks += clock.advance(10);
        assert(Math.abs(ticks - 200 * speed) <= 1, `scaled simulation ticks ${speed}`);
        assert.strictEqual(clock.discardedTicks, 0);
    }
    const overrun = new GameClock(2);
    assert.strictEqual(overrun.advance(1000), 10);
    assert.strictEqual(overrun.discardedTicks, 30);
    const deliveries = [], serverSockets = [];
    const server = net.createServer(socket => { serverSockets.push(socket); socket.on('data', data => socket.write(data)); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const transport = await new LocalTransport(server.address().port, row => deliveries.push(row)).start();
    const client = net.connect({ host: '127.0.0.1', port: transport.port });
    try {
        await once(client, 'connect');
        transport.configure({ label: 'order', seed: 189, latencyMs: 20, jitterMs: 10, stallEveryMs: 1000, stallMs: 80 });
        const expected = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
        const returned = [];
        const completed = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Delayed echo timeout')), 3000);
            client.on('data', bytes => { returned.push(bytes); if (Buffer.concat(returned).length === expected.length) { clearTimeout(timeout); resolve(); } });
        });
        for (let offset = 0; offset < expected.length; offset += 16) {
            client.write(expected.subarray(offset, offset + 16));
            await new Promise(resolve => setTimeout(resolve, 2));
        }
        await completed;
        assert.deepStrictEqual(Buffer.concat(returned), expected, 'Transport preserves exact TCP byte order');
        const sent = deliveries.filter(row => row.type === 'delivery');
        assert(sent.length >= 2 && sent.some(row => row.actualDelayMs >= 60), 'Stall actually delayed traffic');
        assert(sent.every(row => row.actualDelayMs >= row.requestedDelayMs), 'No early scheduled delivery');
    } finally {
        client.destroy(); await transport.close(); for (const socket of serverSockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    }
    console.log('Anticheat lab clock and real TCP transport tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
