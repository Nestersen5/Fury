'use strict';

const { decodeTitle } = require('./menuMonitor');
const { extractText, stripAnsi } = require('../../features/minecraft_chat');
const { createUsage } = require('../../features/chat_controller');
const { TEAM_DEFS } = require('../net/session/bedwarsTeamEvidence');

const MAX_PLAYERS = 1;
const MESSAGE_COLORS = { info: '§b', success: '§a', warning: '§e', error: '§c' };
const INVENTORY_ACTIONS = new Set(['window_click', 'enchant_item', 'set_creative_slot']);
const WINDOW_ACTIONS = new Set(['window_click', 'close_window', 'transaction', 'enchant_item']);
const ACTIVITY_PACKETS = new Set(['block_place', 'use_entity', 'block_dig', 'held_item_slot', 'client_command', 'window_click', 'close_window']);
const MOVEMENT_PACKETS = new Set(['position', 'position_look', 'look', 'flying']);
const clean = value => stripAnsi(String(value || '')).replace(/\s+/g, ' ').trim();
const isReportMenu = data => data.inventoryType === 'minecraft:chest' && data.slotCount === 27
    && clean(decodeTitle(data.windowTitle)) === 'Report Cheating/Hacking';
const SUCCESS = /^Thanks for your Cheating \(Hacking\) report\. We understand your concerns and it will be reviewed as soon as possible\.$/i;
const PROGRESS = /^(?:Please wait|Submitting Report)(?:\.{1,3}|…)?$/i;
const FAILURE = /^(?:You (?:have already reported|already reported|cannot report|can't report|must wait|need to wait|are sending commands too fast)|Please (?:slow down|wait before)|That player (?:does not exist|is not online|isn't online)|(?:Could not|Couldn't|Unable to) find (?:a )?player|Invalid player name|You can't do that while already in a menu)/i;
const FEEDBACK_CONTEXT = /^(?:\[[a-z _-]{1,24}\]\s*)?(?:Thank(?:s| you)\b.*\breport\b|(?:You|Your|The|This|That)\b.*\breport\b|(?:Report|Submitting Report|Watchdog)\b|Please (?:wait|slow|try)|You (?:have already|already|cannot|can't|must wait|need to wait|are sending)\b|That player\b|(?:Could not|Couldn't|Unable to|Invalid player|Something went wrong|An? error)\b)/i;

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
    canStart = () => null, getTeamPlayers = () => [], setTimer = setTimeout, clearTimer = clearTimeout,
    timeoutMs = 10000, settleMs = 350, transitionMs = 400, minimumStillMs = 500,
    maxOpenRetries = 1, now = Date.now }) {
    let batch = null, request = null, disposed = false;
    let nextTimer = null;
    let position = null, grounded = false, stillSince = 0;
    let cursorEmpty = true;
    let playerWindowId = null;
    let lateMenuPending = false;
    let lateReportFeedback = false;
    // Window IDs are bytes. Keep late packets hidden until that ID is opened again.
    const hiddenWindows = new Set();
    const say = (text, tone = 'info') => {
        const color = MESSAGE_COLORS[tone] || MESSAGE_COLORS.info;
        sendChat(`§6§lReports §8» ${color}${text.replace(/§7/g, color)}`);
    };
    const record = (event, details = {}) => {
        try {
            menuMonitor.recordAutomationEvent?.('watchdog-report', {
                event, target: request?.target || null, phase: request?.phase || null,
                windowId: request?.windowId ?? null, submittedWindowId: request?.submittedWindowId ?? null,
                serverClosed: request?.closedByServer || false, receipt: request?.successSeen || false,
                movedAfterSubmit: request?.movedAfterSubmit || false,
                ...details
            });
        } catch { /* Diagnostics must not change report or packet handling. */ }
    };

    function recordFeedback(text, kind) {
        const owner = request;
        if (!owner) return;
        const excerpt = text.slice(0, 512);
        if (owner.feedback.has(excerpt) || owner.feedback.size >= 16 && kind === 'context') return;
        owner.feedback.add(excerpt);
        record('feedback', { kind, text: excerpt });
    }

    function closeHidden(owner) {
        if (owner?.windowId == null) return;
        const windowId = owner.windowId;
        record('hidden-close', { closedWindowId: windowId });
        owner.windowId = null;
        try { sendUpstream('close_window', { windowId }); } catch { /* Connection cleanup owns a failed transport. */ }
    }

    function summarize(completed, reason = '', tone = 'success') {
        const confirmed = completed.names.slice(0, completed.confirmed);
        const remaining = completed.names.slice(completed.confirmed);
        const text = remaining.length
            ? `${completed.confirmed}/${completed.names.length} confirmed${confirmed.length ? `: §f${confirmed.join(', ')}§7` : ''}. Unconfirmed: §f${remaining.join(', ')}§7. ${reason}`
            : `${confirmed.length === 1 ? 'Report' : 'Reports'} confirmed for §f${confirmed.join(', ')}§7.`;
        say(text, tone);
    }

    function stop(reason, boundary = false, tone = 'warning') {
        if (batch || request) record('stop', { reason, activity: request?.activity });
        const previous = batch;
        batch = null;
        clearTimer(nextTimer); nextTimer = null;
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
                if (owner.phase === 'opening' && owner.windowId == null
                    && retryOpening(owner, 'Hypixel did not open the report menu', true)) return;
                record('timeout', { activity: owner.activity });
                if (owner.phase === 'confirming' && owner.movedAfterSubmit && !owner.successSeen) {
                    stop(`Hypixel did not confirm the report for §f${owner.target}§7 after you moved. Stay still until reporting finishes.`, false, 'error');
                    return;
                }
                if (owner.phase === 'confirming' && owner.closedByServer && !owner.successSeen) {
                    stop(`The menu closed, but Hypixel did not confirm the report for §f${owner.target}§7 in time.`, false, 'error');
                    return;
                }
                if (owner.phase === 'confirming' && owner.successSeen && !owner.closedByServer) {
                    stop(`Hypixel acknowledged the report for §f${owner.target}§7, but its menu did not finish closing.`, false, 'error');
                    return;
                }
                const waiting = owner.phase === 'queued' ? 'the command to send'
                    : owner.phase === 'opening' ? (owner.windowId == null ? 'Hypixel to open the report menu' : 'the report menu to be ready')
                    : 'Hypixel to confirm the submitted report';
                stop(`Timed out waiting for ${waiting} for §f${owner.target}§7.`, false, 'error');
            }
        }, timeoutMs);
        owner.timer?.unref?.();
    }

    function releaseUnsubmitted(owner) {
        if (request !== owner) return;
        clearTimer(owner.timer); clearTimer(owner.settle);
        owner.abort.abort(); request = null;
        closeHidden(owner);
    }

    function scheduleNext() {
        clearTimer(nextTimer); nextTimer = null;
        if (!batch || batch.paused || request || disposed) return;
        const stillDelay = stationaryDelay();
        if (stillDelay !== 0) markWaitingForStill();
        if (stillDelay == null) return; // Wait for position evidence, not polling.
        const delay = Math.max(transitionMs, stillDelay);
        if (delay <= 0) { startReport(); return; }
        // A report receipt can precede trailing server inventory closes. Give
        // those packets time to settle before opening another hidden menu.
        if (!batch.waitingForStill) record('waiting', { nextTarget: batch.names[batch.confirmed], delayMs: delay });
        nextTimer = setTimer(() => {
            nextTimer = null;
            startReport();
        }, delay);
        nextTimer?.unref?.();
    }

    function stationaryDelay() {
        if (minimumStillMs <= 0) return 0;
        if (!position) return null;
        return Math.max(0, minimumStillMs - (now() - stillSince));
    }

    function markWaitingForStill() {
        if (!batch || batch.waitingForStill) return;
        batch.waitingForStill = true;
        record('waiting-for-still', { nextTarget: batch.names[batch.confirmed] });
        if (!batch.paused) say('Reports are waiting. Stand still briefly to continue.', 'warning');
    }

    function pauseForMotion() {
        if (!batch || minimumStillMs <= 0) return;
        markWaitingForStill();
        const owner = request;
        if (owner?.phase === 'confirming') {
            // Gameplay keeps flowing. A sent Submit remains owned until its
            // real completion/timeout; movement must never authorize a retry.
            if (!owner.movedAfterSubmit) { owner.movedAfterSubmit = true; record('moved-after-submit'); }
        } else if (owner?.phase === 'queued' || owner?.windowId != null) {
            releaseUnsubmitted(owner);
        } else if (owner) {
            clearTimer(owner.settle); // Drain its pending menu before reopening.
        }
        if (batch && !request && !batch.paused && nextTimer == null) scheduleNext();
    }

    function observeMotion(data) {
        let changed = false;
        if (Number.isFinite(data.x) && Number.isFinite(data.y) && Number.isFinite(data.z)
            && (!position || data.x !== position.x || data.y !== position.y || data.z !== position.z)) {
            if (!position) position = { x: data.x, y: data.y, z: data.z };
            else { position.x = data.x; position.y = data.y; position.z = data.z; }
            changed = true;
        }
        if (typeof data.onGround === 'boolean' && data.onGround !== grounded) {
            grounded = data.onGround;
            changed = true;
        }
        if (changed) stillSince = now();
        if (!batch || minimumStillMs <= 0) return;
        if (changed) pauseForMotion();
        else if (batch.waitingForStill && !batch.paused && !request && nextTimer == null) scheduleNext();
    }

    function retryOpening(owner, reason, menuPending = false) {
        if (request !== owner || !batch || batch.paused || owner.phase !== 'opening'
            || batch.openRetries >= maxOpenRetries) return false;
        batch.openRetries++;
        record('retry-opening', { reason });
        releaseUnsubmitted(owner);
        lateMenuPending = menuPending;
        say(`${reason} for §f${owner.target}§7. Trying once more.`, 'warning');
        scheduleNext();
        return true;
    }

    function resumeWhenReady() {
        if (!batch?.paused || request || playerWindowId != null || !cursorEmpty) return;
        const pausedBatch = batch;
        // Client close packets reach this driver before the shared monitor and
        // transport. Recheck after they have released the player's real menu.
        Promise.resolve().then(() => {
            if (batch !== pausedBatch || !batch.paused || request || disposed || playerWindowId != null || !cursorEmpty || canStart()) return;
            batch.paused = false;
            record('resume');
            if (!batch.waitingForStill && stationaryDelay() === 0) say('Continuing reports.');
            scheduleNext();
        });
    }

    function pauseForInventory(windowId, { replaced = false, closeSubmitted = true } = {}) {
        playerWindowId = windowId;
        if (!batch) return;
        clearTimer(nextTimer); nextTimer = null;
        if (!batch.paused) {
            record('pause', { playerWindowId: windowId, replaced });
            say('Paused while you use your inventory or menu. Close it to continue reports.', 'warning');
        }
        batch.paused = true;
        const owner = request;
        if (!owner) return;
        // An arriving real menu already replaced the hidden one server-side.
        // Never send a close for the old window: it could close the new menu.
        if (replaced) owner.windowId = null;
        if (owner.phase === 'confirming') {
            // Keep waiting for BOTH server signals, including a late close of
            // submittedWindowId. An interrupted Submit is never retried.
            if (closeSubmitted) closeHidden(owner);
        } else if (owner.phase === 'queued' || owner.windowId != null || replaced) {
            releaseUnsubmitted(owner);
        } else {
            // The command was sent but its menu has not arrived. Drain it
            // before resuming, so it cannot be mistaken for a new request.
            clearTimer(owner.settle);
        }
    }

    function startReport() {
        if (!batch || batch.paused || disposed) return;
        if (stationaryDelay() !== 0) { markWaitingForStill(); scheduleNext(); return; }
        const blocked = canStart();
        if (blocked || !cursorEmpty) { stop(blocked || 'Put down the item on your cursor first.'); return; }
        if (batch.waitingForStill) {
            batch.waitingForStill = false;
            record('stationary-resume');
            say('Continuing reports.');
        }
        const owner = request = { target: batch.names[batch.confirmed], phase: 'queued', windowId: null,
            snapshot: false, submittedWindowId: null, closedByServer: false, successSeen: false,
            abort: new AbortController(), timer: null, settle: null, feedback: new Set(), activity: {} };
        record('queued');
        arm(owner);
        Promise.resolve().then(() => {
            if (request !== owner || !batch) return { sent: false };
            return sendCommand(`/wdr ${owner.target}`, {
                signal: owner.abort.signal,
                shouldSend: () => {
                    if (request !== owner || !batch || disposed) return false;
                    if (stationaryDelay() !== 0) { pauseForMotion(); return false; }
                    const blocked = canStart();
                    if (blocked || !cursorEmpty) { stop(blocked || 'Your cursor is holding an item.'); return false; }
                    // Set ownership before the transport writes, not when its
                    // promise resolves: a fast server can reply immediately.
                    owner.phase = 'opening'; arm(owner);
                    record('command-sent');
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
            usage.command('/wdr <player>', 'Report one player without opening the confirmation menu.');
            usage.command('/wdr <team>', 'Report every player on a Bed Wars team, for example /wdr red.');
            usage.command('/wdr status', 'Show report progress.');
            usage.command('/wdr cancel', 'Cancel the current report.');
            usage.command('/watchdogreport <player> [reason]', 'Use the original Hypixel command.');
            usage.note('Keep playing while reports run. Inventory and menus pause reports until you close them.');
            usage.note('Reports wait while you move. Stay still briefly until the report is confirmed.');
            usage.note('Another command or a world change cancels reports. Submitted reports are never sent again automatically.');
            return;
        }
        if (names.length === 1 && /^cancel$/i.test(names[0])) {
            if (batch) stop('Cancelled.');
            else say('No report is running.');
            return;
        }
        if (names.length === 1 && /^status$/i.test(names[0])) {
            say(batch ? `${batch.confirmed}/${batch.names.length} confirmed.${batch.paused ? ' Paused: close your inventory or menu to continue.' : batch.waitingForStill ? ' Waiting for you to stop moving.' : ''}${request ? ` Waiting for §f${request.target}§7.` : !batch.paused && !batch.waitingForStill ? ' Waiting before the next report.' : ''}`
                : 'No report is running.');
            return;
        }
        if (names.length > MAX_PLAYERS || names.some(name => !/^[A-Za-z0-9_]{1,16}$/.test(name))) {
            say('Use §f/wdr <player>§7 with one player name, or §f/wdr <team>§7.', 'warning'); return;
        }
        if (batch || request) { say('A report is already running. Use §f/wdr status§7 or §f/wdr cancel§7.', 'warning'); return; }
        const blocked = canStart();
        if (blocked || playerWindowId != null || !cursorEmpty) {
            say(blocked || (playerWindowId != null ? 'Close your inventory or menu first.' : 'Put down the item on your cursor first.'), 'warning'); return;
        }
        const team = TEAM_DEFS.find(team => team.aliases.includes(names[0].toLowerCase()));
        const targets = team ? getTeamPlayers(team.name) : names;
        const seen = new Set();
        const players = targets.filter(name => {
            if (!/^[A-Za-z0-9_]{1,16}$/.test(name) || seen.has(name.toLowerCase())) return false;
            seen.add(name.toLowerCase());
            return true;
        });
        if (!players.length) { say(`No players found on the §f${team.name}§7 team in your current Bed Wars game.`, 'warning'); return; }
        batch = { names: players, confirmed: 0, openRetries: 0 };
        record('start', { targets: players });
        say(`Started reporting: §f${players.join(', ')}§7.`);
        startReport();
    }

    // Match the existing menu driver's quiet-period approach. Hypixel sends a
    // snapshot, a set_slot burst, and sometimes another snapshot ~150 ms later.
    // Clicking the first snapshot (3 ms after open in the failed live capture)
    // can be ignored. Never retry a submit click automatically.
    function scheduleConfirm(owner) {
        if (request !== owner || batch?.paused || batch?.waitingForStill || owner.phase !== 'opening' || !owner.snapshot) return;
        clearTimer(owner.settle);
        owner.settle = setTimer(() => {
            owner.settle = null;
            tryConfirm(owner);
        }, settleMs);
        owner.settle?.unref?.();
    }

    function tryConfirm(owner) {
        if (request !== owner || batch?.paused || owner.phase !== 'opening' || !owner.snapshot) return;
        if (stationaryDelay() !== 0) { pauseForMotion(); return; }
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
        owner.phase = 'confirming'; owner.submittedWindowId = owner.windowId; arm(owner);
        record('submit');
        try {
            const result = menuMonitor.clickSlot({ slot: submit[0][0], source: 'watchdog-report', actionNumbering: 'window' });
            if (!result.ok) stop('Could not confirm the report.', false, 'error');
        } catch { stop('Could not confirm the report.', false, 'error'); }
    }

    function finishIfConfirmed(owner) {
        if (request !== owner || !batch || owner.phase !== 'confirming'
            || !owner.closedByServer || !owner.successSeen) return;
        record('confirmed', { activity: owner.activity });
        clearTimer(owner.timer); clearTimer(owner.settle); owner.abort.abort(); request = null;
        batch.confirmed++;
        batch.openRetries = 0;
        if (batch.confirmed < batch.names.length) {
            if (batch.paused) resumeWhenReady();
            else scheduleNext();
        }
        else {
            summarize(batch);
            batch = null;
        }
    }

    function observeServer(data, meta) {
        if (disposed) return false;
        const name = meta.name;
        if (name === 'login' || name === 'respawn' || name === 'kick_disconnect') {
            if (request?.windowId != null) {
                menuMonitor.setHold(false);
                menuMonitor.observeClientPacket({ windowId: request.windowId }, { name: 'close_window' });
            }
            stop('The connection or world changed.', true); hiddenWindows.clear(); cursorEmpty = true; playerWindowId = null;
            position = null; grounded = false; stillSince = now(); return false;
        }
        if (name === 'position') {
            position = null; grounded = false; stillSince = now();
            pauseForMotion(); // Require the client's absolute position after a server correction.
        }
        if (name === 'set_slot' && data.windowId === -1 && data.slot === -1) {
            cursorEmpty = !data.item || data.item.blockId < 0;
            if (!cursorEmpty && batch && !batch.paused) stop('Your cursor is holding an item.');
            else if (cursorEmpty) resumeWhenReady();
        }
        if (name === 'open_window') {
            hiddenWindows.delete(data.windowId);
            const owner = request;
            if (owner && owner.phase === 'opening' && owner.windowId == null && isReportMenu(data)) {
                owner.windowId = data.windowId; owner.snapshot = false;
                record('menu-open');
                lateMenuPending = false;
                hiddenWindows.add(data.windowId);
                if (batch?.paused || batch?.waitingForStill) {
                    releaseUnsubmitted(owner);
                    if (batch?.paused) resumeWhenReady();
                    else scheduleNext();
                }
                return true;
            }
            if (!owner && lateMenuPending && isReportMenu(data)) {
                lateMenuPending = false;
                hiddenWindows.add(data.windowId);
                closeHidden({ windowId: data.windowId });
                if (nextTimer != null) scheduleNext();
                return true;
            }
            if (batch || request) pauseForInventory(data.windowId, { replaced: true });
            else playerWindowId = data.windowId;
            return false;
        }
        if (name === 'close_window' && playerWindowId === data.windowId) {
            playerWindowId = null;
            resumeWhenReady();
        }
        if (name === 'close_window' && nextTimer != null
            && (data.windowId === 0 || hiddenWindows.has(data.windowId))) scheduleNext();
        if (name === 'chat' && (data.position || 0) !== 2 && (request || batch || lateReportFeedback)) {
            let component = data.message;
            try { if (typeof component === 'string') component = JSON.parse(component); } catch { return false; }
            const text = clean(extractText(component));
            if (request && (SUCCESS.test(text) || FAILURE.test(text) || PROGRESS.test(text) || FEEDBACK_CONTEXT.test(text))) {
                recordFeedback(text, SUCCESS.test(text) ? 'success' : FAILURE.test(text) ? 'failure' : PROGRESS.test(text) ? 'progress' : 'context');
            }
            if (!request) {
                if (SUCCESS.test(text)) { lateReportFeedback = false; return true; }
                return /^Submitting Report(?:\.{1,3}|…)?$/i.test(text);
            }
            if (request.phase !== 'queued' && PROGRESS.test(text)) return true;
            // Keep both completion signals on their request. Hypixel can send
            // success before or after closing the submitted window; neither
            // signal alone may confirm the report.
            if (SUCCESS.test(text) && request.phase === 'confirming') {
                request.successSeen = true;
                finishIfConfirmed(request);
                return true;
            } else if (request.phase !== 'queued' && FAILURE.test(text)) {
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
            if (current || owner?.phase === 'confirming' && owner.submittedWindowId === data.windowId) {
                owner.windowId = null;
                if (owner.phase === 'confirming') {
                    owner.closedByServer = true;
                    record('server-close');
                    finishIfConfirmed(owner);
                }
                else if (batch?.waitingForStill || stationaryDelay() !== 0) {
                    releaseUnsubmitted(owner); markWaitingForStill(); scheduleNext();
                } else if (!retryOpening(owner, 'Hypixel closed the report menu before submission')) {
                    stop('The report menu closed before it could be confirmed.');
                }
            }
            return true;
        }
        return name === 'craft_progress_bar' || name === 'transaction';
    }

    function observeClient(data, meta) {
        if (disposed) return false;
        const name = meta.name;
        if (MOVEMENT_PACKETS.has(name)) observeMotion(data);
        if (request && ACTIVITY_PACKETS.has(name)) {
            const phase = request.phase === 'confirming' ? 'afterSubmit' : 'beforeSubmit';
            const key = `${phase}:${name}`;
            const at = now();
            const activity = request.activity[key];
            if (activity) { activity.count++; activity.lastAt = at; }
            else {
                request.activity[key] = { count: 1, firstAt: at, lastAt: at };
                record('player-action', { packet: name, stage: phase, hidden: WINDOW_ACTIONS.has(name) && hiddenWindows.has(data.windowId) });
            }
        }
        if (WINDOW_ACTIONS.has(name) && hiddenWindows.has(data.windowId)) return true;
        if (name === 'close_window') {
            if (playerWindowId === data.windowId) { playerWindowId = null; resumeWhenReady(); }
        } else if (INVENTORY_ACTIONS.has(name)) {
            pauseForInventory(data.windowId ?? 0);
        } else if (name === 'client_command' && data.payload === 2) {
            // Opening the local inventory does not change any server slots.
            // Let a submitted report finish normally; release it only if the
            // player actually clicks an inventory slot before it closes.
            pauseForInventory(0, { closeSubmitted: false });
        }
        return false; // Movement, looking, chat and normal gameplay keep flowing.
    }

    function observeCommand(message) {
        if (batch && /^\//.test(message) && !/^\/wdr(?:\s|$)/i.test(message)) stop('You used another command.');
        if (/^\/(?:watchdogreport|report)(?:\s|$)/i.test(message)) { lateMenuPending = false; lateReportFeedback = false; }
    }

    function observeUpstream(name, data) {
        if (disposed || !request || request.phase === 'queued' || name !== 'chat' || typeof data.message !== 'string'
            || !data.message.startsWith('/') || /^\/wdr(?:\s|$)/i.test(data.message)) return;
        // Record the command name only; arguments may contain private chat.
        record('other-command', { command: data.message.split(/\s+/, 1)[0].slice(0, 32) });
    }

    function dispose() { disposed = true; stop('', true); request = null; hiddenWindows.clear(); }
    return { command, observeServer, observeClient, observeCommand, observeUpstream, dispose, isBusy: () => !!batch || !!request };
}

module.exports = { createWatchdogReport, MAX_PLAYERS };
