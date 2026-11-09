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
    fs.writeFileSync(path.join(directory, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0,
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
    let lastPosition = null, lastMotionAt = -Infinity;
    let recoverTeamMenus = false, closedEarly = 0, droppedMenu = 0, prematureReports = 0, reportBusyUntil = 0;
    const submittedTargets = [];
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
            if ((meta.name === 'position' || meta.name === 'position_look')
                && (!lastPosition || data.x !== lastPosition.x || data.y !== lastPosition.y || data.z !== lastPosition.z)) {
                lastPosition = { x: data.x, y: data.y, z: data.z };
                lastMotionAt = Date.now();
            }
            if (meta.name === 'chat' && /^\/wdr /.test(data.message)) {
                const name = data.message.split(' ')[1];
                if (name === 'TooSoon') chat('You are sending commands too fast! Please slow down.');
                else if (recoverTeamMenus && Date.now() < reportBusyUntil) prematureReports++;
                else if (recoverTeamMenus && name === 'RedTwo' && droppedMenu++ === 0) { target = name; complete = null; }
                else {
                    open(name);
                    if (recoverTeamMenus && name === 'RedOne' && closedEarly++ === 0) {
                        const reportWindow = windowId;
                        const timer = setTimeout(() => {
                            menuTimers.delete(timer);
                            client.write('close_window', { windowId: reportWindow });
                        }, 444);
                        menuTimers.add(timer);
                    }
                }
            }
            if (meta.name === 'window_click') {
                if (data.windowId === 0 || data.windowId === 200) return; // Player inventory / real shop, not an automatic Submit.
                assert(Date.now() - lastMotionAt >= 500, 'Submit must wait for a stationary moment');
                if (Date.now() - lastMenuUpdate < 300) { earlyClicks++; return; }
                assert.equal(data.windowId, windowId); assert.equal(data.slot, 11);
                assert.equal(data.action, 1, 'first automatic report click matches the captured native action number');
                assert.equal(data.item.blockId, 159);
                submittedTargets.push(target);
                client.write('transaction', { windowId, action: data.action, accepted: false });
                const reportWindow = windowId;
                const expectsReceipt = target !== 'NoReceipt';
                const finish = () => {
                    chat('Submitting Report...');
                    if (recoverTeamMenus) reportBusyUntil = Date.now() + 200;
                    let delivered = Promise.resolve();
                    if (reportWindow % 2 === 0) {
                        if (expectsReceipt) chat(SUCCESS);
                        delivered = new Promise(resolve => {
                            const timer = setTimeout(() => {
                                menuTimers.delete(timer);
                                client.write('close_window', { windowId: reportWindow });
                                resolve();
                            }, 25);
                            menuTimers.add(timer);
                        });
                    } else {
                        client.write('close_window', { windowId: reportWindow });
                        if (expectsReceipt) chat(SUCCESS);
                    }
                    if (recoverTeamMenus) delivered.then(() => {
                        const timer = setTimeout(() => {
                            menuTimers.delete(timer);
                            client.write('close_window', { windowId: 0 });
                        }, 29);
                        menuTimers.add(timer);
                    });
                    if (complete === finish) complete = null;
                    return delivered;
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
        await eventually(async () => assert(messages.some(text => text.includes('one player name'))), 'Rejecting multiple player names');
        assert.deepEqual(reportCommands(), [], 'invalid multi-player input sends no upstream report or menu');
        player.write('position', { x: 0, y: 80, z: 0, onGround: true });
        player.write('chat', { message: '/wdr FIRST' });
        for (let i = 1; i <= 6; i++) {
            player.write('position', { x: i, y: 80, z: 0, onGround: true });
            await delay(100);
        }
        assert.deepEqual(reportCommands(), [], 'keep moving normally without opening report menus');
        await eventually(async () => assert(complete && target === 'FIRST'), 'Confirming first hidden report');
        assert.deepEqual(reportCommands(), ['/wdr FIRST']);
        player.write('chat', { message: '/wdr Fifth' });
        await eventually(async () => assert(messages.some(text => text.includes('already running'))), 'Rejecting another report while busy');
        player.write('position_look', { x: 4, y: 80, z: 2, yaw: 90, pitch: 0, onGround: true });
        player.write('chat', { message: 'still moving' });
        player.write('chat', { message: '/wdr status' });
        await eventually(async () => {
            assert(sent.some(p => p.name === 'position_look' && p.data.x === 4));
            assert(sent.some(p => p.name === 'chat' && p.data.message === 'still moving'));
            assert(sent.some(p => p.name === 'transaction' && p.data.accepted));
            assert(messages.some(text => text.includes('0/1 confirmed')));
        }, 'Movement, chat, status and rejected click acknowledgment during report');
        assert(!received.some(p => ['open_window', 'window_items', 'transaction'].includes(p.name)));
        assert(received.some(p => p.name === 'set_slot' && p.data.windowId === 0 && p.data.slot === 36 && p.data.item.blockId === 345));
        complete();
        await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes('FIRST'))), 'Finishing the first single-player report');
        for (const name of ['Second', 'Third', 'Last']) {
            player.write('chat', { message: `/wdr ${name}` });
            await eventually(async () => assert(complete && target === name), 'Starting the next explicitly requested report');
            complete();
            await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes(name))), 'Completing one report with either confirmation packet order');
        }
        assert.deepEqual(reportCommands(), ['/wdr FIRST', '/wdr Second', '/wdr Third', '/wdr Last']);
        assert.equal(received.filter(p => p.name === 'chat' && p.data.message.includes('Thanks for your')).length, 0);
        assert(!received.some(p => p.name === 'chat' && /Please wait|Submitting Report/.test(p.data.message)), 'native report progress stays hidden');
        assert.equal(messages.filter(text => text.includes('Report confirmed for')).length, 4, 'one completion notice per explicit report');

        gameContext = true;
        {
            const name = 'BlockAttempt';
            const start = sent.length;
            player.write('chat', { message: `/wdr ${name}` });
            await eventually(async () => assert(target === name), 'Receiving report menu with Bed Wars context');
            player.write('block_place', { location: { x: -1, y: -1, z: -1 }, direction: -1,
                heldItem: { blockId: -1 }, cursorX: 0, cursorY: 0, cursorZ: 0 });
            player.write('use_entity', { target: 1, mouse: 1 });
            await eventually(async () => {
                assert(complete && target === name);
                assert(sent.slice(start).some(p => p.name === 'block_place'));
                assert(sent.slice(start).some(p => p.name === 'use_entity'));
            }, 'Submitting while block use and attacks pass through');
            assert(!sent.slice(start).some(p => p.name === 'close_window'), 'ordinary gameplay does not cancel the report');
            complete();
            await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes(name))), 'Completing report while playing');
        }
        {
            const name = 'InventoryAttempt';
            const start = sent.length;
            player.write('chat', { message: `/wdr ${name}` });
            await eventually(async () => assert(target === name), 'Receiving report before opening inventory');
            player.write('client_command', { payload: 2 });
            await eventually(async () => assert(sent.slice(start).some(p => p.name === 'close_window')), 'Releasing unsubmitted menu for inventory use');
            await delay(650);
            assert(!sent.slice(start).some(p => p.name === 'window_click'), 'never submit while the real inventory is open');
            const pausedWindow = windowId;
            player.write('window_click', { windowId: 0, slot: 36, mouseButton: 0, action: 1, mode: 0, item: { blockId: -1 } });
            await eventually(async () => assert(sent.slice(start).some(p => p.name === 'window_click' && p.data.windowId === 0)), 'Forwarding real inventory clicks');
            player.write('close_window', { windowId: 0 });
            await eventually(async () => assert(complete && target === name && windowId !== pausedWindow), 'Resuming the unsubmitted report after inventory closes');
            complete();
            await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes(name))), 'Completing the resumed inventory report');
        }
        for (const name of ['RetryOne', 'RetryTwo', 'RetryThree', 'RetryFour']) {
            player.write('chat', { message: `/wdr ${name}` });
            await eventually(async () => assert(complete && target === name), 'Submitting an explicit report with Bed Wars context after interruptions');
            complete();
            await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes(name))), 'Completing the contextual report');
        }
        assert.equal(messages.filter(text => text.includes('Report confirmed for')).length, 10, 'later single-player reports work without reconnecting');

        {
            const start = sent.length;
            player.write('chat', { message: '/wdr ShopPaused' });
            await eventually(async () => assert(target === 'ShopPaused'), 'Starting a report before opening a real shop');
            const interruptedWindow = windowId;
            connection.write('open_window', { windowId: 200, inventoryType: 'minecraft:chest', slotCount: 27,
                windowTitle: JSON.stringify({ text: 'Item Shop' }) });
            const items = Array.from({ length: 63 }, () => ({ blockId: -1 }));
            items[0] = item(1, 'Shop item');
            connection.write('window_items', { windowId: 200, items });
            await eventually(async () => {
                assert(received.some(p => p.name === 'open_window' && p.data.windowId === 200));
                assert(received.some(p => p.name === 'window_items' && p.data.windowId === 200));
            }, 'Keeping a player-opened shop visible while reports pause');
            await delay(650);
            assert(!sent.slice(start).some(p => p.name === 'close_window'), 'never close the shop or send a stale hidden-menu close');
            assert(!sent.slice(start).some(p => p.name === 'window_click'), 'do not submit behind the shop');
            player.write('window_click', { windowId: 200, slot: 0, mouseButton: 0, action: 2, mode: 0, item: items[0] });
            await eventually(async () => assert(sent.slice(start).some(p => p.name === 'window_click' && p.data.windowId === 200)), 'Forwarding real shop clicks');
            player.write('close_window', { windowId: 200 });
            await eventually(async () => assert(complete && target === 'ShopPaused' && windowId !== interruptedWindow), 'Resuming after the real shop closes');
            complete();
            await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes('ShopPaused'))), 'Completing the report after shopping');
        }

        {
            const start = sent.length;
            player.write('chat', { message: '/wdr MotionPaused' });
            await eventually(async () => assert(target === 'MotionPaused'), 'Opening a report before movement resumes');
            const interruptedWindow = windowId;
            for (let i = 0; i < 6; i++) {
                player.write('position', { x: 20 + i, y: 80, z: 0, onGround: true });
                await delay(100);
            }
            assert(!sent.slice(start).some(p => p.name === 'window_click'), 'movement before Submit cancels the settled click');
            assert(sent.slice(start).filter(p => p.name === 'position').length >= 6, 'forward every movement packet during deferral');
            await eventually(async () => assert(complete && target === 'MotionPaused' && windowId !== interruptedWindow), 'Reopening the unsubmitted report after a stationary moment');
            complete();
            await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes('MotionPaused'))), 'Completing the movement-deferred report once');
            assert.equal(submittedTargets.filter(name => name === 'MotionPaused').length, 1);
        }

        player.write('chat', { message: '/wdr Fourth' });
        await eventually(async () => assert(complete && target === 'Fourth'), 'Starting a cancellable report');
        const boundary = sent.length;
        const finishCancelled = complete;
        player.write('chat', { message: '/wdr cancel' });
        await eventually(async () => assert(sent.slice(boundary).some(p => p.name === 'close_window')), 'Closing cancelled hidden menu');
        player.write('chat', { message: '/wdr Recovered' });
        await eventually(async () => assert(complete && target === 'Recovered'), 'Starting another report without an old confirmation or reconnect');
        finishCancelled();
        player.write('chat', { message: '/wdr status' });
        await eventually(async () => assert(messages.slice(-6).some(text => text.includes('0/1 confirmed'))), 'Ignoring cancelled report close and success during the new report');
        assert(!messages.some(text => text.includes('Report confirmed for') && text.includes('Recovered')));
        complete();
        await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes('Recovered'))), 'Confirming only the current report');
        await delay(900);
        assert(!reportCommands().includes('/wdr Fifth'));
        player.write('chat', { message: '/wdr TooSoon' });
        await eventually(async () => assert(messages.some(text => text.includes('sending commands too fast') && text.includes('TooSoon'))), 'Stopping on server cooldown');
        await delay(900);
        // A normal menu can reuse an old hidden ID and must display normally.
        connection.write('open_window', { windowId, inventoryType: 'minecraft:chest', slotCount: 27, windowTitle: 'Shop' });
        connection.write('window_items', { windowId, items: Array.from({ length: 63 }, () => ({ blockId: -1 })) });
        await eventually(async () => assert(received.some(p => p.name === 'open_window' && p.data.windowTitle === 'Shop')), 'Preserving normal menus and reused IDs');
        player.write('close_window', { windowId });
        player.write('chat', { message: '/watchdogreport Manual fly' });
        await eventually(async () => assert(sent.some(p => p.name === 'chat' && p.data.message === '/watchdogreport Manual fly')), 'Preserving original command');

        const beforeTeams = reportCommands().length;
        player.write('chat', { message: '/wdr red' });
        await eventually(async () => assert(messages.some(text => text.includes('No players found') && text.includes('Red'))), 'Rejecting a team outside a Bed Wars game');
        assert.equal(reportCommands().length, beforeTeams);
        const members = [
            { uuid: player.uuid, name: 'Alice' },
            { uuid: '11111111-1111-1111-1111-111111111111', name: 'RedOne' },
            { uuid: '22222222-2222-2222-2222-222222222222', name: 'RedTwo' },
            { uuid: '33333333-3333-3333-3333-333333333333', name: '123player' },
            { uuid: '44444444-4444-4444-4444-444444444444', name: 'GrayMate' },
            { uuid: '55555555-5555-5555-5555-555555555555', name: 'RankOnly' }
        ];
        connection.write('player_info', { action: 'add_player', data: members.map(member => ({
            ...member, properties: [], gamemode: 0, ping: 1,
            displayName: member.name === 'RankOnly' ? JSON.stringify({ text: '§bRankOnly' }) : null
        })) });
        const team = (name, prefix, players) => connection.write('scoreboard_team', {
            team: name, mode: 0, name, prefix, suffix: '', friendlyFire: 0, nameTagVisibility: 'always', color: 15, players
        });
        // Explicit prefixes take precedence over misleading raw team IDs.
        team('Blue10', '§c§lR §r§c', ['RedOne']);
        team('Red2', '§cR ', ['RedTwo']);
        team('Blue0', '§9B ', ['Alice']);
        team('Red9', '§9B ', ['123player']);
        team('Gray0', '§8G ', ['GrayMate']);
        connection.write('scoreboard_objective', { name: 'bedwars', action: 0, displayText: 'BED WARS', type: 'integer' });
        connection.write('scoreboard_display_objective', { name: 'bedwars', position: 1 });
        connection.write('scoreboard_score', { itemName: 'Diamond II in 5:00', action: 0, scoreName: 'bedwars', value: 5 });
        await eventually(async () => assert(received.some(packet => packet.name === 'scoreboard_score'
            && packet.data.itemName === 'Diamond II in 5:00')), 'Establishing the live Bed Wars teams');
        connection.write('player_info', { action: 'remove_player', data: [{ uuid: members[2].uuid }] });
        await eventually(async () => assert(received.some(packet => packet.name === 'player_info'
            && (packet.data.action === 'remove_player' || packet.data.action === 4))), 'Removing an observed team member from tab');
        player.write('chat', { message: '/wdr ReD' });
        await eventually(async () => assert(complete && target === 'RedOne'), 'Submitting the first Red team report');
        const beforePause = sent.length;
        const pauseMessages = messages.length;
        player.write('client_command', { payload: 2 });
        await eventually(async () => assert(messages.slice(pauseMessages).some(text => text.includes('Paused while'))), 'Pausing the team after Submit for inventory use');
        assert(!sent.slice(beforePause).some(p => p.name === 'close_window'), 'local inventory opening lets the in-flight Submit finish normally');
        await complete();
        chat('Team report confirmation delivered.');
        await eventually(async () => assert(messages.some(text => text.includes('Team report confirmation delivered.'))), 'Processing both report signals before asking for paused status');
        player.write('chat', { message: '/wdr status' });
        await eventually(async () => assert(messages.some(text => text.includes('1/2 confirmed') && text.includes('Paused:'))), 'Retaining server-confirmed progress while inventory is open');
        await delay(650);
        assert.deepEqual(reportCommands().slice(beforeTeams), ['/wdr RedOne'], 'do not start the next team report while inventory is open');
        player.write('close_window', { windowId: 0 });
        await eventually(async () => assert(complete && target === 'RedTwo'), 'Resuming the next Red team member after inventory closes');
        complete();
        await eventually(async () => assert(messages.some(text => text.includes('Reports confirmed for')
            && text.includes('RedOne, RedTwo'))), 'Confirming every Red team member in one request');
        assert.deepEqual(reportCommands().slice(beforeTeams), ['/wdr RedOne', '/wdr RedTwo']);
        player.write('chat', { message: '/wdr blue' });
        await eventually(async () => assert(complete && target === '123player'), 'Selecting Blue members, including numeric usernames, while excluding the reporting player');
        complete();
        await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes('123player'))), 'Confirming the Blue team');
        player.write('chat', { message: '/wdr grey' });
        await eventually(async () => assert(complete && target === 'GrayMate'), 'Resolving the grey team alias');
        complete();
        await eventually(async () => assert(messages.some(text => text.includes('Report confirmed for') && text.includes('GrayMate'))), 'Confirming the Gray team');
        player.write('chat', { message: '/wdr aqua' });
        await eventually(async () => assert(messages.some(text => text.includes('No players found') && text.includes('Aqua'))), 'Ignoring rank color without actual team membership');
        assert.deepEqual(reportCommands().slice(beforeTeams), ['/wdr RedOne', '/wdr RedTwo', '/wdr 123player', '/wdr GrayMate']);

        const extraMembers = [
            { uuid: '66666666-6666-6666-6666-666666666666', name: 'RedThree' },
            { uuid: '77777777-7777-7777-7777-777777777777', name: 'RedFour' }
        ];
        connection.write('player_info', { action: 'add_player', data: extraMembers.map(member => ({
            ...member, properties: [], gamemode: 0, ping: 1, displayName: null
        })) });
        team('Red3', '§cR ', ['RedThree']); team('Red4', '§cR ', ['RedFour']);
        chat('Four-player report fixture ready.');
        await eventually(async () => assert(messages.some(text => text.includes('Four-player report fixture ready.'))), 'Establishing all four Red team members');
        const beforeRecovery = reportCommands().length, beforeSubmits = submittedTargets.length, beforeMessages = messages.length;
        recoverTeamMenus = true;
        player.write('chat', { message: '/wdr red' });
        for (const name of ['RedOne', 'RedTwo', 'RedThree', 'RedFour']) {
            await eventually(async () => assert(complete && target === name), `Recovering and submitting ${name} in a four-player team report`);
            await complete();
        }
        await eventually(async () => assert(messages.slice(beforeMessages).some(text => text.includes('Reports confirmed for')
            && text.includes('RedOne, RedTwo, RedThree, RedFour'))), 'Finishing all four selected members despite an early close and a missing menu');
        recoverTeamMenus = false;
        assert.deepEqual(reportCommands().slice(beforeRecovery), ['/wdr RedOne', '/wdr RedOne', '/wdr RedTwo', '/wdr RedTwo', '/wdr RedThree', '/wdr RedFour']);
        assert.deepEqual(submittedTargets.slice(beforeSubmits), ['RedOne', 'RedTwo', 'RedThree', 'RedFour'], 'one Submit per player despite reopening two menus');
        assert.equal(prematureReports, 0, 'never open the next report during the prior menu cleanup');
        connection.write('respawn', { dimension: 0, difficulty: 1, gamemode: 0, levelType: 'default' });
        chat('You are now in the lobby!');
        await eventually(async () => assert(messages.some(text => text.includes('You are now in the lobby!'))), 'Leaving the team game');
        player.write('position', { x: 25, y: 80, z: 0, onGround: true });
        const messageBoundary = messages.length;
        player.write('chat', { message: '/wdr red' });
        await eventually(async () => assert(messages.slice(messageBoundary).some(text => text.includes('No players found'))), 'Rejecting stale teams after returning to the lobby');
        assert.equal(reportCommands().length, beforeTeams + 10);
        player.write('chat', { message: '/wdr NoReceipt' });
        await eventually(async () => assert(complete && target === 'NoReceipt'), 'Submitting one report whose server receipt will be omitted');
        const missingReceiptStart = messages.length;
        const missingReceiptPackets = sent.length;
        player.write('block_place', { location: { x: -1, y: -1, z: -1 }, direction: -1,
            heldItem: { blockId: -1 }, cursorX: 0, cursorY: 0, cursorZ: 0 });
        await eventually(async () => assert(sent.slice(missingReceiptPackets).some(p => p.name === 'block_place')), 'Keeping gameplay flowing while awaiting the report reply');
        chat("You can't place blocks here!");
        await complete();
        await eventually(async () => assert(messages.slice(missingReceiptStart).some(text => text.includes('The menu closed, but Hypixel did not confirm the report')
            && text.includes('NoReceipt'))), 'Distinguishing an absent server receipt from a menu-opening timeout');
        let reportEvents;
        await eventually(async () => {
            const logDir = path.join(directory, 'packet_logs', 'menu');
            reportEvents = fs.readdirSync(logDir).filter(file => file.endsWith('.jsonl')).flatMap(file =>
                fs.readFileSync(path.join(logDir, file), 'utf8').split('\n').flatMap(line => {
                    try { const entry = JSON.parse(line); return entry.p === 'automation' && entry.source === 'watchdog-report' ? [entry.event] : []; }
                    catch { return []; }
                }));
            assert(reportEvents.some(event => event.target === 'NoReceipt' && event.event === 'timeout'));
        }, 'Writing scoped report diagnostics through the shared buffered menu log');
        const receiptTimeout = reportEvents.find(event => event.target === 'NoReceipt' && event.event === 'timeout');
        assert.equal(receiptTimeout.serverClosed, true);
        assert.equal(receiptTimeout.receipt, false);
        assert.equal(receiptTimeout.activity['afterSubmit:block_place'].count, 1);
        assert(reportEvents.some(event => event.target === 'NoReceipt' && event.event === 'feedback' && event.text === "You can't place blocks here!"));
        assert.equal(submittedTargets.filter(name => name === 'NoReceipt').length, 1, 'never retry an unconfirmed Submit');
        assert.deepEqual(errors, []);
        assert.equal(earlyClicks, 0, 'never click before initial report updates settle');
        console.log('Production proxy report checks passed: single-player validation, team selection and sequencing, team aliases, departed members, own-player exclusion, explicit team evidence, empty/stale teams, busy rejection, both completion orders, live-layout settling, hidden menus, normal movement/chat/attacks/block use, stationary dispatch/Submit, movement pause and unsubmitted-menu resumption, inventory pause/resume before and after Submit, real inventory and shop ownership/forwarding, four-player early-close and missing-menu recovery, trailing inventory-close settling, one Submit per player, scoped report feedback/action diagnostics, missing-receipt timeout, inventory mapping, ACKs, cancellation recovery, stale results, cooldown and normal menus.');
    } catch (error) {
        console.error({ reports: reportCommands(), recentMessages: messages.slice(-8), proxyOutput: child?.output }); throw error;
    } finally {
        for (const timer of menuTimers) clearTimeout(timer);
        player?.end(); connection?.end(); player?.socket?.destroy(); connection?.socket?.destroy();
        upstream.close();
        if (child) await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
