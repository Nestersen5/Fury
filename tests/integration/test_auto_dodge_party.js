'use strict';

// Exercise party protection through the real proxy and command lane, with
// loopback Minecraft sockets and isolated settings rather than live accounts.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-auto-dodge-party-'));
    const [directPort, failoverPort, healthPort, upstreamPort, cosmeticPort, blockedPort] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({
        proxyDirectHost: '127.0.0.1', proxyDirectPort: directPort,
        proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failoverPort, healthPort
    }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({
        apiKillSwitchEnabled: true, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false,
        autoDodgeEnabled: true, autoDodgeDelaySeconds: 1, autoDodgeTaggedPlayers: true,
        pregameChatStatsEnabled: true, queueTimePartyChatEnabled: false
    }));
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const mc = require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => createClient({ ...options, host: '127.0.0.1', port: ${upstreamPort}, auth: 'offline' });
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin = () => true;
require(${JSON.stringify(path.join(root, 'src/stats/fetch.js'))}).createStatsFetch = () => ({
    getPlayerData: async name => ({ fromCache: true, data: { player: { displayname: name,
        achievements: { bedwars_level: 1980 }, stats: { Bedwars: { final_kills_bedwars: 1353, final_deaths_bedwars: 100 } } },
        urchin: { tag: 'Replays' }, seraph: {}, status: '' } })
});
`);
    const env = cleanEnvironment(directory, root, cosmeticPort, blockedPort);
    env.FURY_ENABLE_DIAGNOSTICS = '0';
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    const commands = [], messages = [], errors = [];
    let child, player, upstreamClient;
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', client => {
        upstreamClient = client;
        client.on('error', error => errors.push(error.message));
        client.on('chat', packet => commands.push(packet.message));
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 16, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
        client.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        client.write('scoreboard_display_objective', { name: 'bedwars', position: 1 });
        ['Map: Lighthouse', 'Players: 16/16', 'Mode: 4v4v4v4', 'Waiting...'].forEach((itemName, value) => {
            client.write('scoreboard_score', { itemName, action: 0, scoreName: 'bedwars', value });
        });
    });
    const chat = text => upstreamClient.write('chat', { message: JSON.stringify({ text }), position: 0 });
    const roster = () => {
        chat('Party Members');
        chat('Party Leader: [MVP++] Nestersen ●');
        chat('Party Members: [MVP++] fyechris ●');
    };
    const leaves = () => commands.filter(command => command === '/l').length;
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Auto-dodge party proxy fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${healthPort}/health`)).ok); }, 'Starting isolated proxy');
        player = mc.createClient({ host: '127.0.0.1', port: directPort, username: 'Nestersen', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('chat', packet => messages.push(packet.message));
        await eventually(async () => assert(upstreamClient), 'Connecting fixture player');
        await delay(300);

        // On a fresh connection inParty=false means unknown, not confirmed
        // solo. Reproduce the tagged teammate from the user's screenshot.
        chat('[MVP++] fyechris: algum br');
        await eventually(async () => assert(messages.some(message => message.includes('Pregame') && message.includes('fyechris'))), 'Looking up tagged player before party confirmation');
        await delay(1400);
        assert.strictEqual(leaves(), 0, 'An unknown roster must not allow dodging fyechris');
        assert(!messages.some(message => message.includes('Dodge') && message.includes('fyechris')), 'Unknown party state must not schedule a leave');
        assert(commands.includes('/p list'), 'Unknown party state requests confirmation through the existing command queue');

        roster();
        await delay(700); // complete the tracker's multipart /p list response
        chat('[MVP++] LateMate: hello');
        await eventually(async () => assert(messages.some(message => message.includes('matched auto-dodge') && message.includes('LateMate'))), 'Scheduling a current non-party player');
        chat('[MVP++] LateMate joined the party.');
        await delay(1400);
        assert.strictEqual(leaves(), 0, 'A member joining during the dodge delay must cancel the leave');

        chat('[MVP++] Opponent: hello');
        await eventually(async () => assert.strictEqual(leaves(), 1), 'Dodging a tagged opponent with a confirmed roster');
        assert(messages.some(message => message.includes('Leaving lobby') && message.includes('Opponent')));
        assert.deepStrictEqual(errors, []);
        console.log('Auto-dodge party integration passed: unknown roster, tagged teammate, late party join, and tagged opponent.');
    } finally {
        player?.end();
        upstreamClient?.end();
        player?.socket?.destroy();
        upstreamClient?.socket?.destroy();
        upstream.close();
        await stopChild(child);
        if (child) fs.writeFileSync(path.join(directory, 'proxy.log'), child.output);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
