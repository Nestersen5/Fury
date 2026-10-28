'use strict';

const { decodeTitle } = require('./menuMonitor');
const { extractText, stripAnsi } = require('../../features/minecraft_chat');
const { createUsage } = require('../../features/chat_controller');

const MAX_PLAYERS = 8;
const MESSAGE_COLORS = { info: '§b', success: '§a', warning: '§e', error: '§c' };
const CLIENT_CONFLICTS = new Set(['window_click', 'close_window', 'enchant_item', 'set_creative_slot', 'block_place', 'use_entity']);
const WINDOW_ACTIONS = new Set(['window_click', 'close_window', 'transaction', 'enchant_item']);
const clean = value => stripAnsi(String(value || '')).replace(/\s+/g, ' ').trim();
const isReportMenu = data => data.inventoryType === 'minecraft:chest' && data.slotCount === 27
    && clean(decodeTitle(data.windowTitle)) === 'Report Cheating/Hacking';
const SUCCESS = /^Thanks for your Cheating \(Hacking\) report\. We understand your concerns and it will be reviewed as soon as possible\.$/i;
const PROGRESS = /^(?:Please wait|Submitting Report)(?:\.{1,3}|…)?$/i;
const FAILURE = /^(?:You (?:have already reported|already reported|cannot report|can't report|must wait|need to wait|are sending commands too fast)|Please (?:slow down|wait before)|That player (?:does not exist|is not online|isn't online)|(?:Could not|Couldn't|Unable to) find (?:a )?player|Invalid player name|You can't do that while already in a menu)/i;

function matchesReportReason(item, target) {
    const lines = item.plainLore.map(clean).filter(Boolean);
    const reports = lines.map((line, index) => /^report\b/i.test(line) ? index : -1).filter(index => index >= 0);
    // In-game reports prepend context such as "Bed Wars". Check the actual
    // report statement (including wrapped lines), not those preceding labels.
    return reports.length === 1 && lines.slice(reports[0]).join(' ').toLowerCase()
        === `report ${target.toLowerCase()} for cheating/hacking`;
}

// Own only the report explicitly requested by this connection. The shared menu
// monitor owns raw items, action numbers and rejected-transaction acknowledgments.
function createWatchdogReport({ menuMonitor, sendCommand, sendUpstream, sendClient, sendChat,
    canStart = () => null, setTimer = setTimeout, clearTimer = clearTimeout,
    timeoutMs = 10000, reportGapMs = 750, settleMs = 350 }) {
    let batch = null, request = null, gapTimer = null, disposed = false;
    let cursorEmpty = true;
    let lateMenuPending = false;
    let lateReportFeedback = false;
    // Window IDs are bytes. Keep late packets hidden until that ID is opened again.
    const hiddenWindows = new Set();
    const say = (text, tone = 'info') => {
        const color = MESSAGE_COLORS[tone] || MESSAGE_COLORS.info;
        sendChat(`§6§lReports §8» ${color}${text.replace(/§7/g, color)}`);
    };

    function closeHidden(owner) {
        if (owner?.windowId == null) return;
        const windowId = owner.windowId;
        owner.windowId = null;
        try { sendUpstream('close_window', { windowId }); } catch { /* Connection cleanup owns a failed transport. */ }
    }

    function summarize(completed, reason = '', tone = 'success') {
        const confirmed = completed.names.slice(0, completed.confirmed);
        const remaining = completed.names.slice(completed.confirmed);
        const text = remaining.length
            ? `${completed.confirmed}/${completed.names.length} confirmed${confirmed.length ? `: §f${confirmed.join(', ')}§7` : ''}. Unconfirmed: §f${remaining.join(', ')}§7. ${reason}`
            : `Reports confirmed for §f${confirmed.join(', ')}§7.`;
        say(text, tone);
    }

    function stop(reason, boundary = false, tone = 'warning') {
        const previous = batch;
        batch = null;
        clearTimer(gapTimer); gapTimer = null;
        if (request) {
            const owner = request;
            request = null;
            clearTimer(owner.timer); clearTimer(owner.settle);
            owner.abort.abort();
            lateReportFeedback = owner.phase !== 'queued' && !owner.successSeen;
            lateMenuPending = !boundary && owner.phase === 'opening' && owner.windowId == null;
            if (!boundary) closeHidden(owner);
        }
        if (boundary) { lateMenuPending = false; lateReportFeedback = false; }
        if (previous && !disposed) summarize(previous, reason, tone);
    }

    function arm(owner) {
        clearTimer(owner.timer);
        owner.timer = setTimer(() => {
            if (request === owner) {
                stop(`Timed out waiting for §f${owner.target}§7.`, false, 'error');
            }
        }, timeoutMs);
        owner.timer?.unref?.();
    }

    function startNext() {
        gapTimer = null;
        if (!batch || disposed) return;
        const blocked = canStart();
        if (blocked || !cursorEmpty) { stop(blocked || 'Put down the item on your cursor first.'); return; }
        const owner = request = { target: batch.names[batch.confirmed], phase: 'queued', windowId: null,
            snapshot: false, closedByServer: false, successSeen: false, abort: new AbortController(), timer: null, settle: null };
        arm(owner);
        Promise.resolve().then(() => {
            if (request !== owner || !batch) return { sent: false };
            return sendCommand(`/wdr ${owner.target}`, {
                signal: owner.abort.signal,
                shouldSend: () => {
                    if (request !== owner || !batch || disposed) return false;
                    const blocked = canStart();
                    if (blocked || !cursorEmpty) { stop(blocked || 'Your cursor is holding an item.'); return false; }
                    // Set ownership before the transport writes, not when its
                    // promise resolves: a fast server can reply immediately.
                    owner.phase = 'opening'; arm(owner);
                    return true;
                }
            });
        }).then(result => {
            if (request !== owner) return;
            if (!result?.sent) stop(`Could not send the report for §f${owner.target}§7.`, result?.reason !== 'send-failed', 'error');
        }).catch(() => {
            if (request === owner) stop(`Could not send the report for §f${owner.target}§7.`, false, 'error');
        });
    }

    function command(args) {
        if (disposed) return;
        const names = args.slice(1);
        if (!names.length || names.length === 1 && /^help$/i.test(names[0])) {
            const usage = createUsage(sendChat, 'Reports', 'Confirm cheating reports in the background.');
            usage.command('/wdr <player> [player ...]', 'Report up to 8 players, one at a time.');
            usage.command('/wdr status', 'Show report progress.');
            usage.command('/wdr cancel', 'Stop the remaining reports.');
            usage.command('/watchdogreport <player> [reason]', 'Use the original Hypixel command.');
            usage.note('Using an item, opening another menu or using another command stops the batch.');
            return;
        }
        if (names.length === 1 && /^cancel$/i.test(names[0])) {
            if (batch) stop('Cancelled.');
            else say('No reports are running.');
            return;
        }
        if (names.length === 1 && /^status$/i.test(names[0])) {
            say(batch ? `${batch.confirmed}/${batch.names.length} confirmed.${request ? ` Waiting for §f${request.target}§7.` : ''}`
                : 'No reports are running.');
            return;
        }
        if (names.length > MAX_PLAYERS || names.some(name => !/^[A-Za-z0-9_]{1,16}$/.test(name))) {
            say('Use §f/wdr <player> [player ...]§7 with up to 8 player names.', 'warning'); return;
        }
        if (batch || request) { say('Reports are busy. Use §f/wdr status§7 or §f/wdr cancel§7.', 'warning'); return; }
        const unique = [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
        const blocked = canStart();
        if (blocked || !cursorEmpty) { say(blocked || 'Put down the item on your cursor first.', 'warning'); return; }
        batch = { names: unique, confirmed: 0 };
        say(`Started reporting: §f${unique.join(', ')}§7.`);
        startNext();
    }

    // Match the existing menu driver's quiet-period approach. Hypixel sends a
    // snapshot, a set_slot burst, and sometimes another snapshot ~150 ms later.
    // Clicking the first snapshot (3 ms after open in the failed live capture)
    // can be ignored. Never retry a submit click automatically.
    function scheduleConfirm(owner) {
        if (request !== owner || owner.phase !== 'opening' || !owner.snapshot) return;
        clearTimer(owner.settle);
        owner.settle = setTimer(() => {
            owner.settle = null;
            tryConfirm(owner);
        }, settleMs);
        owner.settle?.unref?.();
    }

    function tryConfirm(owner) {
        if (request !== owner || owner.phase !== 'opening' || !owner.snapshot) return;
        const win = menuMonitor.getWindow();
        if (!win || win.windowId !== owner.windowId) return;
        const entries = [...win.slots].filter(([slot]) => slot >= 0 && slot < win.slotCount);
        const targets = entries.filter(([, item]) => /^\/report /i.test(clean(item.name)));
        const target = targets[0]?.[1];
        if (targets.length && (targets.length !== 1 || clean(target.name).toLowerCase() !== `/report ${owner.target.toLowerCase()}`)) {
            stop('The report menu is for a different player.', false, 'error'); return;
        }
        const submit = entries.filter(([, item]) => clean(item.name) === 'Submit Report' && item.id === 159 && item.damage === 13);
        const cancel = entries.filter(([, item]) => clean(item.name) === 'Cancel Report' && item.id === 159 && item.damage === 14);
        if (submit.length !== 1 || cancel.length !== 1 || targets.length !== 1 || target.id !== 397
            || !matchesReportReason(target, owner.target)) return;
        owner.phase = 'confirming'; arm(owner);
        try {
            const result = menuMonitor.clickSlot({ slot: submit[0][0], source: 'watchdog-report' });
            if (!result.ok) stop('Could not confirm the report.', false, 'error');
        } catch { stop('Could not confirm the report.', false, 'error'); }
    }

    function finishIfConfirmed(owner) {
        if (request !== owner || !batch || owner.phase !== 'confirming'
            || !owner.closedByServer || !owner.successSeen) return;
        clearTimer(owner.timer); clearTimer(owner.settle); owner.abort.abort(); request = null;
        batch.confirmed++;
        if (batch.confirmed === batch.names.length) {
            summarize(batch);
            batch = null;
        } else { gapTimer = setTimer(startNext, reportGapMs); gapTimer?.unref?.(); }
    }

    function observeServer(data, meta) {
        if (disposed) return false;
        const name = meta.name;
        if (name === 'login' || name === 'respawn' || name === 'kick_disconnect') {
            if (request?.windowId != null) {
                menuMonitor.setHold(false);
                menuMonitor.observeClientPacket({ windowId: request.windowId }, { name: 'close_window' });
            }
            stop('The connection or world changed.', true); hiddenWindows.clear(); cursorEmpty = true; return false;
        }
        if (name === 'set_slot' && data.windowId === -1 && data.slot === -1) {
            cursorEmpty = !data.item || data.item.blockId < 0;
            if (!cursorEmpty && batch) stop('Your cursor is holding an item.');
        }
        if (name === 'open_window') {
            hiddenWindows.delete(data.windowId);
            const owner = request;
            if (owner && owner.phase === 'opening' && owner.windowId == null && isReportMenu(data)) {
                owner.windowId = data.windowId; owner.snapshot = false;
                lateMenuPending = false;
                hiddenWindows.add(data.windowId);
                return true;
            }
            if (!owner && lateMenuPending && isReportMenu(data)) {
                lateMenuPending = false;
                hiddenWindows.add(data.windowId);
                closeHidden({ windowId: data.windowId });
                return true;
            }
            if (batch || request) stop('Another menu opened.', true);
            return false;
        }
        if (name === 'chat' && (data.position || 0) !== 2 && (request || batch || lateReportFeedback)) {
            let component = data.message;
            try { if (typeof component === 'string') component = JSON.parse(component); } catch { return false; }
            const text = clean(extractText(component));
            if (!request) {
                if (SUCCESS.test(text)) { lateReportFeedback = false; return true; }
                return /^Submitting Report(?:\.{1,3}|…)?$/i.test(text);
            }
            if (request.phase !== 'queued' && PROGRESS.test(text)) return true;
            // Keep both completion signals on their request. Hypixel can send
            // success before or after closing the submitted window; neither
            // signal alone may advance the batch.
            if (SUCCESS.test(text) && request.phase === 'confirming') {
                request.successSeen = true;
                finishIfConfirmed(request);
                return true;
            } else if (FAILURE.test(text)) {
                stop(text, false, 'error');
                lateMenuPending = false;
                lateReportFeedback = false;
                return true;
            }
            return false;
        }
        if (!hiddenWindows.has(data.windowId)) return false;
        const owner = request;
        const current = owner?.windowId === data.windowId;
        if (name === 'window_items') {
            if (current && data.items?.length >= 27) {
                // The bottom 36 slots belong to the player's real inventory.
                // Hidden container slots must never be sent as inventory slots.
                if (data.items.length >= 63) for (let i = 0; i < 36; i++) {
                    sendClient('set_slot', { windowId: 0, slot: 9 + i, item: data.items[27 + i] });
                }
                owner.snapshot = true;
                scheduleConfirm(owner);
            }
            return true;
        }
        if (name === 'set_slot') {
            if (current && data.slot >= 27 && data.slot < 63) {
                sendClient('set_slot', { windowId: 0, slot: data.slot - 27 + 9, item: data.item });
            } else if (current) scheduleConfirm(owner);
            return true;
        }
        if (name === 'close_window') {
            if (current) {
                owner.windowId = null;
                if (owner.phase === 'confirming') {
                    owner.closedByServer = true;
                    finishIfConfirmed(owner);
                }
                else stop('The report menu closed before it could be confirmed.');
            }
            return true;
        }
        return name === 'craft_progress_bar' || name === 'transaction';
    }

    function observeClient(data, meta) {
        if (disposed) return false;
        const name = meta.name;
        if (WINDOW_ACTIONS.has(name) && hiddenWindows.has(data.windowId)) return true;
        if (batch && (CLIENT_CONFLICTS.has(name)
            || name === 'client_command' && data.payload === 2)) stop('You started another inventory or item action.');
        return false; // Movement, looking, chat and normal gameplay keep flowing.
    }

    function observeCommand(message) {
        if (batch && /^\//.test(message) && !/^\/wdr(?:\s|$)/i.test(message)) stop('You used another command.');
        if (/^\/(?:watchdogreport|report)(?:\s|$)/i.test(message)) { lateMenuPending = false; lateReportFeedback = false; }
    }

    function dispose() { disposed = true; stop('', true); request = null; hiddenWindows.clear(); }
    return { command, observeServer, observeClient, observeCommand, dispose, isBusy: () => !!batch || !!request };
}

module.exports = { createWatchdogReport, MAX_PLAYERS };
