'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createQuickBuy, SLOTS, key } = require('../../src/menu/quickBuy');
const { createMenuMonitor } = require('../../src/menu/menuMonitor');
const captured = require('../../src/menu/fixtures/quickbuy-menus.json');

function wire(item) {
    return { blockId: item.id, itemCount: item.n || 1, itemDamage: item.dmg || 0,
        nbtData: { type: 'compound', value: { display: { type: 'compound', value: {
            Name: { type: 'string', value: item.name },
            Lore: { type: 'list', value: { type: 'string', value: item.lore || [] } }
        } }, ...(item.databaseName ? { ExtraAttributes: { type: 'compound', value: {
            databaseName: { type: 'string', value: item.databaseName }
        } } } : {}) } } };
}

function harness(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickbuy-test-'));
    const sent = [], sentAt = [], messages = [], client = [], disconnected = [];
    const timers = new Set();
    function later(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); }
    let pendingContent = false;
    let win = 0, title = '', selected = 0, suppress = false;
    let editor = structuredClone(captured['Edit Quick Buy'].items);
    const picker = structuredClone(captured['Adding to Quick Buy...'].items);
    const secondPage = structuredClone(captured['(2/2) Adding to Quick Buy...'].items);
    let injected = false;
    let current = [];
    const q = createQuickBuy({ presetDir: dir, canStart: () => null, minimumStillMs: 0,
        settleMs: 2, snapshotSettleMs: 1, minimumClickMs: 0, timeoutMs: 150, totalTimeoutMs: 3000,
        sendChat: m => messages.push(m.replace(/§[0-9a-fk-or]/gi, '')), sendClient: (n, d) => client.push([n, d]),
        disconnect: m => disconnected.push(m),
        sendUpstream: (name, data) => {
            sent.push([name, data]);
            sentAt.push(Date.now());
            if (name === 'window_click') {
                assert(!pendingContent, 'never click an incomplete menu');
                assert(data.action >= -32768 && data.action <= 32767);
                assert.deepStrictEqual(data.item, wire(current.find(i => i.slot === data.slot)), 'must click the actual server item');
            }
            if (suppress) return;
            if (name === 'chat') setImmediate(() => open('Game Settings', captured['Game Settings'].items));
            if (name === 'window_click') setImmediate(() => {
                const acknowledge = () => {
                    assert(q.observeServer({ windowId: data.windowId, action: data.action, accepted: false }, { name: 'transaction' }));
                };
                if (options.omitAck) { /* Recorded Hypixel replacement-menu behavior. */ }
                else if (options.ackDelayMs) later(acknowledge, options.ackDelayMs);
                else acknowledge();
                if (title === 'Game Settings') open('Bed Wars Settings', captured['Bed Wars Settings'].items);
                else if (title === 'Bed Wars Settings') open('Edit Quick Buy', editor);
                else if (title === 'Edit Quick Buy') {
                    selected = data.slot;
                    if (data.mouseButton === 1) {
                        editor = editor.map(i => i.slot === selected ? { ...structuredClone(captured.emptySlot), slot: i.slot } : i);
                        open('Edit Quick Buy', editor);
                    } else open('Adding to Quick Buy...', picker);
                } else if (data.slot === 53) open('(2/2) Adding to Quick Buy...', secondPage);
                else if (data.slot === 49) open('Edit Quick Buy', editor);
                else {
                    const chosen = current.find(i => i.slot === data.slot);
                    if (!injected && key(chosen.name) === options.stallItem) { injected = true; return; }
                    if (!injected && key(chosen.name) === options.rejectItem) { injected = true; open('Edit Quick Buy', editor); return; }
                    // Hypixel moves an already-present item and leaves an empty
                    // slot behind. Restoration must repair the whole layout.
                    editor = editor.map(i => {
                        if (i.slot === selected) return { ...chosen, slot: selected, lore: captured['Edit Quick Buy'].items[0].lore };
                        if (SLOTS.includes(i.slot) && key(i.name) === key(chosen.name)) return { ...structuredClone(captured.emptySlot), slot: i.slot };
                        return i;
                    });
                    open('Edit Quick Buy', editor);
                    if (!injected && key(chosen.name) === options.cancelItem) {
                        injected = true;
                        q.command(['/quickbuy', 'cancel']);
                    }
                }
            });
        }, ...options });
    function open(nextTitle, items) {
        title = nextTitle;
        current = items;
        win++;
        q.observeServer({ windowId: win, inventoryType: 'minecraft:chest', windowTitle: JSON.stringify({ text: title }), slotCount: 54 }, { name: 'open_window' });
        const raw = Array.from({ length: 90 }, () => ({ blockId: -1 }));
        items.forEach(i => { raw[i.slot] = wire(i); });
        const windowId = win;
        const contents = () => {
            if (options.partialUpdates) {
                const lateSlot = title === 'Edit Quick Buy' ? SLOTS.at(-1)
                    : title.includes('Adding') ? 49 : items[0].slot;
                const partial = raw.slice();
                partial[lateSlot] = { blockId: -1 };
                q.observeServer({ windowId, items: partial }, { name: 'window_items' });
                later(() => {
                    pendingContent = false;
                    q.observeServer({ windowId, slot: lateSlot, item: raw[lateSlot] }, { name: 'set_slot' });
                }, 25);
            } else {
                pendingContent = false;
                q.observeServer({ windowId, items: raw }, { name: 'window_items' });
            }
        };
        pendingContent = true;
        if (options.contentDelayMs) later(contents, options.contentDelayMs);
        else contents();
    }
    q.observeClient({ x: 1, y: 64, z: 1, yaw: 0, pitch: 0, onGround: true }, { name: 'position_look' });
    return { q, sent, sentAt, messages, client, disconnected, dir, open, picker, secondPage,
        suppress: () => { suppress = true; }, editor: () => editor,
        clean: () => { for (const timer of timers) clearTimeout(timer); q.dispose(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

(async () => {
    const h = harness();
    try {
        await h.q.command(['/quickbuy', 'save', 'rush']);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(h.dir, 'rush.json'))).slots.length, 21);
        const changing = h.q.command(['/quickbuy', 'set', '1', 'golden', 'apple']);
        assert(h.q.isActive());
        for (const name of ['block_dig', 'block_place', 'use_entity', 'arm_animation', 'held_item_slot',
            'window_click', 'entity_action', 'chat', 'custom_payload', 'tab_complete', 'set_creative_slot']) {
            assert.strictEqual(h.q.allowOutbound(name, {}), false, `blocked: ${name}`);
        }
        assert(h.q.allowOutbound('keep_alive', {}));
        assert(h.q.allowOutbound('transaction', {}));
        assert(!h.q.allowOutbound('position', { x: 2, y: 64, z: 1, onGround: true }));
        assert(h.client.some(([n]) => n === 'position'), 'correct local movement so it cannot jump after unlock');
        await changing;
        assert.strictEqual(key(h.editor().find(i => i.slot === SLOTS[0]).name), 'golden apple');
        assert(h.sent.some(([n, d]) => n === 'window_click' && d.slot === 53), 'visit next picker page');
        assert(!h.q.isActive());
        assert.strictEqual(h.sent.at(-1)[0], 'close_window', 'close server before releasing lock');
        await h.q.command(['/quickbuy', 'clear', '2']);
        assert.strictEqual(key(h.editor().find(i => i.slot === SLOTS[1]).name), 'empty slot!');
        await h.q.command(['/quickbuy', 'load', 'rush']);
        assert.strictEqual(key(h.editor().find(i => i.slot === SLOTS[0]).name), 'wool');
        assert.strictEqual(key(h.editor().find(i => i.slot === SLOTS[1]).name), 'wood');
        assert.strictEqual(h.disconnected.length, 0);
        const before = h.sent.length;
        await h.q.command(['/quickbuy', 'save', '../escape']);
        assert.strictEqual(h.sent.length, before, 'invalid names cannot touch server or escape preset folder');
        assert(h.messages.some(m => m.includes('Loaded rush')));
    } finally { h.clean(); }

    const cancel = harness();
    try {
        const job = cancel.q.command(['/quickbuy', 'set', '1', 'stone_sword']);
        cancel.q.observeClient({ windowId: 1 }, { name: 'close_window' });
        assert(cancel.q.isActive(), 'cancellation stays locked until outstanding response arrives');
        await job;
        assert(!cancel.q.isActive());
        assert(!cancel.sent.some(([n]) => n === 'window_click'), 'cancel before first menu must not navigate');
        assert.strictEqual(cancel.sent.at(-1)[0], 'close_window');
    } finally { cancel.clean(); }

    const manual = harness();
    try {
        manual.suppress();
        const job = manual.q.command(['/quickbuy', 'set', '1', 'wool']);
        manual.open('Game Settings', captured['Game Settings'].items);
        assert(manual.q.observeClient({ windowId: 1, action: 7, slot: 6 }, { name: 'window_click' }));
        assert(manual.client.some(([n, d]) => n === 'transaction' && d.accepted === false));
        assert(manual.client.some(([n]) => n === 'window_items'));
        assert(manual.client.some(([n, d]) => n === 'set_slot' && d.windowId === -1 && d.item.blockId === -1));
        assert(manual.q.observeClient({ windowId: 1, action: 7, accepted: true }, { name: 'transaction' }), 'local rejection confirmations must never reach server');
        manual.q.command(['/quickbuy', 'cancel']);
        await job;
        assert(!manual.q.isActive());
    } finally { manual.clean(); }

    const timeout = harness({ timeoutMs: 15 });
    try {
        timeout.suppress();
        await timeout.q.command(['/quickbuy', 'set', '1', 'wool']);
        assert.strictEqual(timeout.disconnected.length, 1, 'uncertain outstanding menu request fails closed');
        assert(!timeout.q.allowOutbound('block_place', {}), 'never unlock uncertain server state');
    } finally { timeout.clean(); }

    const denied = harness({ canStart: () => 'Lobby only' });
    try {
        await denied.q.command(['/quickbuy', 'set', '1', 'wool']);
        assert.strictEqual(denied.sent.length, 0);
    } finally { denied.clean(); }

    const moved = harness();
    try {
        moved.suppress();
        const job = moved.q.command(['/quickbuy', 'set', '1', 'wool']);
        moved.q.observeServer({ x: 0, y: 70, z: 0, flags: 0 }, { name: 'position' });
        await job;
        assert.strictEqual(moved.disconnected.length, 1);
        assert(!moved.q.allowOutbound('use_entity', {}));
    } finally { moved.clean(); }

    const slotNames = h => SLOTS.map(slot => key(h.editor().find(i => i.slot === slot).name));
    const report = h => {
        const folder = path.join(h.dir, 'test-reports');
        return fs.readFileSync(path.join(folder, fs.readdirSync(folder)[0]), 'utf8').trim().split('\n').map(JSON.parse);
    };
    // Allow the synthetic menu sequence to reach Golden Apple under CI load;
    // the stalled server response still has to time out and fail closed.
    for (const mode of [{ snapshotSettleMs: 0, minimumClickMs: 0, omitAck: true }, { rejectItem: 'golden apple' }, { cancelItem: 'golden apple' }, { stallItem: 'golden apple', timeoutMs: 250 }]) {
        const live = harness(mode);
        try {
            const original = slotNames(live);
            await live.q.command(['/quickbuy', 'test']);
            const events = report(live);
            const summary = events.find(e => e.event === 'summary');
            const backup = events.find(e => e.event === 'backup');
            assert(fs.existsSync(path.join(live.dir, backup.preset + '.json')), 'recovery preset persists');
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(live.dir, backup.preset + '.json'))).slots, original);
            const catalog = events.find(e => e.event === 'catalog');
            assert.strictEqual(catalog.items.length, 36, 'discover every live item across both recorded pages');
            if (mode.stallItem) {
                assert.strictEqual(live.disconnected.length, 1);
                assert.strictEqual(summary.restored, false);
                assert(events.some(e => e.event === 'fatal' && e.waitingFor.includes('Golden Apple')));
                assert(!live.q.allowOutbound('block_place', {}));
            } else {
                assert.strictEqual(live.disconnected.length, 0);
                assert.strictEqual(summary.restored, true);
                assert.deepStrictEqual(slotNames(live), original, 'restore all slots displaced by testing');
                if (mode.cancelItem) assert.strictEqual(summary.outcome, 'aborted');
                else {
                    assert.strictEqual(events.filter(e => e.event === 'attempt').length, 36);
                    assert.strictEqual(summary.passed, mode.rejectItem ? 35 : 36);
                    assert.strictEqual(summary.failed, mode.rejectItem ? 1 : 0);
                    assert.strictEqual(summary.outcome, mode.rejectItem ? 'completed-with-failures' : 'passed');
                }
                assert(!live.q.isActive());
            }
            assert.strictEqual(events.at(-1).event, 'end');
        } finally { live.clean(); }
    }

    const delayed = harness({ contentDelayMs: 10, partialUpdates: true, ackDelayMs: 60,
        settleMs: 10, snapshotSettleMs: 1, timeoutMs: 500 });
    try {
        await delayed.q.command(['/quickbuy', 'set', '1', 'golden apple']);
        assert.strictEqual(delayed.disconnected.length, 0);
        assert.strictEqual(slotNames(delayed)[0], 'golden apple', 'late slots and acknowledgements must still complete');
    } finally { delayed.clean(); }

    const cache = harness();
    try {
        await cache.q.command(['/quickbuy', 'set', '1', 'golden apple']);
        await cache.q.command(['/quickbuy', 'clear', '1']);
        let before = cache.sent.length;
        await cache.q.command(['/quickbuy', 'set', '1', 'golden apple']);
        assert(cache.sent.slice(before).some(([n, d]) => n === 'window_click' && d.slot === 53 && d.mouseButton === 1),
            'known last-page item uses the advertised right-click shortcut');
        await cache.q.command(['/quickbuy', 'clear', '1']);
        // The server changes its catalog between operations. Live names/items,
        // not cached wire slots, must determine which item gets clicked.
        const apple = structuredClone(cache.secondPage.find(i => key(i.name) === 'golden apple'));
        const clay = structuredClone(cache.picker.find(i => key(i.name) === 'hardened clay'));
        Object.assign(cache.picker.find(i => i.slot === clay.slot), apple, { slot: clay.slot });
        Object.assign(cache.secondPage.find(i => i.slot === apple.slot), clay, { slot: apple.slot });
        before = cache.sent.length;
        await cache.q.command(['/quickbuy', 'set', '1', 'golden apple']);
        assert.strictEqual(slotNames(cache)[0], 'golden apple');
        assert(!cache.sent.slice(before).some(([n, d]) => n === 'window_click' && d.slot === 53), 'stale cache must not force unnecessary page navigation');
        await cache.q.command(['/quickbuy', 'save', 'unchanged']);
        before = cache.sent.length;
        await cache.q.command(['/quickbuy', 'load', 'unchanged']);
        assert.strictEqual(cache.sent.slice(before).filter(([n]) => n === 'window_click').length, 2, 'unchanged load only navigates to the editor');
    } finally { cache.clean(); }

    const timings = [];
    for (const settings of [
        { snapshotSettleMs: 450, settleMs: 450, minimumClickMs: 0 },
        { snapshotSettleMs: 0, settleMs: 75, minimumClickMs: 0 }
    ]) {
        const speed = harness({ ...settings, timeoutMs: 1000, totalTimeoutMs: 5000 });
        try {
            const start = Date.now();
            await speed.q.command(['/quickbuy', 'set', '1', 'hardened clay']);
            timings.push(Date.now() - start);
            assert.strictEqual(speed.disconnected.length, 0);
            assert.strictEqual(slotNames(speed)[0], 'hardened clay');
        } finally { speed.clean(); }
    }
    assert(timings[1] < timings[0] / 2, 'complete snapshots should eliminate most fixed-delay overhead');
    console.log(`Simulated single-slot change: legacy waits ${timings[0]}ms; optimized waits ${timings[1]}ms`);

    // Production defaults must advance in microtasks, without yielding to a
    // timer. A fully loaded replacement menu is sufficient without an old ACK.
    const immediate = harness({ snapshotSettleMs: undefined, minimumClickMs: undefined });
    const flushMicrotasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    try {
        immediate.suppress();
        const job = immediate.q.command(['/quickbuy', 'set', '1', 'hardened clay']);
        immediate.open('Game Settings', captured['Game Settings'].items);
        await flushMicrotasks();
        assert.strictEqual(immediate.sent.filter(([n]) => n === 'window_click').length, 1, 'send immediately after full settings response');
        const firstClick = immediate.sent.find(([n]) => n === 'window_click')[1];
        immediate.open('Bed Wars Settings', captured['Bed Wars Settings'].items);
        await flushMicrotasks();
        assert.strictEqual(immediate.sent.filter(([n]) => n === 'window_click').length, 2, 'replacement menu advances even when Hypixel omits the old ACK');
        immediate.q.observeServer({ windowId: firstClick.windowId, action: firstClick.action, accepted: false }, { name: 'transaction' });
        await flushMicrotasks();
        assert.strictEqual(immediate.sent.filter(([n]) => n === 'window_click').length, 2, 'late old ACK must not release or duplicate the next click');
        immediate.q.dispose();
        await job;
    } finally { immediate.clean(); }

    const actions = [];
    const copiedIds = SLOTS.map(slot => captured['Edit Quick Buy'].items.find(i => i.slot === slot).databaseName).reverse();
    copiedIds[5] = 'null';
    assert(copiedIds.every(Boolean), 'API matching fixtures carry recorded database IDs');
    const copy = harness({ fetchPlayer: async name => {
        assert.strictEqual(name, 'Goatinio2001');
        return { stats: { Bedwars: { favourites_2: copiedIds.join(',') } } };
    } });
    try {
        await copy.q.command(['/quickbuy', 'Goatinio2001']);
        assert.strictEqual(copy.disconnected.length, 0);
        assert.deepStrictEqual(SLOTS.map(slot => {
            const item = copy.editor().find(i => i.slot === slot);
            return item.databaseName || 'null';
        }), copiedIds, 'apply IDs including shears, tools and empty positions without relying on display names');
        assert(copy.messages.some(m => m.includes('Copied Goatinio2001')));
    } finally { copy.clean(); }
    for (const favourites of [undefined, 'wool', Array(21).fill('unknown_item').join(',')]) {
        const unavailable = harness({ fetchPlayer: async () => ({ stats: { Bedwars: { favourites_2: favourites } } }) });
        try {
            await unavailable.q.command(['/quickbuy', 'Someone']);
            assert.strictEqual(unavailable.sent.length, 0, 'missing or malformed API layouts cannot open or modify menus');
        } finally { unavailable.clean(); }
    }
    const unknownIds = [...copiedIds];
    unknownIds[0] = 'future_unavailable_item';
    const unknown = harness({ fetchPlayer: async () => ({ stats: { Bedwars: { favourites_2: unknownIds.join(',') } } }) });
    try {
        await unknown.q.command(['/quickbuy', 'Someone']);
        assert.strictEqual(unknown.disconnected.length, 0);
        for (let i = 1; i < 21; i++) {
            assert.strictEqual(unknown.editor().find(item => item.slot === SLOTS[i]).databaseName || 'null', unknownIds[i],
                'available items and null positions must still apply');
        }
        assert(unknown.messages.some(m => m.includes('Skipping 1: future unavailable item (#1)')));
        assert(unknown.messages.some(m => m.includes('1 skipped')));
        assert(unknown.messages.some(m => m.includes('Copied Someone')));
    } finally { unknown.clean(); }
    const allUnknown = harness({ fetchPlayer: async () => ({ stats: { Bedwars: {
        favourites_2: Array.from({ length: 21 }, (_, i) => `unavailable_${i}`).join(',')
    } } }) });
    try {
        const original = slotNames(allUnknown);
        await allUnknown.q.command(['/quickbuy', 'Someone']);
        assert.deepStrictEqual(slotNames(allUnknown), original, 'skipping every item leaves the layout untouched');
        assert(allUnknown.messages.some(m => m.includes('21 skipped')));
        assert.strictEqual(allUnknown.disconnected.length, 0);
    } finally { allUnknown.clean(); }
    let deliverPlayer;
    const pendingCopy = harness({ fetchPlayer: () => new Promise(resolve => { deliverPlayer = resolve; }) });
    try {
        const job = pendingCopy.q.command(['/quickbuy', 'Someone']);
        pendingCopy.q.command(['/quickbuy', 'cancel']);
        deliverPlayer({ stats: { Bedwars: { favourites_2: copiedIds.join(',') } } });
        await job;
        assert.strictEqual(pendingCopy.sent.length, 0, 'cancel during lookup must not open a menu afterward');
    } finally { pendingCopy.clean(); }
    const monitor = createMenuMonitor({ dir: null, log: () => {}, sendUpstream: (n, d) => actions.push(d.action) });
    try {
        monitor.observeServerPacket({ windowId: 9, windowTitle: 'Test', inventoryType: 'minecraft:chest', slotCount: 54 }, { name: 'open_window' });
        for (let i = 0; i < 150; i++) assert(monitor.clickSlot({ slot: 10 }).ok);
        assert(actions.every(a => Number.isInteger(a) && a >= 0 && a <= 32767), 'long walks stay within protocol signed-short range');
        assert.strictEqual(new Set(actions).size, actions.length, 'pending actions cannot be reused on wrap');
    } finally { monitor.dispose(); }
    console.log('Quick Buy tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
