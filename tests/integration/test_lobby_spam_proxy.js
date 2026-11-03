'use strict';

// Real production proxy and Minecraft 1.8.9 sockets, isolated data, no Hypixel.
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const mc = require('minecraft-protocol');
const { extractText } = require('../../features/minecraft_chat');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-lobby-spam-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0,
        proxyDirectHost: '127.0.0.1', proxyDirectPort: direct, proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health }));
    const featureFile = path.join(directory, 'features_config.json');
    let features = { lobbySpamEnabled: true, lobbySpamSensitivity: 'balanced', apiKillSwitchEnabled: true,
        tabStatsEnabled: false, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false,
        pregameChatStatsEnabled: false, lobbyChatStatsEnabled: false, sessionTrackingEnabled: false };
    fs.writeFileSync(featureFile, JSON.stringify(features));
    const preload = path.join(directory, 'fixture.cjs');
    fs.writeFileSync(preload, `const mc=require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const server=mc.createServer,client=mc.createClient;
mc.createServer=o=>server({...o,host:'127.0.0.1','online-mode':false});
mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin=()=>true;
`);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    let child, player, peer, boardNumber = 0, marker = 0;
    const chat = [], sent = [], packets = [], errors = [];
    upstream.on('error', e => errors.push(e.message));
    upstream.on('login', connection => {
        peer = connection; connection.on('error', e => errors.push(e.message));
        connection.on('packet', (data, meta) => sent.push({ name: meta.name, data }));
        connection.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 80, levelType: 'default', reducedDebugInfo: false });
        connection.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    const write = (text, position = 0) => peer.write('chat', { message: JSON.stringify(typeof text === 'string' ? { text } : text), position });
    const barrier = async () => {
        const text = `boundary-${++marker}`; write(text, 1);
        await eventually(() => assert(chat.some(row => extractText(row) === text)), text);
    };
    const healthState = () => getJson(`http://127.0.0.1:${health}/health`);
    const post = async (endpoint, body) => {
        const res = await fetch(`http://127.0.0.1:${health}${endpoint}`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
    };
    const board = async (title, id, extra = []) => {
        const objective = `board${++boardNumber}`;
        peer.write('scoreboard_objective', { name: objective, action: 0, displayText: title, type: 'integer' });
        peer.write('scoreboard_display_objective', { position: 1, name: objective });
        const entry = '😀§r';
        peer.write('scoreboard_team', { team: objective, mode: 0, name: objective, prefix: '§711/02/26 §8', suffix: id,
            friendlyFire: 0, nameTagVisibility: 'always', color: -1, players: [entry] });
        [entry, ...extra].forEach((line, i) => peer.write('scoreboard_score', { itemName: line, action: 0, scoreName: objective, value: 15 - i }));
        peer.write('player_info', { action: 'add_player', data: [{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Spammer',
            properties: [], gamemode: 0, ping: 25, displayName: null }] });
        await barrier();
    };
    const spam = async (count = 3, text = 'Join my party for doubles!') => {
        const start = chat.length;
        for (let i = 0; i < count; i++) write({ text: `[MVP+] Spammer: ${text}`, color: 'green',
            clickEvent: { action: 'suggest_command', value: '/msg Spammer ' } });
        await barrier(); return chat.slice(start).filter(row => extractText(row).includes(text));
    };
    const buttons = rows => rows.flatMap(row => row.extra || []).filter(part => part.text === ' [Mute]');
    const connect = async () => {
        const before = packets.length; peer = null;
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'SpamTester', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', e => errors.push(e.message));
        player.on('packet', (data, meta) => { packets.push({ name: meta.name, data }); if (meta.name === 'chat') chat.push(JSON.parse(data.message)); });
        await eventually(() => assert(peer && packets.slice(before).some(row => row.name === 'position')), 'Connected player');
    };
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')],
            cleanEnvironment(directory, root, cosmetic, blocked), 'Lobby spam proxy');
        await eventually(async () => { assertRunning(child); assert((await healthState()).ok); }, 'Proxy startup');
        await connect();
        assert.equal(buttons(await spam()).length, 0, 'unknown location stays off');
        for (const [title, id, rows] of [['MAIN LOBBY', 'lobby12', []], ['BED WARS', 'L12A', ['Level: 123', 'Progress: 10%']],
            ['ARCADE GAMES', 'L14A', []], ['DUELS', 'L15A', []]]) {
            await board(title, id, rows);
            const messages = await spam(); assert.equal(messages.length, 3); assert.equal(buttons(messages).length, 1, title);
            assert.deepEqual(messages[2].extra[0].clickEvent, { action: 'suggest_command', value: '/msg Spammer ' });
            assert.equal(buttons(await spam()).length, 0, 'offer cooldown');
        }
        player.write('chat', { message: '/lobbyspam mute Spammer' });
        await eventually(async () => assert.equal((await healthState()).lobbySpam.mutedCount, 1), 'Local mute');
        assert.equal((await spam()).length, 0, 'muted packet is never resent by forwarding fallback');
        for (const text of ['Party > Spammer: party message', 'Guild > Spammer: guild message', 'From Spammer: private message', 'Notice: system message']) write(text);
        await barrier();
        for (const text of ['party message', 'guild message', 'private message', 'system message']) assert(chat.some(row => extractText(row).includes(text)));
        write('[MVP+] Spammer: action bar message', 2); await barrier();
        assert(chat.some(row => extractText(row).includes('action bar message')));

        for (const [title, id, rows] of [['BED WARS', 'mini12A', ['Map: Lighthouse', 'Mode: Doubles', 'Players: 8/16', 'Waiting...']],
            ['BED WARS', 'mini13A', ['Red: 2', 'Blue: 2']], ['ARCADE', 'mini14A', []], ['UNKNOWN', '???', []]]) {
            await board(title, id, rows); const messages = await spam(5);
            assert.equal(messages.length, 5, `${title} game/unknown chat is not muted`); assert.equal(buttons(messages).length, 0);
        }
        await board('MAIN LOBBY', 'lobby13'); assert.equal((await spam()).length, 0, 'mute survives lobby transitions');
        const state = await healthState(), sessionId = state.lobbySpam.sessionId;
        const account = { name: state.connectedAccount, uuid: state.connectedUuid };
        const manage = (action, overrides = {}) => post('/lobby-spam', { action, account, sessionId, ...overrides });
        assert.equal((await manage('list')).body.players[0], 'Spammer');
        assert.equal(state.lobbySpam.players, undefined, 'regular health has only compact mute summary');
        assert.equal((await manage('clear', { account: { name: 'OtherPlayer' } })).status, 409);
        assert.equal((await manage('clear', { sessionId: 'old-connection' })).status, 409);
        assert.equal((await manage('mute')).status, 400, 'launcher cannot invent mute requests');
        assert.equal((await manage('unmute', { name: 'Spammer' })).body.mutedCount, 0);
        assert.equal((await spam()).length, 3);
        player.write('chat', { message: '/lobbyspam mute Spammer' });
        await eventually(async () => assert.equal((await healthState()).lobbySpam.mutedCount, 1), 'Mute again');
        assert.equal((await manage('clear')).body.mutedCount, 0);

        // A world switch must close the gate even while the old lobby board lingers.
        peer.write('respawn', { dimension: -1, difficulty: 1, gamemode: 0, levelType: 'default' }); await barrier();
        assert.equal(buttons(await spam(5)).length, 0, 'old lobby ID cannot authorize a new world');
        await board('MAIN LOBBY', 'lobby14');
        features = { ...features, lobbySpamEnabled: false }; fs.writeFileSync(featureFile, JSON.stringify(features));
        await post('/settings-changed', { silent: true });
        await eventually(async () => assert.equal((await healthState()).features.lobbySpamEnabled, false), 'Live disable');
        assert.equal(buttons(await spam(5)).length, 0);
        features = { ...features, lobbySpamEnabled: true, lobbySpamSensitivity: 'low' }; fs.writeFileSync(featureFile, JSON.stringify(features));
        await post('/settings-changed', { silent: true });
        await eventually(async () => assert.equal((await healthState()).features.lobbySpamSensitivity, 'low'), 'Live sensitivity');
        assert.equal(buttons(await spam(4)).length, 0); assert.equal(buttons(await spam(1)).length, 1);
        player.write('chat', { message: '/lobbyspam mute Spammer' });
        await eventually(async () => assert.equal((await healthState()).lobbySpam.mutedCount, 1), 'Pre-disconnect mute');
        player.end(); player.socket.destroy();
        await eventually(async () => assert.equal((await healthState()).connectionReady, false), 'Disconnected');
        await connect(); await board('MAIN LOBBY', 'lobby15');
        const next = await healthState(); assert.notEqual(next.lobbySpam.sessionId, sessionId); assert.equal(next.lobbySpam.mutedCount, 0);
        assert.equal((await spam(1)).length, 1, 'reconnect shows previously muted player');
        assert(!sent.some(row => row.name === 'chat' && /^\/lobbyspam(?:\s|$)/i.test(row.data.message)), 'local commands never reach Hypixel');
        assert.deepEqual(errors, []);
        console.log('PASS lobby spam production proxy: all lobby kinds, cooldown, local mute/undo/list/clear, channels, pregame/games, transfer freshness, live settings, account/session isolation and disconnect reset.');
    } catch (error) {
        console.error({ recentChat: chat.slice(-12).map(extractText), output: child?.output.slice(-16000) }); throw error;
    } finally {
        player?.end(); player?.socket?.destroy(); peer?.end(); peer?.socket?.destroy(); upstream.close();
        if (child) await stopChild(child);
    }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
