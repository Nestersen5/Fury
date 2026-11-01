'use strict';

// Real 1.8.9 packets, production lookup/scheduler/rendering, synthetic upstream
// services and isolated storage. Slow tags/ping must not hold primary tab rows.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const mc = require('minecraft-protocol');
const { extractText } = require('../../features/minecraft_chat');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');

async function run() {
    const slowMojang = process.argv.includes('--slow-mojang');
    const baselineArg = process.argv.find(arg => arg.startsWith('--proxy-baseline='));
    const baselineProxy = baselineArg ? path.resolve(baselineArg.slice('--proxy-baseline='.length)) : null;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-progressive-stats-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0, proxyDirectHost: '127.0.0.1',
        proxyDirectPort: direct, proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: false,
        urchinRequestDelayMs: 400, urchinRequestConcurrency: 2,
        hypixelRequestDelayMs: 400, hypixelRequestConcurrency: 2,
        autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, tabStatsEnabled: true,
        nametagOverlayEnabled: false, showTagsInTabStats: true,
        tabStatsBedwarsFields: ['stars', 'name', 'fkdr', 'tags', 'ws'], scanMode: 'all' }));
    const preload = path.join(directory, 'fixture.cjs');
    const resolve = name => JSON.stringify(require.resolve(name));
    const extraPlayers = Array.from({ length: 13 }, (_, i) => ({
        name: `Roster${i}`, uuid: (i + 4).toString(16).padStart(32, '0')
            .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
    }));
    fs.writeFileSync(preload, `
${baselineProxy ? `const Module=require('module'),loadJs=Module._extensions['.js'];
Module._extensions['.js']=(m,f)=>f===${JSON.stringify(path.join(root, 'proxy.js'))}?m._compile(require('fs').readFileSync(${JSON.stringify(baselineProxy)},'utf8'),f):loadJs(m,f);` : ''}
const mc=require(${resolve('minecraft-protocol')}),server=mc.createServer,client=mc.createClient;
const ids={FastTags:'2'.repeat(32),LateTags:'3'.repeat(32),...${JSON.stringify(Object.fromEntries(extraPlayers.map(p => [p.name, p.uuid.replace(/-/g, '')])))}};
mc.createServer=o=>{const s=server({...o,host:'127.0.0.1','online-mode':false});s.on('login',c=>{ids[c.username]=c.uuid.replace(/-/g,'');});return s;};
mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${resolve('../../src/accounts/connectionAuth')}).hasSavedLogin=()=>true;
const H=require(${resolve('../../features/hypixel_api_client')}),createH=H.createHypixelApiClient;
H.createHypixelApiClient=o=>createH({...o,getKeys:()=>({hypixel:'synthetic-key'})});
const U=require(${resolve('../../features/urchin_client')}),createU=U.createUrchinClient;
U.createUrchinClient=o=>createU({...o,getKey:()=> 'synthetic-key'});
const S=require(${resolve('../../src/stats/sources')}),createS=S.createStatsSources;
S.createStatsSources=o=>createS({...o,getAuroraKey:()=> 'synthetic-key'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const note=(provider,name)=>require('fs').appendFileSync(${JSON.stringify(path.join(directory, 'requests.jsonl'))},JSON.stringify({provider,name,at:Date.now()})+'\\n');
require(${resolve('axios')}).post=async(url,body,options={})=>{
 if(url!=='https://api.urchin.gg/v3/players')throw Error('Unexpected external POST');
 if(!Array.isArray(body.uuids)||body.uuids.length<1||body.uuids.length>2)throw Error('Invalid UUID batch size');
 const names=body.uuids.map(id=>Object.keys(ids).find(n=>ids[n]===id));
 if(names.some(n=>!n)||options.headers['X-API-Key']!=='synthetic-key')throw Error('Invalid UUID batch');
 note('tag_http',names);names.forEach(name=>note('tags',name));
 await sleep(names.includes('LateTags')?6000:80);
 names.forEach(name=>note('tags_end',name));note('tag_http_end',names);
 return {status:200,headers:{},data:{players:Object.fromEntries(body.uuids.map((id,i)=>[id,names[i]==='LateTags'?[{tag_type:'sniper',reason:'Synthetic fixture',added_by_username:'Fixture'}]:[]]))}};
};
require(${resolve('axios')}).get=async(url,options={})=>{
 const u=new URL(url);
 if(u.hostname==='api.mojang.com'||u.hostname==='api.minecraftservices.com'){
   const name=u.pathname.split('/').pop(),fallback=u.hostname==='api.minecraftservices.com';note(fallback?'mojang_fallback':'mojang',name);
   if(${slowMojang}&&!fallback&&name==='FastTags')await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(Object.assign(Error('Timeout'),{code:'ECONNABORTED'})),3000);
     options.signal.addEventListener('abort',()=>{clearTimeout(timer);note('mojang_cancel',name);reject(Object.assign(Error('Cancelled'),{code:'ERR_CANCELED'}));},{once:true});
   });
   if(!ids[name])throw Object.assign(Error('Missing'),{response:{status:404}});await sleep(30);return {data:{id:ids[name],name}};
 }
 if(u.hostname==='api.hypixel.net'){
   await sleep(80);const id=u.searchParams.get('uuid'),name=Object.keys(ids).find(n=>ids[n]===id);
   note('hypixel',name);
   return {status:200,headers:{},data:{player:{uuid:id,displayname:name,achievements:{bedwars_level:100},stats:{Bedwars:{final_kills_bedwars:200,final_deaths_bedwars:20,wins_bedwars:100,losses_bedwars:50,winstreak:2}}}}};
 }
 if(u.hostname==='api.urchin.gg'&&u.pathname.endsWith('/player/tags')){
   throw Error('Automatic stats must use ready UUIDs, not name-tag prefetches');
 }
 if(u.hostname==='bordic.xyz'){const id=options.params.uuid.replace(/-/g,'');await sleep(id===ids.LateTags?4500:80);return {data:{success:true,data:[]}};}
 throw Error('External request blocked in progressive stats fixture');
};
`);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort,
        'online-mode': false, version: '1.8.9', keepAlive: false });
    let peer, player, child, refreshTimer, roster;
    const tab = [], chat = [], upstreamChat = [], latestTab = new Map(), started = Date.now();
    upstream.on('login', c => {
        c.on('chat', packet => upstreamChat.push(packet.message));
        peer = c; c.on('error', () => {});
        c.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1, maxPlayers: 16, levelType: 'default', reducedDebugInfo: false });
        c.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
        const players = [{ uuid: c.uuid, name: 'StatsTester' },
            { uuid: '22222222-2222-2222-2222-222222222222', name: 'FastTags' },
            { uuid: '33333333-3333-3333-3333-333333333333', name: 'LateTags' }];
        roster = players;
        c.write('player_info', { action: 'add_player', data: players.map(p => ({ ...p, properties: [], gamemode: 0, ping: 1, displayName: null })) });
        for (const [team, prefix, names] of [['Red1', '\u00a7cR ', ['StatsTester']], ['Blue1', '\u00a79B ', ['FastTags', 'LateTags']]]) {
            c.write('scoreboard_team', { team, mode: 0, name: team, prefix, suffix: '', friendlyFire: 0,
                nameTagVisibility: 'always', color: 15, players: names });
        }
        c.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        c.write('scoreboard_display_objective', { name: 'bedwars', position: 1 });
        c.write('scoreboard_score', { itemName: 'Diamond II in 5:00', action: 0, scoreName: 'bedwars', value: 5 });
    });
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')],
            cleanEnvironment(directory, root, cosmetic, blocked), 'Progressive stats proxy');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Proxy startup');
        const usage = (await getJson(`http://127.0.0.1:${health}/health`)).urchinUsage;
        assert.equal(usage.concurrency, 2, 'The production proxy must load the two-read policy');
        assert.equal(usage.minSpacingMs, 400, 'Saved Urchin settings must load when the proxy starts');
        assert.equal(usage.localBudget.limit, 300);
        const hypixelQueue = (await getJson(`http://127.0.0.1:${health}/health`)).hypixelUsage.queue;
        assert.equal(hypixelQueue.gameSpacingMs, 400);
        assert.equal(hypixelQueue.concurrency, 2);
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'StatsTester', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', () => {});
        player.on('packet', (data, meta) => {
            if (meta.name === 'player_info' && (data.action === 'update_display_name' || data.action === 3)) {
                for (const row of data.data) {
                    const uuid = (row.uuid || row.UUID).replace(/-/g, '');
                    const text = row.displayName ? extractText(JSON.parse(row.displayName)) : '';
                    latestTab.set(uuid, text);
                    if (row.displayName) tab.push({ uuid, text, at: Date.now() - started });
                }
            }
            if (meta.name === 'chat') chat.push({ text: extractText(JSON.parse(data.message)), packet: JSON.parse(data.message), at: Date.now() - started });
        });
        await eventually(() => {
            assertRunning(child);
            assert(tab.some(row => row.uuid === '3'.repeat(32) && row.text.includes('10.00') && row.text.includes('[U:...]')));
        }, 'Primary LateTags stats before tags and ping', 4000);
        assert(!tab.some(row => row.uuid === '3'.repeat(32) && /sniper/i.test(row.text)));
        player.write('chat', { message: '/scan' });
        await new Promise(resolve => setTimeout(resolve, 1500));
        assertRunning(child);
        assert(!chat.some(row => /SCAN RESULTS|SCAN COMPLETE|FKDR:/.test(row.text)),
            'Local scan results and headers wait while another player is still loading');
        await eventually(() => {
            assertRunning(child);
            assert(tab.some(row => row.uuid === '3'.repeat(32) && /sniper/i.test(row.text)));
            assert(chat.some(row => row.text.includes('FastTags') && row.text.includes('FKDR:')));
            assert(chat.some(row => row.text.includes('LateTags') && row.text.includes('FKDR:')));
        }, 'Late tags enrich Tab Stats and finish the scan', 12000);
        assert.equal(chat.filter(row => row.text.includes('FastTags') && row.text.includes('FKDR:')).length, 1);
        assert.equal(chat.filter(row => row.text.includes('LateTags') && row.text.includes('FKDR:')).length, 1);
        assert(!chat.some(row => row.text.includes('SCAN COMPLETE')), 'Scan has no completion footer');
        const headerIndex = chat.findIndex(row => row.text.includes('SCAN RESULTS'));
        assert.equal(chat[headerIndex].text, 'SCAN RESULTS');
        assert.equal(chat[headerIndex + 1].text.trim(), '', 'Blank chat packet after the results heading');
        assert.match(chat[headerIndex + 2].text, /TEAM$/);
        const lastPlayerIndex = chat.findLastIndex(row => row.text.includes('FKDR:'));
        await eventually(() => assert.equal(chat[lastPlayerIndex + 1]?.text.trim(), ''), 'Blank chat packet after the final player');
        const taggedRow = chat.find(row => row.text.includes('LateTags') && row.text.includes('FKDR:'));
        assert(taggedRow.packet.extra.some(part => part.hoverEvent && part.clickEvent), 'Buffered badges retain their hover/click actions');

        // Configure the actual proxy through Minecraft chat, without making
        // extra lookups or resetting the allowance already spent above.
        const budgetBefore = (await getJson(`http://127.0.0.1:${health}/health`)).urchinUsage.localBudget.remaining;
        player.write('chat', { message: '/urchinrate delay 350' });
        await eventually(async () => {
            assert.equal((await getJson(`http://127.0.0.1:${health}/health`)).urchinUsage.minSpacingMs, 350);
        }, 'Changing Urchin delay immediately');
        player.write('chat', { message: '/urchinrate concurrency 1' });
        await eventually(async () => {
            assert.equal((await getJson(`http://127.0.0.1:${health}/health`)).urchinUsage.concurrency, 1);
        }, 'Changing Urchin concurrency immediately');
        const savedRate = JSON.parse(fs.readFileSync(path.join(directory, 'features_config.json')));
        assert.equal(savedRate.urchinRequestDelayMs, 350);
        assert.equal(savedRate.urchinRequestConcurrency, 1);
        assert.equal(savedRate.autoStatsDenickEnabled, false);
        assert(chat.some(row => row.text.includes('Delay: 350 ms')));
        player.write('chat', { message: '/urchinrate concurrency 0' });
        await eventually(() => assert(chat.some(row => row.text.includes('whole number from 1 to 16'))), 'Invalid Urchin setting feedback');
        assert.equal((await getJson(`http://127.0.0.1:${health}/health`)).urchinUsage.concurrency, 1);
        player.write('chat', { message: '/urchinrate reset' });
        await eventually(async () => {
            const rate = (await getJson(`http://127.0.0.1:${health}/health`)).urchinUsage;
            assert.equal(rate.minSpacingMs, 200); assert.equal(rate.concurrency, 1);
            assert.equal(rate.localBudget.remaining, budgetBefore);
        }, 'Restoring Urchin defaults without refilling the budget');
        assert(!upstreamChat.some(text => text.startsWith('/urchinrate')), 'Settings commands stay local');

        const hypixelSpent = (await getJson(`http://127.0.0.1:${health}/health`)).hypixelUsage.lastFiveMinutes;
        player.write('chat', { message: '/hypixelrate delay 350' });
        await eventually(async () => assert.equal((await getJson(`http://127.0.0.1:${health}/health`)).hypixelUsage.queue.gameSpacingMs, 350), 'Changing Hypixel delay');
        player.write('chat', { message: '/hypixelrate concurrency 1' });
        await eventually(async () => assert.equal((await getJson(`http://127.0.0.1:${health}/health`)).hypixelUsage.queue.concurrency, 1), 'Changing Hypixel concurrency');
        const savedHypixel = JSON.parse(fs.readFileSync(path.join(directory, 'features_config.json')));
        assert.equal(savedHypixel.hypixelRequestDelayMs, 350);
        assert.equal(savedHypixel.hypixelRequestConcurrency, 1);
        assert.equal(savedHypixel.urchinRequestDelayMs, 200);
        assert.equal(savedHypixel.urchinRequestConcurrency, 1);
        const priorMessages = chat.length;
        player.write('chat', { message: '/hypixelrate delay -1' });
        await eventually(() => assert(chat.slice(priorMessages).some(row => row.text.includes('whole number from 0 to 60000'))), 'Invalid Hypixel delay feedback');
        assert.equal((await getJson(`http://127.0.0.1:${health}/health`)).hypixelUsage.queue.gameSpacingMs, 350);
        player.write('chat', { message: '/hypixelrate reset' });
        await eventually(async () => {
            const rate = (await getJson(`http://127.0.0.1:${health}/health`)).hypixelUsage;
            assert.equal(rate.queue.gameSpacingMs, 150); assert.equal(rate.queue.concurrency, 2);
            assert.equal(rate.lastFiveMinutes, hypixelSpent);
        }, 'Restoring Hypixel defaults without resetting usage');
        assert(!upstreamChat.some(text => text.startsWith('/hypixelrate')));

        // A full Bed Wars tab can receive a fresh display-name packet every
        // second. Later entries must not have their 175 ms stagger reset
        // forever, and cached rows must survive the server replacements.
        peer.write('player_info', { action: 'add_player', data: extraPlayers.map(p => ({ ...p, properties: [], gamemode: 0, ping: 1, displayName: null })) });
        for (const [team, prefix, names, mode] of [
            ['Red1', '\u00a7cR ', extraPlayers.slice(0, 3).map(p => p.name), 3],
            ['Blue1', '\u00a79B ', extraPlayers.slice(3, 5).map(p => p.name), 3],
            ['Green1', '\u00a7aG ', extraPlayers.slice(5, 9).map(p => p.name), 0],
            ['Yellow1', '\u00a7eY ', extraPlayers.slice(9).map(p => p.name), 0]
        ]) peer.write('scoreboard_team', { team, mode, name: team, prefix, suffix: '', friendlyFire: 0,
            nameTagVisibility: 'always', color: 15, players: names });
        roster = [...roster, ...extraPlayers];
        const refresh = () => peer.write('player_info', { action: 'update_display_name', data: roster.map((p, i) => ({
            uuid: p.uuid, displayName: JSON.stringify({ text: `Server row ${i}` })
        })) });
        refresh();
        refreshTimer = setInterval(refresh, 1000);
        await eventually(() => {
            assertRunning(child);
            for (const p of roster) assert(latestTab.get(p.uuid.replace(/-/g, ''))?.includes('10.00'), `${p.name} must keep its loaded stats during repeated server updates`);
        }, 'All sixteen rows render while server display updates continue', 8000);
        await new Promise(resolve => setTimeout(resolve, 1150));
        for (const p of roster) assert(latestTab.get(p.uuid.replace(/-/g, ''))?.includes('10.00'), 'Another raw server update must not leave loaded stats hidden');
        clearInterval(refreshTimer); refreshTimer = null;
        await eventually(() => {
            assertRunning(child);
            for (const p of roster) assert(!latestTab.get(p.uuid.replace(/-/g, ''))?.includes('[U:...]'), 'Paced tags eventually finish after the primary stats');
        }, 'Finishing paced tag enrichment without delaying primary stats', 12000);
        const requests = fs.readFileSync(path.join(directory, 'requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(requests.filter(r => r.provider === 'mojang_fallback').length, slowMojang ? 1 : 0,
            'Only the stalled name uses one shared fallback across tab and Scan.');
        if (slowMojang) {
            const primary = requests.find(r => r.provider === 'mojang' && r.name === 'FastTags');
            const fallback = requests.find(r => r.provider === 'mojang_fallback' && r.name === 'FastTags');
            assert(fallback.at - primary.at >= 980 && fallback.at - primary.at < 1600);
            assert.equal(requests.filter(r => r.provider === 'mojang_cancel' && r.name === 'FastTags').length, 1);
        }
        const initialTagsFinishedAt = Math.max(...requests.filter(r => r.provider === 'tags_end' && ['FastTags', 'LateTags'].includes(r.name)).map(r => r.at)) - started;
        const resultRows = chat.filter(row => row.text.includes('FKDR:'));
        assert(resultRows.every(row => row.at >= initialTagsFinishedAt), 'All scan rows follow the slow tag check');
        let activeTags = 0, peakTags = 0, previousTagStart = null;
        for (const request of requests) {
            if (request.provider === 'tag_http') {
                peakTags = Math.max(peakTags, ++activeTags);
                if (previousTagStart !== null) assert(request.at - previousTagStart >= 180, 'Real proxy tag starts retain the paced floor within timestamp tolerance');
                previousTagStart = request.at;
            } else if (request.provider === 'tag_http_end') activeTags--;
        }
        assert(peakTags <= 4, 'The real proxy must respect the shared physical-request cap');
        assert(requests.some(row => row.provider === 'tag_http'));
        assert(requests.filter(row => row.provider === 'tag_http').every(row => row.name.length <= 2));
        for (const name of ['FastTags', 'LateTags', ...extraPlayers.map(p => p.name)]) for (const provider of ['mojang', 'hypixel', 'tags']) {
            assert.equal(requests.filter(row => row.provider === provider && row.name === name).length, 1,
                `${name}: prefetch, scan and repeated tab updates share one ${provider} request`);
        }
        fs.mkdirSync(path.join(root, 'output/progressive-stats'), { recursive: true });
        fs.writeFileSync(path.join(root, 'output/progressive-stats/packets.json'), JSON.stringify({ tab, chat, requests }, null, 2));
        console.log('PASS real proxy: early Tab Stats, complete scan batches, stable sixteen-player refreshes, provider deduplication' + (slowMojang ? ', and one delayed Mojang fallback with loser cancellation.' : '.'));
    } catch (error) { console.error(child?.output, JSON.stringify({ tab, chat }, null, 2)); throw error; }
    finally {
        clearInterval(refreshTimer);
        player?.end(); peer?.end(); player?.socket?.destroy(); peer?.socket?.destroy(); upstream.close();
        await stopChild(child);
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
