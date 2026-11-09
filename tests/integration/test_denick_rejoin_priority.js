'use strict';

// Cold mid-game joins through the actual 1.8.9 proxy. Only synthetic player
// data and mocked external APIs are used; the running player's data is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const mc = require('minecraft-protocol');
const { extractText } = require('../../features/minecraft_chat');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-denick-rejoin-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    const historyFile = path.join(directory, 'denicked.json'), callsFile = path.join(directory, 'calls.jsonl');
    const outageFile = path.join(directory, 'stats-outage');
    const friends = [
        { nick: 'FirstNick', real: 'FirstFriend', uuid: 'a'.repeat(32), tabUuid: 'd'.repeat(32) },
        { nick: 'SecondNick', real: 'SecondFriend', uuid: 'b'.repeat(32), tabUuid: 'e'.repeat(32) },
        { nick: 'ThirdNick', real: 'ThirdFriend', uuid: 'c'.repeat(32), tabUuid: 'f'.repeat(32) }
    ];
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0,
        proxyDirectHost: '127.0.0.1', proxyDirectPort: direct, proxyFailoverHost: '127.0.0.1',
        proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(directory, 'scan_config.json'), JSON.stringify({ scanMode: 'off' }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ tabStatsEnabled: true,
        autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, denickRealIgnNametags: false,
        denickRealSkin: false, denickRealIgnChat: false, denickChatAnnouncementsEnabled: false,
        sessionTrackingEnabled: false, autoScanOnGameStart: false, pregameChatStatsEnabled: false,
        nametagOverlayEnabled: false, shareOwnNicknameEnabled: false, bedwarsLobbyScoreboardEnabled: false }));
    fs.writeFileSync(historyFile, JSON.stringify([
        ...Array.from({ length: 347 }, (_, i) => ({ realIGN: `Archive${i}`, nicks: [`UnusedNick${i}`] })),
        ...friends.map(friend => ({ realIGN: friend.real, nicks: [friend.nick], identityState: 'pending', methods: ['party_variation'] }))
    ]));
    const preload = path.join(directory, 'fixture.cjs');
    const resolve = name => JSON.stringify(require.resolve(name));
    fs.writeFileSync(preload, `
const fs=require('fs'),friends=${JSON.stringify(friends)},ids=Object.fromEntries(friends.map(f=>[f.real,f.uuid]));
const record=e=>fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify({...e,at:Date.now()})+'\\n');
const mc=require(${resolve('minecraft-protocol')}),server=mc.createServer,client=mc.createClient;
mc.createServer=o=>{const s=server({...o,host:'127.0.0.1','online-mode':false});s.on('login',c=>{ids[c.username]=c.uuid.replace(/-/g,'');});return s;};
mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${resolve('../../src/accounts/connectionAuth')}).hasSavedLogin=()=>true;
const H=require(${resolve('../../features/hypixel_api_client')}),createH=H.createHypixelApiClient;
H.createHypixelApiClient=o=>createH({...o,getKeys:()=>({hypixel:'synthetic-key'})});
const axios=require(${resolve('axios')});
axios.get=async url=>{
 const u=new URL(url);
 if(u.hostname==='api.mojang.com'||u.hostname==='api.minecraftservices.com'){
   const name=u.pathname.split('/').pop();record({service:'identity',name});
   if(/^Archive\\d+$/.test(name)){
     if(name==='Archive0')await new Promise(r=>setTimeout(r,1200));
     return {data:{id:(Number(name.slice(7))+1).toString(16).padStart(32,'0'),name}};
   }
   if(!ids[name])throw Object.assign(Error('Missing'),{response:{status:404}});
   return {data:{id:ids[name],name}};
 }
 if(u.hostname==='api.hypixel.net'){
   const uuid=u.searchParams.get('uuid');record({service:'stats',uuid});
   if(fs.existsSync(${JSON.stringify(outageFile)})&&friends.some(f=>f.uuid===uuid))
     throw Object.assign(Error('Synthetic outage'),{response:{status:503,headers:{}}});
   return {status:200,headers:{},data:{player:{uuid,displayname:Object.keys(ids).find(name=>ids[name]===uuid),
     achievements:{bedwars_level:100},stats:{Bedwars:{final_kills_bedwars:900,final_deaths_bedwars:100}}}}};
 }
 throw Error('External request blocked in denick rejoin fixture');
};
axios.post=async()=>{throw Error('External POST blocked in denick rejoin fixture');};
`);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort,
        'online-mode': false, version: '1.8.9', keepAlive: false });
    let peer, player, child, positioned = false;
    const rows = [], errors = [], chatMessages = [], upstreamChat = [];
    upstream.on('login', connection => {
        peer = connection;
        connection.on('chat', packet => upstreamChat.push(packet.message));
        connection.on('error', error => errors.push(error.message));
        connection.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 16, levelType: 'default', reducedDebugInfo: false });
        connection.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    async function start() {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')],
            cleanEnvironment(directory, root, cosmetic, blocked), 'Denick rejoin proxy');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Starting proxy');
    }
    async function join() {
        positioned = false; rows.length = 0; chatMessages.length = 0;
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'SelfPlayer',
            auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('chat', packet => chatMessages.push(JSON.parse(packet.message)));
        player.on('position', () => { positioned = true; });
        player.on('player_info', packet => {
            if (packet.action !== 'update_display_name' && packet.action !== 3) return;
            for (const entry of packet.data) if (entry.displayName) rows.push({
                uuid: (entry.uuid || entry.UUID).replace(/-/g, ''), text: extractText(JSON.parse(entry.displayName)), at: Date.now() });
        });
        await eventually(() => assert(positioned), 'Connecting player');
        peer.write('player_info', { action: 'add_player', data: [
            { uuid: peer.uuid, name: 'SelfPlayer' }, ...friends.map(friend => ({ uuid: friend.tabUuid, name: friend.nick }))
        ].map(entry => ({ ...entry, properties: [], gamemode: 0, ping: 1, displayName: null })) });
        peer.write('scoreboard_team', { team: 'Yellow1', mode: 0, name: 'Yellow1', prefix: '\u00a7eY ', suffix: '',
            friendlyFire: 0, nameTagVisibility: 'always', color: 14, players: ['SelfPlayer', ...friends.map(friend => friend.nick)] });
        peer.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        peer.write('scoreboard_display_objective', { position: 1, name: 'bedwars' });
        peer.write('scoreboard_score', { itemName: 'Diamond II in 5:40', action: 0, scoreName: 'bedwars', value: 5 });
    }
    async function disconnect() {
        player?.end(); peer?.end(); player?.socket?.destroy(); peer?.socket?.destroy();
        await pause(200);
    }
    const calls = () => fs.readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    try {
        await start(); await join();
        await eventually(() => assert(chatMessages.some(message => extractText(message).includes('scan stats'))),
            'Game-start migration notice reaches local chat');
        const notice = chatMessages.find(message => extractText(message).includes('scan stats'));
        const dismiss = notice.extra.find(part => part.clickEvent?.value === '/denick notice off');
        assert.equal(dismiss.clickEvent.action, 'run_command');
        assert.equal(chatMessages.filter(message => extractText(message).includes('scan stats')).length, 1);
        player.chat(dismiss.clickEvent.value);
        const noticeFile = path.join(directory, 'launcher_data', 'denick-migration-notice.json');
        await eventually(() => assert.equal(JSON.parse(fs.readFileSync(noticeFile)).dismissed, true),
            'Clicking the local reminder action persists dismissal');
        assert(!upstreamChat.includes('/denick notice off'), 'the dismissal must never be sent to Hypixel');
        await eventually(() => friends.forEach(friend => assert(rows.some(row => row.uuid === friend.tabUuid && row.text.includes('[NICK]')))),
            'Pending teammates render as nicked before their identities resolve', 2500);
        await eventually(() => friends.forEach(friend => assert(rows.some(row => row.uuid === friend.tabUuid && row.text.includes(friend.real) && row.text.includes('9.00')))),
            'Current teammates resolve ahead of the 350-player migration backlog', 12000);
        const requested = calls().filter(call => call.service === 'identity');
        for (const friend of friends) {
            assert(requested.findIndex(call => call.name === friend.real) < 10, 'Teammates must not wait behind the archive');
            assert(!requested.some(call => call.name === friend.nick), 'Pending nicknames must not be resolved as real accounts');
        }
        await disconnect(); await stopChild(child); child = null;
        fs.writeFileSync(outageFile, 'synthetic API outage');
        await start(); await join();
        await eventually(() => friends.forEach(friend => assert(rows.some(row => row.uuid === friend.tabUuid
            && row.text.includes(friend.real) && row.text.includes('[NICK]')))),
            'Cold mid-game rejoin retains known names and nick labels during a stats outage', 2500);
        assert(!chatMessages.some(message => extractText(message).includes('scan stats')),
            'Dismissed reminders stay hidden after the proxy restarts with pending accounts');
        const saved = JSON.parse(fs.readFileSync(historyFile));
        for (const friend of friends) {
            assert(saved.some(row => row.realIGN === friend.real && row.realUuid === friend.uuid && row.nicks.includes(friend.nick)));
            assert.equal(calls().filter(call => call.service === 'identity' && call.name === friend.real).length, 1,
                'Verified teammates never repeat name migration after a restart/rejoin');
        }
        assert.equal(saved.length, 350);
        assert.deepEqual(errors, []);
        console.log('Production proxy: pending teammate nick labels, encountered-player priority, UUID persistence and cold rejoin during a stats outage passed.');
    } catch (error) {
        console.error({ rows: rows.slice(-15), output: child?.output }); throw error;
    } finally {
        await disconnect(); if (child) await stopChild(child); upstream.close();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
