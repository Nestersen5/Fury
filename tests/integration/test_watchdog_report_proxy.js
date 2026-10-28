'use strict';

// Real 1.8.9 wire packets through production proxy.js; all data/auth/network
// fixtures are isolated from the user's accounts and from Hypixel.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mc = require('minecraft-protocol');
const { unusedPorts, cleanEnvironment, startChild, stopChild, assertRunning, eventually, getJson } = require('../../scripts/smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SUCCESS = 'Thanks for your Cheating (Hacking) report. We understand your concerns and it will be reviewed as soon as possible.';
function item(id, name, damage = 0, lore = []) {
    return { blockId: id, itemCount: 1, itemDamage: damage, nbtData: { type: 'compound', name: '', value: {
        display: { type: 'compound', value: { Name: { type: 'string', value: name },
            Lore: { type: 'list', value: { type: 'string', value: lore } } } }
    } } };
}

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-watchdog-proxy-'));
    const [direct, failover, health, upstreamPort, cosmetic, blocked] = await unusedPorts(6);
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({
        proxyDirectHost: '127.0.0.1', proxyDirectPort: direct,
        proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health
    }));
    fs.writeFileSync(path.join(directory, 'features_config.json'), JSON.stringify({
        apiKillSwitchEnabled: true, autoSkinDenickEnabled: false, autoStatsDenickEnabled: false,
        pregameChatStatsEnabled: false, sessionTrackingEnabled: false
    }));
    const preload = path.join(directory, 'offline-fixture.js');
    fs.writeFileSync(preload, `const mc = require(${JSON.stringify(require.resolve('minecraft-protocol'))});
const createServer = mc.createServer, createClient = mc.createClient;
mc.createServer = options => createServer({ ...options, host: '127.0.0.1', 'online-mode': false });
mc.createClient = options => createClient({ ...options, host: '127.0.0.1', port: ${upstreamPort}, auth: 'offline' });
require(${JSON.stringify(path.join(root, 'src/accounts/connectionAuth.js'))}).hasSavedLogin = () => true;
require(${JSON.stringify(require.resolve('axios'))}).defaults.adapter = async () => { throw new Error('Offline fixture'); };
`);
    const env = cleanEnvironment(directory, root, cosmetic, blocked);
    env.FURY_ENABLE_DIAGNOSTICS = '0';
    const upstream = mc.createServer({ host: '127.0.0.1', port: upstreamPort, 'online-mode': false, version: '1.8.9', keepAlive: false });
    const sent = [], received = [], messages = [], errors = [];
    const menuTimers = new Set();
    let child, player, connection, positioned = false, windowId = 0, target = null;
    let lastMenuUpdate = 0, earlyClicks = 0;
    let complete = null;
    let gameContext = false;
    const chat = text => connection.write('chat', { message: JSON.stringify({ text }), position: 0 });
    const open = name => {
        target = name; windowId++; complete = null;
        chat('Please wait...');
        const reportWindow = windowId;
        const items = Array.from({ length: 63 }, () => ({ blockId: -1 }));
        items[11] = item(159, '§aSubmit Report', 13);
        items[13] = item(397, `§7/report §b${name}`, 3,
            ['§7', ...(gameContext ? ['§7§7Bed Wars'] : []), `§7§eReport ${name} for cheating/hacking`]);
        items[15] = item(159, '§cCancel Report', 14);
        items[54] = item(345, 'Compass');
        connection.write('open_window', { windowId, inventoryType: 'minecraft:chest', slotCount: 27,
            windowTitle: JSON.stringify({ text: 'Report Cheating/Hacking' }) });
        connection.write('window_items', { windowId, items });
        lastMenuUpdate = Date.now();
        // Replay the initial update burst observed in the failed live test.
        for (const ms of [4, 149]) {
            const timer = setTimeout(() => {
                menuTimers.delete(timer);
                if (windowId !== reportWindow) return;
                lastMenuUpdate = Date.now();
                if (ms === 149) connection.write('window_items', { windowId, items });
                else for (const slot of [11, 13, 15]) connection.write('set_slot', { windowId, slot, item: items[slot] });
            }, ms);
            menuTimers.add(timer);
        }
    };
    upstream.on('error', error => errors.push(error.message));
    upstream.on('login', client => {
        connection = client;
        client.on('error', error => errors.push(error.message));
        client.on('packet', (data, meta) => {
            sent.push({ name: meta.name, data });
            if (meta.name === 'chat' && /^\/wdr /.test(data.message)) {
                const name = data.message.split(' ')[1];
                if (name === 'TooSoon') chat('You are sending commands too fast! Please slow down.');
                else open(name);
            }
            if (meta.name === 'window_click') {
                if (Date.now() - lastMenuUpdate < 300) { earlyClicks++; return; }
                assert.equal(data.windowId, windowId); assert.equal(data.slot, 11);
                assert.equal(data.item.blockId, 159);
                client.write('transaction', { windowId, action: data.action, accepted: false });
                const reportWindow = windowId;
                const finish = () => {
                    chat('Submitting Report...');
                    if (reportWindow % 2 === 0) {
                        chat(SUCCESS);
                        const timer = setTimeout(() => {
                            menuTimers.delete(timer);
                            client.write('close_window', { windowId: reportWindow });
                        }, 25);
                        menuTimers.add(timer);
                    } else {
                        client.write('close_window', { windowId: reportWindow }); chat(SUCCESS);
                    }
                    if (complete === finish) complete = null;
                };
                complete = finish;
            }
        });
        client.write('login', { entityId: 1, gameMode: 0, dimension: 0, difficulty: 1,
            maxPlayers: 8, levelType: 'default', reducedDebugInfo: false });
        client.write('position', { x: 0, y: 80, z: 0, yaw: 0, pitch: 0, flags: 0 });
    });
    const reportCommands = () => sent.filter(p => p.name === 'chat' && p.data.message.startsWith('/wdr ')).map(p => p.data.message);
    try {
        child = startChild(process.execPath, ['--require', preload, path.join(root, 'proxy.js')], env, 'Hidden report proxy fixture');
        await eventually(async () => { assertRunning(child); assert((await getJson(`http://127.0.0.1:${health}/health`)).ok); }, 'Starting isolated proxy');
        player = mc.createClient({ host: '127.0.0.1', port: direct, username: 'Alice', auth: 'offline', version: '1.8.9', keepAlive: false });
        player.on('error', error => errors.push(error.message));
        player.on('position', () => { positioned = true; });
        player.on('packet', (data, meta) => received.push({ name: meta.name, data }));
        player.on('chat', data => messages.push(data.message));
        await eventually(async () => { assertRunning(child); assert(positioned); }, 'Connecting local player');
        player.write('chat', { message: '/wdr First Second FIRST Third Last' });
        await eventually(async () => assert(complete && target === 'FIRST'), 'Confirming first hidden report');
        assert.deepEqual(reportCommands(), ['/wdr FIRST']);
        player.write('position_look', { x: 4, y: 80, z: 2, yaw: 90, pitch: 0, onGround: true });
        player.write('chat', { message: 'still moving' });
        player.write('chat', { message: '/wdr status' });
        await eventually(async () => {
            assert(sent.some(p => p.name === 'position_look' && p.data.x === 4));
            assert(sent.some(p => p.name === 'chat' && p.data.message === 'still moving'));
            assert(sent.some(p => p.name === 'transaction' && p.data.accepted));
            assert(messages.some(text => text.includes('0/4 confirmed')));
        }, 'Movement, chat, status and rejected click acknowledgment during report');
        assert(!received.some(p => ['open_window', 'window_items', 'transaction'].includes(p.name)));
        assert(received.some(p => p.name === 'set_slot' && p.data.windowId === 0 && p.data.slot === 36 && p.data.item.blockId === 345));
        complete();
        await eventually(async () => assert(complete && target === 'Second'), 'Starting second report only after confirmation');
        complete();
        await eventually(async () => assert(complete && target === 'Third'), 'Starting third report');
        complete();
        await eventually(async () => assert(complete && target === 'Last'), 'Starting fourth report');
        complete();
        await eventually(async () => assert(messages.some(text => text.includes('Reports confirmed for'))), 'Finishing four-player batch with both completion packet orders');
        assert.deepEqual(reportCommands(), ['/wdr FIRST', '/wdr Second', '/wdr Third', '/wdr Last']);
        assert.equal(received.filter(p => p.name === 'chat' && p.data.message.includes('Thanks for your')).length, 0);
        assert(!received.some(p => p.name === 'chat' && /Please wait|Submitting Report/.test(p.data.message)), 'native report progress stays hidden');
        assert(!messages.some(text => /Reporting \d+ player|Report confirmed for/.test(text)), 'no per-player notices');

        gameContext = true;
        for (const [name, packet, data] of [
            ['BlockAttempt', 'block_place', { location: { x: -1, y: -1, z: -1 }, direction: -1,
                heldItem: { blockId: -1 }, cursorX: 0, cursorY: 0, cursorZ: 0 }],
            ['InventoryAttempt', 'client_command', { payload: 2 }]
        ]) {
            const start = sent.length;
            player.write('chat', { message: `/wdr ${name} Skipped` });
            await eventually(async () => assert(target === name), 'Receiving report menu with Bed Wars context');
            player.write(packet, data);
            await eventually(async () => assert(sent.slice(start).some(p => p.name === 'close_window')), 'Closing report after gameplay interruption');
            assert(!sent.slice(start).some(p => p.name === 'window_click'), 'interrupting before Submit must cancel its timer');
        }
        player.write('chat', { message: '/wdr RetryOne RetryTwo RetryThree RetryFour' });
        for (const name of ['RetryOne', 'RetryTwo', 'RetryThree', 'RetryFour']) {
            await eventually(async () => assert(complete && target === name), 'Submitting later batch with Bed Wars context after interruptions');
            complete();
        }
        await eventually(async () => assert(messages.filter(text => text.includes('Reports confirmed for')).length === 2), 'Finishing second batch without reconnecting');

        player.write('chat', { message: '/wdr Fourth Fifth' });
        await eventually(async () => assert(complete && target === 'Fourth'), 'Starting cancellable batch');
        const boundary = sent.length;
        const finishCancelled = complete;
        player.write('chat', { message: '/wdr cancel' });
        await eventually(async () => assert(sent.slice(boundary).some(p => p.name === 'close_window')), 'Closing cancelled hidden menu');
        player.write('chat', { message: '/wdr Recovered' });
        await eventually(async () => assert(complete && target === 'Recovered'), 'Starting another report without an old confirmation or reconnect');
        finishCancelled();
        player.write('chat', { message: '/wdr status' });
        await eventually(async () => assert(messages.slice(-6).some(text => text.includes('0/1 confirmed'))), 'Ignoring cancelled report close and success during the new report');
        assert(!messages.some(text => text.includes('Reports confirmed for') && text.includes('Recovered')));
        complete();
        await eventually(async () => assert(messages.some(text => text.includes('Reports confirmed for') && text.includes('Recovered'))), 'Confirming only the current report');
        await delay(900);
        assert(!reportCommands().includes('/wdr Fifth'));
        assert(!reportCommands().includes('/wdr Skipped'));
        player.write('chat', { message: '/wdr TooSoon Sixth' });
        await eventually(async () => assert(messages.some(text => text.includes('sending commands too fast') && text.includes('TooSoon'))), 'Stopping on server cooldown');
        await delay(900);
        assert(!reportCommands().includes('/wdr Sixth'));
        // A normal menu can reuse an old hidden ID and must display normally.
        connection.write('open_window', { windowId, inventoryType: 'minecraft:chest', slotCount: 27, windowTitle: 'Shop' });
        connection.write('window_items', { windowId, items: Array.from({ length: 63 }, () => ({ blockId: -1 })) });
        await eventually(async () => assert(received.some(p => p.name === 'open_window' && p.data.windowTitle === 'Shop')), 'Preserving normal menus and reused IDs');
        player.write('close_window', { windowId });
        player.write('chat', { message: '/watchdogreport Manual fly' });
        await eventually(async () => assert(sent.some(p => p.name === 'chat' && p.data.message === '/watchdogreport Manual fly')), 'Preserving original command');
        assert.deepEqual(errors, []);
        assert.equal(earlyClicks, 0, 'never click before initial report updates settle');
        console.log('Production proxy report checks passed: four-player batch with both completion orders, live-layout settling, hidden menus, movement/chat, inventory mapping, ACKs, cancellation recovery, stale results, cooldown and normal menus.');
    } catch (error) {
        console.error({ reports: reportCommands(), recentMessages: messages.slice(-8), proxyOutput: child?.output }); throw error;
    } finally {
        for (const timer of menuTimers) clearTimeout(timer);
        player?.end(); connection?.end(); player?.socket?.destroy(); connection?.socket?.destroy();
        upstream.close();
        if (child) await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
