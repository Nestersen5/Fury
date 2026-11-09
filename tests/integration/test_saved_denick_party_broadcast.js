'use strict';

// Real 1.8.9 sockets and the production proxy, with synthetic profiles and
// isolated player data. Assert upstream /pc traffic, not just local notices.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const mc = require('minecraft-protocol');
const { extractText } = require('../../features/minecraft_chat');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run({ broadcast = true, pregame = false, lateTeams = false, renamed = false, statsUnavailable = false } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-saved-denick-party-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0,
        proxyDirectHost: '127.0.0.1', proxyDirectPort: direct, proxyFailoverHost: '127.0.0.1',
        proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(directory, 'scan_config.json'), JSON.stringify({ scanMode: 'off' }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({
        denickPartyAnnounceEnabled: broadcast, denickChatAnnouncementsEnabled: false,
        autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, pregameChatStatsEnabled: pregame,
        sessionTrackingEnabled: false, autoScanOnGameStart: false, tabStatsEnabled: renamed,
        nametagOverlayEnabled: false, shareOwnNicknameEnabled: false
    }));
    fs.writeFileSync(path.join(directory, 'denicked.json'), JSON.stringify([
        { realIGN: 'EnemyPlayer', nicks: ['EnemyNick'] },
        { realIGN: 'FriendPlayer', nicks: ['FriendNick'] },
        { realIGN: 'OtherTeammate', nicks: ['TeamNick'] }
    ]));
    const ids = { EnemyPlayer: '1'.repeat(32), FriendPlayer: '2'.repeat(32), OtherTeammate: '3'.repeat(32) };
    const preload = path.join(directory, 'fixture.cjs');
    const identityCalls = path.join(directory, 'identity-calls.jsonl');
    const resolve = name => JSON.stringify(require.resolve(name));
    fs.writeFileSync(preload, `
const mc=require(${resolve('minecraft-protocol')}),server=mc.createServer,client=mc.createClient;
const ids=${JSON.stringify(ids)};
const renamed=${JSON.stringify(renamed)},record=event=>require('fs').appendFileSync(${JSON.stringify(identityCalls)},JSON.stringify(event)+'\\n');
let oldNameLookups=0;
mc.createServer=o=>{const s=server({...o,host:'127.0.0.1','online-mode':false});s.on('login',c=>{ids[c.username]=c.uuid.replace(/-/g,'');});return s;};
mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${resolve('../../src/accounts/connectionAuth')}).hasSavedLogin=()=>true;
const H=require(${resolve('../../features/hypixel_api_client')}),createH=H.createHypixelApiClient;
H.createHypixelApiClient=o=>createH({...o,getKeys:()=>({hypixel:'synthetic-key'})});
const axios=require(${resolve('axios')});
axios.get=async url=>{
 const u=new URL(url);
 if(u.hostname==='api.mojang.com'||u.hostname==='api.minecraftservices.com'){
   const name=u.pathname.split('/').pop();
   record({service:'identity',name});
   if(renamed&&name==='EnemyPlayer'){
     oldNameLookups++;
     return {data:{id:oldNameLookups===1?ids.EnemyPlayer:'9'.repeat(32),name}};
   }
   if(!ids[name])throw Object.assign(Error('Missing'),{response:{status:404}});
   return {data:{id:ids[name],name}};
 }
 if(u.hostname==='api.hypixel.net'){
   const id=u.searchParams.get('uuid'),name=Object.keys(ids).find(n=>ids[n]===id);
   record({service:'stats',uuid:id});
   if(${JSON.stringify(statsUnavailable)}&&id===ids.EnemyPlayer)return {status:200,headers:{},data:{player:null}};
   return {status:200,headers:{},data:{player:{uuid:id,displayname:renamed&&id===ids.EnemyPlayer?'RenamedEnemy':name,
     achievements:{bedwars_level:100},stats:{Bedwars:{final_kills_bedwars:200,final_deaths_bedwars:20,wins_bedwars:40,losses_bedwars:10,winstreak:3}}}}};
 }
 throw Error('External request blocked in saved denick fixture');
};
axios.post=async()=>{throw Error('External POST blocked in saved denick fixture');};
`);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort,
        'online-mode': false, version: '1.8.9', keepAlive: false });
    let peer, player, child, positioned = false;
    const commands = [], messages = [], errors = [], profiles = [];
    upstream.on('login', connection => {
        peer = connection;
        connection.on('error', error => errors.push(error.message));
        connection.on('chat', packet => commands.push(packet.message));
        connection.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 16, levelType: 'default', reducedDebugInfo: false });
        connection.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    const chat = text => peer.write('chat', { message: JSON.stringify({ text }), position: 0 });
    const score = (itemName, value) => peer.write('scoreboard_score', { itemName, action: 0, scoreName: 'bedwars', value });
    const team = (name, players, color, prefix) => peer.write('scoreboard_team', {
        team: name, mode: 0, name, prefix, suffix: '', friendlyFire: 0,
        nameTagVisibility: 'always', color, players
    });
    const broadcasts = () => commands.filter(command => command.startsWith('/pc [Denick]'));
    const expected = `/pc [Denick] ${renamed ? 'RenamedEnemy' : 'EnemyPlayer'} is nicked as EnemyNick`
        + (statsUnavailable ? '' : ' | 100★ FKDR 10.00 WLR 4.00 WS 3');
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')],
            cleanEnvironment(directory, root, cosmetic, blocked), 'Saved denick party proxy');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Starting proxy');
        assert.equal((await getJson(`http://127.0.0.1:${health}/health`)).features.denickPartyAnnounceEnabled, broadcast);
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'SelfPlayer',
            auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('position', () => { positioned = true; });
        player.on('chat', packet => messages.push(extractText(JSON.parse(packet.message))));
        player.on('player_info', packet => profiles.push(...packet.data.filter(entry => entry.name)));
        await eventually(() => assert(positioned), 'Connecting player');
        chat('Party Members (2)');
        chat('Party Leader: [MVP++] FriendPlayer \u25cf');
        chat('Party Members: [MVP++] SelfPlayer \u25cf');
        peer.write('player_info', { action: 'add_player', data: [
            { uuid: peer.uuid, name: 'SelfPlayer' },
            ...['EnemyNick', 'FriendNick', 'TeamNick'].map((name, index) => ({ uuid: String(index + 4).repeat(32), name }))
        ].map(entry => ({ ...entry, properties: [], gamemode: 0, ping: 1, displayName: null })) });
        peer.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        peer.write('scoreboard_display_objective', { position: 1, name: 'bedwars' });
        if (pregame) {
            ['Waiting...', 'Map: Lighthouse', 'Mode: Doubles', 'Players: 4/16'].forEach(score);
            await wait(500);
            chat('[MVP+] EnemyNick: hello');
            await eventually(() => assert.deepEqual(broadcasts(), [expected]), 'Pregame saved broadcast');
            // The former five-second queue dedupe must not hide a game-start repeat.
            await wait(5200);
            for (const itemName of ['Waiting...', 'Map: Lighthouse', 'Mode: Doubles', 'Players: 4/16']) {
                peer.write('scoreboard_score', { itemName, action: 1, scoreName: 'bedwars' });
            }
        }
        if (!lateTeams) team('Red1', ['SelfPlayer', 'TeamNick'], 12, '\u00a7cR ');
        team('Blue1', ['EnemyNick', 'FriendNick'], 9, '\u00a79B ');
        score('Diamond II in 5:40', 5);
        chat('Protect your bed and destroy the enemy beds.');
        if (lateTeams) {
            await wait(1500);
            assert.deepEqual(broadcasts(), [], 'No identities revealed before our own team is known');
            team('Red1', ['SelfPlayer', 'TeamNick'], 12, '\u00a7cR ');
        }
        if (broadcast) await eventually(() => assert.deepEqual(broadcasts(), [expected]), 'Saved opponent broadcast at game start');
        await wait(5600);
        player.write('chat', { message: '/pc fixture-outbound-control' });
        await eventually(() => assert(commands.includes('/pc fixture-outbound-control')), 'Outbound control reaches server');
        assertRunning(child);
        assert.deepEqual(broadcasts(), broadcast ? [expected] : [], 'No repeats, teammate leaks or disabled broadcasts');
        if (broadcast && !pregame && !lateTeams) {
            // A new queue on the same connection must announce this opponent again.
            peer.write('scoreboard_objective', { name: 'bedwars', action: 1 });
            peer.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
            peer.write('scoreboard_display_objective', { position: 1, name: 'bedwars' });
            ['Waiting...', 'Map: Lighthouse', 'Mode: Doubles', 'Players: 4/16'].forEach(score);
            await wait(500);
            for (const name of ['Red1', 'Blue1']) peer.write('scoreboard_team', { team: name, mode: 1 });
            for (const itemName of ['Waiting...', 'Map: Lighthouse', 'Mode: Doubles', 'Players: 4/16']) {
                peer.write('scoreboard_score', { itemName, action: 1, scoreName: 'bedwars' });
            }
            team('Red1', ['SelfPlayer', 'TeamNick'], 12, '\u00a7cR ');
            team('Blue1', ['EnemyNick', 'FriendNick'], 9, '\u00a79B ');
            score('Diamond II in 5:40', 5);
            chat('Protect your bed and destroy the enemy beds.');
            await eventually(() => assert.deepEqual(broadcasts(), [expected, expected]), 'Same opponent in the next game');
        }
        assert(!messages.some(message => message.includes('Known nick')), 'Local notices remain disabled');
        if (renamed) {
            const requests = fs.readFileSync(identityCalls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
            assert.equal(requests.filter(request => request.service === 'identity' && request.name === 'EnemyPlayer').length, 1,
                'The old name is resolved only during migration, never again for saved pregame stats');
            assert(requests.some(request => request.service === 'stats' && request.uuid === ids.EnemyPlayer));
            assert(!requests.some(request => request.uuid === '9'.repeat(32)), 'The new owner of the old IGN is never queried');
            const saved = JSON.parse(fs.readFileSync(path.join(directory, 'denicked.json')));
            assert(saved.some(entry => entry.realUuid === ids.EnemyPlayer && entry.realIGN === 'RenamedEnemy' && entry.nicks.includes('EnemyNick')));
            assert(messages.some(message => message.includes('RenamedEnemy')), 'Pregame chat uses the refreshed real name');
            assert(profiles.some(profile => profile.name === 'RenamedEnemy'), 'In-game tab profiles use the refreshed real name');
        }
        assert.deepEqual(errors, []);
        console.log(`Saved denick party proxy passed: broadcast=${broadcast}, pregame=${pregame}, lateTeams=${lateTeams}, renamed=${renamed}, statsUnavailable=${statsUnavailable}`);
    } catch (error) {
        console.error({ commands, messages: messages.slice(-15), output: child?.output });
        throw error;
    } finally {
        player?.end(); peer?.end(); player?.socket?.destroy(); peer?.socket?.destroy();
        if (child) await stopChild(child);
        upstream.close();
    }
}

(async () => {
    await run();
    await run({ broadcast: false });
    await run({ pregame: true });
    await run({ lateTeams: true });
    await run({ pregame: true, renamed: true });
    await run({ statsUnavailable: true });
    await run({ pregame: true, statsUnavailable: true });
})().catch(error => { console.error(error); process.exitCode = 1; });
