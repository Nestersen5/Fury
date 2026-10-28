'use strict';

// Shared by the proxy and the relay. Keep the wire projection small and explicit.
const VERSION = 1;
const MAX_MEMBERS = 100;
const MAX_MESSAGE_BYTES = 8192;
const SETTLE_MS = 1500;
const DISCOVERY_MS = 2500;
const HEARTBEAT_MS = 10000;
const LEASE_MS = 15000;
const DEFAULT_RELAY_URL = 'wss://furyproxy.online/party/connect';
const nameKey = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(value)
    ? value.toLowerCase() : null;
const uuidKey = value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value.replace(/-/g, ''))
    ? value.replace(/-/g, '').toLowerCase() : null;
function networkKey(host, port) {
    const clean = String(host).toLowerCase().replace(/\.$/, '');
    // Production Direct and Failover are two entry points to the same network.
    const network = ['mc.hypixel.net', 'hypixel.net', 'hypixel.fast'].includes(clean) ? 'hypixel' : clean;
    return `${network}:${port}`;
}
function rosterKeys(value) {
    if (!Array.isArray(value) || value.length > MAX_MEMBERS) return null;
    const keys = value.map(nameKey);
    return keys.some(key => !key) ? null : [...new Set(keys)].sort();
}
function observation(value) {
    if (!value || !['pregame', 'other', 'transfer'].includes(value.phase)
        || !Number.isSafeInteger(value.seq) || value.seq < 1
        || typeof value.generation !== 'string' || !/^[A-Za-z0-9:._-]{1,80}$/.test(value.generation)
        || !Number.isFinite(value.stableMs) || value.stableMs < 0 || value.stableMs > LEASE_MS) return null;
    const serverId = value.phase === 'pregame' && typeof value.serverId === 'string'
        && /^[A-Za-z0-9]{2,16}$/.test(value.serverId) && /\d/.test(value.serverId) && /[A-Za-z]/.test(value.serverId)
        ? value.serverId : null;
    return { phase: value.phase, serverId, generation: value.generation, seq: value.seq,
        stableMs: Math.floor(value.stableMs) };
}
// Optional v1 extension. Claims identify only the sender's own current nickname.
function nicknameState(value) {
    if (!value || typeof value.receive !== 'boolean'
        || typeof value.serverId !== 'string' || !/^[A-Za-z0-9]{2,16}$/.test(value.serverId)
        || typeof value.mode !== 'string' || !/^[A-Z0-9_]{1,32}$/.test(value.mode)) return null;
    if (value.nick !== null && (!nameKey(value.nick) || !/^[a-f0-9]{24}$/.test(value.id))) return null;
    return { nick: value.nick, id: value.nick === null ? null : value.id,
        serverId: value.serverId, mode: value.mode, receive: value.receive };
}
function relayUrl(env = process.env) {
    const value = env.FURY_PARTY_RELAY_URL === undefined ? DEFAULT_RELAY_URL : env.FURY_PARTY_RELAY_URL;
    try {
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash) return null;
        if (url.protocol !== 'wss:' && !(url.protocol === 'ws:'
            && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) return null;
        return url;
    } catch { return null; }
}
module.exports = { VERSION, MAX_MEMBERS, MAX_MESSAGE_BYTES, SETTLE_MS, DISCOVERY_MS,
    HEARTBEAT_MS, LEASE_MS, DEFAULT_RELAY_URL, nameKey, uuidKey, networkKey, rosterKeys, observation, nicknameState, relayUrl };
