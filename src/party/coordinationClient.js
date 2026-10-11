'use strict';

const { randomBytes } = require('crypto');
const WebSocket = require('ws');
const { joinCoordinationChallenge } = require('./coordinationAuth');
const { VERSION, MAX_MESSAGE_BYTES, SETTLE_MS, DISCOVERY_MS, HEARTBEAT_MS, LEASE_MS,
    nameKey, uuidKey, rosterKeys, observation, relayUrl } = require('./coordinationProtocol');

function createPartyCoordination({ network, getSession, onChange = () => {},
    endpoint = relayUrl(), now = () => performance.now(),
    setTimer = setTimeout, clearTimer = clearTimeout,
    createSocket = url => new WebSocket(url, { maxPayload: MAX_MESSAGE_BYTES,
        handshakeTimeout: 8000, perMessageDeflate: false, followRedirects: false }),
    authenticate = joinCoordinationChallenge }) {
    let closed = false, socket = null, ready = false, authController = null;
    let state = null, signature = '', scope = '', seq = 0, stableAt = 0;
    let checkId = '', checkAt = 0, retryAt = 0, backoff = 1000, nextHeartbeat = 0;
    let timer = null, settled = false, discoveryNotified = false;
    let nextProbe = Infinity;
    const peers = new Map();

    function notify() { onChange(); }
    function disconnect() {
        const previous = socket;
        socket = null; ready = false;
        authController?.abort(); authController = null;
        peers.clear();
        nextProbe = Infinity;
        if (previous) previous.terminate();
    }
    function usable() { return !closed && endpoint && state?.enabled && state.members.length
        && nameKey(state.leader) && getSession()?.accessToken; }
    function send(message) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        // A stalled connection must fall back rather than accumulating data.
        if (socket.bufferedAmount > MAX_MESSAGE_BYTES * 2) { failed(socket); return false; }
        socket.send(JSON.stringify({ v: VERSION, ...message }));
        return true;
    }
    function currentObservation() {
        return { phase: state.phase, serverId: state.serverId, generation: state.generation,
            seq: ++seq, stableMs: Math.min(LEASE_MS, Math.max(0, now() - stableAt)) };
    }
    function publish() {
        if (!ready) return;
        send({ type: 'state', members: state.members, observation: currentObservation() });
        nextHeartbeat = now() + HEARTBEAT_MS;
    }
    function probe() {
        if (!ready || state.phase !== 'pregame') return;
        const names = state.members.filter(name => {
            const peer = peers.get(name);
            return !peer || (peer.data.phase === 'pregame' && peer.data.serverId
                && peer.data.serverId !== state.serverId && !peer.confirmed);
        });
        if (names.length) send({ type: 'probe', id: checkId, names });
    }
    function newCheck() {
        checkId = randomBytes(12).toString('hex'); checkAt = now();
        nextProbe = Infinity;
        peers.clear(); discoveryNotified = false;
    }
    function failed(target) {
        if (socket !== target) return;
        disconnect();
        retryAt = now() + backoff;
        backoff = Math.min(60000, backoff * 2);
        notify(); schedule();
    }
    function connect() {
        if (!usable() || socket) return;
        const url = new URL(endpoint.href);
        url.searchParams.set('leader', nameKey(state.leader));
        url.searchParams.set('network', network);
        let target;
        try { target = createSocket(url.href); } catch { retryAt = now() + backoff; backoff = Math.min(60000, backoff * 2); return; }
        socket = target;
        authController = new AbortController();
        const controller = authController;
        target.on('error', () => failed(target));
        target.on('close', () => failed(target));
        target.on('message', async (raw, binary) => {
            if (socket !== target || closed) return;
            let message;
            try {
                if (binary || Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) throw new Error();
                message = JSON.parse(String(raw));
                if (message.v !== VERSION) throw new Error();
            } catch { failed(target); return; }
            if (message.type === 'challenge' && !ready) {
                if (controller.started) { failed(target); return; }
                controller.started = true;
                try {
                    const session = getSession();
                    await authenticate(session, message.challenge, AbortSignal.any([
                        controller.signal, AbortSignal.timeout(8000)]));
                    if (socket !== target || controller.signal.aborted || !usable()) return;
                    send({ type: 'authenticate', name: session.selectedProfile.name,
                        uuid: uuidKey(session.selectedProfile.id) });
                } catch { failed(target); }
                return;
            }
            if (message.type === 'ready' && !ready && controller.started) {
                ready = true; backoff = 1000; newCheck(); publish(); probe(); notify(); schedule(); return;
            }
            if (!ready) return;
            if (message.type === 'query' && /^[a-f0-9]{24}$/.test(message.id)
                && state.members.includes(nameKey(message.name)) && uuidKey(message.uuid)) {
                send({ type: 'reply', to: message.uuid, id: message.id, observation: currentObservation() });
            } else if (message.type === 'peer') {
                const name = nameKey(message.name), uuid = uuidKey(message.uuid);
                const data = observation(message.observation), previous = peers.get(name);
                if (!name || !uuid || !data || !state.members.includes(name)) return;
                // A correlated live reply establishes the baseline for this lobby.
                // Unsolicited snapshots cannot establish it after a local transfer.
                if (!previous && message.id !== checkId) return;
                if (message.id && message.id !== checkId) return;
                if (previous && (previous.uuid !== uuid || data.seq <= previous.data.seq)) return;
                let mismatchAt = null, confirmed = false;
                if (state.serverId && data.phase === 'pregame' && data.serverId
                    && data.serverId !== state.serverId && data.stableMs >= SETTLE_MS) {
                    mismatchAt = previous?.data.generation === data.generation
                        && previous?.data.serverId === data.serverId ? previous.mismatchAt : null;
                    if (mismatchAt === null || mismatchAt === undefined) mismatchAt = now();
                    confirmed = now() - mismatchAt >= 500;
                    if (!confirmed) nextProbe = Math.min(nextProbe, mismatchAt + 500);
                }
                peers.set(name, { uuid, data, at: now(), mismatchAt, confirmed });
                if (!previous || previous.data.phase !== data.phase || previous.data.serverId !== data.serverId
                    || previous.data.generation !== data.generation || previous.confirmed !== confirmed
                    || (previous.data.stableMs >= SETTLE_MS) !== (data.stableMs >= SETTLE_MS)) notify();
                schedule();
            } else if (message.type === 'gone') {
                const name = nameKey(message.name), previous = peers.get(name);
                if (previous?.uuid === uuidKey(message.uuid)) { peers.delete(name); notify(); schedule(); }
            }
        });
        // Bound the complete connect/challenge/verify handshake, not just TCP.
        target.authDeadline = now() + 12000;
    }
    function schedule() {
        if (timer !== null) clearTimer(timer);
        timer = null;
        if (!usable()) return;
        const deadlines = [];
        if (!socket) deadlines.push(retryAt);
        else if (!ready) deadlines.push(socket.authDeadline);
        else {
            deadlines.push(nextHeartbeat);
            if (Number.isFinite(nextProbe)) deadlines.push(nextProbe);
            if (!settled) deadlines.push(stableAt + SETTLE_MS);
            if (!discoveryNotified && state.phase === 'pregame') deadlines.push(checkAt + DISCOVERY_MS);
            for (const peer of peers.values()) deadlines.push(peer.at + LEASE_MS);
        }
        if (!deadlines.length) return;
        timer = setTimer(tick, Math.max(1, Math.min(...deadlines) - now()));
        timer.unref?.();
    }
    function tick() {
        timer = null;
        if (!usable()) return;
        if (!socket) connect();
        else if (!ready && now() >= socket.authDeadline) failed(socket);
        else if (ready) {
            let changed = false;
            for (const [name, peer] of peers) if (now() - peer.at >= LEASE_MS) { peers.delete(name); changed = true; }
            if (!settled && now() - stableAt >= SETTLE_MS) { settled = true; publish(); probe(); changed = true; }
            else if (now() >= nextHeartbeat) { publish(); probe(); }
            if (now() >= nextProbe) { nextProbe = Infinity; probe(); }
            if (!discoveryNotified && now() - checkAt >= DISCOVERY_MS) { discoveryNotified = true; changed = true; }
            if (changed) notify();
        }
        schedule();
    }
    function update(value) {
        if (closed) return;
        const members = rosterKeys(value.members);
        const next = { enabled: Boolean(value.enabled), leader: nameKey(value.leader), members: members || [],
            phase: ['pregame', 'transfer'].includes(value.phase) ? value.phase : 'other',
            serverId: value.serverId || null, generation: String(value.generation) };
        const nextSignature = JSON.stringify(next);
        const identity = getSession()?.selectedProfile;
        const nextScope = `${next.leader}:${uuidKey(identity?.id)}:${nameKey(identity?.name)}`;
        if (signature === nextSignature && scope === nextScope) return;
        const boundary = !state || state.phase !== next.phase || state.serverId !== next.serverId
            || state.generation !== next.generation || scope !== nextScope;
        const rosterChanged = !state || state.members.join(',') !== next.members.join(',');
        if (scope !== nextScope) { disconnect(); retryAt = 0; backoff = 1000; }
        state = next; signature = nextSignature; scope = nextScope;
        if (!usable()) {
            disconnect(); if (timer !== null) clearTimer(timer); timer = null; notify(); return;
        }
        if (boundary || rosterChanged) {
            if (boundary) { stableAt = now(); settled = false; }
            newCheck();
        }
        if (!socket) connect();
        if (ready) { publish(); probe(); }
        notify(); schedule();
    }
    function evidence(name) {
        if (!usable() || !ready || state.phase !== 'pregame' || !state.serverId
            || !state.members.includes(nameKey(name))) return null;
        const peer = peers.get(nameKey(name));
        if (!peer || now() - peer.at >= LEASE_MS || now() - stableAt < SETTLE_MS
            || peer.data.phase !== 'pregame' || !peer.data.serverId || peer.data.stableMs < SETTLE_MS) {
            return now() - checkAt < DISCOVERY_MS ? { status: 'pending' } : null;
        }
        if (peer.data.serverId !== state.serverId && !peer.confirmed) {
            return now() - checkAt < DISCOVERY_MS ? { status: 'pending' } : null;
        }
        return { status: peer.data.serverId === state.serverId ? 'same' : 'different', serverId: peer.data.serverId };
    }
    function close() {
        closed = true; disconnect();
        if (timer !== null) clearTimer(timer);
        timer = null;
    }
    return { update, evidence, close,
        getStatus: () => !endpoint ? 'unconfigured' : ready ? 'connected' : usable() ? 'connecting' : 'inactive' };
}
module.exports = { createPartyCoordination };
