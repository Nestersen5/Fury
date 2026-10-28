'use strict';

// Actual 1.8.9 packets through the release proxy, with isolated data/auth and
// no Hypixel connection. Withheld report automation must leave native flow alone.
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const success = 'Thanks for your Cheating (Hacking) report. We understand your concerns and it will be reviewed as soon as possible.';
const item = (id, name, damage = 0, lore = []) => ({ blockId: id, itemCount: 1, itemDamage: damage,
    nbtData: { type: 'compound', name: '', value: { display: { type: 'compound', value: {
        Name: { type: 'string', value: name }, Lore: { type: 'list', value: { type: 'string', value: lore } }
    } } } } });

(async () => {
    assert(!fs.existsSync(path.join(root, 'src/menu/watchdogReport.js')), 'Automation module must not ship in this release');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-native-report-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyDirectHost: '127.0.0.1',
        proxyDirectPort: direct, proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true,
        autoSkinDenickEnabled: false, autoStatsDenickEnabled: false, pregameChatStatsEnabled: false, sessionTrackingEnabled: false }));
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const mc=require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const server=mc.createServer,client=mc.createClient;
mc.createServer=o=>server({...o,host:'127.0.0.1','online-mode':false});
mc.createClient=o=>client({...o,host:'127.0.0.1',port:${upstreamPort},auth:'offline'});
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin=()=>true;
require(${JSON.stringify(require.resolve('axios'))}).defaults.adapter=async()=>{throw Error('Offline fixture');};
`);
    const env = cleanEnvironment(directory, root, cosmetic, blocked);
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false,
        version: '1.8.9', keepAlive: false });
    const sent = [], received = [], messages = [], errors = [];
    let child, player, connection, positioned = false;
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', client => {
        connection = client;
        client.on('error', error => errors.push(error.message));
        client.on('packet', (data, meta) => sent.push({ name: meta.name, data }));
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    const commands = () => sent.filter(p => p.name === 'chat').map(p => p.data.message);
    const chat = text => connection.write('chat', { message: JSON.stringify({ text }), position: 0 });
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Native report release fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Starting isolated proxy');
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'Alice', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('position', () => { positioned = true; });
        player.on('packet', (data, meta) => received.push({ name: meta.name, data }));
        player.on('chat', data => messages.push(data.message));
        await eventually(() => { assertRunning(child); assert(positioned); }, 'Connecting local player');

        player.write('chat', { message: '/wdr DemoPlayer' });
        await eventually(() => assert(commands().includes('/wdr DemoPlayer')), 'Native command forwarded');
        const windowId = 7, items = Array.from({ length: 63 }, () => ({ blockId: -1 }));
        items[11] = item(159, '§aSubmit Report', 13);
        items[13] = item(397, '§7/report §bDemoPlayer', 3, ['§7', '§eReport DemoPlayer for cheating/hacking']);
        items[15] = item(159, '§cCancel Report', 14);
        chat('Please wait...');
        connection.write('open_window', { windowId, inventoryType: 'minecraft:chest', slotCount: 27,
            windowTitle: JSON.stringify({ text: 'Report Cheating/Hacking' }) });
        connection.write('window_items', { windowId, items });
        await eventually(() => {
            assert(received.some(p => p.name === 'open_window' && p.data.windowId === windowId));
            assert(received.some(p => p.name === 'window_items' && p.data.windowId === windowId));
            assert(messages.some(text => text.includes('Please wait...')));
        }, 'Native report menu and progress remain visible');
        await delay(900);
        assert(!sent.some(p => p.name === 'window_click'), 'Proxy must not submit a report automatically');

        player.write('window_click', { windowId, slot: 11, mouseButton: 0, action: 37, mode: 0, item: items[11] });
        await eventually(() => assert(sent.some(p => p.name === 'window_click' && p.data.windowId === windowId
            && p.data.slot === 11 && p.data.action === 37)), 'Manual Submit click forwarded unchanged');
        connection.write('transaction', { windowId, action: 37, accepted: true });
        chat('Submitting Report...');
        connection.write('close_window', { windowId });
        chat(success);
        await eventually(() => {
            assert(received.some(p => p.name === 'transaction' && p.data.action === 37));
            assert(received.some(p => p.name === 'close_window' && p.data.windowId === windowId));
            assert(messages.some(text => text.includes('Submitting Report...')));
            assert(messages.some(text => text.includes(success)));
        }, 'Native confirmation and inventory replies remain visible');
        for (const command of ['/wdr First Second', '/watchdogreport Other fly']) {
            player.write('chat', { message: command });
            await eventually(() => assert(commands().includes(command)), 'Report command remains server-controlled');
        }
        assert.equal(sent.filter(p => p.name === 'window_click').length, 1, 'Only the manual click was sent');
        assert(!messages.some(text => text.includes('Started reporting:') || text.includes('Report confirmed for')));
        assert.deepEqual(errors, []);
        console.log('Native report command/menu/manual click/receipt passthrough passed; no automated reporting ships.');
    } finally {
        player?.end(); connection?.end();
        player?.socket?.destroy(); connection?.socket?.destroy();
        upstream.close();
        if (child) await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
