'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../storage/atomic_file');
const { createMenuMonitor, simplifyNbt } = require('./menuMonitor');
const { parseQuickBuy } = require('./quickBuyImport');
const { quickBuyMessage } = require('./quickBuyMessages');
const hotbar = require('./hotbarLayout');

const SLOTS = Array.from({ length: 21 }, (_, i) => 10 + Math.floor(i / 7) * 9 + i % 7);
const plain = value => String(value || '').replace(/§[0-9a-fk-or]/gi, '').trim();
const key = value => plain(value).toLowerCase().replace(/_/g, ' ').replace(/ x\d+$/, '').replace(/\s+/g, ' ');
const empty = item => item && /^(empty slot|empty quick buy slot|quick buy slot)!?$/i.test(plain(item.name));
const isPicker = win => win && /^(?:\(\d+\/\d+\) )?Adding to Quick Buy\.\.\.$/.test(win.plainTitle) && win.slotCount === 54;
const choices = win => [...win.slots].filter(([s, i]) => s < win.slotCount
    && /Click to add this item to your Quick\s*Buy!/i.test(i.plainLore.join(' ')));
const itemKey = item => empty(item) ? null : key(item && item.name);
const databaseName = item => item?.nbt?.ExtraAttributes?.databaseName;
const targetKey = target => target && typeof target === 'object' ? `db:${target.databaseName}` : target;
const matchesTarget = (item, target) => target && typeof target === 'object'
    ? databaseName(item) === target.databaseName : itemKey(item) === target;
const layout = win => SLOTS.map(slot => itemKey(win.slots.get(slot)));
const signature = win => JSON.stringify([...win.slots].filter(([s]) => s < win.slotCount).map(([s, i]) => [s, i.name, i.lore]));
const pageNumber = win => Number(/^\((\d+)\/\d+\)/.exec(win.plainTitle)?.[1] || 1);

// All automation writes use a private, pre-guard transport. The public transport
// is guarded too, so timers and other features cannot bypass the interaction lock.
function createQuickBuy({ sendUpstream, sendClient, sendChat, disconnect, canStart, presetDir, fetchPlayer,
    settleMs = 75, snapshotSettleMs = 0, minimumClickMs = 0,
    timeoutMs = 8000, totalTimeoutMs = 180000, minimumStillMs = 500,
    testTimeoutMs = 600000 }) {
    let active = false;
    let cancelled = false;
    let disposed = false;
    let waiter = null;
    let totalTimer = null;
    let position = null;
    let anchor = null;
    let grounded = false;
    let stillSince = Date.now();
    let correctionAt = 0;
    let operation = null;
    let diagnostic = null;
    let menuGeneration = 0;
    let snapshotGeneration = -1;
    let menuRevision = 0;
    let lastMenuSignature = '';
    let startedAt = 0;
    let clickCount = 0;
    let mode = 'quickbuy';
    let cursor = { blockId: -1 };
    let closing = null;
    let usedHotbar = false;
    let menuTask = null;
    let allowTeleportAck = false;
    let teleportPending = false;
    const itemPages = new Map();
    const rejectedClientClicks = new Set();
    const monitor = createMenuMonitor({ sendUpstream: (name, data) => {
        if (name === 'window_click') {
            clickCount++;
            if (waiter) Object.assign(waiter, { action: data.action, actionWindow: data.windowId, acknowledged: false });
        }
        record({ event: 'send', packet: name, window: data.windowId, slot: data.slot,
            action: data.action, button: data.mouseButton });
        sendUpstream(name, data);
    }, dir: null, log: () => {} });
    const say = (text, tone) => sendChat(quickBuyMessage(text, tone)
        .replace('Quick Buy', menuTask?.label || (mode === 'hotbar' ? 'Hotbar' : mode === 'quickbuyandhotbar' ? 'Quick Buy + Hotbar' : 'Quick Buy'))
        .replace(/\/quickbuy\b/g, `/${mode}`));

    function record(event) {
        if (!diagnostic) return;
        try { fs.appendFileSync(diagnostic.file, JSON.stringify({ t: Date.now(), ...event }) + '\n'); }
        catch (error) { diagnostic.logError = error.message; }
    }

    function startDiagnostic() {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const directory = path.join(presetDir, 'test-reports');
        fs.mkdirSync(directory, { recursive: true });
        const file = path.join(directory, `test-${id}.jsonl`);
        fs.writeFileSync(file, '', { flag: 'wx' });
        diagnostic = { file, backup: `test-backup-${id}`, restored: false, passed: 0, failed: 0,
            total: 0, attempted: 0, interrupted: 0, phase: 'opening' };
        record({ event: 'start', testSlot: 1, snapshotSettleMs, settleMs, minimumClickMs });
        say(`Test log: §f${path.basename(file)}`);
    }

    function rejectWait(error) {
        if (!waiter) return;
        const current = waiter;
        waiter = null;
        clearTimeout(current.timeout);
        clearTimeout(current.settle);
        current.reject(error);
    }

    function fatal(reason) {
        if (!active) return;
        disposed = true;
        cancelled = true;
        record({ event: 'fatal', reason, waitingFor: waiter?.label, menu: monitor.getWindow()?.plainTitle });
        rejectWait(new Error(reason));
        clearTimeout(totalTimer);
        // If a menu response is missing, releasing the lock could leave an
        // outstanding open request. Disconnect instead of guessing it closed.
        disconnect(`${menuTask?.label || (mode === 'quickbuy' ? 'Quick Buy' : mode === 'hotbar' ? 'Hotbar' : 'Quick Buy + Hotbar')} stopped: ${reason}. Reconnect to resume.`);
    }

    function waitFor(predicate, trigger, label = 'opening settings') {
        if (cancelled || disposed) return Promise.reject(new Error('Cancelled'));
        return new Promise((resolve, reject) => {
            record({ event: 'wait', label });
            waiter = { predicate, resolve, reject, settle: null, label, sentAt: Date.now(), changedAt: Date.now(),
                revision: menuRevision, generation: menuGeneration, acknowledged: true,
                delay: menuTask?.snapshotSettleMs ?? snapshotSettleMs, scheduleVersion: 0, queued: false,
                timeout: setTimeout(() => fatal(`Timed out ${label}; current menu: ${monitor.getWindow()?.plainTitle || 'none'}`), timeoutMs) };
            try { trigger(); } catch (error) { fatal(error.message); }
        });
    }

    function readyMenu(win) {
        if (!win || snapshotGeneration !== menuGeneration) return false;
        if (menuTask) return menuTask.readyMenu(win);
        if (win.plainTitle === 'Hotbar Manager') {
            try { hotbar.validate(win); return true; } catch { return false; }
        }
        if (win.plainTitle === 'Edit Quick Buy') {
            try { validateEditor(win); return true; } catch { return false; }
        }
        if (isPicker(win)) return choices(win).length > 0
            && [...win.slots].some(([s, i]) => s < win.slotCount && key(i.name) === 'go back');
        const expected = win.plainTitle === 'Game Settings' ? 'bed wars settings'
            : win.plainTitle === 'Bed Wars Settings' ? (mode === 'hotbar' ? 'hotbar manager' : 'edit quick buy') : null;
        return expected && [...win.slots].some(([s, i]) => s < win.slotCount && key(i.name) === expected);
    }

    function checkWait(changed = false, incremental = false) {
        if (!waiter) return;
        const current = waiter;
        if (changed) {
            clearTimeout(current.settle);
            current.settle = null;
            current.queued = false;
            current.scheduleVersion++;
            current.delay = incremental ? Math.max(settleMs, menuTask?.snapshotSettleMs || 0)
                : (menuTask?.snapshotSettleMs ?? snapshotSettleMs);
            current.changedAt = Date.now();
        }
        const win = monitor.getWindow();
        // Hypixel can replace the container without acknowledging the click on
        // the old one. A fully received expected replacement is itself proof
        // of that transition. Same-container updates still require the ACK.
        const confirmed = () => current.hotbarEvidence ? current.hotbarEvidence() : current.acknowledged || menuGeneration > current.generation;
        const revised = () => current.hotbarEvidence ? confirmed() : menuRevision > current.revision;
        if (!readyMenu(win) || !revised() || !confirmed() || !current.predicate(win)) return;
        if (current.settle || current.queued) return; // Identical resends do not extend the wait.
        const version = current.scheduleVersion;
        const complete = () => {
            if (waiter !== current || version !== current.scheduleVersion) return;
            const win = monitor.getWindow();
            current.settle = null;
            current.queued = false;
            if (!readyMenu(win) || !revised() || !confirmed() || !current.predicate(win)) return;
            waiter = null;
            clearTimeout(current.timeout);
            if (isPicker(win)) rememberPage(win);
            record({ event: 'ready', label: current.label, elapsedMs: Date.now() - current.sentAt,
                confirmedBy: current.acknowledged ? 'transaction' : 'replacement-menu' });
            if (cancelled) current.reject(new Error('Cancelled'));
            else current.resolve(win);
        };
        const delay = Math.max(0, current.changedAt + (current.hotbarEvidence ? 0 : current.delay) - Date.now(),
            current.sentAt + minimumClickMs - Date.now());
        if (delay > 0) current.settle = setTimeout(complete, delay);
        else {
            // Finish processing this packet batch, recheck the live menu, then
            // continue the action queue without a timer or artificial cooldown.
            current.queued = true;
            queueMicrotask(complete);
        }
    }

    function rememberPage(win) {
        const page = pageNumber(win);
        for (const [name, cached] of itemPages) if (cached.page === page) itemPages.delete(name);
        const total = Number(/^\(\d+\/(\d+)\)/.exec(win.plainTitle)?.[1] || 0);
        for (const [, item] of choices(win)) {
            itemPages.set(key(item.name), { page, total });
            if (databaseName(item)) itemPages.set(`db:${databaseName(item)}`, { page, total });
        }
    }

    function pageRoute(win, desired, visited) {
        const here = pageNumber(win);
        const controls = [...win.slots].filter(([s]) => s < win.slotCount);
        const next = controls.find(([, i]) => /left-click for next page/i.test(plain(i.name)));
        const previous = controls.find(([, i]) => /left-click for previous page/i.test(plain(i.name)));
        const cached = itemPages.get(desired);
        // Only use shortcuts explicitly advertised in the live control's lore.
        if (cached && cached.page !== here && !visited.has(cached.page)) {
            if (cached.page === cached.total && next && /right-click for last page/i.test(next[1].plainLore.join(' '))) {
                return { slot: next[0], button: 1 };
            }
            if (cached.page === 1 && previous && /right-click for first page/i.test(previous[1].plainLore.join(' '))) {
                return { slot: previous[0], button: 1 };
            }
            if (cached.page < here && previous && !visited.has(here - 1)) return { slot: previous[0], button: 0 };
        }
        if (next && !visited.has(here + 1)) return { slot: next[0], button: 0 };
        if (previous && !visited.has(here - 1)) return { slot: previous[0], button: 0 };
        return null;
    }

    function named(win, name) {
        const matches = [...win.slots].filter(([s, i]) => s < win.slotCount && key(i.name) === key(name));
        if (matches.length !== 1) throw new Error(`Expected one menu item named "${name}"`);
        return matches[0][0];
    }

    function click(slot, predicate, button = 0) {
        const win = monitor.getWindow();
        return waitFor(predicate, () => {
            const result = monitor.clickSlot({ slot, button, source: 'quickbuy' });
            if (!result.ok) throw new Error(result.error);
        }, `after clicking ${plain(win?.slots.get(slot)?.name) || slot} in ${win?.plainTitle || 'unknown menu'}`);
    }

    function validateEditor(win) {
        if (!win || win.plainTitle !== 'Edit Quick Buy' || win.slotCount !== 54 || !SLOTS.every(slot => {
            const item = win.slots.get(slot);
            return item && (empty(item) || item.plainLore.some(line => /This is a Quick Buy Slot!/i.test(line)));
        })) throw new Error('Unrecognized Quick Buy layout; no further clicks sent');
        return win;
    }

    async function openEditor(editor = 'Edit Quick Buy', existing = null) {
        if (existing?.plainTitle === 'Edit Quick Buy') {
            existing = await click(named(existing, 'Go Back'), w => w.plainTitle === 'Bed Wars Settings');
        }
        let win = existing || await waitFor(w => ['Game Settings', 'Bed Wars Settings'].includes(w.plainTitle),
            () => sendUpstream('chat', { message: '/settings' }));
        if (win.plainTitle === 'Game Settings') {
            win = await click(named(win, 'Bed Wars Settings'), w => w.plainTitle === 'Bed Wars Settings');
        }
        win = await click(named(win, editor), w => w.plainTitle === editor);
        return editor === 'Hotbar Manager' ? hotbar.validate(win) : validateEditor(win);
    }

    function hotbarClick(slot, desired, pickup) {
        const win = hotbar.validate(monitor.getWindow());
        return waitFor(w => w.windowId === win.windowId && (pickup
            ? cursor.nbtData && simplifyNbt(cursor.nbtData)?.ExtraAttributes?.hotbarCategory === desired
            : cursor.blockId === -1 && hotbar.layout(w)[slot - 27] === desired), () => {
            const current = waiter;
            current.cursorSeen = false;
            current.destinationSeen = false;
            current.destination = slot;
            current.hotbarEvidence = () => current.cursorSeen && (pickup || current.destinationSeen);
            const result = monitor.clickSlot({ slot, source: 'hotbar' });
            if (!result.ok) throw new Error(result.error);
        }, `after ${pickup ? 'picking up ' + desired : 'updating hotbar slot ' + (slot - 26)}`);
    }

    async function applyHotbar(win, target) {
        for (let i = 0; i < 9; i++) {
            if (cancelled) throw new Error('Cancelled');
            hotbar.validate(win);
            if (hotbar.layout(win)[i] === target[i]) continue;
            if (cursor.blockId !== -1) throw new Error('Unexpected item on cursor');
            if (target[i] !== null) {
                const source = [...win.slots].find(([s, item]) => s < 18 && item.nbt?.ExtraAttributes?.hotbarCategory === target[i]);
                win = await hotbarClick(source[0], target[i], true);
            }
            win = await hotbarClick(27 + i, target[i], false);
        }
        if (JSON.stringify(hotbar.layout(win)) !== JSON.stringify(target)) throw new Error('Hotbar verification failed');
        return win;
    }

    async function replace(win, index, desired, force = false) {
        validateEditor(win);
        if (!force && matchesTarget(win.slots.get(SLOTS[index]), desired)) return win;
        if (desired === null) {
            return validateEditor(await click(SLOTS[index], w => w.plainTitle === 'Edit Quick Buy'
                && empty(w.slots.get(SLOTS[index])), 1));
        }
        let picker = await click(SLOTS[index], isPicker);
        const pages = new Set();
        const visited = new Set();
        for (let page = 0; page < 10; page++) {
            const fingerprint = signature(picker);
            if (pages.has(fingerprint)) break;
            pages.add(fingerprint);
            visited.add(pageNumber(picker));
            const matches = choices(picker).filter(([, i]) => matchesTarget(i, desired));
            if (matches.length > 1) throw new Error(`Ambiguous item: ${desired}`);
            if (matches.length === 1) {
                win = validateEditor(await click(matches[0][0], w => w.plainTitle === 'Edit Quick Buy'));
                if (!matchesTarget(win.slots.get(SLOTS[index]), desired)) throw new Error(`Server did not apply slot ${index + 1}`);
                return win;
            }
            const route = pageRoute(picker, targetKey(desired), visited);
            if (!route) break;
            picker = await click(route.slot, w => isPicker(w) && signature(w) !== fingerprint, route.button);
        }
        throw new Error(`Item not found in the selection menu: ${targetKey(desired)}`);
    }

    async function validateImport(win, target) {
        if (target.every(item => item === null)) return { win, skipped: [] };
        if (target.every((item, i) => matchesTarget(win.slots.get(SLOTS[i]), item))) return { win, skipped: [] };
        let picker = await click(SLOTS[0], isPicker);
        const available = new Set();
        const pages = new Set();
        for (;;) {
            const fingerprint = signature(picker);
            if (pages.has(fingerprint) || pages.size >= 10) throw new Error('Unexpected Quick Buy pagination');
            pages.add(fingerprint);
            for (const [, item] of choices(picker)) if (databaseName(item)) available.add(databaseName(item));
            const next = [...picker.slots].find(([s, item]) => s < picker.slotCount && /left-click for next page/i.test(plain(item.name)));
            if (!next) break;
            picker = await click(next[0], w => isPicker(w) && signature(w) !== fingerprint);
        }
        const skipped = target.flatMap((item, index) => item && !available.has(item.databaseName)
            && !matchesTarget(win.slots.get(SLOTS[index]), item) ? [{ index, databaseName: item.databaseName }] : []);
        if (skipped.length) say(`Skipping ${skipped.length}: §f${skipped.slice(0, 3).map(item => `${item.databaseName.replace(/_/g, ' ')} (#${item.index + 1})`).join(', ')}${skipped.length > 3 ? ` §7+${skipped.length - 3} more` : ''}`, 'warning');
        return { win: await returnToEditor(), skipped };
    }

    async function returnToEditor() {
        let win = monitor.getWindow();
        if (isPicker(win)) win = await click(named(win, 'Go Back'), w => w.plainTitle === 'Edit Quick Buy');
        return validateEditor(win);
    }

    async function testAll(win) {
        const original = layout(win);
        await persist(presetPath(diagnostic.backup), JSON.stringify({ version: 1, slots: original }, null, 2) + '\n');
        record({ event: 'backup', preset: diagnostic.backup, slots: original });
        say(`Backup: §f${diagnostic.backup}`, 'success');
        let outcome = 'aborted';
        try {
            diagnostic.phase = 'discovery';
            let picker = await click(SLOTS[0], isPicker);
            const catalog = new Map();
            const pages = new Set();
            for (;;) {
                const fingerprint = signature(picker);
                if (pages.has(fingerprint) || pages.size >= 10) throw new Error('Picker pagination repeated or exceeded 10 pages');
                pages.add(fingerprint);
                for (const [, item] of choices(picker)) {
                    const name = key(item.name);
                    if (catalog.has(name)) throw new Error(`Duplicate picker item: ${name}`);
                    catalog.set(name, plain(item.name));
                }
                const next = [...picker.slots].find(([s, i]) => s < picker.slotCount && /left-click for next page/i.test(plain(i.name)));
                if (!next) break;
                picker = await click(next[0], w => isPicker(w) && signature(w) !== fingerprint);
            }
            if (!catalog.size) throw new Error('No selectable items discovered');
            diagnostic.total = catalog.size;
            record({ event: 'catalog', pages: pages.size, items: [...catalog.values()] });
            win = await returnToEditor();
            diagnostic.phase = 'testing';
            let number = 0;
            for (const [desired, display] of catalog) {
                if (cancelled || disposed) throw new Error('Cancelled');
                if (diagnostic.logError) throw new Error(`Cannot write test report: ${diagnostic.logError}`);
                say(`Test §f${++number}/${catalog.size} §8· §7${display}`);
                diagnostic.attempted++;
                record({ event: 'attempt', number, item: desired });
                try {
                    win = await replace(win, 0, desired, true);
                    diagnostic.passed++;
                    record({ event: 'result', item: desired, status: 'passed', actual: layout(win) });
                } catch (error) {
                    if (disposed || cancelled) diagnostic.interrupted++;
                    else diagnostic.failed++;
                    record({ event: 'result', item: desired,
                        status: disposed ? 'interrupted' : cancelled ? 'cancelled' : 'failed', error: error.message });
                    if (disposed || cancelled) throw error;
                    // Continue only from a recognized, fully returned editor.
                    win = validateEditor(monitor.getWindow());
                    say(`Failed: §f${display} §7— continuing.`, 'warning');
                }
            }
            outcome = diagnostic.failed ? 'completed-with-failures' : 'passed';
        } catch (error) {
            record({ event: 'test-stopped', reason: error.message });
            if (!disposed) say(`Test stopped: ${error.message}`, 'error');
        } finally {
            diagnostic.phase = 'restoring';
            if (!disposed) {
                // First cancellation stops testing and restores. Cancelling a
                // second time stops restoration; the backup remains available.
                cancelled = false;
                say('Restoring your layout…');
                try {
                    win = await returnToEditor();
                    for (let i = 0; i < SLOTS.length; i++) win = await replace(win, i, original[i]);
                    if (JSON.stringify(layout(win)) !== JSON.stringify(original)) throw new Error('Restored layout differs from backup');
                    diagnostic.restored = true;
                    record({ event: 'restored', slots: layout(win) });
                } catch (error) {
                    record({ event: 'restore-failed', reason: error.message });
                }
            }
            record({ event: 'summary', outcome, passed: diagnostic.passed, failed: diagnostic.failed,
                elapsedMs: Date.now() - startedAt, clicks: clickCount,
                total: diagnostic.total, attempted: diagnostic.attempted, interrupted: diagnostic.interrupted,
                untested: diagnostic.total - diagnostic.attempted,
                restored: diagnostic.restored, backup: diagnostic.backup });
            if (!disposed) {
                say(`Test: §a${diagnostic.passed} passed §8· §c${diagnostic.failed} failed §8· §7${diagnostic.total - diagnostic.passed - diagnostic.failed} untested §8(${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
                say(diagnostic.restored ? 'Your layout is restored.' : `Restore incomplete. §f/quickbuy load ${diagnostic.backup}`, diagnostic.restored ? 'success' : 'warning');
                if (diagnostic.logError) say(`Couldn’t save test log: ${diagnostic.logError}`, 'error');
            }
        }
    }

    function correctPosition() {
        if (anchor) sendClient('position', { ...anchor, yaw: anchor.yaw || 0, pitch: anchor.pitch || 0, flags: 0 });
    }

    async function finish() {
        clearTimeout(totalTimer);
        if (!disposed) {
            const win = monitor.getWindow();
            if (win) {
                let closed;
                if (usedHotbar) closed = new Promise(resolve => {
                    closing = { resolve, timer: setTimeout(() => {
                        fatal('Timed out closing Hotbar Manager');
                        closing = null;
                        resolve();
                    }, timeoutMs) };
                });
                sendUpstream('close_window', { windowId: win.windowId });
                monitor.observeClientPacket({ windowId: win.windowId }, { name: 'close_window' });
                sendClient('close_window', { windowId: win.windowId });
                if (closed) await closed;
            }
            if (disposed) return;
            correctPosition();
            active = false;
        }
        anchor = null;
    }

    function presetPath(name) {
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name || '')) throw new Error('Preset names use 1–40 letters, numbers, _ or -');
        return path.join(mode === 'quickbuy' ? presetDir : path.join(presetDir, mode), `${name.toLowerCase()}.json`);
    }

    async function run(sub, args) {
        cancelled = false;
        let target = null;
        let file = null;
        let index = null;
        let skipped = [];
        let hotbarTarget = null;
        const includesQuickBuy = mode !== 'hotbar';
        const includesHotbar = mode !== 'quickbuy';
        usedHotbar = false;
        if (sub === 'copy') {
            if (args.length !== 1 || !/^[a-zA-Z0-9_]{1,16}$/.test(args[0])) throw new Error('Usage: /quickbuy <player name>');
            const reason = canStart();
            if (reason) throw new Error(reason);
            if (typeof fetchPlayer !== 'function') throw new Error('Player lookup is unavailable');
            say(`Looking up §f${args[0]}§7…`);
            const player = await fetchPlayer(args[0]);
            if (includesQuickBuy) target = parseQuickBuy(player);
            if (includesHotbar) hotbarTarget = hotbar.parseHotbar(player);
            if (cancelled) throw new Error('Cancelled');
        }
        if (sub === 'load' || sub === 'save') file = presetPath(args[0]);
        if (sub === 'load') {
            const saved = JSON.parse(await fs.promises.readFile(file, 'utf8'));
            if (saved.version !== 1) throw new Error('Invalid preset file');
            if (includesHotbar) hotbarTarget = hotbar.normalizeSlots(saved.hotbar);
            if (includesQuickBuy && (!Array.isArray(saved.slots) || saved.slots.length !== 21
                || !saved.slots.every(v => v === null || typeof v === 'string' && v.length > 0 && v.length < 120))) {
                throw new Error('Invalid preset file');
            }
            if (includesQuickBuy) target = saved.slots.map(v => v === null ? null : key(v));
        }
        if (sub === 'set' || sub === 'clear') {
            index = Number(args[0]) - 1;
            if (!Number.isInteger(index) || index < 0 || index >= 21) throw new Error('Choose a Quick Buy position from 1 to 21');
            target = sub === 'clear' ? null : key(args.slice(1).join(' '));
            if (sub === 'set' && !target) throw new Error('Provide an item name, e.g. /quickbuy set 1 wool');
        }
        if (disposed) throw new Error('Connection closed');
        if (cancelled) throw new Error('Cancelled');
        const reason = canStart();
        if (reason) throw new Error(reason);
        if (monitor.getWindow()) throw new Error('Close your current menu first');
        if (!position || !grounded || Date.now() - stillSince < minimumStillMs) {
            throw Object.assign(new Error('You need to stand on the ground to use Quick Buy. If you’re already on the ground, wait a little longer and try again.'),
                { code: 'QUICKBUY_NOT_READY' });
        }
        active = true;
        startedAt = Date.now();
        clickCount = 0;
        cancelled = false;
        anchor = { ...position };
        totalTimer = setTimeout(() => fatal('Operation exceeded its time limit'), sub === 'test' ? testTimeoutMs : totalTimeoutMs);
        say(`${sub === 'save' ? 'Reading layout' : sub === 'test' ? 'Testing items' : 'Updating layout'}… §8Esc to cancel`);
        try {
            if (sub === 'test') startDiagnostic();
            let win = await openEditor(includesQuickBuy ? 'Edit Quick Buy' : 'Hotbar Manager');
            usedHotbar = !includesQuickBuy;
            let savedQuickBuy;
            if (sub === 'test') {
                await testAll(win);
                return;
            } else if (sub === 'save') {
                if (includesQuickBuy) savedQuickBuy = layout(win);
            } else if (includesQuickBuy && (sub === 'load' || sub === 'copy')) {
                if (sub === 'copy') ({ win, skipped } = await validateImport(win, target));
                const skippedIndices = new Set(skipped.map(item => item.index));
                for (let i = 0; i < 21; i++) {
                    if (cancelled) throw new Error('Cancelled');
                    if (skippedIndices.has(i)) continue;
                    win = await replace(win, i, target[i]);
                }
                if (!target.every((item, i) => skippedIndices.has(i) || matchesTarget(win.slots.get(SLOTS[i]), item))) throw new Error('Final layout does not match the requested available items');
            } else if (includesQuickBuy) {
                win = await replace(win, index, target);
            }
            if (includesHotbar) {
                if (includesQuickBuy) {
                    say(sub === 'save' ? 'Quick Buy read. Reading hotbar…' : 'Quick Buy ready. Updating hotbar…');
                    win = await openEditor('Hotbar Manager', win);
                    usedHotbar = true;
                }
                if (sub !== 'save') win = await applyHotbar(win, hotbarTarget);
            }
            if (sub === 'save') {
                if (cancelled) throw new Error('Cancelled');
                await fs.promises.mkdir(path.dirname(file), { recursive: true });
                await persist(file, JSON.stringify({ version: 1,
                    ...(includesQuickBuy ? { slots: savedQuickBuy } : {}),
                    ...(includesHotbar ? { hotbar: hotbar.layout(win) } : {}) }, null, 2) + '\n');
            }
            if (cancelled) throw new Error('Cancelled');
            const done = sub === 'save' ? `Saved §f${args[0]}§a.`
                : sub === 'copy' ? `Copied §f${args[0]}§a’s layout.`
                : sub === 'load' ? `Loaded §f${args[0]}§a.`
                : sub === 'clear' ? `Cleared slot §f${index + 1}§a.` : `Updated slot §f${index + 1}§a.`;
            say(`${done}${sub !== 'save' ? ` §8(${((Date.now() - startedAt) / 1000).toFixed(1)}s)` : ''}${skipped.length ? ` §e${skipped.length} skipped.` : ''}`, 'success');
        } finally {
            await finish();
            record({ event: 'end', restored: diagnostic?.restored, disconnected: disposed,
                elapsedMs: Date.now() - startedAt, clicks: clickCount });
            diagnostic = null;
        }
    }

    function command(args) {
        let sub = String(args[1] || 'help').toLowerCase();
        if (sub === 'cancel') { if (active || operation) { cancelled = true; say('Cancelling…', 'warning'); } else say('Nothing is running.'); return; }
        if (active || operation) { say('Already busy. §f/quickbuy cancel §eto stop.', 'warning'); return; }
        mode = ({ '/hb': 'hotbar', '/hotbar': 'hotbar', '/qbahb': 'quickbuyandhotbar',
            '/quickbuyandhotbar': 'quickbuyandhotbar' })[String(args[0]).toLowerCase()] || 'quickbuy';
        if (sub === 'list') {
            try { say(`Presets: §f${fs.readdirSync(path.dirname(presetPath('list'))).filter(n => /^[a-z0-9_-]+\.json$/.test(n)).map(n => n.slice(0, -5)).join(', ') || 'none yet'}`); }
            catch (e) { say(e.code === 'ENOENT' ? 'No presets yet. §f/quickbuy save <name>' : e.message, e.code === 'ENOENT' ? 'info' : 'error'); }
            return;
        }
        let runArgs = args.slice(2);
        if (!['save', 'load', 'set', 'clear', 'test', 'copy', 'help', 'trace'].includes(sub) && args.length === 2) {
            sub = 'copy';
            runArgs = [args[1]];
        }
        if (!(mode === 'quickbuy' ? ['save', 'load', 'set', 'clear', 'test', 'copy'] : ['save', 'load', 'copy']).includes(sub)) {
            say(`§f/${mode} <player> §8· §f/${mode} save/load <preset> §8· §f/${mode} list`);
            say(`Presets: §f${listPresets(`/${mode}`).join(', ') || 'none yet'}`);
            return;
        }
        operation = run(sub, runArgs).catch(error => {
            if (!disposed) say(error.message === 'Cancelled' ? 'Cancelled.'
                : error.code === 'ENOENT' ? 'Preset not found. §f/quickbuy list' : error.message,
                error.message === 'Cancelled' || error.code === 'QUICKBUY_NOT_READY' ? 'warning' : 'error');
        })
            .finally(() => { operation = null; });
        return operation;
    }

    function allowOutbound(name, data) {
        if (!active) return true;
        if (['keep_alive', 'transaction', 'settings', 'resource_pack_receive'].includes(name)) return true;
        if (name === 'flying') return data.onGround === true;
        // Stationary position packets and teleport acknowledgements must survive.
        if (['position', 'position_look'].includes(name)) {
            if (anchor && data.x === anchor.x && data.y === anchor.y && data.z === anchor.z
                && (data.onGround === true || menuTask && allowTeleportAck && data.onGround === false)) return true;
            if (Date.now() - correctionAt > 250) { correctPosition(); correctionAt = Date.now(); }
        }
        return false;
    }

    function observeClient(data, meta) {
        if (meta.name === 'transaction' && rejectedClientClicks.delete(`${data.windowId}:${data.action}`)) return true;
        if (active) {
            if (meta.name === 'close_window') {
                if (!cancelled) say('Cancelling… waiting for the server.', 'warning');
                cancelled = true;
                return true;
            }
            if (meta.name === 'window_click') {
                // Vanilla predicts the click locally. Reject and repaint it so
                // closing the GUI cannot leave a phantom item on the cursor.
                rejectedClientClicks.add(`${data.windowId}:${data.action}`);
                if (rejectedClientClicks.size > 1024) { fatal('Too many unconfirmed client clicks'); return true; }
                sendClient('transaction', { windowId: data.windowId, action: data.action, accepted: false });
                const win = monitor.getWindow();
                if (win && win.windowId === data.windowId) {
                    sendClient('window_items', { windowId: win.windowId,
                        items: Array.from({ length: win.slotCount + 36 }, (_, slot) => win.rawSlots.get(slot) || { blockId: -1 }) });
                }
                sendClient('set_slot', { windowId: -1, slot: -1, item: { blockId: -1 } });
                return true;
            }
            if (meta.name === 'chat') return false; // Dedicated chat handler only permits cancellation.
            const allowed = allowOutbound(meta.name, data);
            if (allowed && menuTask && ['position', 'position_look'].includes(meta.name)) {
                if (meta.name === 'position_look') Object.assign(anchor, { yaw: data.yaw, pitch: data.pitch });
                if (teleportPending) {
                    teleportPending = false;
                    menuTask.onTeleportAcknowledged?.(anchor);
                    checkWait();
                }
            }
            return !allowed;
        }
        if (['position', 'position_look', 'flying', 'look'].includes(meta.name)) {
            grounded = data.onGround === true;
            if (data.x !== undefined) {
                if (!position || data.x !== position.x || data.y !== position.y || data.z !== position.z) stillSince = Date.now();
                position = { ...position, x: data.x, y: data.y, z: data.z };
            }
            if (position && data.yaw !== undefined) Object.assign(position, { yaw: data.yaw, pitch: data.pitch });
        }
        monitor.observeClientPacket(data, meta);
        return false;
    }

    function observeServer(data, meta) {
        // Suppress server feedback sounds while automatically editing Quick Buy.
        // Manual menus and the hotbar phase keep their normal audio.
        if (active && meta.name === 'named_sound_effect') {
            const win = monitor.getWindow();
            if (win?.plainTitle === 'Edit Quick Buy' || isPicker(win)) return true;
        }
        const swallowed = monitor.observeServerPacket(data, meta);
        if (meta.name === 'set_slot' && data.windowId === -1 && data.slot === -1) {
            cursor = data.item || { blockId: -1 };
            if (closing && cursor.blockId === -1) {
                clearTimeout(closing.timer);
                closing.resolve();
                closing = null;
            }
            if (waiter?.hotbarEvidence) {
                waiter.cursorSeen = true;
                checkWait();
            }
        }
        if (waiter?.hotbarEvidence && data.windowId === waiter.actionWindow
            && (meta.name === 'window_items' || meta.name === 'set_slot' && data.slot === waiter.destination)) {
            waiter.destinationSeen = true;
            checkWait();
        }
        if (meta.name === 'open_window') {
            menuGeneration++;
            snapshotGeneration = -1;
            lastMenuSignature = '';
            if (waiter) {
                clearTimeout(waiter.settle);
                waiter.settle = null;
                waiter.queued = false;
                waiter.scheduleVersion++;
            }
        }
        if (meta.name === 'respawn' || meta.name === 'login') itemPages.clear();
        if (diagnostic && (['open_window', 'window_items', 'close_window'].includes(meta.name) || swallowed)) {
            const win = monitor.getWindow();
            record({ event: 'receive', packet: meta.name, window: data.windowId, title: win?.plainTitle,
                action: data.action, accepted: data.accepted,
                items: meta.name === 'window_items' && win && data.windowId === win.windowId
                    ? [...win.slots].filter(([s]) => s < win.slotCount).map(([slot, i]) => ({ slot, name: i.plainName, lore: i.plainLore })) : undefined });
        }
        if (active && ['respawn', 'login', 'position'].includes(meta.name)) {
            const relocation = menuTask?.onRelocation ? {
                packet: meta.name,
                data: Object.fromEntries(['x', 'y', 'z', 'yaw', 'pitch', 'flags', 'dimension', 'gamemode']
                    .filter(field => data[field] !== undefined).map(field => [field, data[field]])),
                from: anchor && { ...anchor }, waitingFor: waiter?.label
            } : null;
            let accepted = false;
            if (meta.name === 'position' && menuTask?.acceptTeleport && anchor) {
                const next = {};
                const fields = ['x', 'y', 'z', 'yaw', 'pitch'];
                const flags = data.flags ?? 0;
                if (Number.isInteger(flags) && flags >= 0 && flags <= 31 && fields.every(field => Number.isFinite(data[field]))) {
                    fields.forEach((field, index) => { next[field] = data[field] + ((flags & (1 << index)) ? (anchor[field] || 0) : 0); });
                    accepted = menuTask.acceptTeleport(next) === true;
                    if (accepted) {
                        anchor = next;
                        position = { ...next };
                        allowTeleportAck = true;
                        teleportPending = true;
                        // Resolve relative flags against the locked server position,
                        // not any local movement predicted while controls are locked.
                        Object.assign(data, next, { flags: 0 });
                    }
                }
            }
            if (relocation) menuTask.onRelocation({ ...relocation, accepted });
            if (!accepted) {
                // A menu request may still be in flight across an unrelated
                // relocation or world change. Never release that uncertain lock.
                anchor = null;
                fatal('Server moved you or changed worlds during editing');
            }
        }
        const win = monitor.getWindow();
        if (active && win && data.windowId === win.windowId && ['window_items', 'set_slot'].includes(meta.name)
            && (meta.name === 'window_items' || data.slot >= 0 && data.slot < win.slotCount)) {
            const fingerprint = signature(win);
            const changed = fingerprint !== lastMenuSignature;
            if (changed) { menuRevision++; lastMenuSignature = fingerprint; }
            if (meta.name === 'window_items') {
                snapshotGeneration = Array.isArray(data.items) && data.items.length >= win.slotCount ? menuGeneration : -1;
            }
            checkWait(changed, meta.name === 'set_slot');
        }
        if (active && menuTask) {
            try {
                const result = menuTask.observeServer?.(data, meta);
                if (result instanceof Error) rejectWait(result);
                else if (result) checkWait();
            }
            catch (error) { fatal(error.message); }
        }
        if (swallowed && waiter && data.action === waiter.action && data.windowId === waiter.actionWindow) {
            waiter.acknowledged = true;
            checkWait();
        }
        return swallowed;
    }

    // Other menu walks share this connection's transport lock, complete-snapshot
    // gates, transaction handling, cancellation and shutdown ownership.
    function runMenuTask(task) {
        if (active || operation) return Promise.reject(new Error('Wait for the current menu operation to finish'));
        const work = (async () => {
            if (disposed) throw new Error('Connection closed');
            const reason = canStart();
            if (reason) throw new Error(reason);
            if (monitor.getWindow()) throw new Error('Close your current menu first');
            if (!position || !grounded || Date.now() - stillSince < minimumStillMs) {
                throw new Error('Stand still on the ground, then try again');
            }
            menuTask = task;
            allowTeleportAck = false;
            teleportPending = false;
            active = true;
            cancelled = false;
            usedHotbar = false;
            anchor = { ...position };
            totalTimer = setTimeout(() => fatal('Operation exceeded its time limit'), task.totalTimeoutMs || totalTimeoutMs);
            try {
                return await task.run({
                    waitFor, click, persist,
                    getPosition: () => anchor && { ...anchor },
                    getReadyWindow: () => {
                        const win = monitor.getWindow();
                        return readyMenu(win) ? win : null;
                    },
                    send: sendUpstream,
                    canSend: () => !disposed,
                    checkCancelled: () => { if (cancelled || disposed) throw new Error(disposed ? 'Connection closed' : 'Cancelled'); }
                });
            } finally {
                await finish();
            }
        })();
        operation = work.catch(() => {}).finally(() => { menuTask = null; operation = null; });
        return operation.then(() => work);
    }

    const acceptedWrites = new Set();
    let writeFailure = null;
    function persist(...args) {
        const pending = writeFileAtomic(...args);
        acceptedWrites.add(pending);
        pending.then(() => acceptedWrites.delete(pending), () => {
            writeFailure ||= new Error(`${menuTask?.label || 'Quick Buy'} save failed.`);
            acceptedWrites.delete(pending);
        });
        return pending;
    }
    async function drain() {
        dispose();
        await operation;
        await Promise.allSettled([...acceptedWrites]);
        if (writeFailure) throw writeFailure;
    }

    function dispose() {
        disposed = true;
        cancelled = true;
        clearTimeout(totalTimer);
        rejectWait(new Error('Connection closed'));
        if (closing) { clearTimeout(closing.timer); closing.resolve(); closing = null; }
        monitor.dispose();
        rejectedClientClicks.clear();
    }

    function listPresets(command) {
        const folder = ['/hb', '/hotbar'].includes(command) ? 'hotbar'
            : ['/qbahb', '/quickbuyandhotbar'].includes(command) ? 'quickbuyandhotbar' : '';
        try { return fs.readdirSync(path.join(presetDir, folder)).filter(n => /^[a-z0-9_-]+\.json$/.test(n)).map(n => n.slice(0, -5)); }
        catch { return []; }
    }
    return { command, runMenuTask, listPresets, observeClient, observeServer, allowOutbound, isActive: () => active,
        isBusy: () => active || !!operation, dispose, drain };
}

module.exports = { createQuickBuy, SLOTS, key };
