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
    const publications = [], messages = [], errors = [], nicknamePublications = [];
    let lastNickname = null;
    let peerSequence = 0, child, player, serverClient, positioned = false;
    relay.on('connection', ws => {
        ws.on('error', error => errors.push(error.message));
        ws.send(JSON.stringify({ v: 1, type: 'challenge', challenge: '1'.repeat(40) }));
        ws.on('message', raw => {
            const message = JSON.parse(String(raw));
            assert(!String(raw).includes('synthetic'), 'credentials must never reach relay');
            if (message.type === 'authenticate') ws.send(JSON.stringify({ v: 1, type: 'ready', capabilities: ['nicknames-v1'] }));
            if (message.type === 'state') {
                publications.push(message.observation); lastNickname = message.nickname;
                if (message.nickname?.nick) {
                    nicknamePublications.push(message.nickname);
                    ws.send(JSON.stringify({ v: 1, type: 'nick_saved', id: message.nickname.id, name: 'Bob', uuid: 'b'.repeat(32) }));
                }
            }
            if (message.type === 'probe' && message.names.includes('bob')) ws.send(JSON.stringify({
                v: 1, type: 'peer', id: message.id, name: 'Bob', uuid: 'b'.repeat(32),
                observation: { phase: lastNickname ? 'other' : 'pregame', serverId: lastNickname ? null : 'mini2A', generation: '1:1',
                    seq: ++peerSequence, stableMs: 1500 },
                ...(lastNickname ? { nickname: { nick: 'BobNick', id: '2'.repeat(24), serverId: lastNickname.serverId, mode: lastNickname.mode, receive: true } } : {})
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
        player.write('chat', { message: '/denick self' });
        await eventually(async () => assert(messages.some(text => text.includes('Not checked yet.'))), 'Diagnostic before any own tab observation');
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
        serverClient.write('scoreboard_team', { team: 'date', mode: 2, name: 'date',
            prefix: '10/07/26 ', suffix: 'mini1A', friendlyFire: 0, nameTagVisibility: 'always', color: -1 });
        score('\u{1F525}', 5);
        serverClient.write('player_info', { action: 'add_player', data: [
            { uuid: 'a'.repeat(32), name: 'AliceNick', properties: [], gamemode: 0, ping: 0, displayName: null },
            { uuid: 'd'.repeat(32), name: 'BobNick', properties: [], gamemode: 0, ping: 0, displayName: null }
        ] });
        serverClient.write('scoreboard_team', { team: 'red', mode: 0, name: 'red', prefix: '§cR ', suffix: '',
            friendlyFire: 0, nameTagVisibility: 'always', color: 12, players: ['AliceNick', 'BobNick'] });
        chat('Protect your bed and destroy the enemy beds.');
        await eventually(async () => {
            assertRunning(child);
            assert(nicknamePublications.some(entry => entry.nick === 'AliceNick'));
            assert(messages.some(text => text.includes('Shared your nickname') && text.includes('Bob')));
            assert(messages.some(text => text.includes('Received') && text.includes('BobNick') && text.includes('saved it')));
        }, 'Own nickname sharing and received nickname saving');
        const savedNicks = JSON.parse(fs.readFileSync(path.join(directory, 'denicked.json')));
        assert(savedNicks.find(entry => entry.realIGN === 'Alice')?.nicks.includes('AliceNick'));
        assert(savedNicks.find(entry => entry.realIGN.toLowerCase() === 'bob')?.nicks.includes('BobNick'));
        const diagnosticStart = messages.length;
        player.write('chat', { message: '/denick self' });
        await eventually(async () => {
            const report = messages.slice(diagnosticStart);
            assert(report.some(text => text.includes('Current nickname:') && text.includes('AliceNick')));
            assert(report.some(text => text.includes('Saved nickname history:')));
            assert(report.some(text => text.includes('AliceNick') && !text.includes('BobNick')));
        }, 'Diagnostic after game detection shows own nickname and history');
        const notice = JSON.parse(messages.find(text => text.includes('Received') && text.includes('BobNick')));
        const undo = notice.extra.find(part => part.clickEvent?.value.includes('party undo')).clickEvent.value;
        player.write('chat', { message: undo });
        await eventually(async () => assert(messages.some(text => text.includes('Removed the saved match for'))), 'Shared nickname Undo');
        for (const command of ['autoteammates', 'sharednicks']) {
            player.write('chat', { message: `/denick ${command} off` });
        }
        await eventually(async () => {
            assert.equal(messages.filter(text => text.includes('always enabled')).length, 2);
            assert(messages.some(text => text.includes('[Turn off sharing]')));
        }, 'Legacy commands cannot disable nickname features');
        player.write('chat', { message: '/denick sharenick off' });
        await eventually(async () => assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'features_config.json'))).shareOwnNicknameEnabled, false), 'Chat sharing button persists off');
        serverClient.write('player_info', { action: 'add_player', data: [
            { uuid: 'a'.repeat(32), name: 'NewAliceNick', properties: [], gamemode: 0, ping: 0, displayName: null }
        ] });
        await eventually(async () => {
            const history = JSON.parse(fs.readFileSync(path.join(directory, 'denicked.json')));
            const self = history.find(entry => entry.realIGN === 'Alice');
            assert(self.nicks.includes('AliceNick') && self.nicks.includes('NewAliceNick'));
        }, 'Own nickname changes retain old names with sharing always enabled');
        assert(!nicknamePublications.some(entry => entry.nick === 'NewAliceNick'));
        player.write('chat', { message: '/denick sharenick on' });
        await eventually(async () => assert(nicknamePublications.some(entry => entry.nick === 'NewAliceNick')), 'Sharing resumes when enabled');
        player.write('chat', { message: '/apikill on' });
        await eventually(async () => assert.equal(relay.clients.size, 0), 'API kill switch closes relay');
        assert.deepEqual(errors, []);
        console.log('Production proxy split checks, private nickname history, sharing notices, received saving, Undo, always-on behavior and kill switch passed.');
    } catch (error) {
        console.error('Nickname fixture state:', { nicknamePublications, lastNickname, publications: publications.slice(-4), messages: messages.slice(-5), proxyOutput: child?.output });
        throw error;
    } finally {
        player?.end(); serverClient?.end(); player?.socket?.destroy(); serverClient?.socket?.destroy();
        if (child) await stopChild(child);
        for (const ws of relay.clients) ws.terminate();
        await new Promise(resolve => relay.close(resolve));
        upstream.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
