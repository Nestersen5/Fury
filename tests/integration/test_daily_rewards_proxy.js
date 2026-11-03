'use strict';

// Real Minecraft 1.8.9 sockets and production proxy; synthetic rewards/auth,
// isolated settings and no requests to Hypixel or the user's running app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mc = require('minecraft-protocol');
const { extractText } = require('../../features/minecraft_chat');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const ID = '1234abcd', SECOND = '2345abcd', SHARED = 'abcd1234';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function rewardItem() {
    return { blockId: 54, itemCount: 1, itemDamage: 0, nbtData: { type: 'compound', name: '', value: {
        display: { type: 'compound', value: {
            Name: { type: 'string', value: '§aDaily Reward (#12)' },
            Lore: { type: 'list', value: { type: 'string', value: ['§eClick here to get the link in chat!'] } }
        } }
    } } };
}

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-daily-rewards-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    const requestLog = path.join(directory, 'reward-requests.jsonl');
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0,
        proxyDirectHost: '127.0.0.1', proxyDirectPort: direct,
        proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({
        apiKillSwitchEnabled: false, tabStatsEnabled: false, autoSkinDenickEnabled: false,
        autoStatsDenickEnabled: false, pregameChatStatsEnabled: false, sessionTrackingEnabled: false
    }));
    const preload = path.join(directory, 'fixture.cjs');
    fs.writeFileSync(preload, `
const fs=require('fs'),mc=require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const server=mc.createServer,client=mc.createClient;
mc.createServer=o=>server({...o,host:'127.0.0.1','online-mode':false});
mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin=()=>true;
require(${JSON.stringify(require.resolve('axios'))}).defaults.adapter=async config=>{
 const url=new URL(config.url);
 if(url.origin!=='https://rewards.hypixel.net')throw Error('External requests disabled in reward fixture');
 const id=config.method==='get'?url.pathname.split('/').pop():url.searchParams.get('id');
 const headers=config.headers;
 fs.appendFileSync(${JSON.stringify(requestLog)},JSON.stringify({method:config.method,id,option:url.searchParams.get('option'),
   cookie:headers.get('Cookie')==='_csrf=SyntheticCookie',referer:headers.get('Referer')==='https://rewards.hypixel.net/claim-reward/'+id,
   origin:headers.get('Origin')==='https://rewards.hypixel.net',skipped:url.searchParams.get('skipped')})+'\\n');
 const cards=[{reward:'coins',gameType:'TNTGAMES',rarity:'COMMON',amount:4000},
   {reward:'coins',gameType:'DUELS',rarity:'COMMON',amount:3000},{reward:'dust',rarity:'EPIC',amount:40}];
 const data={id,rewards:cards,skippable:id!=='ffffffff',activeAd:2,dailyStreak:{score:3,highScore:19}};
 return {status:200,statusText:'OK',config,headers:{'set-cookie':['_csrf=SyntheticCookie; Path=/']},
   data:config.method==='get'?'window.securityToken = "SyntheticCsrfToken"; window.appData = '+"'"+JSON.stringify(data)+"';":'reward claimed'};
};
`);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    let child, player, peer, id = ID, bookFirst = true, windowId = 0;
    const received = [], sent = [], chat = [], errors = [];
    const writeChat = component => peer.write('chat', { message: JSON.stringify(component), position: 0 });
    const link = () => writeChat({ text: '\nClick the link to visit our website and claim your reward: ', extra: [{
        text: 'https://rewards.hypixel.net/claim-reward/' + id,
        clickEvent: { action: 'open_url', value: 'https://hypixel.net/claim-reward/' + id }
    }] });
    const book = () => peer.write('custom_payload', { channel: 'MC|BOpen', data: Buffer.from([0]) });
    upstream.on('login', connection => {
        peer = connection; connection.on('error', error => errors.push(error.message));
        connection.on('packet', (data, meta) => {
            sent.push({ name: meta.name, data });
            if (meta.name === 'window_click') {
                if (bookFirst) { book(); link(); } else { link(); book(); }
            }
        });
        connection.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        connection.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    const requests = () => fs.existsSync(requestLog) ? fs.readFileSync(requestLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const choices = rewardId => chat.flatMap(row => row.extra || []).filter(part => part.text === '[CLAIM]'
        && part.clickEvent?.value.includes(rewardId));
    const open = async () => {
        windowId++;
        peer.write('open_window', { windowId, inventoryType: 'minecraft:chest', slotCount: 27,
            windowTitle: JSON.stringify({ text: 'The Delivery Man' }) });
        const items = Array.from({ length: 63 }, () => ({ blockId: -1 })); items[10] = rewardItem();
        peer.write('window_items', { windowId, items });
        await eventually(() => assert(received.some(row => row.name === 'window_items' && row.data.windowId === windowId)), 'Delivery Man inventory');
        player.write('window_click', { windowId, slot: 10, mouseButton: 0, action: windowId, mode: 0, item: rewardItem() });
    };
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')],
            cleanEnvironment(directory, root, cosmetic, blocked), 'Daily rewards proxy');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Proxy startup');
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'RewardTester', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('packet', (data, meta) => {
            received.push({ name: meta.name, data });
            if (meta.name === 'chat') chat.push(JSON.parse(data.message));
        });
        await eventually(() => assert(peer && received.some(row => row.name === 'position')), 'Connected test player');
        for (const first of [true, false]) {
            id = first ? ID : SECOND; bookFirst = first;
            await open();
            await eventually(() => { assertRunning(child); assert.equal(choices(id).length, 3); }, 'Three clickable cards');
            assert.equal(requests().filter(row => row.id === id && row.method === 'get').length, 1);
            assert.equal(requests().filter(row => row.id === id && row.method === 'post').length, 0);
            assert(received.some(row => row.name === 'close_window' && row.data.windowId === windowId));
            assert(sent.some(row => row.name === 'close_window' && row.data.windowId === windowId));
            assert(!received.some(row => row.name === 'custom_payload' && row.data.channel === 'MC|BOpen'), 'Reward book never opens');
            player.write('chat', { message: choices(id)[2].clickEvent.value });
            await eventually(() => assert(chat.some(row => extractText(row).includes('Claimed') && extractText(row).includes('Mystery Dust'))), 'Claim success');
            await eventually(() => assert.equal(requests().filter(row => row.id === id && row.method === 'post').length, 1), 'Single claim POST');
            player.write('chat', { message: choices(id)[0].clickEvent.value });
            await delay(100);
            const post = requests().find(row => row.id === id && row.method === 'post');
            assert.equal(post.option, '2'); assert(post.cookie && post.referer && post.origin); assert.equal(post.skipped, '0');
        }
        writeChat({ text: `[410✫] [MVP++] Friend: https://hypixel.net/claim-reward/${SHARED}` });
        await eventually(() => assert(chat.some(row => row.extra?.some(part => part.text === ' [CLAIM REWARD]'))), 'Shared link button');
        assert(!requests().some(row => row.id === SHARED), 'Shared link is not fetched automatically');
        const sharedButton = chat.flatMap(row => row.extra || []).find(part => part.text === ' [CLAIM REWARD]');
        player.write('chat', { message: sharedButton.clickEvent.value });
        await eventually(() => assert.equal(choices(SHARED).length, 3), 'Shared reward cards');
        player.write('chat', { message: choices(SHARED)[1].clickEvent.value });
        await eventually(() => assert(chat.some(row => extractText(row).includes('for Friend.'))), 'Shared reward claim');
        player.write('chat', { message: '/dailyreward mode auto' });
        await eventually(() => assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'features_config.json'))).dailyReward.mode, 'auto'), 'Saved auto-pick setting');
        player.write('chat', { message: '/dailyreward off' });
        await eventually(() => assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'features_config.json'))).dailyReward.enabled, false), 'Saved off setting');
        id = 'ffffffff'; await open();
        await eventually(() => assert(received.some(row => row.name === 'custom_payload' && row.data.channel === 'MC|BOpen')), 'Disabled book passes through');
        assert(!requests().some(row => row.id === id));
        player.write('chat', { message: '/dailyreward on' });
        await eventually(() => assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'features_config.json'))).dailyReward.enabled, true), 'Re-enable');
        await open();
        await eventually(() => assert(chat.some(row => extractText(row).includes('cannot skip the ad'))), 'Unskippable reward browser fallback');
        assert(!requests().some(row => row.id === id && row.method === 'post'));
        assert(!sent.some(row => row.name === 'chat' && /^\/dailyreward(?:\s|$)/.test(row.data.message)), 'Fury commands never leak to Hypixel');
        assert.deepEqual(errors, []);
        console.log('Daily reward proxy checks passed: both book/link orders, clickable cards, one POST per pick, shared links, settings, disabled passthrough and browser fallback.');
    } catch (error) {
        console.error({ recentChat: chat.slice(-8).map(extractText), requests: requests(), proxyOutput: child?.output });
        throw error;
    } finally {
        player?.end(); peer?.end(); player?.socket?.destroy(); peer?.socket?.destroy();
        upstream.close(); if (child) await stopChild(child);
    }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
