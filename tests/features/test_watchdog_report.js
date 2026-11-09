'use strict';

const assert = require('assert/strict');
const { createWatchdogReport } = require('../../src/menu/watchdogReport');
const { createMenuMonitor } = require('../../src/menu/menuMonitor');
const { createHypixelCommandQueue } = require('../../src/net/hypixelCommandQueue');

function item(id, name, damage = 0, lore = []) {
    return { blockId: id, itemCount: 1, itemDamage: damage, nbtData: { type: 'compound', name: '', value: {
        display: { type: 'compound', value: { Name: { type: 'string', value: name },
            Lore: { type: 'list', value: { type: 'string', value: lore } } } }
    } } };
}
function reportItems(target) {
    const items = Array.from({ length: 63 }, () => ({ blockId: -1 }));
    items[11] = item(159, '§aSubmit Report', 13);
    items[13] = item(397, `§7/report §b${target}`, 3, ['§7', `§7§eReport ${target} for cheating/hacking`]);
    items[15] = item(159, '§cCancel Report', 14);
    items[54] = item(345, 'Compass');
    return items;
}
const SUCCESS = 'Thanks for your Cheating (Hacking) report. We understand your concerns and it will be reviewed as soon as possible.';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness({ getTeamPlayers = () => [], transitionMs = 0, minimumStillMs = 0,
    maxOpenRetries = 1, diagnosticFailure = false } = {}) {
    let now = 0, timerId = 0, blocked = null;
    const timers = new Map(), upstream = [], downstream = [], messages = [], diagnostics = [];
    const setTimer = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; };
    const clearTimer = id => timers.delete(id);
    const advance = async ms => {
        const end = now + ms;
        for (;;) {
            const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > end) break;
            now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
        }
        now = end; await flush();
    };
    const send = (name, data) => upstream.push({ name, data, at: now });
    const monitor = createMenuMonitor({ sendUpstream: (name, data) => {
        send(name, data);
        if (name === 'window_click') upstream.at(-1).synthetic = true;
    }, dir: null, log: () => {}, itemNameLookup: () => null });
    const recordEvent = monitor.recordAutomationEvent;
    monitor.recordAutomationEvent = (source, event) => {
        if (diagnosticFailure) throw new Error('Logging unavailable');
        diagnostics.push(JSON.parse(JSON.stringify({ source, ...event })));
        recordEvent(source, event);
    };
    const queue = createHypixelCommandQueue({ send: message => send('chat', { message }),
        now: () => now, setTimeout: setTimer, clearTimeout: clearTimer });
    const reporter = createWatchdogReport({ menuMonitor: monitor, sendCommand: queue.enqueue, getTeamPlayers, transitionMs,
        minimumStillMs: minimumStillMs ?? undefined, maxOpenRetries,
        sendUpstream: (name, data) => { send(name, data); monitor.setHold(false); monitor.observeClientPacket(data, { name }); },
        sendClient: (name, data) => downstream.push({ name, data }), sendChat: text => messages.push(text),
        canStart: () => blocked || (monitor.getWindow() ? 'Close your current menu first.' : null),
        setTimer, clearTimer, timeoutMs: 1000, now: () => now });
    const server = (name, data) => {
        const shared = monitor.observeServerPacket(data, { name });
        const hidden = reporter.observeServer(data, { name });
        if (!shared && !hidden) downstream.push({ name, data });
        return shared || hidden;
    };
    const client = (name, data = {}) => {
        if (reporter.observeClient(data, { name })) return true;
        if (monitor.observeClientPacket(data, { name })) return true;
        send(name, data);
        return false;
    };
    const open = (target, windowId = 2, items = reportItems(target)) => {
        server('open_window', { windowId, inventoryType: 'minecraft:chest', slotCount: 27,
            windowTitle: JSON.stringify({ text: 'Report ', extra: [{ text: 'Cheating/Hacking' }] }) });
        server('window_items', { windowId, items });
    };
    const chat = (text, position = 0) => server('chat', { message: JSON.stringify({ text }), position });
    const ready = async (...args) => { open(...args); await advance(350); };
    const confirm = (windowId = 2) => { server('close_window', { windowId }); chat(SUCCESS); };
    const command = text => { reporter.command(text.split(/\s+/)); return flush(); };
    const clicks = () => upstream.filter(p => p.name === 'window_click' && p.synthetic);
    const commands = () => upstream.filter(p => p.name === 'chat').map(p => p.data.message);
    return { reporter, upstream, downstream, messages, diagnostics, timers, server, client, open, ready, confirm, chat, command, clicks, commands, advance,
        block: value => { blocked = value; },
        dispose: () => { reporter.dispose(); queue.close(); monitor.dispose(); assert.equal(timers.size, 0); } };
}

(async () => {
    {
        const members = ['RedOne', 'RedTwo', 'REDONE', 'Bad-Name', 'RedThree'];
        const resolved = [];
        const h = harness({ getTeamPlayers: team => { resolved.push(team); return members; } });
        try {
            await h.command('/wdr ReD');
            assert.deepEqual(resolved, ['Red']);
            assert.deepEqual(h.commands(), ['/wdr RedOne']);
            members.push('LatePlayer'); // The explicit request owns its original selection.
            await h.command('/wdr blue');
            assert(h.messages.at(-1).includes('already running'));
            assert.deepEqual(resolved, ['Red'], 'Busy commands cannot replace or expand the selected team');
            await h.ready('RedOne');
            h.chat(SUCCESS);
            await h.advance(20);
            assert.deepEqual(h.commands(), ['/wdr RedOne'], 'Success alone cannot advance the team');
            h.server('close_window', { windowId: 2 });
            await h.command('/wdr status');
            assert(h.messages.at(-1).includes('1/3 confirmed'));
            await h.advance(30);
            assert.deepEqual(h.commands(), ['/wdr RedOne', '/wdr RedTwo'], 'Next member uses the existing command cooldown');
            await h.ready('RedTwo', 3);
            h.server('close_window', { windowId: 3 });
            await h.advance(20);
            assert.equal(h.commands().length, 2, 'Close alone cannot advance the team');
            h.chat(SUCCESS); await h.advance(30);
            assert.equal(h.commands().at(-1), '/wdr RedThree');
            await h.ready('RedThree', 4); h.confirm(4);
            assert(!h.reporter.isBusy());
            assert(h.messages.at(-1).includes('Reports confirmed for §fRedOne, RedTwo, RedThree'));
            assert.equal(h.clicks().length, 3, 'One submit per distinct valid member');
            assert.equal(h.messages.filter(text => text.includes('confirmed for')).length, 1, 'One final team summary');
        } finally { h.dispose(); }
    }
    for (const [alias, expected] of [['blue', 'Blue'], ['GREEN', 'Green'], ['yellow', 'Yellow'], ['aqua', 'Aqua'],
        ['cyan', 'Aqua'], ['white', 'White'], ['pink', 'Pink'], ['gray', 'Gray'], ['grey', 'Gray']]) {
        const h = harness({ getTeamPlayers: team => { assert.equal(team, expected); return ['Member']; } });
        try {
            await h.command(`/wdr ${alias}`);
            assert.deepEqual(h.commands(), ['/wdr Member']);
            await h.ready('Member'); h.confirm();
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr red');
            assert.deepEqual(h.commands(), [], 'An unavailable team is never reported as a literal player');
            assert(h.messages.at(-1).includes('No players found on the §fRed'));
            assert(!h.reporter.isBusy());
            await h.command('/wdr help');
            assert(h.messages.some(text => typeof text === 'object' && JSON.stringify(text).includes('/wdr <team>')));
        } finally { h.dispose(); }
    }
    for (const end of ['cancel', 'timeout', 'error', 'command', 'world', 'blocked', 'dispose']) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second', 'Third'] });
        try {
            await h.command('/wdr blue'); await h.ready('First');
            if (end === 'blocked') h.block('Another feature is busy.');
            h.confirm(); await flush();
            // The next report is queued for the shared 400 ms command gap.
            if (end === 'cancel') await h.command('/wdr cancel');
            if (end === 'timeout') { await h.advance(50); h.open('Second', 3); await h.advance(1000); }
            if (end === 'error') { await h.advance(50); h.chat('You must wait before reporting again!'); }
            if (end === 'command') h.reporter.observeCommand('/lobby');
            if (end === 'world') h.server('respawn', {});
            if (end === 'dispose') h.reporter.dispose();
            await h.advance(2000);
            assert(!h.reporter.isBusy(), end);
            assert(!h.commands().includes('/wdr Third'), `Stopped team never advances: ${end}`);
            if (!['timeout', 'error'].includes(end)) assert.deepEqual(h.commands(), ['/wdr First'], end);
            if (end !== 'dispose') assert(h.messages.at(-1).includes('1/3 confirmed'), end);
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            for (const command of ['/wdr One Two', '/wdr One ONE', '/wdr A B C D E F G H']) {
                await h.command(command);
                assert.equal(h.commands().length, 0, 'multiple names are rejected before any report is sent');
                assert(h.messages.at(-1).includes('one player name'));
                assert(!h.reporter.isBusy());
            }
            await h.command('/wdr MixedCase');
            await h.command('/wdr QueuedPlayer');
            assert(h.messages.at(-1).includes('already running'));
            await h.ready('MixedCase'); h.confirm();
            await h.advance(2000);
            assert.deepEqual(h.commands(), ['/wdr MixedCase'], 'busy commands never queue a second report');
            await h.command('/wdr NextPlayer'); await h.ready('NextPlayer', 3); h.confirm(3);
            assert.deepEqual(h.commands(), ['/wdr MixedCase', '/wdr NextPlayer'], 'a completed report allows another explicit command');
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One');
            assert.equal(h.messages.length, 1);
            assert(h.messages[0].includes('Started reporting: \u00a7fOne'));
            assert(h.chat('Please wait...'));
            assert(!h.chat('Someone: Please wait...'));
            assert(!h.chat('Normal server notice'));
            assert(!h.chat('Please wait...', 2), 'never hide action bars');
            await h.ready('One');
            assert(h.chat('Submitting Report...'));
            assert.equal(h.messages.length, 1, 'only the start notice until completion');
            h.confirm();
            assert.equal(h.messages.length, 2);
            assert(h.messages[1].includes('Report confirmed for \u00a7fOne'));
            assert(!h.reporter.isBusy());
            h.reporter.observeCommand('/watchdogreport Manual fly');
            assert(!h.chat(SUCCESS), 'original manual report feedback is preserved');
        } finally { h.dispose(); }
    }
    for (const end of ['cancel', 'timeout']) {
        const h = harness();
        try {
            await h.command('/wdr One'); await h.ready('One');
            if (end === 'cancel') await h.command('/wdr cancel');
            else await h.advance(1000);
            assert.equal(h.messages.length, 2);
            assert(h.messages[1].includes('0/1 confirmed. Unconfirmed: §fOne'));
            assert(h.chat('Submitting Report...'));
            assert(h.chat(SUCCESS), 'late native feedback from the stopped report stays hidden');
            assert.equal(h.messages.length, 2, 'a late result must not print a second summary');
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        const contextualItems = name => {
            const items = reportItems(name);
            items[13] = item(397, `§7/report §b${name}`, 3,
                ['§7', '§7§7Bed Wars', `§7§eReport ${name} for`, '§echeating/hacking']);
            return items;
        };
        try {
            for (const [i, name] of ['A', 'B', 'C', 'D'].entries()) {
                await h.command(`/wdr ${name}`);
                await h.ready(name, i + 1); h.confirm(i + 1);
                if (i < 3) await h.advance(500);
            }
            h.server('respawn', {});
            await h.advance(400);
            for (const [i, name] of ['E', 'F', 'G', 'H'].entries()) {
                await h.command(`/wdr ${name}`);
                const windowId = i + 3;
                await h.ready(name, windowId, contextualItems(name));
                assert.equal(h.clicks().length, i + 5, 'the game-context lore must not prevent another explicit report from submitting: ' + JSON.stringify(h.messages.slice(-3)));
                h.confirm(windowId);
                if (i < 3) await h.advance(500);
            }
            assert.equal(h.messages.filter(t => typeof t === 'string' && t.includes('Report confirmed for')).length, 8);
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            for (const [index, name] of ['First', 'Second', 'Third', 'Fourth'].entries()) {
                await h.command(`/wdr ${name}`);
                const windowId = index + 1;
                await h.ready(name, windowId);
                await h.command('/wdr status');
                assert(h.messages.at(-1).includes('0/1 confirmed'));
                h.chat('Submitting Report...');
                if (index % 2 === 0) {
                    h.server('close_window', { windowId });
                    h.chat(SUCCESS);
                } else {
                    // Success can precede the menu-close packet. Keep it until
                    // this submitted window closes instead of discarding it.
                    h.server('chat', { position: 0, message: JSON.stringify({ text: '§aThanks for your ', extra: [
                        { text: 'Cheating (Hacking) report. We understand your concerns and it will be reviewed as soon as possible.' }
                    ] }) });
                    await h.advance(20);
                    assert.equal(h.messages.filter(t => typeof t === 'string' && t.includes('Report confirmed for')).length, index);
                    h.server('close_window', { windowId });
                }
                assert.equal(h.messages.filter(t => typeof t === 'string' && t.includes('Report confirmed for')).length, index + 1, 'both completion orders produce one summary per explicit report');
                h.chat(SUCCESS); // A duplicate receipt must not increment again.
                h.server('close_window', { windowId });
                if (index < 3) await h.advance(500);
            }
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr Second', '/wdr Third', '/wdr Fourth']);
            assert(h.messages.some(t => typeof t === 'string' && t.includes('Report confirmed for \u00a7fFourth')));
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One'); await h.ready('One');
            h.chat(SUCCESS);
            await h.command('/wdr cancel');
            await h.command('/wdr Three'); await h.advance(400); await h.ready('Three', 3);
            h.server('close_window', { windowId: 3 });
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Report confirmed for')), 'a buffered success from the cancelled request cannot confirm the next request');
            h.chat(SUCCESS); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One'); await h.ready('One');
            h.chat(SUCCESS); h.chat('You must wait before reporting again!');
            h.server('close_window', { windowId: 2 }); await h.advance(1500);
            assert.equal(h.commands().length, 1);
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Report confirmed for')), 'server rejection clears a buffered success');
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            // Timing/layout from the failed 2026-10-28 live capture: the first
            // full snapshot, a slot burst at +4 ms, then a resnapshot at +149 ms.
            await h.command('/wdr TestPlayer');
            h.open('TestPlayer');
            assert.equal(h.clicks().length, 0, 'never click the initial snapshot synchronously');
            await h.advance(4);
            for (const slot of [11, 13, 15]) h.server('set_slot', { windowId: 2, slot, item: reportItems('TestPlayer')[slot] });
            await h.advance(145);
            h.server('window_items', { windowId: 2, items: reportItems('TestPlayer') });
            await h.advance(349);
            assert.equal(h.clicks().length, 0, 'wait until the last initial update has settled');
            await h.advance(1);
            assert.equal(h.clicks().length, 1);
            // A resync after submission must not result in a second report click.
            h.server('window_items', { windowId: 2, items: reportItems('TestPlayer') });
            await h.advance(350);
            assert.equal(h.clicks().length, 1);
            h.confirm();
            await h.advance(500);
            assert.deepEqual(h.commands(), ['/wdr TestPlayer']);
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One'); await h.ready('One');
            h.chat(SUCCESS);
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Report confirmed for')), 'unlabelled success alone cannot confirm a new window');
            await h.advance(1000);
            assert(!h.reporter.isBusy(), 'a timed-out clicked report releases the queue');
            await h.command('/wdr cancel'); await h.command('/wdr Three');
            h.server('close_window', { windowId: 2 }); h.chat(SUCCESS);
            await h.advance(400); await h.ready('Three', 3);
            assert.equal(h.commands().length, 2, 'a timed-out report cannot start another report on its own');
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Report confirmed for')));
            h.confirm(3); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One'); h.open('One');
            await h.advance(349); await h.command('/wdr cancel'); await h.advance(1000);
            assert.equal(h.clicks().length, 0, 'cancel clears the pending settled click');
            assert(!h.reporter.isBusy());
            await h.command('/wdr Two'); h.open('Two', 3);
            await h.advance(349);
            h.server('set_slot', { windowId: 3, slot: 13, item: reportItems('Elsewhere')[13] });
            await h.advance(350);
            assert.equal(h.clicks().length, 0, 'revalidate the target when the timer fires');
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr one');
            assert.deepEqual(h.commands(), ['/wdr one']);
            assert.equal(h.reporter.observeClient({ x: 4, y: 80, z: 2, onGround: true }, { name: 'position' }), false);
            await h.ready('one');
            assert.equal(h.clicks().length, 1);
            assert.equal(h.clicks()[0].data.slot, 11);
            assert.equal(h.clicks()[0].data.action, 1, 'the first hidden report click matches the captured native per-window action number');
            assert.deepEqual(h.clicks()[0].data.item, reportItems('one')[11]);
            assert(!h.downstream.some(p => ['open_window', 'window_items'].includes(p.name)));
            assert(h.downstream.some(p => p.name === 'set_slot' && p.data.windowId === 0 && p.data.slot === 36 && p.data.item.blockId === 345));
            const action = h.clicks()[0].data.action;
            assert(h.server('transaction', { windowId: 2, action, accepted: false }));
            assert(h.upstream.some(p => p.name === 'transaction' && p.data.action === action && p.data.accepted));
            h.server('set_slot', { windowId: 2, slot: 11, item: reportItems('one')[11] });
            assert.equal(h.clicks().length, 1, 'incremental updates cannot duplicate confirmation');
            h.chat(`OtherPlayer: ${SUCCESS}`); h.chat(SUCCESS, 2);
            await h.advance(600);
            assert.equal(h.commands().length, 1, 'chat/actionbar spoof and click ACK are not success');
            h.server('close_window', { windowId: 2 }); h.chat(SUCCESS);
            await h.advance(500);
            assert.deepEqual(h.commands(), ['/wdr one']);
            assert(!h.reporter.isBusy());
            assert(h.messages.some(t => typeof t === 'string' && t.includes('Report confirmed for \u00a7fone')));
            assert(!h.downstream.some(p => p.name === 'chat' && p.data.position !== 2 && JSON.parse(p.data.message).text === SUCCESS), 'hide the native receipt after using it for confirmation');
            assert(h.server('window_items', { windowId: 2, items: reportItems('one') }), 'late hidden packets stay hidden');
            assert(!h.server('open_window', { windowId: 2, inventoryType: 'minecraft:chest', slotCount: 27, windowTitle: 'Shop' }), 'reused IDs return to normal');
            assert(!h.server('window_items', { windowId: 2, items: [] }));
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr help'); await h.command('/wdr');
            await h.command('/wdr Bad-Name');
            await h.command('/wdr A B C D E F G H I');
            assert.equal(h.commands().length, 0);
            h.block('Busy'); await h.command('/wdr One'); assert.equal(h.commands().length, 0);
            h.block(null);
            for (let i = 0; i < 8; i++) {
                await h.command(`/wdr ${'ABCDEFGH'[i]}`);
                await h.ready('ABCDEFGH'[i], i + 1); h.confirm(i + 1);
                if (i < 7) await h.advance(500);
            }
            assert.equal(h.clicks().length, 8); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    for (const mutation of ['wrong-player', 'wrong-item', 'no-target', 'wrong-lore', 'wrong-context-reason', 'ambiguous-context', 'duplicate-submit']) {
        const h = harness();
        try {
            await h.command('/wdr One');
            const items = reportItems(mutation === 'wrong-player' ? 'Elsewhere' : 'One');
            if (mutation === 'wrong-item') items[11].itemDamage = 14;
            if (mutation === 'no-target') items[13] = { blockId: -1 };
            if (mutation === 'wrong-lore') items[13] = item(397, '/report One', 3, ['Different report reason']);
            if (mutation === 'wrong-context-reason') items[13] = item(397, '/report One', 3, ['Bed Wars', 'Report One for chat abuse']);
            if (mutation === 'ambiguous-context') items[13] = item(397, '/report One', 3, ['Report Elsewhere for cheating/hacking', 'Report One for cheating/hacking']);
            if (mutation === 'duplicate-submit') items[12] = items[11];
            h.open('One', 2, items);
            assert.equal(h.clicks().length, 0, mutation);
            await h.advance(1000);
            assert.equal(h.commands().length, 1, 'never advance after an unconfirmed report');
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One');
            const items = reportItems('One'); items[15] = { blockId: -1 };
            h.open('One', 2, items); assert.equal(h.clicks().length, 0);
            h.server('set_slot', { windowId: 2, slot: 15, item: reportItems('One')[15] });
            await h.advance(350);
            assert.equal(h.clicks().length, 1, 'wait for complete menu, including incremental delivery');
            h.reporter.observeClient({ windowId: 0, slot: 36 }, { name: 'window_click' });
            assert(h.upstream.some(p => p.name === 'close_window'));
            assert(h.reporter.isBusy(), 'inventory use pauses the submitted request');
            await h.command('/wdr cancel');
            h.client('close_window', { windowId: 0 });
            await h.command('/wdr Two');
            h.chat(SUCCESS);
            await h.advance(400);
            await h.ready('Two', 3);
            h.server('close_window', { windowId: 2 }); h.chat(SUCCESS);
            assert(!h.messages.some(text => typeof text === 'string' && text.includes('Report confirmed for §fTwo')), 'late old close and chat cannot confirm the new window');
            h.confirm(3); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    for (const cancel of ['cancel', 'timeout', 'command', 'world']) {
        const h = harness({ maxOpenRetries: 0 }); // Exercise exhausted timeout cleanup separately from recovery.
        try {
            await h.command('/wdr One');
            if (cancel === 'cancel') await h.command('/wdr cancel');
            if (cancel === 'timeout') await h.advance(1000);
            if (cancel === 'command') h.reporter.observeCommand('/play bedwars_four_four');
            if (cancel === 'world') h.server('respawn', {});
            if (['cancel', 'timeout', 'command'].includes(cancel)) {
                h.open('One');
                assert(!h.downstream.some(p => p.name === 'open_window'), 'late cancelled menu stays hidden');
                assert(!h.reporter.isBusy());
            }
            await h.advance(2000);
            assert.equal(h.clicks().length, 0, cancel);
            assert.equal(h.commands().length, 1, cancel);
        } finally { h.dispose(); }
    }
    for (const text of ['You have already reported this player!', 'You must wait before reporting again!', 'You are sending commands too fast!', "Couldn't find a player with that name!"]) {
        const h = harness();
        try {
            await h.command('/wdr One'); h.chat(text); await h.advance(2000);
            assert.equal(h.commands().length, 1); assert.equal(h.clicks().length, 0); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            // Delay dispatch in the real shared command queue, then cancel.
            h.block(null); await h.command('/wdr One'); await h.ready('One'); h.confirm();
            await h.command('/wdr Two'); await h.command('/wdr cancel');
            await h.advance(1500);
            assert.deepEqual(h.commands(), ['/wdr One']);
            await h.command('/wdr Three');
            h.open('Three'); h.server('respawn', {});
            assert(!h.reporter.isBusy());
            await h.command('/wdr Four');
            await h.advance(400);
            assert.equal(h.commands().at(-1), '/wdr Four', 'world change clears hidden ownership');
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second', 'Third', 'Fourth'] });
        try {
            await h.command('/wdr red');
            for (const [index, name] of ['First', 'Second', 'Third', 'Fourth'].entries()) {
                if (index) await h.advance(50);
                h.open(name, index + 1);
                for (const packet of ['position', 'look', 'block_dig', 'block_place', 'use_entity', 'held_item_slot']) {
                    assert(!h.client(packet, { target: 1, mouse: 1 }), packet);
                }
                await h.advance(350);
                h.client('block_place'); h.client('use_entity', { target: 1, mouse: 1 });
                assert.equal(h.clicks().length, index + 1);
                h.confirm(index + 1);
            }
            assert(!h.reporter.isBusy());
            assert(h.messages.at(-1).includes('First, Second, Third, Fourth'));
            assert(!h.upstream.some(p => p.name === 'close_window'), 'normal gameplay never closes the hidden report');
        } finally { h.dispose(); }
    }
    for (const phase of ['queued', 'opening', 'settling']) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red');
            let target = 'First';
            if (phase === 'queued') { await h.ready('First'); h.confirm(); await flush(); target = 'Second'; }
            if (phase === 'settling') { h.open('First'); await h.advance(100); }
            const before = h.commands().length, submitted = h.clicks().length;
            h.client('client_command', { payload: 2 });
            if (phase === 'opening') h.open('First'); // Drain the already-sent command's delayed menu.
            h.client('window_click', { windowId: 0, slot: 36, action: 1, mode: 0, mouseButton: 0, item: { blockId: -1 } });
            await h.advance(2500);
            assert(h.reporter.isBusy(), `${phase}: inventory time is not a report timeout`);
            assert.equal(h.commands().length, before);
            assert.equal(h.clicks().length, submitted, 'no synthetic click in the player inventory');
            await h.command('/wdr status');
            assert(h.messages.at(-1).includes('Paused:'));
            assert.equal(h.messages.filter(text => typeof text === 'string' && text.includes('Paused while')).length, 1);
            h.client('close_window', { windowId: 0 }); await flush();
            assert.equal(h.commands().at(-1), `/wdr ${target}`);
            await h.ready(target, 3); h.confirm(3);
            if (target === 'First') { await h.advance(50); await h.ready('Second', 4); h.confirm(4); }
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2, 'each selected player is submitted exactly once');
        } finally { h.dispose(); }
    }
    for (const closeFirst of [true, false]) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red'); await h.ready('First');
            h.client('client_command', { payload: 2 });
            assert(!h.upstream.some(p => p.name === 'close_window'), 'opening local inventory lets the already submitted report finish normally');
            // Inventory opening and either single server signal are not confirmation.
            assert(h.reporter.isBusy());
            if (closeFirst) h.server('close_window', { windowId: 2 });
            else h.chat(SUCCESS);
            await h.command('/wdr status');
            assert(h.messages.at(-1).includes('0/2 confirmed'));
            if (closeFirst) h.chat(SUCCESS);
            else h.server('close_window', { windowId: 2 });
            await h.advance(2500);
            await h.command('/wdr status');
            assert(h.messages.at(-1).includes('1/2 confirmed'));
            assert.deepEqual(h.commands(), ['/wdr First'], 'confirmation cannot start another report while inventory is open');
            h.client('close_window', { windowId: 0 }); await flush();
            await h.ready('Second', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2);
        } finally { h.dispose(); }
    }
    for (const signal of ['none', 'receipt', 'close']) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red'); await h.ready('First');
            h.client('client_command', { payload: 2 });
            h.client('window_click', { windowId: 0, slot: 36, action: 1, mode: 0, mouseButton: 0, item: { blockId: -1 } });
            assert(h.upstream.some(p => p.name === 'close_window' && p.data.windowId === 2), 'release the submitted menu before forwarding real inventory edits');
            if (signal === 'receipt') h.chat(SUCCESS);
            if (signal === 'close') h.server('close_window', { windowId: 2 });
            h.client('close_window', { windowId: 0 }); await h.advance(1100);
            assert(!h.reporter.isBusy());
            assert.deepEqual(h.commands(), ['/wdr First'], 'an ambiguous Submit is never retried or advanced');
            assert.equal(h.clicks().length, 1);
            const expected = signal === 'receipt' ? 'its menu did not finish closing'
                : signal === 'close' ? 'Hypixel did not confirm the report' : 'Hypixel to confirm the submitted report';
            assert(h.messages.at(-1).includes(expected));
            assert(h.messages.at(-1).includes('0/2 confirmed'));
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red');
            h.client('client_command', { payload: 2 });
            h.client('close_window', { windowId: 0 }); await h.advance(100);
            assert.deepEqual(h.commands(), ['/wdr First'], 'wait for the old pending menu even if inventory closes quickly');
            h.open('First'); await h.advance(300);
            assert.equal(h.clicks().length, 0, 'drain the old menu before reopening');
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr First']);
            await h.ready('First', 3); h.confirm(3);
            await h.advance(50); await h.ready('Second', 4); h.confirm(4);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2);
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red'); await h.ready('First');
            h.server('open_window', { windowId: 8, inventoryType: 'minecraft:chest', slotCount: 27, windowTitle: 'Item Shop' });
            h.confirm(2); await h.advance(2000);
            await h.command('/wdr status');
            assert(h.messages.at(-1).includes('1/2 confirmed'));
            assert.deepEqual(h.commands(), ['/wdr First']);
            assert(!h.upstream.some(p => p.name === 'close_window'), 'late confirmation must not close the real shop');
            h.server('close_window', { windowId: 8 }); await flush();
            await h.ready('Second', 3); h.confirm(3);
            assert(!h.reporter.isBusy(), 'server-closed shops resume the paused team too');
        } finally { h.dispose(); }
    }
    for (const phase of ['queued', 'opening', 'confirming']) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red');
            if (phase === 'queued') { await h.ready('First'); h.confirm(); await flush(); }
            else { h.open('First'); if (phase === 'confirming') await h.advance(350); }
            const before = h.upstream.length;
            // Reusing a hidden window ID must restore normal player ownership.
            assert(!h.server('open_window', { windowId: 2, inventoryType: 'minecraft:chest', slotCount: 27, windowTitle: 'Item Shop' }));
            assert(!h.server('window_items', { windowId: 2, items: [item(1, 'Shop item')] }));
            assert(!h.client('window_click', { windowId: 2, slot: 0, action: 8, mode: 0, mouseButton: 0, item: { blockId: -1 } }));
            assert(!h.upstream.slice(before).some(p => p.name === 'close_window'), 'pausing must not close the real shop');
            if (phase === 'confirming') {
                h.chat(SUCCESS);
                await h.advance(1100);
                assert(!h.reporter.isBusy(), 'a replaced menu without a matching server close cannot confirm Submit');
                assert.equal(h.commands().length, 1);
            } else {
                await h.advance(2500);
                const next = phase === 'queued' ? 'Second' : 'First';
                h.client('close_window', { windowId: 2 }); await flush();
                assert.equal(h.commands().at(-1), `/wdr ${next}`);
                await h.ready(next, 3); h.confirm(3);
                if (next === 'First') { await h.advance(50); await h.ready('Second', 4); h.confirm(4); }
                assert(!h.reporter.isBusy());
            }
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr First'); h.open('First');
            h.client('client_command', { payload: 2 });
            h.server('set_slot', { windowId: -1, slot: -1, item: item(1, 'Held item') });
            h.client('close_window', { windowId: 0 }); await flush();
            assert.deepEqual(h.commands(), ['/wdr First'], 'do not resume with an item on the cursor');
            h.server('set_slot', { windowId: -1, slot: -1, item: { blockId: -1 } });
            await h.advance(400); await h.ready('First', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    for (const end of ['cancel', 'command', 'world', 'dispose']) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red'); h.open('First');
            h.client('client_command', { payload: 2 });
            if (end === 'cancel') await h.command('/wdr cancel');
            if (end === 'command') h.reporter.observeCommand('/lobby');
            if (end === 'world') h.server('respawn', {});
            if (end === 'dispose') h.reporter.dispose();
            h.client('close_window', { windowId: 0 }); await h.advance(2500);
            assert(!h.reporter.isBusy(), end);
            assert.deepEqual(h.commands(), ['/wdr First'], 'stopped pauses never resume: ' + end);
            assert.equal(h.clicks().length, 0);
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'] });
        try {
            await h.command('/wdr red'); await h.ready('First'); h.confirm(); await flush();
            assert(!h.chat('You are sending commands too fast!'), 'a queued report does not own an earlier command error');
            await h.advance(50); await h.ready('Second', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
            assert(h.messages.at(-1).includes('First, Second'));
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], transitionMs: 400 });
        try {
            await h.command('/wdr red');
            // Replay the screenshot's first attempt: full snapshot at +28 ms,
            // a duplicate head at +171 ms, then a server close at +444 ms.
            h.server('open_window', { windowId: 2, inventoryType: 'minecraft:chest', slotCount: 27,
                windowTitle: 'Report Cheating/Hacking' });
            await h.advance(28);
            h.server('window_items', { windowId: 2, items: reportItems('First') });
            await h.advance(143);
            h.server('set_slot', { windowId: 2, slot: 13, item: reportItems('First')[13] });
            await h.advance(273);
            h.server('close_window', { windowId: 2 });
            assert.equal(h.clicks().length, 0);
            assert(h.reporter.isBusy(), 'a server close before Submit recovers instead of cancelling the team');
            await h.advance(399);
            assert.deepEqual(h.commands(), ['/wdr First']);
            await h.advance(1);
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr First']);
            await h.ready('First', 3); h.confirm(3);
            await h.advance(400); await h.ready('Second', 4); h.confirm(4);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2, 'reopening an unsubmitted menu never duplicates Submit');
            assert(h.messages.at(-1).includes('First, Second'));
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], transitionMs: 400 });
        try {
            await h.command('/wdr blue'); await h.ready('First'); h.confirm();
            await h.advance(29);
            h.server('close_window', { windowId: 0 }); // Captured trailing close of the player inventory.
            await h.advance(399);
            assert.deepEqual(h.commands(), ['/wdr First'], 'wait for the trailing close burst before the next member');
            await h.advance(1);
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr Second']);
            await h.advance(1000);
            assert(h.reporter.isBusy(), 'a missing menu gets one recovery attempt');
            await h.advance(400);
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr Second', '/wdr Second']);
            await h.ready('Second', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2);
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], transitionMs: 400 });
        try {
            await h.command('/wdr red'); await h.advance(1000); await h.advance(400); await h.advance(1000);
            assert(!h.reporter.isBusy(), 'opening recovery is bounded');
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr First']);
            assert.equal(h.clicks().length, 0);
            assert(h.messages.at(-1).includes('0/2 confirmed'));
            assert(h.messages.at(-1).includes('Hypixel to open the report menu'));
        } finally { h.dispose(); }
    }
    for (const end of ['cancel', 'world', 'inventory', 'menu']) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], transitionMs: 400 });
        try {
            await h.command('/wdr red'); h.open('First');
            h.server('close_window', { windowId: 2 });
            if (end === 'cancel') await h.command('/wdr cancel');
            if (end === 'world') h.server('respawn', {});
            if (end === 'inventory') h.client('client_command', { payload: 2 });
            if (end === 'menu') h.server('open_window', { windowId: 8, inventoryType: 'minecraft:chest', slotCount: 27, windowTitle: 'Item Shop' });
            await h.advance(2000);
            assert.deepEqual(h.commands(), ['/wdr First'], 'never retry through an interruption: ' + end);
            if (end === 'inventory' || end === 'menu') {
                h.client('close_window', { windowId: end === 'inventory' ? 0 : 8 }); await flush();
                await h.advance(400); await h.ready('First', 3); h.confirm(3);
                await h.advance(400); await h.ready('Second', 4); h.confirm(4);
            }
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second', 'Third', 'Fourth'], transitionMs: 400 });
        try {
            await h.command('/wdr red'); h.open('First'); await h.advance(301);
            h.server('close_window', { windowId: 2 }); await h.advance(400);
            h.open('First', 3); await h.advance(130);
            h.server('set_slot', { windowId: 3, slot: 13, item: reportItems('First')[13] });
            await h.advance(350);
            h.client('block_place', { location: { x: 99, y: 99, z: 99 }, heldItem: item(1, 'Private item data') });
            await h.advance(171); h.server('close_window', { windowId: 3 });
            assert(!h.chat("You can't place blocks here!"), 'context-only game errors still pass through');
            await h.advance(829);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 1);
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr First'], 'no retry or next player after an unconfirmed Submit');
            assert(h.messages.at(-1).includes('The menu closed, but Hypixel did not confirm the report'));
            const timeout = h.diagnostics.find(e => e.event === 'timeout');
            assert.equal(timeout.target, 'First');
            assert.equal(timeout.serverClosed, true);
            assert.equal(timeout.receipt, false);
            assert.equal(timeout.submittedWindowId, 3);
            assert.equal(timeout.activity['afterSubmit:block_place'].count, 1);
            assert(h.diagnostics.some(e => e.event === 'feedback' && e.kind === 'context' && e.text === "You can't place blocks here!"));
            assert(!JSON.stringify(h.diagnostics).includes('Private item data'), 'diagnostics do not copy gameplay items or packet payloads');
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            h.client('block_place'); h.chat('Your report is pending.');
            assert.equal(h.diagnostics.length, 0, 'no logging outside an explicit report');
            await h.command('/wdr One'); await h.ready('One');
            h.chat('Private unrelated conversation'); h.chat('Party > Someone: Your report is pending.');
            h.chat(SUCCESS, 2);
            for (let i = 0; i < 100; i++) {
                h.client('block_place'); h.client('position', { x: i }); h.chat('Submitting Report...');
            }
            for (let i = 0; i < 50; i++) h.chat(`Your report is still pending ${i}.`);
            assert.equal(h.diagnostics.filter(e => e.event === 'player-action' && e.packet === 'block_place').length, 1, 'coalesce repeated actions per stage');
            assert.equal(h.diagnostics.filter(e => e.event === 'feedback' && e.kind === 'progress').length, 1, 'deduplicate progress');
            assert(h.diagnostics.filter(e => e.event === 'feedback' && e.kind === 'context').length <= 16, 'bound unknown feedback');
            assert(!h.diagnostics.some(e => e.receipt), 'unrecognized feedback and action bars are never confirmation');
            assert(!JSON.stringify(h.diagnostics).includes('Private unrelated'));
            assert(!JSON.stringify(h.diagnostics).includes('Party > Someone'));
            assert(!h.diagnostics.some(e => e.event === 'player-action' && e.packet === 'position'));
            h.confirm();
            const confirmed = h.diagnostics.find(e => e.event === 'confirmed');
            assert(confirmed.receipt && confirmed.serverClosed);
            assert.equal(confirmed.activity['afterSubmit:block_place'].count, 100);
        } finally { h.dispose(); }
    }
    {
        const h = harness({ diagnosticFailure: true });
        try {
            await h.command('/wdr One'); await h.ready('One'); h.confirm();
            assert(!h.reporter.isBusy(), 'a logging failure cannot break reports or packet handling');
            assert(h.messages.at(-1).includes('Report confirmed for'));
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], minimumStillMs: null });
        try {
            await h.command('/wdr red');
            await h.advance(5000);
            assert.deepEqual(h.commands(), [], 'no report or network timeout before position evidence');
            h.client('position', { x: 0, y: 80, z: 0, onGround: true });
            await h.advance(499);
            h.client('look', { yaw: 90, pitch: 0, onGround: true });
            h.client('position', { x: 0, y: 80, z: 0, onGround: true });
            assert.deepEqual(h.commands(), []);
            await h.advance(1);
            assert.deepEqual(h.commands(), ['/wdr First'], 'unchanged position and looking do not postpone readiness');
            h.open('First'); await h.advance(100);
            for (let i = 1; i <= 10; i++) {
                assert(!h.client('position', { x: i, y: 80, z: 0, onGround: true }));
                await h.advance(100);
                assert.equal(h.clicks().length, 0, 'never Submit while the player moves');
            }
            h.server('close_window', { windowId: 2 });
            await h.advance(399);
            assert.deepEqual(h.commands(), ['/wdr First']);
            await h.command('/wdr status');
            assert(h.messages.at(-1).includes('stop moving'));
            await h.advance(1);
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr First']);
            await h.ready('First', 3); h.confirm(3);
            await h.advance(50); await h.ready('Second', 4); h.confirm(4);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2);
            assert.equal(h.diagnostics.filter(e => e.event === 'retry-opening').length, 0, 'movement does not spend network recovery attempts');
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], minimumStillMs: 500 });
        try {
            h.client('position', { x: 0, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.command('/wdr red'); await h.ready('First'); h.confirm(); await flush();
            h.client('position', { x: 1, y: 80, z: 0, onGround: true });
            await h.advance(499);
            assert.deepEqual(h.commands(), ['/wdr First'], 'movement aborts a queued next-player command');
            await h.advance(1); await h.ready('Second', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2);
        } finally { h.dispose(); }
    }
    {
        const h = harness({ minimumStillMs: 500 });
        try {
            h.client('position', { x: 0, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.command('/wdr First');
            h.client('position', { x: 1, y: 80, z: 0, onGround: true }); await h.advance(100);
            h.open('First'); await h.advance(399);
            assert.deepEqual(h.commands(), ['/wdr First'], 'drain the old pending menu before resuming');
            assert.equal(h.clicks().length, 0);
            await h.advance(1); await h.ready('First', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 1);
        } finally { h.dispose(); }
    }
    {
        const h = harness({ minimumStillMs: null });
        try {
            await h.command('/wdr First');
            h.client('look', { yaw: 20, pitch: 1, onGround: true }); await h.advance(1000);
            assert.equal(h.commands().length, 0, 'looking alone does not establish a position');
            for (let i = 0; i < 10; i++) {
                h.client('position', { x: 0, y: 80 - i, z: 0, onGround: false }); await h.advance(100);
                assert.equal(h.commands().length, 0, 'no submission while falling');
            }
            h.client('flying', { onGround: false }); await h.advance(400);
            assert.deepEqual(h.commands(), ['/wdr First'], 'stationary spectators can report while hovering');
            h.open('First'); await h.advance(349);
            h.server('position', { x: 100, y: 80, z: 0, flags: 0 });
            await h.advance(1000);
            assert.equal(h.clicks().length, 0, 'a server correction invalidates readiness before Submit');
            h.client('position', { x: 100, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.ready('First', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 1);
        } finally { h.dispose(); }
    }
    for (const closeFirst of [true, false]) {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], minimumStillMs: 500 });
        try {
            h.client('position', { x: 0, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.command('/wdr red'); await h.ready('First');
            h.client('position', { x: 1, y: 80, z: 0, onGround: true });
            assert(!h.upstream.some(p => p.name === 'close_window'), 'moving after Submit does not synthesize a server-close confirmation');
            if (closeFirst) { h.server('close_window', { windowId: 2 }); h.chat(SUCCESS); }
            else { h.chat(SUCCESS); h.server('close_window', { windowId: 2 }); }
            await h.advance(499);
            assert.deepEqual(h.commands(), ['/wdr First']);
            await h.advance(1); await h.ready('Second', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
            assert.equal(h.clicks().length, 2, 'a valid result still counts when the player moved afterward');
        } finally { h.dispose(); }
    }
    {
        const h = harness({ minimumStillMs: 500 });
        try {
            await h.command('/wdr First');
            h.client('position', { x: 0, y: 80, z: 0, onGround: true });
            const wake = [...h.timers.keys()];
            for (let i = 1; i <= 20; i++) {
                await h.advance(10);
                h.client('position', { x: i, y: 80, z: 0, onGround: true });
                assert.deepEqual([...h.timers.keys()], wake, 'coalesce motion into the existing readiness deadline');
            }
            assert.equal(h.diagnostics.filter(e => e.event === 'waiting-for-still').length, 1, 'no repeated movement notices');
            await h.advance(500); await h.ready('First'); h.confirm();
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness({ minimumStillMs: null });
        try {
            h.client('position', { x: 0, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.command('/wdr First'); h.open('First');
            for (const [delay, count] of [[50, 31], [97, 32], [153, 33]]) {
                await h.advance(delay);
                const iron = item(265, 'Iron ingot'); iron.itemCount = count;
                h.server('set_slot', { windowId: 2, slot: 30, item: iron });
                h.client('flying', { onGround: true });
            }
            await h.advance(49);
            assert.equal(h.clicks().length, 0);
            await h.advance(1);
            assert.equal(h.clicks().length, 1, 'generator inventory updates do not postpone the menu quiet deadline');
            assert(h.downstream.some(p => p.name === 'set_slot' && p.data.windowId === 0
                && p.data.slot === 12 && p.data.item.blockId === 265 && p.data.item.itemCount === 33));
            h.confirm();
            assert(!h.reporter.isBusy());
            assert(h.messages.at(-1).includes('Report confirmed for'));
        } finally { h.dispose(); }
    }
    {
        const h = harness({ getTeamPlayers: () => ['First', 'Second'], minimumStillMs: 500 });
        try {
            h.client('position', { x: 0, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.command('/wdr red'); await h.ready('First');
            h.client('position', { x: 1, y: 80, z: 0, onGround: true });
            h.server('close_window', { windowId: 2 }); await h.advance(1000);
            assert(!h.reporter.isBusy());
            assert.deepEqual(h.commands(), ['/wdr First'], 'never retry an unconfirmed report after movement');
            assert.equal(h.clicks().length, 1);
            assert(h.messages.at(-1).includes('after you moved'));
        } finally { h.dispose(); }
    }
    for (const end of ['cancel', 'command', 'world', 'dispose']) {
        const h = harness({ minimumStillMs: 500 });
        try {
            h.client('position', { x: 0, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.command('/wdr First'); await h.ready('First'); h.confirm();
            await h.command('/wdr Second');
            h.client('position', { x: 1, y: 80, z: 0, onGround: true });
            if (end === 'cancel') await h.command('/wdr cancel');
            if (end === 'command') h.reporter.observeCommand('/lobby');
            if (end === 'world') h.server('respawn', {});
            if (end === 'dispose') h.reporter.dispose();
            await h.advance(2000);
            assert.deepEqual(h.commands(), ['/wdr First'], 'stopped movement waits never restart: ' + end);
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness({ minimumStillMs: 500 });
        try {
            h.client('position', { x: 0, y: 80, z: 0, onGround: true }); await h.advance(500);
            await h.command('/wdr First'); h.open('First');
            h.client('position', { x: 1, y: 80, z: 0, onGround: true });
            h.client('client_command', { payload: 2 }); await h.advance(6000);
            h.client('position', { x: 2, y: 80, z: 0, onGround: true });
            h.client('close_window', { windowId: 0 }); await flush(); await h.advance(499);
            assert.deepEqual(h.commands(), ['/wdr First'], 'closing inventory does not bypass the stationary gate');
            await h.advance(1); await h.ready('First', 3); h.confirm(3);
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One'); await h.ready('One');
            assert(!h.chat('You can only submit one report at a time.'), 'unknown reporting-limit wording is diagnostic context, not confirmation or a guessed error');
            assert(h.diagnostics.some(e => e.event === 'feedback' && e.kind === 'context' && e.text === 'You can only submit one report at a time.'));
            h.reporter.observeUpstream('chat', { message: '/pc Private message arguments' });
            h.reporter.observeUpstream('chat', { message: '/wdr One' });
            h.reporter.observeUpstream('position', { x: 1 });
            assert.deepEqual(h.diagnostics.filter(e => e.event === 'other-command').map(e => e.command), ['/pc']);
            assert(!JSON.stringify(h.diagnostics).includes('Private message arguments'));
            assert(h.reporter.isBusy(), 'observing an automatic command does not change its routing or cancel the report');
            h.confirm();
        } finally { h.dispose(); }
    }
    console.log('Watchdog report tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
