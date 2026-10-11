'use strict';

// Real localhost WebSockets through the production client and relay core.
// Minecraft identity verification is injected; no real accounts or APIs used.
const assert = require('assert/strict');
const { createHash } = require('crypto');
const { WebSocketServer } = require('ws');
const { createPartyCoordination } = require('../../src/party/coordinationClient');

(async () => {
    const { PartyRoom } = await import('../../cloudflare/party-coordination/core.mjs');
    const rooms = new Map(), clients = [], wire = { messages: 0, bytes: 0 };
    const identities = new Map(['Alice', 'Bob', 'Charlie', 'David', 'Ella', 'Frank', 'Grace', 'Harry']
        .map(name => [name, createHash('md5').update(name).digest('hex')]));
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 8192, perMessageDeflate: false });
    await new Promise(resolve => server.once('listening', resolve));
    server.on('connection', async (ws, request) => {
        const leader = new URL(request.url, 'http://localhost').searchParams.get('leader');
        let entry = rooms.get(leader);
        if (!entry) {
            entry = { sockets: [], alarm: null };
            const ctx = { getWebSockets: () => entry.sockets, storage: {
                getAlarm: async () => entry.alarm, setAlarm: async value => { entry.alarm = value; }
            } };
            entry.room = new PartyRoom(ctx, {}, { verify: async (name, uuid) => identities.get(name) === uuid });
            rooms.set(leader, entry);
        }
        let attachment;
        ws.serializeAttachment = value => { attachment = structuredClone(value); };
        ws.deserializeAttachment = () => structuredClone(attachment);
        const send = ws.send.bind(ws);
        ws.send = raw => { wire.messages++; wire.bytes += Buffer.byteLength(raw); send(raw); };
        entry.sockets.push(ws);
        ws.on('message', (raw, binary) => {
            wire.messages++; wire.bytes += Buffer.byteLength(raw);
            void entry.room.webSocketMessage(ws, binary ? raw : String(raw));
        });
        ws.on('close', () => entry.room.webSocketClose(ws));
        ws.on('error', () => entry.room.webSocketError(ws));
        await entry.room.open(ws, leader);
    });
    function player(name, party, id) {
        const client = createPartyCoordination({ network: 'mc.hypixel.net:25565',
            endpoint: new URL(`ws://127.0.0.1:${server.address().port}/party/connect`),
            getSession: () => ({ accessToken: 'synthetic', selectedProfile: { name, id: identities.get(name) } }),
            authenticate: async () => {} });
        const state = { enabled: true, leader: party[0], members: party.filter(member => member !== name),
            phase: 'pregame', serverId: id, generation: '1:1' };
        clients.push(client); client.update(state); return { client, state };
    }
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function eventually(check) {
        const deadline = performance.now() + 6000;
        while (performance.now() < deadline) {
            try { check(); return; } catch { await sleep(30); }
        }
        check();
    }
    try {
        const partyA = ['Alice', 'Bob', 'Charlie', 'David'], partyB = ['Ella', 'Frank', 'Grace', 'Harry'];
        const a = partyA.map((name, index) => player(name, partyA, index === 1 ? 'mini2A' : 'mini1A'));
        const b = partyB.map(name => player(name, partyB, 'mini9A'));
        await eventually(() => {
            assert.equal(a[0].client.evidence('Bob')?.status, 'different');
            assert.equal(a[0].client.evidence('Charlie')?.status, 'same');
            assert.equal(b[0].client.evidence('Frank')?.status, 'same');
            assert.equal(b[3].client.evidence('Ella')?.status, 'same');
        });
        assert.equal(rooms.size, 2);
        assert.equal(a[0].client.evidence('Ella')?.status === 'same', false, 'different parties stay isolated');
        a[1].state = { ...a[1].state, generation: '2:2', serverId: 'mini1A' };
        a[1].client.update(a[1].state);
        await eventually(() => assert.equal(a[0].client.evidence('Bob')?.status, 'same'));
        a[1].client.close();
        await eventually(() => assert.equal(a[0].client.evidence('Bob'), null));
        assert.equal(b[0].client.evidence('Frank')?.status, 'same', 'another party works independently');
        for (const ws of rooms.get('alice').sockets) ws.terminate();
        await eventually(() => assert.equal(a[0].client.evidence('Charlie'), null));
        console.log(`Two independent parties coordinated over real WebSockets: ${wire.messages} messages, ${wire.bytes} payload bytes during connect, checks and transfer.`);
    } finally {
        for (const client of clients) client.close();
        for (const ws of server.clients) ws.terminate();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
