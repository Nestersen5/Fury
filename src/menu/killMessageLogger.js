'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const { simplifyNbt } = require('./menuMonitor');
const { stripAnsi, extractText, extractFormattedText } = require('../../features/minecraft_chat');

const clean = value => stripAnsi(value || '').replace(/\s+/g, ' ').trim();
const title = win => clean(win?.plainTitle);
const isKillMenu = win => win?.slotCount === 54 && /^Kill Messages(?: \(Page \d+\))?$/.test(title(win));
const pageNumber = win => Number(/\(Page (\d+)\)/.exec(title(win))?.[1] || 1);
const entries = win => [...win.slots].filter(([slot]) => slot < win.slotCount);
const named = (win, name) => {
    const found = entries(win).filter(([, item]) => clean(item.name) === name);
    if (found.length !== 1) throw new Error(`Expected one menu item named "${name}"`);
    return found[0][0];
};
const previews = win => entries(win).filter(([, item]) => item.plainLore.some(line => /^Right-Click to preview!$/i.test(clean(line))));
const samePosition = (a, b) => a && b && ['x', 'y', 'z'].every(axis => Math.abs(a[axis] - b[axis]) < 0.0001);

function summarize(cosmetics) {
    const messages = new Map();
    let totalMessages = 0;
    for (const cosmetic of cosmetics) {
        for (const line of cosmetic.lines) {
            const wording = clean(line.text);
            if (!messages.has(wording)) messages.set(wording, []);
            messages.get(wording).push({ cosmetic: cosmetic.name, position: line.position });
            totalMessages++;
        }
    }
    const duplicates = [...messages].filter(([, occurrences]) => occurrences.length > 1)
        .map(([text, occurrences]) => ({ text, occurrences }));
    return { cosmetics: cosmetics.length, totalMessages, uniqueMessages: messages.size,
        duplicateOccurrences: totalMessages - messages.size, duplicateGroups: duplicates.length, duplicates };
}

// Raw capture intentionally remains separate from /km's detection-pattern store.
// Positions are preserved without guessing event labels or deduplicating lines.
function createKillMessageLogger({ automation, dir, sendChat, account = () => null,
    menuSettleMs = 1000, retryDelayMs = 1000 }) {
    const hotbar = Array(9).fill(null);
    let selected = 0;
    let container = null;
    let busy = false;
    let lastFile = null;
    let report = null;
    let reportSaved = false;
    let capture = null;
    const say = text => sendChat(`§6[KM] §7${text}`);

    function observeClient(data, meta) {
        if (meta.name === 'held_item_slot' && Number.isInteger(data.slotId)) selected = data.slotId;
    }

    function observeServer(data, meta) {
        if (meta.name === 'login' || meta.name === 'respawn') {
            hotbar.fill(null);
            selected = 0;
            container = null;
        }
        if (meta.name === 'held_item_slot') selected = data.slot;
        if (meta.name === 'open_window') container = { id: data.windowId, count: data.slotCount };
        if (meta.name === 'close_window' && container?.id === data.windowId) container = null;
        if (meta.name !== 'window_items' && meta.name !== 'set_slot') return;
        const offset = data.windowId === 0 ? 36 : container && container.id === data.windowId ? container.count + 27 : null;
        if (offset === null) return;
        if (meta.name === 'window_items' && Array.isArray(data.items) && data.items.length >= offset + 9) {
            for (let i = 0; i < 9; i++) hotbar[i] = data.items[offset + i];
        }
        if (meta.name === 'set_slot' && data.slot >= offset && data.slot < offset + 9) hotbar[data.slot - offset] = data.item;
    }

    function observePreview(data, meta) {
        if (!capture || capture.done || meta.name !== 'chat' || data.position !== 0) return;
        const component = typeof data.message === 'string' ? JSON.parse(data.message) : data.message;
        const text = clean(extractText(component));
        if (!capture.started && !capture.destination && text === "You can't do that while already in a menu!") {
            report.previewRejections.push({ cosmetic: report.currentCosmetic, at: new Date().toISOString(), text });
            return Object.assign(new Error('Hypixel is still busy with the previous menu'), { code: 'MENU_BUSY' });
        }
        if (text === 'Chat Messages:') {
            if (capture.started) throw new Error('Received a second preview header before the first preview ended');
            capture.started = true;
            return;
        }
        if (!capture.started || !text) return;
        if (/^▬{10,}$/.test(text)) {
            if (!capture.lines.length) throw new Error('The preview contained no kill messages');
            capture.done = true;
            return true;
        }
        // Lobby/player chat can arrive while the preview is running. Recorded
        // preview templates use Player or a team Bed as their subject.
        if (!/^(?:Player\b|(?:Red|Blue|Green|Yellow|Aqua|White|Pink|Gray|Grey) Bed\b)/.test(text)) {
            capture.ignoredLines++;
            return;
        }
        if (capture.lines.length >= 64) throw new Error('Unexpectedly large kill-message preview');
        capture.lines.push({ position: capture.lines.length + 1, text,
            formatted: extractFormattedText(component), raw: data.message });
    }

    function acceptTeleport(next) {
        if (!capture) return false;
        if (!capture.destination) {
            if (samePosition(next, capture.origin)) return false;
            capture.destination = { ...next };
            return true;
        }
        if (samePosition(next, capture.origin)) {
            capture.returned = true;
            capture.returnAcknowledged = false;
            return true;
        }
        // The captured Hypixel preview moves the camera two blocks sideways
        // after its initial teleport, then repeats that correction before return.
        // Bound adjustments to the initial destination (never a drifting anchor).
        const destination = capture.destination;
        return !capture.returned && Math.abs(next.y - destination.y) < 0.0001
            && Math.hypot(next.x - destination.x, next.z - destination.z) <= 2.0001;
    }

    function onTeleportAcknowledged(at) {
        if (capture?.returned && samePosition(at, capture.origin)) capture.returnAcknowledged = true;
    }

    function onRelocation(event) {
        if (!report) return;
        report.relocations.push({ at: new Date().toISOString(), cosmetic: report.currentCosmetic || null,
            ...event, preview: capture ? { origin: capture.origin, destination: capture.destination,
                returned: capture.returned, returnAcknowledged: capture.returnAcknowledged,
                chatStarted: capture.started, chatComplete: capture.done } : null });
        if (report.relocations.length > 16) report.relocations.shift();
    }

    function readyMenu(win) {
        const items = entries(win);
        const has = name => items.some(([, item]) => clean(item.name) === name);
        if (title(win) === 'Bed Wars Menu') return win.slotCount === 36 && has('My Cosmetics');
        if (title(win) === 'My Cosmetics') return win.slotCount === 54 && has('Kill Messages');
        return isKillMenu(win) && has('Go Back') && previews(win).length > 0
            && items.some(([, item]) => clean(item.name).startsWith('Sorted by:'));
    }

    async function run(context) {
        const { waitFor, click, persist, send, checkCancelled, canSend } = context;
        const menuSlot = hotbar.findIndex(item => item?.blockId === 388
            && clean(simplifyNbt(item.nbtData)?.display?.Name) === 'Bed Wars Menu (Right Click)');
        if (menuSlot < 0) throw new Error('Bed Wars Menu item not found in your hotbar. Join a Bed Wars lobby and try again');
        const previousSlot = selected;
        const seen = new Set();
        const pages = new Set();
        lastFile = path.join(dir, `kill-messages-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
        report = { version: 1, account: account(), startedAt: new Date().toISOString(), status: 'running',
            cosmetics: [], attemptedCosmetics: [], skippedCosmetics: [], pages: [], relocations: [], previewRejections: [], summary: summarize([]) };
        const save = async () => {
            reportSaved = false;
            report.summary = summarize(report.cosmetics);
            report.summary.attemptedCosmetics = report.attemptedCosmetics.length;
            report.summary.skippedCosmetics = report.skippedCosmetics.length;
            report.summary.unfinishedCosmetics = report.attemptedCosmetics.filter(name => !report.cosmetics.some(c => c.name === name));
            await persist(lastFile, JSON.stringify(report, null, 2) + '\n');
            reportSaved = true;
        };
        let selectedByLogger = false;
        try {
            await save();
            checkCancelled();
            say('Recording all kill-message previews. Keep Rainbow off. §f/kmlog cancel §7to stop.');
            say(`File: §f${lastFile}`);
            let win = await waitFor(w => title(w) === 'Bed Wars Menu', () => {
                send('held_item_slot', { slotId: menuSlot });
                selectedByLogger = true;
                send('block_place', { location: { x: -1, y: -1, z: -1 }, direction: -1,
                    heldItem: hotbar[menuSlot], cursorX: 0, cursorY: 0, cursorZ: 0 });
            }, 'opening the Bed Wars Menu');
            win = await click(named(win, 'My Cosmetics'), w => title(w) === 'My Cosmetics');
            win = await click(named(win, 'Kill Messages'), isKillMenu);
            for (;;) {
                checkCancelled();
                const page = pageNumber(win);
                if (pages.has(page) || pages.size >= 20) throw new Error('Kill Messages pagination repeated or exceeded 20 pages');
                pages.add(page);
                report.pages.push(page);
                const previewSlots = new Set(previews(win).map(([slot]) => slot));
                for (const [slot, item] of entries(win)) {
                    const name = clean(item.name);
                    if (!previewSlots.has(slot) && (item.plainLore.some(line => clean(line) === 'Kill Messages')
                        || /^Random (?:Favorite )?Kill Messages$/.test(name))) {
                        report.skippedCosmetics.push({ name, page, reason: 'No right-click preview advertised' });
                    }
                }
                for (;;) {
                    checkCancelled();
                    // Re-read each returned window; window IDs and slot contents
                    // belong to that opening, never to a cached previous page.
                    const next = previews(win).find(([, item]) => !seen.has(clean(item.name).toLowerCase()));
                    if (!next) break;
                    const [slot, item] = next;
                    const name = clean(item.name);
                    report.currentCosmetic = name;
                    report.attemptedCosmetics.push(name);
                    say(`Previewing §f${name} §7(page ${page})…`);
                    let previewSlot = slot;
                    for (let attempt = 0; ; attempt++) {
                        checkCancelled();
                        capture = { started: false, done: false, lines: [], ignoredLines: 0,
                            origin: context.getPosition(), destination: null, returned: false, returnAcknowledged: false };
                        try {
                            win = await click(previewSlot, w => isKillMenu(w) && pageNumber(w) === page
                                && capture.done && capture.returnAcknowledged, 1);
                            break;
                        } catch (error) {
                            if (error.code !== 'MENU_BUSY') throw error;
                            capture = null;
                            // This explicit refusal means no preview was started;
                            // unlike a missing response, it can be retried safely.
                            if (attempt >= 2) throw new Error('Hypixel kept refusing the preview. Saved progress; try /kmlog start again shortly');
                            say(`Hypixel is busy; retrying §f${name} §7(${attempt + 1}/2)…`);
                            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                            checkCancelled();
                            win = context.getReadyWindow();
                            if (!win || !isKillMenu(win) || pageNumber(win) !== page) throw new Error('Kill Messages menu changed while waiting to retry');
                            previewSlot = named(win, name);
                            if (!previews(win).some(([slot]) => slot === previewSlot)) throw new Error('This cosmetic no longer advertises a preview');
                        }
                    }
                    checkCancelled();
                    report.cosmetics.push({ name, page, lines: capture.lines, ignoredLines: capture.ignoredLines });
                    seen.add(name.toLowerCase());
                    capture = null;
                    delete report.currentCosmetic;
                    await save();
                }
                const next = entries(win).filter(([, item]) => clean(item.name) === 'Left-click for next page!');
                if (!next.length) break;
                if (next.length !== 1) throw new Error('Ambiguous next-page control');
                win = await click(next[0][0], w => isKillMenu(w) && pageNumber(w) === page + 1);
            }
            report.status = 'complete';
        } catch (error) {
            report.status = error.message === 'Cancelled' ? 'cancelled' : 'failed';
            report.error = error.message;
            if (capture) report.interruptedPreview = { name: report.currentCosmetic,
                lines: capture.lines, chatComplete: capture.done, returned: capture.returned,
                returnAcknowledged: capture.returnAcknowledged };
            throw error;
        } finally {
            capture = null;
            report.finishedAt = new Date().toISOString();
            if (selectedByLogger && canSend()) send('held_item_slot', { slotId: previousSlot });
            await save();
        }
    }

    function printSummary() {
        const s = report.summary;
        say(`${report.status === 'complete' ? 'Finished' : 'Partial recording'}: §f${s.cosmetics} cosmetics §8· §f${s.totalMessages} messages §8· §f${s.uniqueMessages} unique §8· §f${s.duplicateOccurrences} duplicate occurrences §7in ${s.duplicateGroups} groups.`);
        if (s.unfinishedCosmetics.length) say(`Unfinished: §f${s.unfinishedCosmetics.join(', ')}`);
        if (report.skippedCosmetics.length) say(`No preview available (${report.skippedCosmetics.length}): §f${report.skippedCosmetics.map(c => c.name).join(', ')}`);
        for (const group of s.duplicates) {
            say(`Shared text: §f${group.text}`);
            say(group.occurrences.map(o => `${o.cosmetic} (#${o.position})`).join(' · '));
        }
        say(`Saved: §f${lastFile}`);
    }

    async function command(args) {
        const sub = String(args[1] || 'help').toLowerCase();
        if (sub === 'cancel' || sub === 'stop') {
            if (busy) automation.command(['/quickbuy', 'cancel']);
            else say('No automatic recording is running.');
            return;
        }
        if (sub === 'status') {
            say(busy ? `Recording ${report?.currentCosmetic || 'menus'}; ${report?.cosmetics.length || 0} cosmetics saved.` : 'No automatic recording is running.');
            if (lastFile) say(`File: §f${lastFile}`);
            return;
        }
        if (sub !== 'start') { say('§f/kmlog start §8· §f/kmlog status §8· §f/kmlog cancel'); return; }
        if (busy) { say('Already recording. §f/kmlog cancel §7to stop.'); return; }
        busy = true;
        report = null;
        reportSaved = false;
        try {
            await automation.runMenuTask({ label: 'Kill Messages', readyMenu, observeServer: observePreview,
                snapshotSettleMs: menuSettleMs,
                acceptTeleport, onTeleportAcknowledged, onRelocation,
                totalTimeoutMs: 10 * 60 * 1000, run });
        } catch (error) {
            say(`§c${error.message}`);
        } finally {
            busy = false;
            if (report && reportSaved) printSummary();
        }
    }

    return { command, observeServer, observeClient, isBusy: () => busy };
}

module.exports = { createKillMessageLogger, summarize };
