'use strict';
const assert = require('assert/strict');

(async () => {
    const { PartyRoom } = await import('../../cloudflare/party-coordination/core.mjs');
    let time = 1000, alarm = null;
    const sockets = [];
    const ctx = { getWebSockets: () => sockets, storage: {
        getAlarm: async () => alarm, setAlarm: async value => { alarm = value; }
    } };
    const room = new PartyRoom(ctx, {}, { now: () => time,
        verify: async (name, uuid) => uuid === ({ Alice: 'a', Bob: 'b', Eve: 'e' }[name] || '').repeat(32) });
    async function connect(name, letter, leader = 'alice') {
        const ws = { readyState: 1, messages: [],
            send(raw) { this.messages.push(JSON.parse(raw)); },
            serializeAttachment(a) { this.a = structuredClone(a); },
            deserializeAttachment() { return structuredClone(this.a); },
            close() { this.readyState = 3; } };
        sockets.push(ws); await room.open(ws, leader);
        await message(ws, { type: 'authenticate', name, uuid: letter.repeat(32) });
        return ws;
    }
    const message = (ws, value) => room.webSocketMessage(ws, JSON.stringify({ v: 1, ...value }));
    const obs = (seq, serverId = 'mini1A') => ({ phase: 'pregame', serverId, seq, generation: '1:1', stableMs: 1500 });
    const alice = await connect('Alice', 'a'), bob = await connect('Bob', 'b'), eve = await connect('Eve', 'e');
    assert.equal(alice.messages.at(-1).type, 'ready');
    await message(alice, { type: 'state', members: ['Bob'], observation: obs(1) });
    await message(bob, { type: 'state', members: ['Alice'], observation: obs(1, 'mini2A') });
    await message(eve, { type: 'state', members: ['Alice', 'Bob'], observation: obs(1) });
    const probeId = 'c'.repeat(24);
    await message(alice, { type: 'probe', id: probeId, names: ['Bob'] });
    assert.equal(bob.messages.at(-1).type, 'query');
    assert(!eve.messages.some(m => m.type === 'peer' || m.type === 'query'), 'unrelated account cannot read presence');
    await message(bob, { type: 'reply', to: 'a'.repeat(32), id: probeId, observation: obs(2, 'mini2A') });
    assert.equal(alice.messages.at(-1).id, probeId);
    assert.equal(alice.messages.at(-1).observation.serverId, 'mini2A');
    assert.deepEqual(Object.keys(alice.messages.at(-1).observation).sort(),
        ['generation', 'phase', 'seq', 'serverId', 'stableMs']);
    const before = alice.messages.length;
    await message(eve, { type: 'reply', to: 'a'.repeat(32), id: probeId, observation: obs(2) });
    assert.equal(alice.messages.length, before, 'spoofed party membership cannot route a response');
    const aliceNick = { nick: 'AliceNick', id: '1'.repeat(24), serverId: 'mini1A', mode: 'DUELS', receive: true };
    const bobNick = { ...aliceNick, nick: 'BobNick', id: '2'.repeat(24) };
    await message(alice, { type: 'state', members: ['Bob'], observation: obs(3), nickname: aliceNick });
    await message(bob, { type: 'state', members: ['Alice'], observation: obs(3), nickname: bobNick });
    assert.equal(alice.messages.at(-1).nickname.nick, 'BobNick');
    await message(bob, { type: 'nick_saved', to: 'a'.repeat(32), id: aliceNick.id });
    assert.equal(alice.messages.at(-1).type, 'nick_saved');
    assert.equal(alice.messages.at(-1).name, 'bob', 'relay supplies authenticated receiver identity');
    const received = alice.messages.length;
    await message(eve, { type: 'nick_saved', to: 'a'.repeat(32), id: aliceNick.id });
    assert.equal(alice.messages.length, received, 'unrelated peers cannot acknowledge or read a nickname');
    await message(bob, { type: 'state', members: ['Alice'], observation: obs(4), nickname: { ...bobNick, serverId: 'mini2A' } });
    const otherGame = alice.messages.length;
    await message(bob, { type: 'nick_saved', to: 'a'.repeat(32), id: aliceNick.id });
    assert.equal(alice.messages.length, otherGame, 'different-game acknowledgements rejected');
    // Reinstantiate the object: attachments preserve authorization across hibernation.
    const restored = new PartyRoom(ctx, {}, { now: () => time });
    await restored.webSocketMessage(bob, JSON.stringify({ v: 1, type: 'state', members: [], observation: obs(5) }));
    assert.equal(bob.readyState, 3, 'nonleader cannot claim a roster excluding the room leader');
    assert.equal(alice.messages.at(-1).type, 'gone');
    const spoof = await connect('Alice', 'e');
    assert.equal(spoof.readyState, 3, 'failed identity proof is rejected');
    const duplicate = await connect('Alice', 'a');
    assert.equal(alice.readyState, 3, 'old account connection replaced');
    assert.equal(duplicate.readyState, 1);
    time += 16000; await room.alarm();
    assert.equal(duplicate.readyState, 3, 'silent authenticated clients expire');
    assert.equal(eve.readyState, 3);
    const oversized = await connect('Eve', 'e');
    await room.webSocketMessage(oversized, 'x'.repeat(8193));
    assert.equal(oversized.readyState, 3, 'oversized messages fail closed');
    const worker = (await import('../../cloudflare/party-coordination/worker.mjs')).default;
    assert.equal((await worker.fetch(new Request('https://relay/party/health'), {})).status, 200);
    assert.equal((await worker.fetch(new Request('https://relay/unrelated'), {})).status, 404);
    const routes = [];
    const env = { PARTIES: { idFromName: key => { routes.push(key); return key; },
        get: () => ({ fetch: async () => new Response('test') }) } };
    const request = new Request('https://relay/party/connect?leader=Alice&network=hypixel:25565', {
        headers: { Upgrade: 'websocket' } });
    await worker.fetch(request, env);
    assert.deepEqual(routes, ['hypixel:25565:alice']);
    console.log('Coordination relay identity, mutual roster, hibernation and expiry tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
