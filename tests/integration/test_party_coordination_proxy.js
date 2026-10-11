'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mc = require('minecraft-protocol');
const { WebSocketServer } = require('ws');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-party-coordination-proxy-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked, relayPort] = await unusedPorts(7);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({
        proxyDirectHost: '127.0.0.1', proxyDirectPort: direct,
        proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health
    }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({
        apiKillSwitchEnabled: false, autoSkinDenickEnabled: false,
        autoStatsDenickEnabled: false, pregameChatStatsEnabled: false, sessionTrackingEnabled: false
    }));
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const mc = require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => {
    const client = createClient({ ...options, host: '127.0.0.1', port: ${upstreamPort}, auth: 'offline' });
    client.once('login', () => { client.session = { accessToken: 'synthetic', selectedProfile: { name: 'Alice', id: 'a'.repeat(32) } }; });
    return client;
};
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin = () => true;
require(${JSON.stringify(path.join(root, 'src/party/coordinationAuth.js'))}).joinCoordinationChallenge = async () => {};
// Fail all external statistics requests locally rather than reading real data.
require(${JSON.stringify(require.resolve('axios'))}).defaults.adapter = async () => { throw new Error('Offline fixture'); };
`);
    const env = cleanEnvironment(directory, root, cosmetic, blocked);
    env.FURY_PARTY_RELAY_URL = `ws://127.0.0.1:${relayPort}/party/connect`;
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort,
        'online-mode': false, version: '1.8.9', keepAlive: false });
    const relay = new WebSocketServer({ host: '127.0.0.1', port: relayPort });
    const publications = [], messages = [], errors = [];
    let peerSequence = 0, child, player, serverClient, positioned = false;
    relay.on('connection', ws => {
        ws.on('error', error => errors.push(error.message));
        ws.send(JSON.stringify({ v: 1, type: 'challenge', challenge: '1'.repeat(40) }));
        ws.on('message', raw => {
            const message = JSON.parse(String(raw));
            assert(!String(raw).includes('synthetic'), 'credentials must never reach relay');
            if (message.type === 'authenticate') ws.send(JSON.stringify({ v: 1, type: 'ready' }));
            if (message.type === 'state') publications.push(message.observation);
            if (message.type === 'probe' && message.names.includes('bob')) ws.send(JSON.stringify({
                v: 1, type: 'peer', id: message.id, name: 'Bob', uuid: 'b'.repeat(32),
                observation: { phase: 'pregame', serverId: 'mini2A', generation: '1:1',
                    seq: ++peerSequence, stableMs: 1500 }
            }));
        });
    });
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', connection => {
        serverClient = connection; connection.on('error', error => errors.push(error.message));
        connection.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        connection.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    const chat = text => serverClient.write('chat', { message: JSON.stringify({ text }), position: 0 });
    const score = (text, value) => serverClient.write('scoreboard_score', {
        itemName: text, action: 0, scoreName: 'bedwars', value
    });
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Coordinated party proxy fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Starting proxy');
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'Alice',
            auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('position', () => { positioned = true; });
        player.on('chat', data => messages.push(data.message));
        await eventually(async () => { assertRunning(child); assert(positioned); }, 'Connecting player');
        chat('Party Leader: Alice'); chat('Party Members: Bob');
        await eventually(async () => { assertRunning(child); assert(publications.length); }, 'Confirming roster and relay authentication');
        serverClient.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        serverClient.write('scoreboard_display_objective', { position: 1, name: 'bedwars' });
        score('Map: Airshow', 4); score('Mode: Doubles', 3); score('Players: 2/16', 2); score('Waiting...', 1);
        await eventually(async () => assert(publications.some(x => x.phase === 'transfer')), 'Pregame without a fresh ID');
        assert(!publications.some(x => x.phase === 'pregame'));
        // Actual Hypixel sidebar ID is reconstructed from team prefix/suffix.
        serverClient.write('scoreboard_team', { team: 'date', mode: 0, name: 'date',
            prefix: '10/07/26 ', suffix: 'mini1A', friendlyFire: 0, nameTagVisibility: 'always', color: -1, players: ['\u{1F525}'] });
        score('\u{1F525}', 5);
        await eventually(async () => { assertRunning(child); assert(publications.some(x => x.serverId === 'mini1A')); }, 'Fresh sidebar ID');
        await eventually(async () => assert(messages.some(x => x.includes('PARTY SPLIT DETECTED'))), 'Coordinated split warning without join announcements');
        assert(messages.some(x => x.includes('Different pregame server') && x.includes('Bob')));
        const boundary = publications.length;
        serverClient.write('respawn', { dimension: 0, difficulty: 1, gamemode: 0, levelType: 'default' });
        await eventually(async () => assert(publications.slice(boundary).some(x => x.phase === 'transfer' && x.serverId === null)), 'World transfer invalidation');
        // A countdown change must not revalidate the old world's lingering date.
        score('Waiting...', 1);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert(!publications.slice(boundary).some(x => x.phase === 'pregame'));
        player.write('chat', { message: '/apikill on' });
        await eventually(async () => assert.equal(relay.clients.size, 0), 'API kill switch closes relay');
        assert.deepEqual(errors, []);
        console.log('Production proxy roster, sidebar-ID gate, split warning, transfer and kill switch passed.');
    } finally {
        player?.end(); serverClient?.end(); player?.socket?.destroy(); serverClient?.socket?.destroy();
        if (child) await stopChild(child);
        for (const ws of relay.clients) ws.terminate();
        await new Promise(resolve => relay.close(resolve));
        upstream.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
