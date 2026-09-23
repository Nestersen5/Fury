'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createQuickBuy } = require('../../src/menu/quickBuy');
const { createKillMessageLogger, summarize } = require('../../src/menu/killMessageLogger');
const { stripAnsi, extractText } = require('../../features/minecraft_chat');
const fixtures = require('../../src/menu/fixtures/kill-message-menus.json');
const capturedTeleports = require('../../src/menu/fixtures/kill-message-teleports.json');

const wire = item => ({ blockId: item.id, itemCount: 1, itemDamage: item.dmg || 0,
    nbtData: { type: 'compound', name: '', value: { display: { type: 'compound', value: {
        Name: { type: 'string', value: item.name },
        Lore: { type: 'list', value: { type: 'string', value: item.lore || [] } }
    } } } } });

function harness(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kill-message-logger-'));
    const sent = [], messages = [], disconnected = [], previewed = [], timers = new Set(), clientPackets = [];
    let returnAckPending = false;
    let busyRejections = 0;
    const origin = options.recordedTeleports ? capturedTeleports.at(-1).data : { x: 0, y: 70, z: 0, yaw: 0, pitch: 0, flags: 0 };
    let logger, windowId = 0, currentTitle = '', currentItems = [], pending = false, inPreview = false;
    function later(fn, delay = 1) {
        const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay);
        timers.add(timer);
    }
    function server(name, data) {
        logger.observeServer(data, { name });
        return automation.observeServer(data, { name });
    }
    function teleport(returning = false, acknowledge = true) {
        const absolute = returning ? { x: origin.x, y: origin.y, z: origin.z, yaw: origin.yaw, pitch: origin.pitch }
            : options.recordedTeleports ? { ...capturedTeleports[0].data }
            : { x: 100, y: 90, z: 200, yaw: 45, pitch: 15 };
        const packet = options.relativeTeleports
            ? { x: returning ? -100 : 100, y: returning ? -20 : 20, z: returning ? -200 : 200,
                yaw: returning ? -45 : 45, pitch: returning ? -15 : 15, flags: 31 }
            : { ...absolute, flags: 0 };
        server('position', packet);
        assert.equal(disconnected.length, 0, 'preview teleport must not disconnect');
        assert.deepStrictEqual(packet, { ...absolute, flags: 0 }, 'relative coordinates must resolve against the locked position');
        const ack = { ...absolute, onGround: false };
        const confirm = () => {
            assert.equal(automation.observeClient(ack, { name: 'position_look' }), false, 'allow vanilla airborne teleport acknowledgement');
            assert(automation.allowOutbound('position_look', ack), 'ack must also pass the public transport guard');
            if (returning) returnAckPending = false;
        };
        if (returning) returnAckPending = true;
        if (acknowledge) {
            if (returning && options.lateReturnAck) later(confirm, 9);
            else confirm();
        }
        const before = clientPackets.length;
        assert(!automation.allowOutbound('position', { ...ack, x: absolute.x + 1, onGround: true }), 'voluntary movement remains blocked');
        const corrections = clientPackets.slice(before).filter(([name]) => name === 'position');
        for (const [, correction] of corrections) assert.deepStrictEqual(correction, { ...absolute, flags: 0 }, 'correct only to the current server destination');
    }
    function open(name) {
        const fixture = structuredClone(fixtures.menus[name]);
        if (options.repeatCosmetic && name === 'Kill Messages (Page 2)') {
            fixture.items.push({ ...fixtures.menus['Kill Messages'].items.find(item => stripAnsi(item.name) === 'Western'), slot: 28 });
        }
        currentTitle = name;
        currentItems = fixture.items;
        windowId++;
        const id = windowId;
        pending = true;
        server('open_window', { windowId: id, inventoryType: 'minecraft:chest',
            windowTitle: JSON.stringify({ text: name }), slotCount: fixture.slotCount });
        // Neither an old snapshot nor a partial current snapshot is sufficient.
        server('window_items', { windowId: id - 1, items: Array(90).fill({ blockId: -1 }) });
        server('window_items', { windowId: id, items: [] });
        later(() => {
            const items = Array.from({ length: fixture.slotCount + 36 }, () => ({ blockId: -1 }));
            fixture.items.forEach(item => { items[item.slot] = wire(item); });
            pending = false;
            server('window_items', { windowId: id, items });
        }, 2);
    }
    const chat = (component, position = 0) => server('chat', { position, message: JSON.stringify(component) });
    const automation = createQuickBuy({ presetDir: path.join(dir, 'presets'), minimumStillMs: 0,
        canStart: () => options.denied || null, snapshotSettleMs: 0, timeoutMs: 120, totalTimeoutMs: 1000,
        sendClient: (name, data) => clientPackets.push([name, data]), sendChat: text => messages.push(stripAnsi(text)),
        disconnect: reason => disconnected.push(reason),
        sendUpstream: (name, data) => {
            sent.push([name, data]);
            if (name === 'block_place') {
                assert.equal(data.heldItem.blockId, 388);
                later(() => {
                    if (options.unrelatedTeleport) server('position', { x: 5, y: 70, z: 0, yaw: 0, pitch: 0, flags: 0 });
                    else open('Bed Wars Menu');
                });
            }
            if (name !== 'window_click') return;
            assert(!pending, 'must wait for complete current-window contents');
            assert(!inPreview, 'must wait for both preview footer and menu return');
            assert(!returnAckPending, 'must wait for the return teleport acknowledgement');
            assert.equal(data.windowId, windowId, 'must use the returned window ID');
            const item = currentItems.find(item => item.slot === data.slot);
            assert(item, 'must never click an empty last-page slot');
            assert.deepStrictEqual(data.item, wire(item));
            const label = stripAnsi(item.name).trim();
            if (currentTitle === 'Bed Wars Menu') { assert.equal(label, 'My Cosmetics'); later(() => open('My Cosmetics')); }
            else if (currentTitle === 'My Cosmetics') { assert.equal(label, 'Kill Messages'); later(() => open('Kill Messages')); }
            else if (label === 'Left-click for next page!') { assert.equal(data.mouseButton, 0); later(() => open('Kill Messages (Page 2)')); }
            else {
                assert.equal(data.mouseButton, 1, 'cosmetics must only be right-clicked');
                assert(item.lore.some(line => stripAnsi(line) === 'Right-Click to preview!'));
                if (label === 'Western' && busyRejections < (options.busyRejections || 0)) {
                    busyRejections++;
                    later(() => {
                        chat({ text: "You can't do that while already in a menu!" });
                        if (options.cancelDuringRetry) logger.command(['/kmlog', 'cancel']);
                    });
                    return;
                }
                previewed.push(label);
                inPreview = true;
                const returnTitle = currentTitle;
                later(() => {
                    server('close_window', { windowId: data.windowId });
                    teleport();
                    chat({ text: 'Chat Messages:' });
                    chat({ text: '' });
                    chat({ text: 'An unrelated lobby notice' });
                    chat({ text: 'Player action-bar noise' }, 2);
                    let lines = structuredClone(fixtures.previews[label] || Array.from({ length: 6 }, (_, i) => ({ text: `Player ${label} preview ${i + 1}.` })));
                    if (label === 'Western') lines[1] = structuredClone(lines[0]); // Consecutive legitimate duplicates.
                    if (label === 'Fire') lines[5] = structuredClone(fixtures.previews.Western[5]); // Shared bed wording.
                    lines.forEach(line => chat(line));
                    const footer = () => chat({ text: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬' });
                    if (!options.lateChat) footer();
                    if (options.recordedTeleports) {
                        for (const event of capturedTeleports.slice(1, -1)) {
                            const packet = { ...event.data };
                            server('position', packet);
                            assert.equal(disconnected.length, 0, 'allow the captured two-block camera adjustment and repeated corrections');
                            const ack = { ...packet, onGround: false };
                            assert.equal(automation.observeClient(ack, { name: 'position_look' }), false);
                            assert(automation.allowOutbound('position_look', ack));
                        }
                    }
                    if (options.cancelAt === label) {
                        logger.command(['/kmlog', 'cancel']);
                        assert(automation.isActive(), 'cancellation retains the lock until the menu returns');
                    }
                    if (options.disconnectAt === label) { automation.dispose(); return; }
                    if (options.timeoutAt === label) return;
                    if (options.worldChangeAt === label) { server('respawn', { dimension: 0 }); return; }
                    if (options.wrongReturnAt === label) {
                        server('position', { x: 12, y: 70, z: 0, yaw: 0, pitch: 0, flags: 0 });
                        return;
                    }
                    later(() => {
                        inPreview = false;
                        if (!options.lateReturn && options.missingReturnAt !== label) teleport(true, options.missingAckAt !== label);
                        open(returnTitle);
                        if (options.lateReturn) later(() => teleport(true), 7);
                        if (options.lateChat) {
                            inPreview = true;
                            later(() => { inPreview = false; footer(); }, 7);
                        }
                    }, 8);
                });
            }
            // Replacement menus may be the only acknowledgement Hypixel sends.
            if (options.ack) later(() => server('transaction', { windowId: data.windowId, action: data.action, accepted: false }));
        } });
    logger = createKillMessageLogger({ automation, dir: options.badPath ? path.join(dir, 'file', 'logs') : path.join(dir, 'logs'),
        menuSettleMs: options.menuSettleMs || 0, retryDelayMs: 5,
        sendChat: text => messages.push(stripAnsi(text)), account: () => ({ uuid: 'test-account', username: 'ExampleKiller' }) });
    if (options.badPath) fs.writeFileSync(path.join(dir, 'file'), 'not a directory');
    const inventory = Array.from({ length: 45 }, () => ({ blockId: -1 }));
    inventory[40] = wire({ id: 388, name: '§aBed Wars Menu §7(Right Click)' });
    server('window_items', { windowId: 0, items: inventory });
    logger.observeClient({ slotId: 2 }, { name: 'held_item_slot' });
    automation.observeClient({ ...origin, onGround: true }, { name: 'position_look' });
    return { automation, logger, messages, sent, previewed, disconnected, clientPackets,
        read: () => JSON.parse(fs.readFileSync(path.join(dir, 'logs', fs.readdirSync(path.join(dir, 'logs'))[0]), 'utf8')),
        cleanup: () => { automation.dispose(); timers.forEach(clearTimeout); fs.rmSync(dir, { recursive: true, force: true }); } };
}

(async () => {
    for (const options of [{}, { lateChat: true, ack: true, repeatCosmetic: true, relativeTeleports: true },
        { lateReturn: true, lateReturnAck: true }, { recordedTeleports: true }, { busyRejections: 2, menuSettleMs: 5 }]) {
        const h = harness(options);
        try {
            await h.logger.command(['/kmlog', 'start']);
            const report = h.read();
            assert.equal(report.status, 'complete');
            assert.equal(report.account.uuid, 'test-account');
            assert.deepStrictEqual(report.pages, [1, 2]);
            assert.equal(report.cosmetics.length, 32);
            assert.equal(report.summary.attemptedCosmetics, 32);
            assert.equal(report.summary.skippedCosmetics, 3);
            assert.equal(report.previewRejections.length, options.busyRejections || 0);
            assert.equal(new Set(h.previewed).size, 32);
            assert(!h.previewed.includes('DEFAULT'));
            assert(!h.previewed.includes('Random Kill Messages'));
            const western = report.cosmetics.find(c => c.name === 'Western');
            const glorious = report.cosmetics.find(c => c.name === 'Glorious');
            assert.equal(western.lines.length, 6);
            assert.equal(glorious.lines.length, 7);
            assert.deepStrictEqual(western.lines[0].text, western.lines[1].text);
            assert(western.lines[0].formatted.includes('§'));
            assert.equal(extractText(JSON.parse(western.lines[0].raw)), western.lines[0].text);
            assert.equal(report.summary.totalMessages, 193);
            assert.equal(report.summary.duplicateOccurrences, 2);
            assert.equal(report.summary.duplicateGroups, 2);
            assert.equal(report.summary.uniqueMessages, 191);
            assert.deepStrictEqual(report.summary.duplicates.find(g => g.text.startsWith('Green Bed')).occurrences,
                [{ cosmetic: 'Fire', position: 6 }, { cosmetic: 'Western', position: 6 }]);
            assert(h.messages.some(s => s.includes('Fire (#6)') && s.includes('Western (#6)')));
            assert.equal(h.disconnected.length, 0);
            assert.equal(report.relocations.length, 16, 'keep bounded relocation diagnostics');
            assert(report.relocations.every(event => event.accepted));
            assert.deepStrictEqual(h.clientPackets.filter(([name]) => name === 'position').at(-1)[1],
                options.recordedTeleports ? capturedTeleports.at(-1).data : { x: 0, y: 70, z: 0, yaw: 0, pitch: 0, flags: 0 }, 'finish must leave the player at their original location');
            assert(!h.automation.isBusy());
            assert.deepStrictEqual(h.sent.filter(([name]) => name === 'held_item_slot').map(([, d]) => d.slotId), [4, 2]);
            // Each run has its own report; there is no append-to-old-file duplication.
            await h.logger.command(['/kmlog', 'status']);
            assert(h.messages.at(-1).includes('File:'));
        } finally { h.cleanup(); }
    }
    for (const options of [{ cancelAt: 'Western', lateReturn: true, lateReturnAck: true },
        { timeoutAt: 'Western' }, { disconnectAt: 'Western' }, { missingReturnAt: 'Western' },
        { missingAckAt: 'Western' }, { worldChangeAt: 'Western' }, { wrongReturnAt: 'Western' }]) {
        const h = harness(options);
        try {
            await h.logger.command(['/kmlog', 'start']);
            const report = h.read();
            assert.equal(report.status, options.cancelAt ? 'cancelled' : 'failed');
            assert.equal(report.cosmetics.length, 1, 'earlier Fire capture survives interruption during Western');
            assert.equal(report.summary.attemptedCosmetics, 2);
            assert.deepStrictEqual(report.summary.unfinishedCosmetics, ['Western']);
            assert.deepStrictEqual(h.previewed, ['Fire', 'Western']);
            if (!options.cancelAt && !options.disconnectAt) assert.equal(h.disconnected.length, 1);
            if (options.worldChangeAt || options.wrongReturnAt) {
                const event = report.relocations.at(-1);
                assert.equal(event.accepted, false);
                assert.equal(event.cosmetic, 'Western');
                assert.equal(event.packet, options.worldChangeAt ? 'respawn' : 'position');
                assert(event.from && event.preview.destination);
            }
            assert.equal(report.interruptedPreview.name, 'Western');
            assert.equal(report.interruptedPreview.lines.length, 6, 'retain interrupted preview evidence');
            await h.automation.drain();
        } finally { h.cleanup(); }
    }
    for (const options of [{ denied: 'Not in a lobby' }, { badPath: true }]) {
        const h = harness(options);
        try {
            await h.logger.command(['/kmlog', 'start']);
            assert.equal(h.previewed.length, 0);
            assert(!h.messages.some(s => s.startsWith('[KM] Saved:')));
            assert(!h.automation.isBusy());
            if (options.badPath) await assert.rejects(h.automation.drain(), /save failed/);
        } finally { h.cleanup(); }
    }
    const moved = harness({ unrelatedTeleport: true });
    try {
        await moved.logger.command(['/kmlog', 'start']);
        assert.equal(moved.disconnected.length, 1, 'teleports outside a preview remain fatal');
        assert.equal(moved.read().status, 'failed');
        assert(!moved.clientPackets.some(([name]) => name === 'position'), 'do not snap back after an unrelated teleport');
    } finally { moved.cleanup(); }
    for (const options of [{ busyRejections: 10 }, { busyRejections: 10, cancelDuringRetry: true }]) {
        const h = harness(options);
        try {
            await h.logger.command(['/kmlog', 'start']);
            const report = h.read();
            assert.equal(report.status, options.cancelDuringRetry ? 'cancelled' : 'failed');
            assert.equal(report.previewRejections.length, options.cancelDuringRetry ? 1 : 3);
            assert.equal(report.cosmetics.length, 1);
            assert.equal(h.disconnected.length, 0, 'explicit preview refusal must stop cleanly without a timeout kick');
            assert(!h.automation.isBusy());
            assert.deepStrictEqual(h.previewed, ['Fire'], 'never start another cosmetic during a rejected preview');
        } finally { h.cleanup(); }
    }
    const empty = summarize([]);
    assert.equal(empty.totalMessages, 0);
    assert.equal(empty.duplicateOccurrences, 0);
    console.log('Kill-message logger tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
