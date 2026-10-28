'use strict';
const { randomBytes } = require('crypto');
const { nameKey, MAX_MEMBERS } = require('./coordinationProtocol');

// One deferred, coalesced task per connection. Never fetches profiles or changes
// the scan/party-review state; the host owns validation and saved mappings.
function createNicknameSharing({ getContext, getOwnName, rememberOwn, getPeers,
    acceptPeer, acknowledge, onChange, onError = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null, closed = false, epoch = 0, world = null, readyAt = 0;
    let current = null, claim = null, sharing = false;
    let running = false, queuedDelay = Infinity;
    const received = new Set();
    function request(delay = 0) {
        if (closed || timer !== null) return;
        if (running) { queuedDelay = Math.min(queuedDelay, delay); return; }
        timer = setTimer(run, delay); timer.unref?.();
    }
    function reset(nextWorld) {
        epoch++;
        if (timer !== null) clearTimer(timer);
        timer = null; world = nextWorld; readyAt = now() + 8000;
        current = null; claim = null; sharing = false; received.clear();
    }
    function state() {
        const context = getContext();
        if (!context.active || context.world !== world || !current || now() < readyAt || context.busy) return null;
        return { nick: context.share && current.nick ? current.nick : null,
            id: context.share && current.nick ? claim : null,
            serverId: context.serverId, mode: context.mode, receive: context.receive };
    }
    async function check() {
        timer = null;
        if (closed) return;
        const context = getContext();
        if (context.world !== world) reset(context.world);
        if (now() < readyAt) { request(readyAt - now()); return; }
        if (context.busy) { request(1000); return; }
        const ownName = getOwnName();
        const nextNick = ownName && nameKey(ownName) !== nameKey(context.account) ? ownName : null;
        if (ownName && (!current || nameKey(current.name) !== nameKey(ownName))) {
            current = { name: ownName, nick: nextNick, checkedAt: now() }; claim = randomBytes(12).toString('hex');
            rememberOwn(nextNick);
            onChange();
        } else if (!ownName && current) { current = null; claim = null; onChange(); }
        if (sharing !== context.share) {
            sharing = context.share; claim = randomBytes(12).toString('hex'); onChange();
        }
        if (!context.active || !current || !context.receive) return;
        const taskEpoch = epoch;
        const peers = getPeers();
        const counts = new Map();
        for (const peer of peers) counts.set(nameKey(peer.nick), (counts.get(nameKey(peer.nick)) || 0) + 1);
        for (const peer of peers) {
            if (closed || taskEpoch !== epoch || getContext().busy) return;
            const key = `${peer.uuid}:${peer.id}`;
            if (received.has(key) || counts.get(nameKey(peer.nick)) !== 1) continue;
            const stillValid = () => {
                const latest = getContext();
                return !closed && taskEpoch === epoch && latest.active && latest.receive && !latest.busy
                    && latest.world === context.world && latest.serverId === context.serverId && latest.mode === context.mode
                    && getPeers().some(current => current.uuid === peer.uuid && current.id === peer.id);
            };
            if (await acceptPeer(peer, stillValid)) {
                if (closed || taskEpoch !== epoch) return;
                if (acknowledge(peer)) {
                    received.add(key);
                    if (received.size > MAX_MEMBERS) received.delete(received.values().next().value);
                }
            }
        }
    }
    async function run() {
        running = true;
        try { await check(); } catch (error) { onError(error); }
        finally {
            running = false;
            if (Number.isFinite(queuedDelay)) { const delay = queuedDelay; queuedDelay = Infinity; request(delay); }
        }
    }
    function close() { closed = true; reset(null); }
    function ownStatus() {
        const context = getContext();
        const checked = !closed && context.world === world && Boolean(current);
        return { checked, nick: checked ? current.nick : null, name: checked ? current.name : null,
            checkedAt: checked ? current.checkedAt : null,
            pending: !closed && (!checked || context.busy),
            sharing: context.share, receiving: context.receive };
    }
    return { request, reset, state, ownStatus, close };
}

module.exports = { createNicknameSharing };
