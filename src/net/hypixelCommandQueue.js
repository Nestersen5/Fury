'use strict';

// Hypixel applies a command-specific chat cooldown. Keep every automatic and
// forwarded slash command for one connection in a single serialized lane so
// lobby events cannot collide with party lookups, denick announcements, or
// dodge commands.
const DEFAULT_COMMAND_GAP_MS = 400;

function normalizeCommand(command) {
    return String(command || '').replace(/\s+/g, ' ').trim();
}

function createHypixelCommandQueue(options = {}) {
    const minIntervalMs = Math.max(1, Number(options.minIntervalMs) || DEFAULT_COMMAND_GAP_MS);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const setTimer = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    const clearTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    const canSend = typeof options.canSend === 'function' ? options.canSend : () => true;
    const send = typeof options.send === 'function' ? options.send : () => {};
    const onError = typeof options.onError === 'function' ? options.onError : () => {};

    const entries = [];
    const pendingByKey = new Map();
    const lastSentByKey = new Map();
    let timer = null;
    let lastSentAt = null;
    let nextSequence = 0;
    let closed = false;

    function snapshot() {
        return {
            minIntervalMs,
            queued: entries.length,
            lastSentAt,
            closed
        };
    }

    function settle(entry, result) {
        if (entry.dedupeKey && pendingByKey.get(entry.dedupeKey) === entry) {
            pendingByKey.delete(entry.dedupeKey);
        }
        entry.resolve(result);
    }

    function nextEntry() {
        if (!entries.length) return null;
        let bestIndex = 0;
        for (let index = 1; index < entries.length; index += 1) {
            const candidate = entries[index];
            const best = entries[bestIndex];
            if (candidate.priority < best.priority
                || (candidate.priority === best.priority && candidate.sequence < best.sequence)) {
                bestIndex = index;
            }
        }
        return entries.splice(bestIndex, 1)[0];
    }

    function scheduleDrain() {
        if (closed || timer || !entries.length) return;
        const elapsed = lastSentAt === null ? Infinity : Math.max(0, now() - lastSentAt);
        const waitMs = lastSentAt === null ? 0 : Math.max(0, minIntervalMs - elapsed);
        if (waitMs <= 0) {
            drain();
            return;
        }
        timer = setTimer(() => {
            timer = null;
            drain();
        }, waitMs);
    }

    function drain() {
        if (closed || !entries.length) return;
        const elapsed = lastSentAt === null ? Infinity : Math.max(0, now() - lastSentAt);
        if (lastSentAt !== null && elapsed < minIntervalMs) {
            scheduleDrain();
            return;
        }

        const entry = nextEntry();
        if (!entry) return;
        if (!canSend()) {
            settle(entry, { sent: false, reason: 'not-ready', command: entry.command });
            scheduleDrain();
            return;
        }

        try {
            send(entry.command);
            lastSentAt = now();
            if (entry.dedupeKey) lastSentByKey.set(entry.dedupeKey, lastSentAt);
            settle(entry, { sent: true, command: entry.command, sentAt: lastSentAt });
        } catch (error) {
            onError(error, entry.command);
            settle(entry, { sent: false, reason: 'send-failed', command: entry.command, error });
        }
        scheduleDrain();
    }

    function enqueue(command, options = {}) {
        const clean = normalizeCommand(command);
        if (!clean) return Promise.resolve({ sent: false, reason: 'empty', command: clean });
        if (!clean.startsWith('/')) return Promise.resolve({ sent: false, reason: 'not-command', command: clean });
        if (closed) return Promise.resolve({ sent: false, reason: 'closed', command: clean });

        const dedupeKey = String(options.dedupeKey || '').trim();
        const dedupeMs = Math.max(0, Number(options.dedupeMs) || 0);
        const lastSent = dedupeKey ? lastSentByKey.get(dedupeKey) : null;
        if (dedupeKey && pendingByKey.has(dedupeKey)) return pendingByKey.get(dedupeKey).promise;
        if (dedupeKey && dedupeMs > 0 && Number.isFinite(lastSent) && now() - lastSent < dedupeMs) {
            return Promise.resolve({ sent: false, reason: 'deduped', command: clean });
        }

        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        const entry = {
            command: clean,
            priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : 50,
            sequence: nextSequence++,
            dedupeKey,
            resolve,
            promise
        };
        entries.push(entry);
        if (dedupeKey) pendingByKey.set(dedupeKey, entry);
        scheduleDrain();
        return promise;
    }

    function close(reason = 'closed') {
        if (closed) return;
        closed = true;
        if (timer) {
            clearTimer(timer);
            timer = null;
        }
        while (entries.length) {
            const entry = entries.shift();
            settle(entry, { sent: false, reason, command: entry.command });
        }
    }

    return { enqueue, close, snapshot };
}

module.exports = {
    DEFAULT_COMMAND_GAP_MS,
    createHypixelCommandQueue
};
