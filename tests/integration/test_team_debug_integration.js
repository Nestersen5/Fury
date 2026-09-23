'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

// Real proxy process + Minecraft protocol sockets, isolated data and loopback
// upstream. Only this fixture bypasses authentication; production paths stay intact.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const root = REPOSITORY_ROOT;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-team-debug-integration-'));
    const [directPort, failoverPort, healthPort, upstreamPort, cosmeticPort, blockedPort] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyDirectPort: directPort, proxyFailoverPort: failoverPort, healthPort, proxyDirectHost: '127.0.0.1', proxyFailoverHost: '127.0.0.1' }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, tabStatsEnabled: true, nametagOverlayEnabled: true,
        nametagTeammatesEnabled: true, nametagTeammatesPrefix: 'fkdr', nametagTeammatesSuffix: 'none',
        nametagOthersEnabled: true, nametagOthersPrefix: 'star', nametagOthersSuffix: 'none' }));
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const mc = require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => createClient({ ...options, host: '127.0.0.1', port: ${upstreamPort}, auth: 'offline' });
// The loopback fixture has no Microsoft cache; production authentication stays intact.
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin = () => true;
require(${JSON.stringify(path.join(root, 'src/stats/fetch.js'))}).createStatsFetch = () => ({
    getPlayerData: async name => ({ fromCache: true, data: { player: { displayname: name,
        stats: { Bedwars: { Experience: 250000, final_kills_bedwars: 20, final_deaths_bedwars: 10 } } }, urchin: {}, seraph: {}, status: '' } })
});
`);
    const env = cleanEnvironment(directory, root, cosmeticPort, blockedPort);
    env.FURY_ENABLE_DIAGNOSTICS = '0';
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    const receivedCommands = [], downstreamPackets = [], messages = [], errors = [], tabUpdates = new Map();
    let upstreamClient, player, child;
    const uuid = '11111111-1111-1111-1111-111111111111';
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', client => {
        upstreamClient = client;
        client.on('error', error => errors.push(error.message));
        client.on('chat', packet => receivedCommands.push(packet.message));
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
        client.write('player_info', { action: 'add_player', data: [{ uuid, name: 'Alice', properties: [], gamemode: 0, ping: 1, displayName: JSON.stringify({ text: 'Alice', color: 'red' }) }] });
        const reportPlayers = [
            { uuid: client.uuid, name: 'DebugObserver' },
            { uuid: '22222222-2222-2222-2222-222222222222', name: 'WhitePlayer' },
            { uuid: '33333333-3333-3333-3333-333333333333', name: 'GreenPlayer' },
            { uuid: '44444444-4444-4444-4444-444444444444', name: 'RedPlayer' },
            { uuid: '55555555-5555-5555-5555-555555555555', name: 'YellowPlayer' }
        ];
        client.write('player_info', { action: 'add_player', data: reportPlayers.map(p => ({ ...p, properties: [], gamemode: 0, ping: 1, displayName: null })) });
        const team = (name, color, prefix, players) => client.write('scoreboard_team', {
            team: name, mode: 0, name, prefix, suffix: '', friendlyFire: 0, nameTagVisibility: 'always', color, players
        });
        team('Red1', 12, '\u00a7cR ', ['Alice']);
        team('Blue1', 9, '\u00a79B ', []);
        team('Pink0', 15, '§lW §r§f', ['WhitePlayer']);
        team('Yellow0', 15, '§a§lG §r§a', ['DebugObserver']);
        team('Yellow11', 15, '§e§lY §r§e', ['YellowPlayer']);
        // Initially shares Yellow's registry entry, then must split out only
        // its own member when the server supplies the real Green prefix.
        team('Yellow2', 15, '', ['GreenPlayer']);
        client.write('scoreboard_team', { team: 'Yellow2', mode: 2, name: 'Yellow2', prefix: '§a§lG §r§a', suffix: '', friendlyFire: 3, nameTagVisibility: 'always', color: 15 });
        team('Blue10', 15, '§c§lR §r§c', ['RedPlayer']);
        client.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        client.write('scoreboard_display_objective', { name: 'bedwars', position: 1 });
        client.write('scoreboard_score', { itemName: 'Diamond II in 5:00', action: 0, scoreName: 'bedwars', value: 5 });
        client.write('scoreboard_team', { team: 'Blue1', mode: 3, players: ['Alice'] });
        client.write('scoreboard_team', { team: 'Red1', mode: 2, name: 'Red1', prefix: '\u00a7cR ', suffix: '', friendlyFire: 0, nameTagVisibility: 'always', color: 12 });
    });
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Team debug proxy fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${healthPort}/health`)).ok); }, 'Starting isolated proxy');
        player = mc.createClient({ host: '127.0.0.1', port: directPort, username: 'DebugObserver', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('packet', (data, meta) => {
            if (meta.name === 'scoreboard_team') downstreamPackets.push(data);
            if (meta.name === 'player_info' && data.action === 'update_display_name') {
                for (const row of data.data) if (row.displayName) tabUpdates.set(row.uuid, row.displayName);
            }
            if (meta.name === 'chat') messages.push(data.message);
        });
        await eventually(async () => { assertRunning(child); assert(downstreamPackets.some(packet => packet.team === 'Blue1' && packet.mode === 3)); }, 'Forwarding team packets');
        await delay(800);
        await eventually(async () => assert(tabUpdates.size >= 6), 'Rendering all fixture tab rows');
        // The real server temporarily replaces prefixes during invisibility.
        for (const [team, prefix] of [['Pink0', '§7'], ['Yellow2', ''], ['Yellow0', '§7']]) {
            upstreamClient.write('scoreboard_team', { team, mode: 2, name: team, prefix, suffix: '', friendlyFire: 3, nameTagVisibility: 'always', color: 15 });
        }
        await delay(800);
        player.write('chat', { message: '/teamdebug Alice Blue' });
        const reportDirectory = path.join(directory, 'diagnostics', 'teams');
        const file = await eventually(async () => {
            assertRunning(child);
            const name = fs.existsSync(reportDirectory) && fs.readdirSync(reportDirectory).find(name => name.endsWith('.json'));
            assert(name, messages.join('\n'));
            const file = path.join(reportDirectory, name);
            JSON.parse(fs.readFileSync(file, 'utf8'));
            return file;
        }, 'Saving command report', 10000);
        const report = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.strictEqual(report.annotation.player, 'Alice');
        assert.strictEqual(report.annotation.expectedTeam, 'Blue');
        assert.strictEqual(report.state.currentGamemode, 'BEDWARS');
        assert.strictEqual(report.state.gameActive, true);
        assert.strictEqual(report.state.players.find(row => row.name === 'Alice').rawTeam, 'Blue1');
        assert.strictEqual(report.state.players.find(row => row.name === 'Alice').resolvedTeam, 'Blue');
        for (const [name, expected] of [['WhitePlayer', 'White'], ['GreenPlayer', 'Green'], ['DebugObserver', 'Green'], ['RedPlayer', 'Red'], ['YellowPlayer', 'Yellow']]) {
            const row = report.state.players.find(row => row.name === name);
            assert.strictEqual(row?.resolvedTeam, expected, `${name}: resolver`);
            assert.strictEqual(row.cachedTeam, expected, `${name}: cached team`);
            assert.strictEqual(row.registryTeam, expected, `${name}: registry membership`);
            const tab = report.client.tab.find(entry => entry.uuid.replace(/-/g, '') === row.uuid.replace(/-/g, ''));
            const display = JSON.parse(tab.displayName);
            assert.strictEqual(display.extra[0].text.trim(), expected[0], `${name}: outgoing tab marker`);
        }
        assert.strictEqual(report.state.myTeam, 'Green');
        for (const [name, color] of [['WhitePlayer', 15], ['GreenPlayer', 10], ['RedPlayer', 12], ['YellowPlayer', 14]]) {
            const row = report.state.players.find(row => row.name === name);
            assert(row.nametag, `${name}: missing annotation`);
            const outgoing = report.client.teams.find(team => team.team === row.nametag.teamName);
            assert.strictEqual(outgoing?.color, color, `${name}: outgoing nametag color`);
        }
        assert(report.state.players.find(row => row.name === 'GreenPlayer').nametag.prefix.includes('2.00'), 'Green teammate uses the teammate settings');
        const green = report.state.registry.find(team => team.name === 'Green');
        const yellow = report.state.registry.find(team => team.name === 'Yellow');
        assert(green.players.includes('GreenPlayer') && green.players.includes('DebugObserver'));
        assert(!green.players.includes('YellowPlayer') && yellow.players.includes('YellowPlayer') && !yellow.players.includes('GreenPlayer'));
        assert(report.events.some(event => event.direction === 'server' && event.packet?.team === 'Red1'));
        assert(report.events.some(event => event.direction === 'client' && event.name === 'player_info'));
        assert.strictEqual(new Map(report.server.entries).get('Alice'), 'Blue1');
        await eventually(async () => assert(messages.some(message => message.includes('Report saved'))), 'Reporting saved path');
        assert(!receivedCommands.some(command => command.startsWith('/teamdebug')), 'Diagnostic command must not be sent upstream');
        // A true team change must win over previous prefix evidence, and an
        // old teammate's update must not pull that player back into its group.
        for (const [team, prefix] of [['Yellow2', '§c§lR §r§c'], ['Yellow0', '§a§lG §r§a']]) {
            upstreamClient.write('scoreboard_team', { team, mode: 2, name: team, prefix, suffix: '', friendlyFire: 3, nameTagVisibility: 'always', color: 15 });
        }
        upstreamClient.write('scoreboard_team', { team: 'Blue10', mode: 1 });
        for (const [team, name] of [['Blue10', 'RedPlayer'], ['Pink0', 'WhitePlayer']]) {
            upstreamClient.write('scoreboard_team', { team, mode: 0, name: team, prefix: '§7', suffix: '', friendlyFire: 3, nameTagVisibility: 'always', color: 15, players: [name] });
        }
        await delay(5200);
        player.write('chat', { message: '/teamdebug GreenPlayer Red' });
        const changedFile = await eventually(async () => {
            const files = fs.readdirSync(reportDirectory).filter(name => name.endsWith('.json'));
            assert.strictEqual(files.length, 2);
            return path.join(reportDirectory, files.sort().at(-1));
        }, 'Saving changed-team report');
        const changed = JSON.parse(fs.readFileSync(changedFile, 'utf8'));
        for (const [name, expected] of [['GreenPlayer', 'Red'], ['DebugObserver', 'Green'], ['RedPlayer', 'Blue'], ['WhitePlayer', 'Pink'], ['YellowPlayer', 'Yellow']]) {
            const row = changed.state.players.find(row => row.name === name);
            assert.strictEqual(row?.resolvedTeam, expected, `${name}: move/recreate team`);
            assert.strictEqual(row.cachedTeam, expected, `${name}: move/recreate cached team`);
            assert.strictEqual(row.registryTeam, expected, `${name}: move/recreate registry`);
        }
        assert.strictEqual(changed.state.myTeam, 'Green');
        assert(!changed.state.registry.find(team => team.name === 'Green').players.includes('GreenPlayer'));
        assert.strictEqual(changed.client.teams.find(team => team.team === changed.state.players.find(row => row.name === 'GreenPlayer').nametag.teamName).color, 12);
        assert.deepStrictEqual(errors, []);
        console.log(`Team debug integration passed: report mismatches, tab/nametag colors, teammate audience, neutral updates, regrouping and recreate boundaries. Reports: ${reportDirectory}`);
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
