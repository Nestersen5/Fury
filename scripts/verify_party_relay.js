'use strict';

// Public health/protocol smoke only. Does not read local account credentials
// or attempt Minecraft authentication. Run after a relay deployment.
const assert = require('assert/strict');
const WebSocket = require('ws');
const { relayUrl } = require('../src/party/coordinationProtocol');

(async () => {
    const endpoint = relayUrl();
    assert(endpoint, 'Relay endpoint is disabled or invalid');
    const health = new URL(endpoint.href.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
    health.pathname = '/party/health';
    const response = await fetch(health, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, version: 1 });
    endpoint.searchParams.set('leader', 'FuryRelaySmoke'); endpoint.searchParams.set('network', 'hypixel:25565');
    await new Promise((resolve, reject) => {
        let challenged = false;
        const ws = new WebSocket(endpoint, { handshakeTimeout: 10000, maxPayload: 8192, followRedirects: false });
        const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Relay handshake timed out')); }, 12000);
        ws.on('error', error => { clearTimeout(timeout); reject(error); });
        ws.on('message', raw => {
            try {
                const message = JSON.parse(String(raw));
                assert.equal(message.v, 1); assert.equal(message.type, 'challenge');
                assert.match(message.challenge, /^[0-7][a-f0-9]{39}$/);
                challenged = true;
                // No account proof: invalid versions must fail closed.
                ws.send(JSON.stringify({ v: 99, type: 'authenticate' }));
            } catch (error) { clearTimeout(timeout); ws.terminate(); reject(error); }
        });
        ws.on('close', code => {
            clearTimeout(timeout);
            try { assert(challenged); assert.equal(code, 1008); resolve(); } catch (error) { reject(error); }
        });
    });
    console.log('Public relay health, WebSocket challenge and incompatible-client rejection passed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
