'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

// Real proxy process + Minecraft protocol sockets, isolated data and loopback
// upstream. A 1.8 client draws prefix + name + suffix from the one team holding
// a name, so a player left in no team renders plain white. The client model
// below follows Scoreboard/NetHandlerPlayClient: creating a team that exists
// drops the whole packet, adding to a missing team does nothing.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createClientTeams() {
    const teams = new Map(), owners = new Map(), rejected = [];
    const addPlayers = (team, players = []) => {
        for (const player of players) {
            const previous = owners.get(player);
            if (previous) teams.get(previous)?.players.delete(player);
            owners.set(player, team);
            teams.get(team).players.add(player);
        }
    };
    return {
        rejected,
        apply(packet) {
            const { team, mode } = packet;
            if (mode === 0) {
                if (teams.has(team)) { rejected.push(`create existing ${team}`); return; }
                teams.set(team, { prefix: packet.prefix, suffix: packet.suffix, players: new Set() });
                addPlayers(team, packet.players);
            } else if (mode === 1) {
                for (const player of teams.get(team)?.players || []) owners.delete(player);
                teams.delete(team);
            } else if (mode === 2) {
                if (!teams.has(team)) { rejected.push(`update missing ${team}`); return; }
                Object.assign(teams.get(team), { prefix: packet.prefix, suffix: packet.suffix });
            } else if (mode === 3) {
                if (teams.has(team)) addPlayers(team, packet.players);
            } else if (mode === 4) {
                for (const player of packet.players || []) {
                    if (owners.get(player) !== team) { rejected.push(`remove ${player} from ${team}`); return; }
                    owners.delete(player);
                    teams.get(team).players.delete(player);
                }
            }
        },
        teamOf: name => owners.get(name) || null,
        prefixOf: name => teams.get(owners.get(name))?.prefix ?? null,
        render: name => owners.has(name) ? `${teams.get(owners.get(name)).prefix}${name}${teams.get(owners.get(name)).suffix}` : name
    };
}

(async () => {
    const root = REPOSITORY_ROOT;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-duels-nametags-'));
    const clockFile = path.join(directory, 'advance-clock');
    const [directPort, failoverPort, healthPort, upstreamPort, cosmeticPort, blockedPort] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0, proxyDirectPort: directPort, proxyFailoverPort: failoverPort, healthPort, proxyDirectHost: '127.0.0.1', proxyFailoverHost: '127.0.0.1' }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, tabStatsEnabled: false, nametagOverlayEnabled: true }));
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const fs = require('fs');
const mc = require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => createClient({ ...options, host: '127.0.0.1', port: ${upstreamPort}, auth: 'offline' });
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin = () => true;
// Jumps the proxy's clock on demand so the roster age limit can pass quickly.
const now = Date.now; let offset = 0;
Date.now = () => now() + offset;
setInterval(() => { if (!offset && fs.existsSync(${JSON.stringify(clockFile)})) offset = 100000; }, 25).unref();
// First answers arrive in reverse name order, the order that shifts team indexes.
const firstDelay = new Map([['Alpha', 2400], ['Bravo', 1200], ['Charlie', 0]]);
const duels = { wins: 10, losses: 5, kills: 10, deaths: 5, classic_duel_wins: 10, classic_duel_losses: 5, classic_duel_kills: 10, classic_duel_deaths: 5 };
require(${JSON.stringify(path.join(root, 'src/stats/fetch.js'))}).createStatsFetch = () => ({
    getPlayerData: async name => {
        const wait = firstDelay.get(name) || 0;
        firstDelay.delete(name);
        if (wait) await new Promise(resolve => setTimeout(resolve, wait));
        return { fromCache: true, data: { player: { displayname: name, stats: { Duels: duels } }, urchin: {}, seraph: {}, status: '' } };
    }
});
`);
    const env = cleanEnvironment(directory, root, cosmeticPort, blockedPort);
    env.FURY_ENABLE_DIAGNOSTICS = '0';
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    const clientTeams = createClientTeams();
    const errors = [];
    const opponents = [
        { uuid: '22222222-2222-2222-2222-222222222222', name: 'Alpha' },
        { uuid: '33333333-3333-3333-3333-333333333333', name: 'Bravo' },
        { uuid: '44444444-4444-4444-4444-444444444444', name: 'Charlie' }
    ];
    const names = opponents.map(player => player.name);
    let upstreamClient, player, child;
    const rawTeam = (mode, fields) => upstreamClient.write('scoreboard_team', { team: 'Opp', mode, ...fields });
    const rawProperties = prefix => ({ name: 'Opp', prefix, suffix: '', friendlyFire: 0, nameTagVisibility: 'always', color: 15 });
    const sidebarLine = (itemName, value, action = 0) => upstreamClient.write('scoreboard_score', action === 1
        ? { itemName, action, scoreName: 'duels' }
        : { itemName, action, scoreName: 'duels', value });
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', client => {
        upstreamClient = client;
        client.on('error', error => errors.push(error.message));
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
        client.write('player_info', { action: 'add_player', data: [{ uuid: client.uuid, name: 'DuelObserver', properties: [], gamemode: 0, ping: 1, displayName: null }, ...opponents.map(entry => ({ ...entry, properties: [], gamemode: 0, ping: 1, displayName: null }))] });
        rawTeam(0, { ...rawProperties('§c'), players: names });
        client.write('scoreboard_objective', { name: 'duels', action: 0, displayText: '§e§lDUELS', type: 'integer' });
        client.write('scoreboard_display_objective', { name: 'duels', position: 1 });
        sidebarLine('Mode: Classic Duel', 2);
    });
    const allAnnotated = async label => eventually(async () => {
        assertRunning(child);
        for (const name of names) {
            assert(/^.*!\d+$/.test(clientTeams.teamOf(name) || ''), `${label}: ${name} is in ${clientTeams.teamOf(name)}, rendered ${clientTeams.render(name)}`);
            assert((clientTeams.prefixOf(name) || '').endsWith('§c'), `${label}: ${name} rendered ${clientTeams.render(name)}`);
        }
    }, label, 10000);
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Duels nametag proxy fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${healthPort}/health`)).ok); }, 'Starting isolated proxy');
        player = mc.createClient({ host: '127.0.0.1', port: directPort, username: 'DuelObserver', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('packet', (data, meta) => { if (meta.name === 'scoreboard_team') clientTeams.apply(data); });
        await eventually(async () => { assertRunning(child); assert.strictEqual(clientTeams.teamOf('Alpha'), 'Opp'); }, 'Forwarding Hypixel team');

        // Stats arriving one player at a time shifts shared-team indexes.
        await delay(3200);
        await allAnnotated('Shared team annotated out of order');
        assert.deepStrictEqual(clientTeams.rejected, [], 'overlay teams must never collide on the client');

        // Hypixel's colour byte is 15 on every team and the client never draws
        // it, so a prefix that loses its colour must not repaint the name white.
        rawTeam(2, rawProperties(''));
        await delay(400);
        await allAnnotated('Colourless Hypixel prefix');
        rawTeam(2, rawProperties('§c'));
        await delay(300);

        // A player present in the tab list stays annotated however long it has
        // been since their last latency update.
        fs.writeFileSync(clockFile, '');
        await delay(200);
        sidebarLine('Time Left: 13:59', 1);
        await delay(400);
        await allAnnotated('Roster age limit');
        // Regular tab updates resume, as they do from the real server.
        upstreamClient.write('player_info', { action: 'update_latency', data: opponents.map(({ uuid }) => ({ uuid, ping: 1 })) });
        await delay(200);

        // Losing the duel sidebar takes the overlay down: every player has to go
        // back to Hypixel's team, not into no team at all.
        sidebarLine('Mode: Classic Duel', 2, 1);
        await eventually(async () => {
            assertRunning(child);
            for (const name of names) assert.strictEqual(clientTeams.teamOf(name), 'Opp', `Sidebar change: ${name} rendered ${clientTeams.render(name)}`);
        }, 'Handing players back at the end of a duel');
        sidebarLine('Mode: Classic Duel', 2);
        await allAnnotated('Returning to the duel sidebar');

        // /nametags clear in a duel also restores Hypixel's team.
        player.write('chat', { message: '/nametags clear' });
        await eventually(async () => {
            for (const name of names) assert.strictEqual(clientTeams.teamOf(name), 'Opp', `/nametags clear: ${name} rendered ${clientTeams.render(name)}`);
        }, 'Restoring names on request');
        sidebarLine('Time Left: 13:58', 1);
        await allAnnotated('Annotating again after a clear');

        // Invisibility removes the annotation; the player returns afterwards.
        upstreamClient.write('named_entity_spawn', { entityId: 42, playerUUID: opponents[0].uuid, x: 0, y: 2560, z: 0, yaw: 0, pitch: 0, currentItem: 0, metadata: [{ type: 0, key: 0, value: 0 }] });
        await delay(200);
        upstreamClient.write('entity_metadata', { entityId: 42, metadata: [{ type: 0, key: 0, value: 0x20 }] });
        await eventually(async () => assert.strictEqual(clientTeams.teamOf('Alpha'), null), 'Removing the annotation while invisible');
        upstreamClient.write('entity_metadata', { entityId: 42, metadata: [{ type: 0, key: 0, value: 0 }] });
        await allAnnotated('Visible again');

        // A duel ending while someone is invisible must not strand them either.
        upstreamClient.write('entity_metadata', { entityId: 42, metadata: [{ type: 0, key: 0, value: 0x20 }] });
        await eventually(async () => assert.strictEqual(clientTeams.teamOf('Alpha'), null), 'Invisible again');
        sidebarLine('Mode: Classic Duel', 2, 1);
        await eventually(async () => {
            for (const name of names) assert.strictEqual(clientTeams.teamOf(name), 'Opp', `Duel end while invisible: ${name} rendered ${clientTeams.render(name)}`);
        }, 'Restoring an invisible player at the end of a duel');

        assert.deepStrictEqual(clientTeams.rejected, [], 'overlay teams must never collide on the client');
        assert.deepStrictEqual(errors, []);
        console.log('Duels nametag team integration passed: shared-team annotation order, colourless prefixes, roster age limit, duel end, /nametags clear and invisibility.');
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
