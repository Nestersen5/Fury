'use strict';

// Production proxy, 1.8.9 packets and writer, with a loopback upstream and
// synthetic profiles. No saved accounts, API keys or live storage are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scenario(apiAvailable) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-session-protocol-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0, proxyDirectPort: direct,
        proxyFailoverPort: failover, healthPort: health, proxyDirectHost: '127.0.0.1', proxyFailoverHost: '127.0.0.1' }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: !apiAvailable,
        autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, tabStatsEnabled: false,
        nametagOverlayEnabled: false, autoScanOnGameStart: false }));
    const preload = path.join(directory, 'fixture.cjs');
    const resolve = name => JSON.stringify(require.resolve(name));
    fs.writeFileSync(preload, `
const mc = require(${resolve('minecraft-protocol')});
const server = mc.createServer, client = mc.createClient;
let owner;
mc.createServer = options => { const s = server({...options,host:'127.0.0.1','online-mode':false});
    s.on('login', c => { owner = {uuid:c.uuid,name:c.username}; }); return s; };
mc.createClient = options => client({...options,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${resolve('../../src/accounts/connectionAuth')}).hasSavedLogin = () => true;
const h = require(${resolve('../../features/hypixel_api_client')}); const create = h.createHypixelApiClient;
h.createHypixelApiClient = options => ({...create(options),hasHypixelApiKeyConfigured:()=>${apiAvailable}});
require(${resolve('../../src/stats/fetch')}).createStatsFetch = () => ({getPlayerData:async name => ({data:{
    uuid:owner?.uuid,displayname:name,stats:{Duels:{wins:10,losses:5,kills:20,deaths:5}}}})});
`);
    const env = cleanEnvironment(directory, root, cosmetic, blocked);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort,
        'online-mode': false, version: '1.8.9', keepAlive: false });
    let peer, player, child;
    upstream.on('login', c => {
        peer = c; c.on('error', () => {});
        c.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        c.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
        c.write('player_info', { action: 'add_player', data: [{ uuid: c.uuid, name: 'SessionTester',
            properties: [], gamemode: 0, ping: 1, displayName: null }] });
        c.write('scoreboard_objective', { name: 'duels', action: 0, displayText: 'DUELS', type: 'integer' });
        c.write('scoreboard_display_objective', { name: 'duels', position: 1 });
        c.write('scoreboard_score', { itemName: 'Mode: Classic Duel', action: 0, scoreName: 'duels', value: 2 });
    });
    const chat = text => peer.write('chat', { message: JSON.stringify({ text }), position: 0 });
    const read = () => JSON.parse(fs.readFileSync(path.join(directory, 'session_data.json'), 'utf8'));
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Session protocol fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Proxy startup');
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'SessionTester',
            auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', () => {});
        await eventually(() => assert(peer), 'Upstream login');
        // Chat and title results both exercise the real packet dispatcher.
        for (let round = 1; round <= 2; round++) {
            chat('Opponent: Rival');
            await delay(150);
            chat('Rival was killed by SessionTester.');
            if (round === 1) chat('VICTORY!');
            else peer.write('title', { action: 0, text: JSON.stringify({ text: 'VICTORY!' }) });
            peer.write('title', { action: 0, text: JSON.stringify({ text: 'VICTORY!' }) });
            await eventually(() => {
                assertRunning(child);
                const sessions = read().sessions;
                const games = sessions.flatMap(s => s.games);
                assert.equal(games.length, round);
                assert(games.every(g => g.mode === 'DUELS' && g.result === 'win'));
                assert(games.every(g => g.localModes[0].kills === 1));
                assert.equal(sessions[0].trackingSource, apiAvailable ? 'api' : 'local');
            }, 'Saving short Duel ' + round, 5000);
        }
        chat('Opponent: Rival'); await delay(150);
        chat('Rival was killed by SessionTester.'); await delay(1100);
        peer.write('scoreboard_score', { itemName: 'Mode: Classic Duel', action: 1, scoreName: 'duels' });
        await delay(150);
        player.end();
        await eventually(() => {
            assertRunning(child);
            const games = read().sessions.flatMap(s => s.games);
            assert.equal(games.length, 3, 'Ordinary disconnect preserves a pending end');
            assert.equal(games[2].localModes[0].kills, 1);
        }, 'Preserving the departure before delayed capture');
        console.log(`PASS production session packets, duplicate titles, immediate disk save and ordinary disconnect (API ${apiAvailable})`);
    } catch (error) {
        console.error(child?.output);
        throw error;
    } finally {
        player?.end(); peer?.end(); player?.socket?.destroy(); peer?.socket?.destroy(); upstream.close();
        await stopChild(child);
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

(async () => { await scenario(true); await scenario(false); })().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
