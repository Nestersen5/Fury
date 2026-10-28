'use strict';
const assert = require('assert/strict');
const { EventEmitter } = require('events');
const { createPartyCoordination } = require('../../src/party/coordinationClient');
const { relayUrl, observation, rosterKeys, networkKey } = require('../../src/party/coordinationProtocol');
const { createPartyArrivalCheck } = require('../../src/party/arrivalCheck');
const { joinCoordinationChallenge } = require('../../src/party/coordinationAuth');

const alice = 'a'.repeat(32), bob = 'b'.repeat(32);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function clock() {
    let time = 1000, id = 0;
    const timers = new Map();
    return { now: () => time, timers,
        set: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
        clear: id => timers.delete(id),
        async advance(ms) {
            const end = time + ms;
            while (true) {
                const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (!entry || entry[1].at > end) break;
                time = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await flush();
            }
            time = end; await flush();
        }
    };
}
function fixture(options = {}) {
    const time = clock(), sockets = [], sent = [];
    let changes = 0, authSignal;
    const client = createPartyCoordination({ network: 'mc.hypixel.net:25565',
        endpoint: new URL('ws://127.0.0.1/party/connect'),
        getSession: () => ({ accessToken: 'synthetic-secret', selectedProfile: { id: alice, name: 'Alice' } }),
        now: time.now, setTimer: time.set, clearTimer: time.clear,
        onChange: () => changes++,
        createSocket: url => {
            const socket = new EventEmitter(); socket.readyState = 1; socket.bufferedAmount = 0;
            socket.url = url; socket.send = raw => sent.push(JSON.parse(raw));
            socket.terminate = () => { socket.readyState = 3; socket.emit('close'); };
            sockets.push(socket); return socket;
        },
        authenticate: async (_session, _challenge, signal) => { authSignal = signal; },
        ...options
    });
    const state = { enabled: true, leader: 'Alice', members: ['Bob', 'Charlie'],
        phase: 'pregame', serverId: 'mini1A', generation: '1:1' };
    const receive = async (message, socket = sockets.at(-1)) => {
        socket.emit('message', Buffer.from(JSON.stringify({ v: 1, ...message })), false); await flush();
    };
    async function ready(capabilities) {
        await receive({ type: 'challenge', challenge: '1'.repeat(40) });
        await receive({ type: 'ready', capabilities });
    }
    const probe = () => sent.filter(x => x.type === 'probe').at(-1).id;
    const peer = async (seq, serverId, extra = {}) => receive({ type: 'peer', id: probe(),
        name: 'Bob', uuid: bob, observation: { phase: 'pregame', generation: '2:1',
            seq, stableMs: 1500, serverId, ...extra } });
    return { client, time, sockets, sent, state, receive, ready, probe, peer,
        changes: () => changes, signal: () => authSignal };
}

(async () => {
    {
        const shared = [];
        const f = fixture({ onNicknameShared: value => shared.push(value) });
        const claim = { nick: 'AliceNick', id: '1'.repeat(24), serverId: 'mini1A', mode: 'SKYWARS', receive: true };
        const state = { ...f.state, phase: 'other', serverId: null, nickname: claim };
        f.client.update(state); await f.ready(['nicknames-v1']);
        assert.deepEqual(f.sent.find(x => x.type === 'state').nickname, claim);
        await f.receive({ type: 'peer', id: f.probe(), name: 'Bob', uuid: bob,
            observation: { phase: 'other', serverId: null, generation: 'bob:1', seq: 1, stableMs: 1500 },
            nickname: { ...claim, nick: 'BobNick', id: '2'.repeat(24) } });
        await f.time.advance(1500);
        const peer = f.client.nicknameEvidence()[0];
        assert.equal(peer.nick, 'BobNick');
        assert(f.client.acknowledgeNickname(peer));
        assert.equal(f.sent.at(-1).type, 'nick_saved');
        await f.receive({ type: 'nick_saved', id: claim.id, name: 'Bob', uuid: bob });
        await f.receive({ type: 'nick_saved', id: claim.id, name: 'Bob', uuid: bob });
        assert.equal(shared.length, 1, 'sender notice only once per accepted claim and peer');
        f.client.update({ ...state, nickname: { ...claim, nick: 'NewNick', id: '3'.repeat(24) } });
        await f.receive({ type: 'nick_saved', id: claim.id, name: 'Charlie', uuid: 'c'.repeat(32) });
        assert.equal(shared.length, 1, 'old nickname acknowledgement ignored');
        f.client.update({ ...state, nickname: { ...claim, receive: false } });
        assert.deepEqual(f.client.nicknameEvidence(), [], 'receive toggle gates all received claims');
        f.client.update({ ...state, generation: 'new-world', nickname: { ...claim, serverId: 'mini9A' } });
        assert.deepEqual(f.client.nicknameEvidence(), [], 'world changes invalidate claims');
        f.client.close();
    }
    {
        const f = fixture();
        f.client.update({ ...f.state, nickname: { nick: 'AliceNick', id: '1'.repeat(24), serverId: 'mini1A', mode: 'BEDWARS', receive: true } });
        await f.ready();
        assert(!('nickname' in f.sent.find(x => x.type === 'state')), 'old relays receive the original wire format');
        assert.deepEqual(f.client.nicknameEvidence(), []);
        f.client.close();
    }
    const originalFetch = global.fetch;
    const requests = [];
    try {
        global.fetch = async (url, options) => { requests.push({ url, options }); return { status: 204 }; };
        const session = { accessToken: 'synthetic-local-token', selectedProfile: { id: alice, name: 'Alice' } };
        await assert.rejects(joinCoordinationChallenge(session, 'invalid'), /identity unavailable/);
        assert.equal(requests.length, 0, 'invalid relay challenges cannot initiate account requests');
        await joinCoordinationChallenge(session, '1'.repeat(40));
        assert.equal(requests[0].url, 'https://sessionserver.mojang.com/session/minecraft/join');
        assert.equal(requests[0].options.redirect, 'error', 'credentials cannot follow a redirect');
        assert.equal(JSON.parse(requests[0].options.body).selectedProfile, alice);
        global.fetch = async () => ({ status: 403 });
        await assert.rejects(joinCoordinationChallenge(session, '1'.repeat(40)), /authentication unavailable/);
    } finally { global.fetch = originalFetch; }
    assert.equal(relayUrl({ FURY_PARTY_RELAY_URL: '' }), null);
    assert.equal(relayUrl({ FURY_PARTY_RELAY_URL: 'ws://example.com' }), null);
    assert.equal(relayUrl({ FURY_PARTY_RELAY_URL: 'wss://user:pass@example.com' }), null);
    assert(relayUrl({ FURY_PARTY_RELAY_URL: 'ws://[::1]:1234/party/connect' }));
    assert.equal(rosterKeys(Array(101).fill('Bob')), null);
    assert.equal(observation({ phase: 'pregame', seq: Infinity }), null);
    assert.equal(networkKey('mc.hypixel.net', 25565), networkKey('hypixel.fast', 25565));
    assert.notEqual(networkKey('example.com', 25565), networkKey('mc.hypixel.net', 25565));
    {
        const f = fixture(); f.client.update(f.state); await f.ready();
        assert.equal(f.client.getStatus(), 'connected');
        assert(!JSON.stringify(f.sent).includes('synthetic-secret'));
        assert.equal(f.client.evidence('Bob').status, 'pending');
        await f.peer(1, 'mini1A'); await f.time.advance(1500);
        assert.equal(f.client.evidence('Bob').status, 'same');
        await f.peer(2, 'mini2A'); assert.equal(f.client.evidence('Bob').status, 'pending');
        await f.time.advance(500); await f.peer(3, 'mini2A');
        assert.equal(f.client.evidence('Bob').status, 'different');
        await f.peer(2, 'mini1A'); assert.equal(f.client.evidence('Bob').status, 'different', 'old sequence rejected');
        await f.time.advance(501); assert.equal(f.client.evidence('Charlie'), null, 'non-Fury member falls back');
        const oldProbe = f.probe();
        f.client.update({ ...f.state, generation: '2:2', serverId: 'mini3A' });
        await f.receive({ type: 'peer', id: oldProbe, name: 'Bob', uuid: bob,
            observation: { phase: 'pregame', generation: '2:1', serverId: 'mini2A', stableMs: 1500, seq: 4 } });
        assert.equal(f.client.evidence('Bob').status, 'pending', 'previous lobby response rejected');
        await f.peer(5, 'mini3A'); await f.time.advance(1500);
        assert.equal(f.client.evidence('Bob').status, 'same');
        const changes = f.changes();
        await f.time.advance(15000);
        assert.equal(f.client.evidence('Bob'), null, 'silent peers expire');
        assert(f.changes() > changes, 'expiry wakes a successful checker');
        f.sockets.at(-1).emit('close');
        assert.equal(f.client.evidence('Bob'), null, 'outage falls back immediately');
        f.client.close(); assert.equal(f.time.timers.size, 0);
        assert(f.signal().aborted); await f.time.advance(60000); assert.equal(f.sockets.length, 1);
    }
    {
        const f = fixture(); f.client.update({ ...f.state, enabled: false });
        assert.equal(f.sockets.length, 0);
        f.client.update(f.state); await f.ready();
        f.client.update({ ...f.state, leader: 'Bob' });
        assert.equal(f.sockets.length, 2); assert.equal(f.sockets[0].readyState, 3);
        await f.receive({ type: 'ready' }, f.sockets[0]);
        assert.equal(f.client.getStatus(), 'connecting', 'old connection cannot become ready');
        f.client.update({ ...f.state, members: [] }); assert.equal(f.time.timers.size, 0);
        f.client.close();
    }
    {
        let identity = { accessToken: 'synthetic', selectedProfile: { id: alice, name: 'Alice' } };
        const f = fixture({ getSession: () => identity });
        f.client.update(f.state); await f.ready();
        const sent = f.sent.length;
        f.client.update({ ...f.state }); assert.equal(f.sent.length, sent, 'unchanged state is not republished');
        identity = { accessToken: 'synthetic', selectedProfile: { id: 'c'.repeat(32), name: 'Carol' } };
        f.client.update({ ...f.state });
        assert.equal(f.sockets[0].readyState, 3, 'account changes close the old identity scope');
        assert.equal(f.sockets.length, 2); assert.equal(f.client.evidence('Bob'), null);
        f.client.close();
    }
    {
        const f = fixture(); f.client.update(f.state);
        await f.time.advance(12000); assert.equal(f.sockets[0].readyState, 3, 'handshake timeout');
        await f.time.advance(1000); assert.equal(f.sockets.length, 2);
        f.client.close();
    }
    {
        const f = fixture(); f.client.update(f.state); await f.ready();
        await f.peer(1, 'mini9A'); await f.time.advance(1500); await f.peer(2, 'mini9A');
        f.client.update({ ...f.state, phase: 'transfer', serverId: null, generation: '2:1' });
        assert.equal(f.client.evidence('Bob'), null, 'transfer clears previous lobby comparison');
        f.client.close();
    }
    // Mixed party: coordinated success overrides unknown nick evidence;
    // confirmed mismatch overrides a misleading local name; only Charlie
    // falls back. A dismissed checker stays dismissed through peer updates.
    {
        const time = clock(), messages = [], sounds = [], evidence = new Map([
            ['Bob', { status: 'same' }], ['David', { status: 'different' }]
        ]);
        const checker = createPartyArrivalCheck({ getMembers: () => ['Bob', 'Charlie', 'David'],
            getKnownDenick: () => null, isOwnName: () => false,
            getVisibleNames: () => ['David'], getCoordination: name => evidence.get(name),
            hasCoordination: () => true, sendChat: value => messages.push(value), playSound: () => sounds.push(1),
            setTimer: time.set, clearTimer: time.clear });
        checker.enter(); checker.refresh(); await time.advance(1000);
        assert(messages[0].includes('PARTY SPLIT DETECTED'));
        assert(messages[1].includes('David')); assert(messages[2].includes('Charlie'));
        assert(!JSON.stringify(messages).includes('Bob'));
        evidence.set('David', { status: 'same' }); checker.observeChatLine('Charlie has joined (4/16)!');
        assert(messages.at(-1).includes('all current party members'));
        checker.stop(); evidence.set('Bob', { status: 'different' }); checker.refresh();
        await time.advance(10000); assert.equal(sounds.length, 1);
    }
    {
        const time = clock(); let traversals = 0;
        const checker = createPartyArrivalCheck({ getMembers: () => ['Bob'], getKnownDenick: () => null,
            isOwnName: () => false, getCoordination: () => ({ status: 'same' }),
            getVisibleNames: () => { traversals++; return []; }, sendChat: () => {}, playSound: () => {},
            setTimer: time.set, clearTimer: time.clear });
        checker.enter(); checker.observeChatLine('Self has joined (2/16)!'); await time.advance(1000);
        assert.equal(traversals, 0, 'fully coordinated checks skip local player scans'); checker.stop();
    }
    {
        const time = clock(), messages = [];
        let status = { status: 'pending' };
        const checker = createPartyArrivalCheck({ getMembers: () => ['Bob'], getKnownDenick: () => null,
            isOwnName: () => false, getCoordination: () => status, hasCoordination: () => true,
            sendChat: value => messages.push(value), playSound: () => {}, setTimer: time.set, clearTimer: time.clear });
        checker.enter(); checker.refresh(); await time.advance(1000); assert.equal(messages.length, 0);
        status = null; checker.refresh(); await time.advance(2500);
        assert(messages[0].includes('POSSIBLE PARTY SPLIT')); checker.stop();
    }
    console.log('Party coordination client and mixed-party warning tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
