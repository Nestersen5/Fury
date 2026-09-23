'use strict';

function formatQueueTime(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

// Accumulate only confirmed pregame intervals, including abandoned queues.
function formatQueueTimeWords(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const minutes = Math.floor(seconds / 60), remainder = seconds % 60;
    const parts = [];
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    if (remainder || !minutes) parts.push(`${remainder} second${remainder === 1 ? '' : 's'}`);
    return parts.join(' ');
}

function createQueueTimeTracker({ now = () => performance.now(), announce, share = () => {},
    getEnabled = () => true, getShareEnabled = () => false }) {
    let enteredAt = null, elapsed = 0, lobbies = 0;
    let pending = null;
    let lobbyKey = null;
    let awaitingIntroEnd = false;
    function enter(key = null) {
        if (enteredAt !== null) return;
        // A countdown can activate the game before its pregame sidebar clears.
        // Reopening that same lobby must preserve the wait already measured.
        const sameLobby = pending && key && pending.lobbyKey && key === pending.lobbyKey;
        const unidentifiedTransition = pending && (!key || !pending.lobbyKey)
            && now() - pending.stoppedAt <= 3000;
        if (sameLobby || unidentifiedTransition) {
            elapsed = pending.duration;
            lobbies = pending.count;
            enteredAt = pending.stoppedAt;
            lobbyKey = key || pending.lobbyKey;
            pending = null;
            return;
        }
        pending = null;
        lobbyKey = key;
        enteredAt = now();
        lobbies += 1;
    }
    function leave() {
        if (enteredAt === null) return;
        elapsed += Math.max(0, now() - enteredAt);
        enteredAt = null;
    }
    function reset() { enteredAt = null; elapsed = 0; lobbies = 0; pending = null; lobbyKey = null; awaitingIntroEnd = false; }
    function gameStart(mode) {
        if (mode === 'BEDWARS' && pending && !lobbies) return;
        leave();
        const duration = elapsed, count = lobbies, key = lobbyKey;
        reset();
        if (mode !== 'BEDWARS' || !count) return;
        pending = { duration, count, lobbyKey: key, stoppedAt: now() };
    }
    function confirmStartMessage() {
        if (!pending) return;
        const { duration, count } = pending;
        pending = null;
        awaitingIntroEnd = false;
        if (!getEnabled()) return;
        // The last lobby started this match; every earlier lobby was abandoned.
        const folds = count - 1;
        const folded = `folded ${folds} time${folds === 1 ? '' : 's'}`;
        if (getShareEnabled()) share(`${folded}, took ${formatQueueTimeWords(duration)}`);
        else announce(`\u00a76Queue time \u00a78\u00bb \u00a7f${formatQueueTime(duration)}`
            + ` \u00a78\u00b7 \u00a77${folded}`);
    }
    function observeStartChat(text) {
        if (!pending) return;
        const clean = String(text || '').replace(/\u00a7[0-9a-fk-or]/gi, '');
        for (const line of clean.split(/\r?\n/)) {
            if (/^\s*Protect your bed and destroy the enemy beds/i.test(line)) awaitingIntroEnd = true;
            else if (awaitingIntroEnd && /^\s*[-\u2500\u2501]{10,}\s*$/.test(line)) confirmStartMessage();
        }
    }
    return { enter, leave, reset, gameStart, confirmStartMessage, observeStartChat };
}

module.exports = { createQueueTimeTracker, formatQueueTime, formatQueueTimeWords };
