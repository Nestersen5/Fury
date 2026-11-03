'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

// Real proxy process + 1.8.9 Minecraft protocol sockets, isolated data and a
// loopback upstream. Checks the custom lobby sidebar on the wire: what the
// player's client ends up displaying, that Hypixel's board comes back, and
// that the client is never sent a packet that would disconnect it.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');

const plain = value => String(value || '').replace(/§[0-9a-fk-or]/gi, '');

// The parts of the 1.8.9 client scoreboard that matter here, including the
// cases that disconnect a real client.
function createClientScoreboard() {
    const objectives = new Map(), teams = new Map(), entryTeam = new Map(), scores = new Map(), faults = [];
    let slot = '';
    return {
        faults,
        apply(name, data) {
            if (name === 'scoreboard_objective') {
                if (data.action === 0) { if (objectives.has(data.name)) faults.push(`duplicate objective ${data.name}`); objectives.set(data.name, data.displayText); }
                else if (data.action === 2) objectives.set(data.name, data.displayText);
                else if (data.action === 1) { if (!objectives.delete(data.name)) faults.push(`remove missing objective ${data.name}`); scores.delete(data.name); if (slot === data.name) slot = ''; }
            } else if (name === 'scoreboard_display_objective' && data.position === 1) {
                if (data.name && !objectives.has(data.name)) faults.push(`display missing objective ${data.name}`);
                slot = data.name;
            } else if (name === 'scoreboard_team') {
                if ((data.mode === 0 || data.mode === 2) && (data.prefix.length > 16 || data.suffix.length > 16)) faults.push(`overlong team text ${data.team}`);
                if (data.players?.some(entry => entry.length > 40)) faults.push(`overlong team entry ${data.team}`);
                const team = teams.get(data.team);
                if (data.mode === 0) { if (team) faults.push(`duplicate team ${data.team}`); teams.set(data.team, { prefix: data.prefix, suffix: data.suffix }); (data.players || []).forEach(p => entryTeam.set(p, data.team)); }
                else if (!team) faults.push(`team ${data.team} missing for mode ${data.mode}`);
                else if (data.mode === 1) { teams.delete(data.team); for (const [p, t] of [...entryTeam]) if (t === data.team) entryTeam.delete(p); }
                else if (data.mode === 2) Object.assign(team, { prefix: data.prefix, suffix: data.suffix });
                else if (data.mode === 3) data.players.forEach(p => entryTeam.set(p, data.team));
                else if (data.mode === 4) data.players.forEach(p => entryTeam.delete(p));
            } else if (name === 'scoreboard_score') {
                if (data.itemName.length > 40) faults.push(`overlong score entry ${data.itemName}`);
                if (data.action === 1) { scores.get(data.scoreName)?.delete(data.itemName); return; }
                if (!objectives.has(data.scoreName)) faults.push(`score for missing objective ${data.scoreName}`);
                if (!scores.has(data.scoreName)) scores.set(data.scoreName, new Map());
                scores.get(data.scoreName).set(data.itemName, data.value);
            }
        },
        view() {
            if (!slot) return null;
            const rows = [...(scores.get(slot) || new Map())].sort((a, b) => b[1] - a[1]).map(([entry]) => {
                const team = teams.get(entryTeam.get(entry));
                return team ? team.prefix + entry + team.suffix : entry;
            });
            return { objective: slot, title: objectives.get(slot), rows: rows.map(row => plain(row).replace(/[\u{10000}-\u{10FFFF}]/gu, '').trim()), raw: rows };
        },
        teamNames: () => [...teams.keys()]
    };
}

const LOBBY = ['§711/02/26 §8L12A', '', 'Level: §b312✫', '', 'Progress: §b2.7k§7/§a5k', '§8[§b■■■■■§7■■■■■§8]', '',
    'Tokens: §2123,456', 'Slumber Tickets: §b139/100,000', '', 'Total Kills: §a12,345', 'Total Wins: §a1,234', '', '§ewww.hypixel.net'];

(async () => {
    const root = REPOSITORY_ROOT;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-lobby-scoreboard-'));
    const [directPort, failoverPort, healthPort, upstreamPort, cosmeticPort, blockedPort] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0, proxyDirectPort: directPort, proxyFailoverPort: failoverPort, healthPort }));
    const featuresFile = path.join(directory, 'features_config.json');
    const features = { apiKillSwitchEnabled: false, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, tabStatsEnabled: false,
        sessionTrackingEnabled: false };
    fs.writeFileSync(featuresFile, JSON.stringify(features));
    // A placeholder key enables the own-stats read; all HTTP is routed to a closed port.
    fs.writeFileSync(path.join(directory, 'statmod_key.txt'), 'Hypixel API Key: 00000000-0000-0000-0000-000000000000\n');
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const mc = require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => createClient({ ...options, host: '127.0.0.1', port: ${upstreamPort}, auth: 'offline' });
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin = () => true;
require(${JSON.stringify(path.join(root, 'src/stats/fetch.js'))}).createStatsFetch = () => ({
    getPlayerData: async name => ({ fromCache: false, data: { player: { displayname: name,
        stats: { Bedwars: { Experience: 250000, final_kills_bedwars: 20, final_deaths_bedwars: 10, winstreak: 3 } } }, urchin: {}, seraph: {}, status: '' } })
});
`);
    const env = cleanEnvironment(directory, root, cosmeticPort, blockedPort);
    env.FURY_ENABLE_DIAGNOSTICS = '0';
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    const board = createClientScoreboard();
    const errors = [];
    let upstreamClient, player, child, playerEnded = false;
    const sendBoard = (objective, title, lines) => {
        upstreamClient.write('scoreboard_objective', { name: objective, action: 0, displayText: title, type: 'integer' });
        upstreamClient.write('scoreboard_display_objective', { position: 1, name: objective });
        lines.forEach((line, i) => {
            const entry = String.fromCodePoint(0x1F600 + i) + '§r';
            upstreamClient.write('scoreboard_team', { team: `${objective}_${i}`, mode: 0, name: `${objective}_${i}`, prefix: line.slice(0, 16), suffix: line.slice(16),
                friendlyFire: 0, nameTagVisibility: 'always', color: -1, players: [entry] });
            upstreamClient.write('scoreboard_score', { itemName: entry, action: 0, scoreName: objective, value: lines.length - i });
        });
    };
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', client => {
        upstreamClient = client;
        client.on('error', error => errors.push(error.message));
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Lobby scoreboard proxy fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${healthPort}/health`)).ok); }, 'Starting isolated proxy');
        player = mc.createClient({ host: '127.0.0.1', port: directPort, username: 'LobbyPlayer', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('end', () => { playerEnded = true; });
        player.on('packet', (data, meta) => { if (meta.name.startsWith('scoreboard_')) board.apply(meta.name, data); });
        await eventually(async () => { assertRunning(child); assert(upstreamClient && player.state === mc.states.PLAY); }, 'Joining through the proxy');

        // Lobby: the Fury board replaces Hypixel's, then FKDR arrives from the own-stats read.
        sendBoard('lobbySB', '§e§lBED WARS', LOBBY);
        const lobbyView = await eventually(async () => {
            const view = board.view();
            assert.strictEqual(view?.objective, 'fury_lobby');
            assert.ok(view.rows.includes('FKDR: 2.0000'), view.rows.join(' | '));
            return view;
        }, 'Showing the custom lobby board with FKDR');
        assert.strictEqual(lobbyView.title, '§e§lBED WARS');
        assert.deepStrictEqual(lobbyView.rows, ['11/02/26 L12A', '', 'Level: 312✫', '', 'Progress: 2.7k/5k', '■'.repeat(10), '', 'Tokens: 123,456',
            'Slumber: 139/100,000', '', 'Total Kills: 12,345', 'Total Wins: 1,234', 'FKDR: 2.0000', 'Winstreak: 3', '']);
        assert.ok(lobbyView.raw[7].startsWith(' §fTokens: §2'), 'Classic colors by default');

        // A Hypixel line update reaches the Fury board.
        upstreamClient.write('scoreboard_team', { team: 'lobbySB_10', mode: 2, name: 'lobbySB_10', prefix: 'Total Kills: §a1', suffix: '2,400', friendlyFire: 0, nameTagVisibility: 'always', color: -1 });
        await eventually(async () => assert.ok(board.view().rows.includes('Total Kills: 12,400')), 'Updating a lobby line');

        // In-game color choice through chat.
        player.write('chat', { message: '/fury set lobbystyle gold' });
        await eventually(async () => assert.ok(board.view().raw[7].startsWith(' §fTokens: §6')), 'Changing colors with /fury');
        assert.strictEqual(JSON.parse(fs.readFileSync(featuresFile, 'utf8')).bedwarsLobbyScoreboardStyle, 'gold', 'the chat choice is saved');

        // Larger ticket values must keep all digits and replace the old score
        // entry cleanly as the row starts/stops needing its middle text field.
        player.write('chat', { message: '/fury set lobbystyle classic' });
        await eventually(async () => assert.ok(board.view().raw[7].startsWith(' §fTokens: §2')), 'Switching to the screenshot style');
        for (const amount of ['2,669', '10,000', '100,000', '139', '2,669']) {
            const line = `Slumber Tickets: ${amount}/100,000`;
            upstreamClient.write('scoreboard_team', { team: 'lobbySB_8', mode: 2, name: 'lobbySB_8', prefix: line.slice(0, 16), suffix: line.slice(16), friendlyFire: 0, nameTagVisibility: 'always', color: -1 });
            await eventually(async () => {
                const view = board.view();
                assert.strictEqual(view.rows.length, 15, 'no stale score entries');
                assert.deepStrictEqual(view.rows.filter(row => row.startsWith('Slumber:')), [`Slumber: ${amount}/100,000`]);
            }, `Showing all Slumber ticket digits for ${amount}`);
        }

        // Live launcher-style settings changes propagate through the actual
        // file watcher without replacing the board or losing Slumber digits.
        for (let decimals = 0; decimals <= 4; decimals++) {
            fs.writeFileSync(featuresFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(featuresFile, 'utf8')), bedwarsLobbyScoreboardDecimals: decimals }));
            await eventually(async () => {
                const view = board.view();
                assert.ok(view.rows.includes(`FKDR: ${['2', '2.0', '2.00', '2.000', '2.0000'][decimals]}`));
                assert.ok(view.rows.includes('Slumber: 2,669/100,000'));
                assert.strictEqual(view.rows.length, 15);
            }, `Applying ${decimals} FKDR decimal digits`, 10000);
        }

        // Pregame and in-game Bed Wars boards: Hypixel's lines, one space in.
        sendBoard('preSB', '§e§lBED WARS', ['§711/02/26 §8m45K', '', 'Map: §aLighthouse', 'Players: §a7/8', '', 'Starting in §a12s']);
        await eventually(async () => {
            const view = board.view();
            assert.strictEqual(view?.objective, 'fury_lobby');
            assert.deepStrictEqual(view.rows, ['11/02/26 m45K', '', 'Map: Lighthouse', 'Players: 7/8', '', 'Starting in 12s']);
            assert.ok(view.raw.filter((row, i) => view.rows[i]).every(row => row.startsWith(' ')));
        }, 'Indenting the pregame board');
        sendBoard('gameSB', '§e§lBED WARS', ['§711/02/26 §8m45K', '', '§cR §fRed: §a✔', '§9B §fBlue: §a✔']);
        const gameView = await eventually(async () => {
            const view = board.view();
            assert.strictEqual(view?.objective, 'fury_lobby');
            assert.strictEqual(view.rows.length, 4, view.rows.join(' | '));
            assert.ok(view.rows[2].includes('Red') && view.raw[2].startsWith(' '), view.rows.join(' | '));
            return view;
        }, 'Indenting the in-game board');
        console.log('In-game rows as drawn:', JSON.stringify(gameView.raw));

        // Another game's board: Hypixel's board is shown and every Fury team is removed.
        sendBoard('skySB', '§e§lSKYWARS', ['Players left: §a12', 'Kills: §a0']);
        await eventually(async () => {
            assert.strictEqual(board.view()?.objective, 'skySB');
            assert.ok(!board.teamNames().some(name => name.startsWith('fury_lobby_')));
        }, 'Restoring Hypixel outside Bed Wars');

        // Back in a lobby, then switched off from the launcher's settings file.
        sendBoard('lobbyTwo', '§e§lBED WARS', LOBBY);
        await eventually(async () => assert.strictEqual(board.view()?.objective, 'fury_lobby'), 'Showing the board again in the next lobby');
        fs.writeFileSync(featuresFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(featuresFile, 'utf8')), bedwarsLobbyScoreboardEnabled: false }));
        await eventually(async () => assert.strictEqual(board.view()?.objective, 'lobbyTwo'), 'Switching off restores Hypixel\'s lobby board', 10000);

        assert.deepStrictEqual(board.faults, [], 'no packet would disconnect a 1.8.9 client');
        assert.strictEqual(playerEnded, false, 'the player stayed connected');
        assert.deepStrictEqual(errors, []);
        console.log('Lobby scoreboard proxy integration passed: custom board, FKDR, full Slumber counts, line updates, /fury colors, game restore, live switch-off.');
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
