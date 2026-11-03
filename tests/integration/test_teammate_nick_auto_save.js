'use strict';

// Screenshot-shaped party, real 1.8.9 sockets and the production proxy. All
// external profile responses are synthetic and all writes use temporary data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const mc = require('minecraft-protocol');
const { extractText } = require('../../features/minecraft_chat');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-teammate-nick-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0,
        proxyDirectHost: '127.0.0.1', proxyDirectPort: direct, proxyFailoverHost: '127.0.0.1',
        proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({
        autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, pregameChatStatsEnabled: false,
        sessionTrackingEnabled: false, autoScanOnGameStart: false, tabStatsEnabled: true,
        nametagOverlayEnabled: false, denickPartyBroadcastEnabled: false
    }));
    fs.writeFileSync(path.join(directory, 'denicked.json'), JSON.stringify([
        { realIGN: 'ModernLegendsLP', nicks: ['GoldenJimmy'], methods: ['manual'],
            manualNicks: { goldenjimmy: new Date().toISOString() } }
    ]));
    const ids = { RealEye: '1'.repeat(32), FacebookMessages: '2'.repeat(32),
        ModernLegendsLP: '3'.repeat(32), Adeserproala: '4'.repeat(32) };
    const nickUuid = '5'.repeat(32);
    const preload = path.join(directory, 'fixture.cjs');
    const resolve = name => JSON.stringify(require.resolve(name));
    fs.writeFileSync(preload, `
const mc=require(${resolve('minecraft-protocol')}),server=mc.createServer,client=mc.createClient;
const ids=${JSON.stringify(ids)};
mc.createServer=o=>{const s=server({...o,host:'127.0.0.1','online-mode':false});s.on('login',c=>{ids[c.username]=c.uuid.replace(/-/g,'');});return s;};
mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${resolve('../../src/accounts/connectionAuth')}).hasSavedLogin=()=>true;
const H=require(${resolve('../../features/hypixel_api_client')}),createH=H.createHypixelApiClient;
H.createHypixelApiClient=o=>createH({...o,getKeys:()=>({hypixel:'synthetic-key'})});
const axios=require(${resolve('axios')});
axios.get=async(url,options={})=>{
 const u=new URL(url);
 if(u.hostname==='api.mojang.com'||u.hostname==='api.minecraftservices.com'){
   const name=u.pathname.split('/').pop();
   if(!ids[name])throw Object.assign(Error('Missing'),{response:{status:404}});
   return {data:{id:ids[name],name}};
 }
 if(u.hostname==='api.hypixel.net'){
   const id=u.searchParams.get('uuid'),name=Object.keys(ids).find(n=>ids[n]===id);
   return {status:200,headers:{},data:{player:{uuid:id,displayname:name,
     newPackageRank:'MVP_PLUS',monthlyPackageRank:'SUPERSTAR',
     achievements:{bedwars_level:name==='RealEye'?0:100},
     stats:{Bedwars:{final_kills_bedwars:name==='RealEye'?0:200,final_deaths_bedwars:20,winstreak:0}}}}};
 }
 throw Error('External request blocked in teammate nick fixture');
};
axios.post=async()=>{throw Error('External POST blocked in teammate nick fixture');};
`);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort,
        'online-mode': false, version: '1.8.9', keepAlive: false });
    let peer, player, child, positioned = false;
    const messages = [], tabs = [], errors = [];
    upstream.on('login', connection => {
        peer = connection;
        connection.on('error', error => errors.push(error.message));
        connection.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 16, levelType: 'default', reducedDebugInfo: false });
        connection.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    const chat = text => peer.write('chat', { message: JSON.stringify({ text }), position: 0 });
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')],
            cleanEnvironment(directory, root, cosmetic, blocked), 'Teammate nickname proxy');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Starting proxy');
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'Nestersen',
            auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('position', () => { positioned = true; });
        player.on('chat', data => messages.push(JSON.parse(data.message)));
        player.on('player_info', packet => {
            if (packet.action !== 'update_display_name' && packet.action !== 3) return;
            for (const entry of packet.data) if ((entry.uuid || entry.UUID).replace(/-/g, '') === nickUuid && entry.displayName) {
                tabs.push(extractText(JSON.parse(entry.displayName)));
            }
        });
        await eventually(() => assert(positioned), 'Connecting player');
        chat('Party Members (4)');
        chat('Party Leader: [MVP++] ModernLegendsLP ●');
        chat('Party Members: [MVP++] FacebookMessages ● [MVP++] Nestersen ● [MVP+] Adeserproala ●');
        peer.write('player_info', { action: 'add_player', data: [
            { uuid: peer.uuid, name: 'Nestersen' }, { uuid: nickUuid, name: 'RealEye' },
            { uuid: '6'.repeat(32), name: 'GoldenJimmy' }, { uuid: ids.Adeserproala, name: 'Adeserproala' }
        ].map(entry => ({ ...entry, properties: [], gamemode: 0, ping: 1, displayName: null })) });
        peer.write('scoreboard_team', { team: 'Yellow1', mode: 0, name: 'Yellow1', prefix: '§eY ', suffix: '',
            friendlyFire: 0, nameTagVisibility: 'always', color: 14,
            players: ['Nestersen', 'RealEye', 'GoldenJimmy', 'Adeserproala'] });
        peer.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        peer.write('scoreboard_display_objective', { position: 1, name: 'bedwars' });
        peer.write('scoreboard_score', { itemName: 'Diamond II in 5:40', action: 0, scoreName: 'bedwars', value: 5 });
        chat('Protect your bed and destroy the enemy beds.');
        const savedHistory = () => JSON.parse(fs.readFileSync(path.join(directory, 'denicked.json')));
        await eventually(() => {
            assertRunning(child);
            assert(savedHistory().some(entry => entry.realIGN === 'FacebookMessages' && entry.nicks.includes('RealEye')));
            assert(messages.some(message => extractText(message).includes('Saved RealEye')));
        }, 'Automatically saving the one unknown nick in a four-player party', 12000);
        assert(tabs.some(text => text.includes('[NICK]')), 'The colliding account must be detected before saving');
        assert.equal(messages.filter(message => extractText(message).includes('Saved RealEye')).length, 1);
        const notice = messages.find(message => extractText(message).includes('Saved RealEye'));
        const undo = notice.extra.find(part => part.clickEvent?.value.includes('party undo')).clickEvent.value;
        player.write('chat', { message: undo });
        await eventually(() => {
            assert(!savedHistory().some(entry => entry.realIGN === 'FacebookMessages' && entry.nicks.includes('RealEye')));
        }, 'Undoing the inferred match');
        assert(savedHistory().some(entry => entry.realIGN === 'ModernLegendsLP' && entry.nicks.includes('GoldenJimmy')));
        assert.deepEqual(errors, []);
        console.log('Production proxy: four-player party, colliding nickname, automatic save, single notice and Undo passed.');
    } catch (error) {
        console.error({ messages: messages.map(extractText).slice(-15), tabs, output: child?.output });
        throw error;
    } finally {
        player?.end(); peer?.end(); player?.socket?.destroy(); peer?.socket?.destroy();
        if (child) await stopChild(child);
        upstream.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
