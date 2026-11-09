'use strict';

const { realAccountUuid, isAccountName } = require('./identity');

// One connection-independent queue for the proxy's saved denicks. Verified
// accounts leave it permanently; there is no scheduled name refresh.
function createDenickIdentityMigration({ history, resolveIdentity, canRequest = () => true,
    now = Date.now, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
    spacingMs = 2000, retryDelaysMs = [60000, 300000], onError = () => {} }) {
    const pending = new Set(), urgent = new Set(), attempts = new WeakMap();
    let timer = null, timerAt = Infinity, running = false, closed = false, lastStart = -Infinity;
    const controller = new AbortController();
    const eligible = player => player && !player.realUuid && player.identityState !== 'missing'
        && (attempts.get(player) || 0) <= retryDelaysMs.length;

    function enqueue(player, priority = false) {
        if (eligible(player)) {
            if (pending.has(player) && (!priority || urgent.has(player))) return;
            pending.add(player);
            if (priority) urgent.add(player);
        }
        schedule();
    }
    function schedule() {
        if (closed || running || !canRequest() || !pending.size) return;
        let next = Infinity;
        for (const player of pending) {
            if (!eligible(player)) { pending.delete(player); urgent.delete(player); continue; }
            next = Math.min(next, player.identityRetryAt || 0);
        }
        if (!Number.isFinite(next)) return;
        const delay = Math.max(0, next - now(), lastStart + spacingMs - now());
        if (timer !== null && timerAt <= now() + delay) return;
        if (timer !== null) clearTimeoutImpl(timer);
        timerAt = now() + delay;
        timer = setTimeoutImpl(() => { timer = null; timerAt = Infinity; void run(); }, delay);
        timer?.unref?.();
    }
    async function run() {
        if (closed || !canRequest()) return;
        const ready = player => eligible(player) && (player.identityRetryAt || 0) <= now();
        const player = [...urgent].find(ready) || [...pending].find(ready);
        if (!player) return schedule();
        pending.delete(player);
        urgent.delete(player);
        if (!history.loadDenickHistoryStore().players.includes(player)) { resume(); return schedule(); }
        const version = history.identityVersion(player);
        running = true;
        lastStart = now();
        const attempt = (attempts.get(player) || 0) + 1;
        attempts.set(player, attempt);
        try {
            const identity = await resolveIdentity(player.realIGN, { signal: controller.signal, attempt });
            if (closed) return;
            if (!realAccountUuid(identity?.realUuid) || !isAccountName(identity?.realIGN)
                || identity.realIGN.toLowerCase() !== player.realIGN.toLowerCase()) throw new Error('Invalid saved account identity.');
            if (!history.updateIdentity(player, identity, version)) enqueue(player);
        } catch (error) {
            if (closed) return;
            // Only an explicit missing-profile response can retire a legacy
            // mapping. Timeouts, refusals, malformed replies and kill switches
            // retain the saved finding and cannot turn it into a different UUID.
            const missing = [204, 404].includes(error?.response?.status);
            const delay = retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 300000;
            history.updateIdentity(player, missing ? { identityState: 'missing' }
                : { identityState: 'pending', identityRetryAt: now() + delay }, version);
            if (!missing && eligible(player) && history.loadDenickHistoryStore().players.includes(player)) pending.add(player);
            if (!missing && !error?.apiKillSwitchBlocked) onError(error);
        } finally {
            // Include provider cooldown waits in the pacing guarantee.
            lastStart = now();
            running = false;
            schedule();
        }
    }
    const unsubscribe = history.subscribe(({ nick, reason }) => {
        if (reason !== 'automatic' && reason !== 'manual') return;
        const store = history.loadDenickHistoryStore();
        const known = store.byNick.get(String(nick).toLowerCase());
        if (known) enqueue(store.byReal.get(known.realName.toLowerCase()), true);
    });
    function request(nick) {
        if (closed) return;
        const store = history.loadDenickHistoryStore();
        const known = store.byNick.get(String(nick || '').toLowerCase());
        if (known && !known.realUuid) enqueue(store.byReal.get(known.realName.toLowerCase()), true);
    }
    function resume() {
        if (closed) return;
        for (const player of history.loadDenickHistoryStore().players) if (eligible(player)) pending.add(player);
        schedule();
    }
    function close() {
        closed = true;
        if (timer !== null) clearTimeoutImpl(timer);
        timer = null;
        controller.abort();
        pending.clear();
        urgent.clear();
        unsubscribe();
    }
    function getStatus() {
        let pendingCount = 0, ready = false, retrying = false;
        const at = now();
        for (const player of history.loadDenickHistoryStore().players) {
            if (player.realUuid || player.identityState === 'missing') continue;
            pendingCount++;
            if (!eligible(player)) continue;
            if ((player.identityRetryAt || 0) <= at) ready = true;
            else retrying = true;
        }
        const state = !pendingCount ? 'complete' : closed || !canRequest() ? 'paused'
            : running || ready ? 'updating' : retrying ? 'retrying' : 'restart';
        return { state, pendingCount };
    }
    return { resume, request, close, getStatus };
}

module.exports = { createDenickIdentityMigration };
