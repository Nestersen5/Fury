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

function harness() {
    let now = 0, timerId = 0, blocked = null;
    const timers = new Map(), upstream = [], downstream = [], messages = [];
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
    const send = (name, data) => upstream.push({ name, data });
    const monitor = createMenuMonitor({ sendUpstream: send, dir: null, log: () => {}, itemNameLookup: () => null });
    const queue = createHypixelCommandQueue({ send: message => send('chat', { message }),
        now: () => now, setTimeout: setTimer, clearTimeout: clearTimer });
    const reporter = createWatchdogReport({ menuMonitor: monitor, sendCommand: queue.enqueue,
        sendUpstream: (name, data) => { send(name, data); monitor.setHold(false); monitor.observeClientPacket(data, { name }); },
        sendClient: (name, data) => downstream.push({ name, data }), sendChat: text => messages.push(text),
        canStart: () => blocked || (monitor.getWindow() ? 'Close your current menu first.' : null),
        setTimer, clearTimer, timeoutMs: 1000, reportGapMs: 500 });
    const server = (name, data) => {
        const shared = monitor.observeServerPacket(data, { name });
        const hidden = reporter.observeServer(data, { name });
        if (!shared && !hidden) downstream.push({ name, data });
        return shared || hidden;
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
    const clicks = () => upstream.filter(p => p.name === 'window_click');
    const commands = () => upstream.filter(p => p.name === 'chat').map(p => p.data.message);
    return { reporter, upstream, downstream, messages, timers, server, open, ready, confirm, chat, command, clicks, commands, advance,
        block: value => { blocked = value; },
        dispose: () => { reporter.dispose(); queue.close(); monitor.dispose(); assert.equal(timers.size, 0); } };
}

(async () => {
    {
        const h = harness();
        try {
            await h.command('/wdr One Two Three Four Five');
            assert.equal(h.messages.length, 1);
            assert(h.messages[0].includes('Started reporting: \u00a7fOne, Two, Three, Four, Five'));
            assert(h.chat('Please wait...'));
            assert(!h.chat('Someone: Please wait...'));
            assert(!h.chat('Normal server notice'));
            assert(!h.chat('Please wait...', 2), 'never hide action bars');
            for (const [i, name] of ['One', 'Two', 'Three'].entries()) {
                await h.ready(name, i + 1);
                assert(h.chat('Submitting Report...'));
                h.confirm(i + 1);
                assert.equal(h.messages.length, 1, 'only the start notice until completion');
                await h.advance(500);
            }
            assert(h.chat('You must wait before reporting again!'));
            assert.equal(h.messages.length, 2);
            assert(h.messages[1].includes('3/5 confirmed: §fOne, Two, Three'));
            assert(h.messages[1].includes('Unconfirmed: §fFour, Five'));
            assert(h.messages[1].includes('You must wait before reporting again!'));
            assert(!h.reporter.isBusy());
            h.reporter.observeCommand('/watchdogreport Manual fly');
            assert(!h.chat(SUCCESS), 'original manual report feedback is preserved');
        } finally { h.dispose(); }
    }
    for (const end of ['cancel', 'timeout']) {
        const h = harness();
        try {
            await h.command('/wdr One Two'); await h.ready('One');
            if (end === 'cancel') await h.command('/wdr cancel');
            else await h.advance(1000);
            assert.equal(h.messages.length, 2);
            assert(h.messages[1].includes('0/2 confirmed. Unconfirmed: §fOne, Two'));
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
            await h.command('/wdr A B C D');
            for (const [i, name] of ['A', 'B', 'C', 'D'].entries()) {
                await h.ready(name, i + 1); h.confirm(i + 1);
                if (i < 3) await h.advance(500);
            }
            h.server('respawn', {});
            await h.advance(400);
            for (const [i, action] of ['block_place', 'client_command'].entries()) {
                await h.command('/wdr E F');
                h.open('E', i + 1, contextualItems('E'));
                await h.advance(100);
                assert(!h.reporter.observeClient({ payload: 2 }, { name: action }));
                await h.advance(1000);
                assert(!h.reporter.isBusy(), 'an item/inventory interruption does not block a later attempt');
                assert.equal(h.clicks().length, 4);
            }
            await h.command('/wdr E F G H');
            for (const [i, name] of ['E', 'F', 'G', 'H'].entries()) {
                const windowId = i + 3;
                await h.ready(name, windowId, contextualItems(name));
                assert.equal(h.clicks().length, i + 5, 'the game-context lore must not prevent the next batch from submitting: ' + JSON.stringify(h.messages.slice(-3)));
                h.confirm(windowId);
                if (i < 3) await h.advance(500);
            }
            assert.equal(h.messages.filter(t => typeof t === 'string' && t.includes('Reports confirmed for')).length, 2);
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr First Second Third Fourth');
            for (const [index, name] of ['First', 'Second', 'Third', 'Fourth'].entries()) {
                const windowId = index + 1;
                await h.ready(name, windowId);
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
                    assert.equal(h.messages.filter(t => typeof t === 'string' && t.includes('Reports confirmed for')).length, 0);
                    h.server('close_window', { windowId });
                }
                assert.equal(h.messages.filter(t => typeof t === 'string' && t.includes('Reports confirmed for')).length, index === 3 ? 1 : 0, 'both completion orders produce only the final summary');
                if (index < 3) {
                    await h.command('/wdr status');
                    assert(h.messages.at(-1).includes(`${index + 1}/4 confirmed`));
                }
                h.chat(SUCCESS); // A duplicate receipt must not increment again.
                h.server('close_window', { windowId });
                if (index < 3) await h.advance(500);
            }
            assert.deepEqual(h.commands(), ['/wdr First', '/wdr Second', '/wdr Third', '/wdr Fourth']);
            assert(h.messages.some(t => typeof t === 'string' && t.includes('Reports confirmed for \u00a7fFirst, Second, Third, Fourth')));
            assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One Two'); await h.ready('One');
            h.chat(SUCCESS);
            await h.command('/wdr cancel');
            await h.command('/wdr Three'); await h.advance(400); await h.ready('Three', 3);
            h.server('close_window', { windowId: 3 });
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Reports confirmed for')), 'a buffered success from the cancelled request cannot confirm the next request');
            h.chat(SUCCESS); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One Two'); await h.ready('One');
            h.chat(SUCCESS); h.chat('You must wait before reporting again!');
            h.server('close_window', { windowId: 2 }); await h.advance(1500);
            assert.equal(h.commands().length, 1);
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Reports confirmed for')), 'server rejection clears a buffered success');
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            // Timing/layout from the failed 2026-10-28 live capture: the first
            // full snapshot, a slot burst at +4 ms, then a resnapshot at +149 ms.
            await h.command('/wdr TestPlayer OtherPlayer');
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
            assert.deepEqual(h.commands(), ['/wdr TestPlayer', '/wdr OtherPlayer']);
        } finally { h.dispose(); }
    }
    {
        const h = harness();
        try {
            await h.command('/wdr One Two'); await h.ready('One');
            h.chat(SUCCESS);
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Reports confirmed for')), 'unlabelled success alone cannot confirm a new window');
            await h.advance(1000);
            assert(!h.reporter.isBusy(), 'a timed-out clicked report releases the queue');
            await h.command('/wdr cancel'); await h.command('/wdr Three');
            h.server('close_window', { windowId: 2 }); h.chat(SUCCESS);
            await h.advance(400); await h.ready('Three', 3);
            assert.equal(h.commands().length, 2, 'the timed-out batch must never continue with Two');
            assert(!h.messages.some(t => typeof t === 'string' && t.includes('Reports confirmed for')));
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
            await h.command('/wdr One TWO one Three');
            assert.deepEqual(h.commands(), ['/wdr one']);
            assert.equal(h.reporter.observeClient({ x: 4, y: 80, z: 2, onGround: true }, { name: 'position' }), false);
            await h.ready('one');
            assert.equal(h.clicks().length, 1);
            assert.equal(h.clicks()[0].data.slot, 11);
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
            assert.deepEqual(h.commands(), ['/wdr one', '/wdr TWO']);
            await h.ready('TWO', 3); h.confirm(3);
            await h.advance(500);
            await h.ready('Three', 4); h.confirm(4);
            assert(!h.reporter.isBusy());
            assert(h.messages.some(t => typeof t === 'string' && t.includes('Reports confirmed for \u00a7fone, TWO, Three')));
            assert(!h.downstream.some(p => p.name === 'chat' && p.data.position !== 2 && JSON.parse(p.data.message).text === SUCCESS), 'hide the native receipt after using it for confirmation');
            assert(h.server('window_items', { windowId: 4, items: reportItems('Three') }), 'late hidden packets stay hidden');
            assert(!h.server('open_window', { windowId: 4, inventoryType: 'minecraft:chest', slotCount: 27, windowTitle: 'Shop' }), 'reused IDs return to normal');
            assert(!h.server('window_items', { windowId: 4, items: [] }));
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
            h.block(null); await h.command('/wdr A B C D E F G H');
            for (let i = 0; i < 8; i++) {
                await h.ready('ABCDEFGH'[i], i + 1); h.confirm(i + 1);
                if (i < 7) await h.advance(500);
            }
            assert.equal(h.clicks().length, 8); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    for (const mutation of ['wrong-player', 'wrong-item', 'no-target', 'wrong-lore', 'wrong-context-reason', 'ambiguous-context', 'duplicate-submit']) {
        const h = harness();
        try {
            await h.command('/wdr One Two');
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
            assert(!h.reporter.isBusy(), 'cancellation releases the request without reconnecting');
            await h.command('/wdr Two');
            h.chat(SUCCESS);
            await h.advance(400);
            await h.ready('Two', 3);
            h.server('close_window', { windowId: 2 }); h.chat(SUCCESS);
            assert(!h.messages.some(text => typeof text === 'string' && text.includes('Reports confirmed for §fTwo')), 'late old close and chat cannot confirm the new window');
            h.confirm(3); assert(!h.reporter.isBusy());
        } finally { h.dispose(); }
    }
    for (const cancel of ['cancel', 'timeout', 'menu', 'command', 'world', 'item']) {
        const h = harness();
        try {
            await h.command('/wdr One Two');
            if (cancel === 'cancel') await h.command('/wdr cancel');
            if (cancel === 'timeout') await h.advance(1000);
            if (cancel === 'menu') h.server('open_window', { windowId: 8, slotCount: 54, windowTitle: 'Unrelated', inventoryType: 'minecraft:chest' });
            if (cancel === 'command') h.reporter.observeCommand('/play bedwars_four_four');
            if (cancel === 'world') h.server('respawn', {});
            if (cancel === 'item') assert(!h.reporter.observeClient({}, { name: 'block_place' }));
            if (['cancel', 'timeout', 'command', 'item'].includes(cancel)) {
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
            await h.command('/wdr One Two'); h.chat(text); await h.advance(2000);
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
    console.log('Watchdog report tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
