import protocol from '../../src/party/coordinationProtocol.js';
const { VERSION, MAX_MEMBERS, MAX_MESSAGE_BYTES, LEASE_MS, nameKey, uuidKey,
    rosterKeys, observation, nicknameState } = protocol;
const AUTH_MS = 12000;
const ID_RE = /^[a-f0-9]{24}$/;

async function verifyIdentity(name, uuid, challenge) {
    const url = new URL('https://sessionserver.mojang.com/session/minecraft/hasJoined');
    url.searchParams.set('username', name);
    url.searchParams.set('serverId', challenge);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (response.status !== 200) return false;
    const profile = await response.json();
    return nameKey(profile.name) === nameKey(name) && uuidKey(profile.id) === uuidKey(uuid);
}

// One hibernatable object per network + party leader. Attachments survive
// hibernation; no player history, tokens or durable presence records are stored.
export class PartyRoom {
    constructor(ctx, env, { verify = verifyIdentity, now = Date.now } = {}) {
        this.ctx = ctx; this.env = env; this.verify = verify; this.now = now;
    }
    sockets() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1); }
    attachment(ws) { return ws.deserializeAttachment(); }
    save(ws, value) { ws.serializeAttachment(value); }
    send(ws, message) {
        try { ws.send(JSON.stringify({ v: VERSION, ...message })); } catch { this.remove(ws); }
    }
    async fetch(request) {
        const leader = nameKey(new URL(request.url).searchParams.get('leader'));
        if (!leader || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('WebSocket required', { status: 400 });
        }
        if (this.sockets().length >= MAX_MEMBERS + 16) return new Response('Party busy', { status: 429 });
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        await this.open(server, leader);
        return new Response(null, { status: 101, webSocket: client });
    }
    async open(ws, leader) {
        const bytes = crypto.getRandomValues(new Uint8Array(20)); bytes[0] &= 0x7f;
        const challenge = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
        this.save(ws, { leader, challenge, openedAt: this.now(), seenAt: this.now(),
            authenticated: false, verifying: false, rateAt: this.now(), count: 0, controlCount: 0 });
        this.send(ws, { type: 'challenge', challenge });
        await this.ensureAlarm();
    }
    mutual(a, b) {
        return a?.authenticated && b?.authenticated && a.uuid !== b.uuid
            && a.members?.includes(b.name) && b.members?.includes(a.name);
    }
    live(a) { return a?.authenticated && this.now() - a.seenAt < LEASE_MS; }
    remove(ws) {
        const a = this.attachment(ws);
        if (!a || a.removed) return;
        this.save(ws, { ...a, removed: true, authenticated: false });
        for (const peer of this.sockets()) if (peer !== ws && this.mutual(a, this.attachment(peer))) {
            this.send(peer, { type: 'gone', name: a.name, uuid: a.uuid });
        }
        try { ws.close(1008, 'Coordination unavailable'); } catch { /* already closed */ }
    }
    async ensureAlarm() {
        if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(this.now() + AUTH_MS);
    }
    async alarm() {
        for (const ws of this.sockets()) {
            const a = this.attachment(ws);
            if (!a || (a.authenticated ? !this.live(a) : this.now() - a.openedAt >= AUTH_MS)) this.remove(ws);
        }
        if (this.sockets().length) await this.ctx.storage.setAlarm(this.now() + AUTH_MS);
    }
    async webSocketMessage(ws, raw) {
        let a = this.attachment(ws), message;
        if (!a || a.removed) return;
        try {
            if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) throw new Error();
            message = JSON.parse(raw);
            if (message.v !== VERSION) throw new Error();
        } catch { this.remove(ws); return; }
        if (this.now() - a.rateAt >= 1000) { a.rateAt = this.now(); a.count = a.controlCount = 0; }
        // Large parties may answer one query from every member in a burst.
        if (++a.count > MAX_MEMBERS * 4 + 16
            || (!['reply', 'nick_saved'].includes(message.type) && ++a.controlCount > 8)) { this.remove(ws); return; }
        this.save(ws, a);
        if (!a.authenticated) {
            if (message.type !== 'authenticate' || a.verifying || this.now() - a.openedAt >= AUTH_MS
                || !nameKey(message.name) || !uuidKey(message.uuid)) { this.remove(ws); return; }
            a.verifying = true; this.save(ws, a);
            let verified = false;
            try { verified = await this.verify(message.name, message.uuid, a.challenge); } catch { /* fail closed */ }
            const latest = this.attachment(ws);
            if (!verified || latest.removed || this.now() - a.openedAt >= AUTH_MS) { this.remove(ws); return; }
            // A new authenticated connection replaces an older connection for
            // the same UUID. It must establish fresh per-lobby evidence again.
            for (const peer of this.sockets()) if (peer !== ws && this.attachment(peer)?.uuid === uuidKey(message.uuid)) this.remove(peer);
            a = { leader: a.leader, name: nameKey(message.name), uuid: uuidKey(message.uuid),
                authenticated: true, members: [], observation: null, seenAt: this.now(),
                rateAt: this.now(), count: 0, controlCount: 0 };
            this.save(ws, a); this.send(ws, { type: 'ready', capabilities: ['nicknames-v1'] }); return;
        }
        if (!this.live(a)) { this.remove(ws); return; }
        if (message.type === 'state') {
            const members = rosterKeys(message.members), data = observation(message.observation);
            const nickname = message.nickname == null ? null : nicknameState(message.nickname);
            if (!members || members.includes(a.name) || !data
                || (message.nickname != null && !nickname)
                || (nickname?.nick && nameKey(nickname.nick) === a.name)
                || (a.leader !== a.name && !members.includes(a.leader))
                || (a.observation && data.seq <= a.observation.seq)) { this.remove(ws); return; }
            const before = { ...a };
            a.members = members; a.observation = data; a.nickname = nickname; a.seenAt = this.now(); this.save(ws, a);
            for (const peer of this.sockets()) {
                if (peer === ws) continue;
                const b = this.attachment(peer);
                if (this.live(b) && this.mutual(a, b)) {
                    this.send(peer, { type: 'peer', name: a.name, uuid: a.uuid, observation: data,
                        ...(b.nickname ? { nickname } : {}) });
                    // A previously unavailable peer can now answer the latest
                    // lobby-scoped query without waiting for another heartbeat.
                    if (b.probeId && b.probeNames?.includes(a.name) && !this.mutual(before, b)) this.send(ws, { type: 'query',
                        name: b.name, uuid: b.uuid, id: b.probeId });
                } else if (this.mutual(before, b)) this.send(peer, { type: 'gone', name: a.name, uuid: a.uuid });
            }
        } else if (message.type === 'probe' && ID_RE.test(message.id)) {
            const names = rosterKeys(message.names);
            if (!names || names.some(name => !a.members.includes(name))) { this.remove(ws); return; }
            a.probeId = message.id; a.probeNames = names; this.save(ws, a);
            for (const peer of this.sockets()) {
                const b = this.attachment(peer);
                if (names.includes(b?.name) && this.live(b) && this.mutual(a, b)) this.send(peer, {
                    type: 'query', name: a.name, uuid: a.uuid, id: message.id });
            }
        } else if (message.type === 'reply' && ID_RE.test(message.id) && uuidKey(message.to)) {
            const data = observation(message.observation);
            const nickname = message.nickname == null ? null : nicknameState(message.nickname);
            if (!data || (message.nickname != null && !nickname)
                || (nickname?.nick && nameKey(nickname.nick) === a.name)
                || (a.observation && data.seq <= a.observation.seq)) { this.remove(ws); return; }
            a.observation = data; a.nickname = nickname; this.save(ws, a);
            for (const peer of this.sockets()) {
                const b = this.attachment(peer);
                if (this.live(b) && b.uuid === uuidKey(message.to) && b.probeId === message.id
                    && b.probeNames?.includes(a.name) && this.mutual(a, b)) {
                    this.send(peer, { type: 'peer', id: message.id, name: a.name, uuid: a.uuid, observation: data,
                        ...(b.nickname ? { nickname } : {}) });
                }
            }
        } else if (message.type === 'nick_saved' && ID_RE.test(message.id) && uuidKey(message.to)) {
            for (const peer of this.sockets()) {
                const b = this.attachment(peer);
                if (this.live(b) && b.uuid === uuidKey(message.to) && this.mutual(a, b)
                    && a.nickname?.receive && b.nickname?.nick && b.nickname.id === message.id
                    && a.nickname.serverId === b.nickname.serverId && a.nickname.mode === b.nickname.mode) {
                    this.send(peer, { type: 'nick_saved', id: message.id, name: a.name, uuid: a.uuid });
                }
            }
        } else { this.remove(ws); }
    }
    webSocketClose(ws) { this.remove(ws); }
    webSocketError(ws) { this.remove(ws); }
}
