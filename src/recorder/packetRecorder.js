'use strict';

// Targeted anticheat packet recorder (/recordcheat).
//
// While at least one session is active, every whitelisted clientbound
// packet is serialized to JSONL for each active session file - full
// scene, not just the labeled player, because aim-assist/blink analysis
// needs victim geometry and fight context. The label ("<player> <cheat>")
// lives in the header line; offline tools slice the labeled player's
// stream out by entity id.
//
// Hot-path guarantees:
// - observe() is a single Set-membership check when no session is active.
// - No synchronous fs calls on the packet path: lines buffer in memory
//   and flush to a write stream on a timer (async, backpressure-buffered).
// - observe()/observeOwn() never throw - a recorder bug must not break
//   packet forwarding.

const fs = require('fs');
const path = require('path');

const DEFAULT_FLUSH_MS = 400;
const DEFAULT_MAX_EVENTS = 400_000;
const MAX_CHAT_LENGTH = 2_000;

const RECORDED_PACKETS = new Set([
    'named_entity_spawn', 'entity_destroy',
    'rel_entity_move', 'entity_move_look', 'entity_look', 'entity_teleport',
    'entity_head_rotation', 'animation', 'entity_metadata', 'entity_status',
    'entity_velocity', 'entity_equipment',
    'block_change', 'multi_block_change', 'explosion',
    'update_time', 'chat', 'player_info',
    'scoreboard_team', 'scoreboard_score', 'scoreboard_display_objective'
]);

const OWN_POSITION_PACKETS = new Set(['position', 'position_look', 'look', 'flying']);

function i64ToNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (Array.isArray(value) && value.length === 2) {
        return Number(value[0]) * 4294967296 + Number(value[1] >>> 0);
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function safeMetadataValue(value) {
    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') return value;
    if (value === null || value === undefined) return null;
    try {
        const json = JSON.stringify(value);
        return json && json.length <= 200 ? value : null;
    } catch (e) {
        return null;
    }
}

function compactMetadata(metadata) {
    if (!Array.isArray(metadata)) return [];
    return metadata.map(entry => ({
        key: entry?.key ?? entry?.index ?? entry?.id ?? null,
        value: safeMetadataValue(entry?.value)
    }));
}

function sanitizeLabel(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
}

function fileTimestamp(epochMs) {
    const d = new Date(epochMs);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function createPacketRecorder(deps = {}) {
    const {
        dir,
        getUuidMappedName = () => null,
        snapshotEntities = () => [],
        now = Date.now,
        flushMs = DEFAULT_FLUSH_MS,
        maxEvents = DEFAULT_MAX_EVENTS,
        createWriteStream = fs.createWriteStream,
        log = () => {}
    } = deps;
    if (!dir) throw new Error('createPacketRecorder requires a dir');

    const sessions = new Map();
    const completions = new Set();
    let stopping = false, failure = null;
    const entityNames = new Map();
    let flushTimer = null;
    let dirEnsured = false;

    // Rolling pre-capture buffer: when enabled, extracted records are kept in
    // memory (no disk writes) so /rc clip can capture the seconds BEFORE the
    // command was typed - cheaters toggle, and you notice after the fact.
    let buffering = false;
    let bufferMs = 60_000;
    const ring = [];

    function evictRing(nowMs) {
        const cutoff = nowMs - bufferMs;
        let drop = 0;
        while (drop < ring.length && ring[drop].t < cutoff) drop += 1;
        if (drop > 0) ring.splice(0, drop);
    }

    function setBuffering(on, seconds) {
        buffering = Boolean(on);
        if (Number.isFinite(Number(seconds)) && Number(seconds) > 0) {
            bufferMs = Math.min(300, Math.max(5, Number(seconds))) * 1000;
        }
        if (!buffering) ring.length = 0;
        return { buffering, bufferSeconds: bufferMs / 1000 };
    }

    function getBufferInfo() {
        return { buffering, bufferSeconds: bufferMs / 1000, bufferedEvents: ring.length };
    }

    function ensureDir() {
        if (dirEnsured) return;
        fs.mkdirSync(dir, { recursive: true });
        dirEnsured = true;
    }

    function startFlushTimer() {
        if (flushTimer) return;
        flushTimer = setInterval(flushNow, flushMs);
        if (typeof flushTimer.unref === 'function') flushTimer.unref();
    }

    function stopFlushTimerIfIdle() {
        if (sessions.size > 0 || !flushTimer) return;
        clearInterval(flushTimer);
        flushTimer = null;
        entityNames.clear();
    }

    function flushSession(session) {
        if (!session.buffer.length || session.closed) return;
        const chunk = session.buffer.join('');
        session.buffer.length = 0;
        try {
            session.stream.write(chunk);
        } catch (e) {
            failure ||= new Error('Recording write failed.');
            session.stream.destroy();
            finishSession(session, 'write-error');
        }
    }

    function flushNow() {
        sessions.forEach(flushSession);
    }

    function writeSessionLine(session, record) {
        if (session.closed) return;
        session.buffer.push(`${JSON.stringify(record)}\n`);
        session.events += 1;
        if (session.events >= session.maxEvents) {
            finishSession(session, 'event-cap');
        }
    }

    function writeLine(record) {
        sessions.forEach(session => writeSessionLine(session, record));
    }

    function finishSession(session, reason = 'stopped') {
        if (session.closed || session.finishing) return;
        session.finishing = true;
        session.buffer.push(`${JSON.stringify({
            k: 'footer',
            t: now(),
            reason,
            events: session.events
        })}\n`);
        flushSession(session);
        session.closed = true;
        try {
            session.stream.end();
        } catch (e) { failure ||= new Error('Recording could not finish.'); session.stream.destroy(); }
        sessions.delete(session.key);
        log(`[RECORDER] Stopped ${session.player} (${reason}) - ${session.events} events -> ${session.file}`);
        stopFlushTimerIfIdle();
    }

    function rememberSpawn(data) {
        const uuid = data?.playerUUID || data?.UUID || data?.uuid || null;
        const mapped = uuid ? getUuidMappedName(uuid) : null;
        const id = Number(data?.entityId);
        if (Number.isFinite(id) && mapped) entityNames.set(id, mapped);
        return { uuid, name: mapped || null };
    }

    function extract(name, data) {
        switch (name) {
            case 'named_entity_spawn': {
                const { uuid, name: playerName } = rememberSpawn(data);
                return {
                    k: 'spawn', id: data.entityId, name: playerName, uuid,
                    x: data.x, y: data.y, z: data.z, yaw: data.yaw, pitch: data.pitch
                };
            }
            case 'entity_destroy': {
                const ids = (data.entityIds || []).map(Number).filter(Number.isFinite);
                ids.forEach(id => entityNames.delete(id));
                return { k: 'destroy', ids };
            }
            case 'rel_entity_move':
                return { k: 'mv', id: data.entityId, dx: data.dX, dy: data.dY, dz: data.dZ, g: data.onGround };
            case 'entity_move_look':
                return {
                    k: 'mvl', id: data.entityId, dx: data.dX, dy: data.dY, dz: data.dZ,
                    yaw: data.yaw, pitch: data.pitch, g: data.onGround
                };
            case 'entity_look':
                return { k: 'look', id: data.entityId, yaw: data.yaw, pitch: data.pitch, g: data.onGround };
            case 'entity_teleport':
                return {
                    k: 'tp', id: data.entityId, x: data.x, y: data.y, z: data.z,
                    yaw: data.yaw, pitch: data.pitch, g: data.onGround
                };
            case 'entity_head_rotation':
                return { k: 'head', id: data.entityId, yaw: data.headYaw };
            case 'animation':
                return { k: 'anim', id: data.entityId, a: data.animation };
            case 'entity_metadata':
                return { k: 'meta', id: data.entityId, m: compactMetadata(data.metadata) };
            case 'entity_status':
                return { k: 'st', id: data.entityId, s: data.entityStatus };
            case 'entity_velocity':
                return { k: 'vel', id: data.entityId, vx: data.velocityX, vy: data.velocityY, vz: data.velocityZ };
            case 'entity_equipment':
                return {
                    k: 'eq', id: data.entityId, slot: data.slot,
                    item: data.item ? (data.item.blockId ?? data.item.itemId ?? null) : null
                };
            case 'block_change':
                return {
                    k: 'blk',
                    x: data.location?.x, y: data.location?.y, z: data.location?.z,
                    b: data.type
                };
            case 'multi_block_change': {
                const records = Array.isArray(data.records) ? data.records : [];
                return {
                    k: 'mblk', cx: data.chunkX, cz: data.chunkZ,
                    r: records.map(rec => ({
                        p: rec.horizontalPos ?? rec.horizontalPosition,
                        y: rec.y,
                        b: rec.blockId
                    }))
                };
            }
            case 'explosion': {
                const affected = Array.isArray(data.affectedBlockOffsets) ? data.affectedBlockOffsets : [];
                return {
                    k: 'boom', x: data.x, y: data.y, z: data.z, r: data.radius,
                    blocks: affected.map(off => ({ x: off?.x, y: off?.y, z: off?.z }))
                };
            }
            case 'update_time':
                return { k: 'time', age: i64ToNumber(data.age), tod: i64ToNumber(data.time) };
            case 'chat':
                return { k: 'chat', pos: data.position, msg: String(data.message ?? '').slice(0, MAX_CHAT_LENGTH) };
            case 'player_info': {
                const rows = Array.isArray(data.data) ? data.data : [];
                // Tab-list adds carry uuid<->name pairs - the offline tools use
                // them to name entities whose spawn uuid the live map missed
                // (replay NPCs especially).
                const named = rows
                    .filter(entry => entry?.name)
                    .map(entry => ({ uuid: entry.UUID || entry.uuid || null, name: entry.name }));
                const pings = rows
                    .filter(entry => Number.isFinite(Number(entry?.ping)))
                    .map(entry => ({
                        uuid: entry.UUID || entry.uuid || null,
                        name: entry.name || null,
                        ping: Number(entry.ping)
                    }));
                // Nameless, pingless rows are usually remove_player (uuid only);
                // party-arrival analysis needs those and the action id.
                const uuids = rows
                    .filter(entry => !entry?.name && !Number.isFinite(Number(entry?.ping)))
                    .map(entry => entry?.UUID || entry?.uuid || null)
                    .filter(Boolean);
                if (!named.length && !pings.length && !uuids.length) return null;
                const record = { k: 'tab', a: data.action };
                if (named.length) record.named = named;
                if (pings.length) record.pings = pings;
                if (uuids.length) record.uuids = uuids;
                return record;
            }
            case 'scoreboard_team': {
                // Team membership at game start is the ground-truth label for
                // party detection: Hypixel seats parties on the same team.
                const players = Array.isArray(data.players) ? data.players : [];
                const record = { k: 'team', team: data.team, mode: data.mode };
                if (players.length) record.players = players;
                if (data.prefix != null) record.prefix = String(data.prefix).slice(0, 48);
                if (data.suffix != null) record.suffix = String(data.suffix).slice(0, 48);
                return record;
            }
            case 'scoreboard_score':
                return {
                    k: 'score',
                    item: String(data.itemName ?? '').slice(0, 80),
                    action: data.action,
                    objective: String(data.scoreName ?? '').slice(0, 48),
                    value: data.value
                };
            case 'scoreboard_display_objective':
                return { k: 'display', position: data.position, objective: String(data.name ?? '').slice(0, 48) };
            default:
                return null;
        }
    }

    function commitRecord(record) {
        record.t = now();
        if (sessions.size > 0) writeLine(record);
        if (buffering) {
            ring.push(record);
            evictRing(record.t);
        }
    }

    function observe(data, meta) {
        if (sessions.size === 0 && !buffering) return;
        try {
            const name = meta?.name;
            if (!RECORDED_PACKETS.has(name)) return;
            const record = extract(name, data || {});
            if (!record) return;
            commitRecord(record);
        } catch (e) {
            // Recording must never break packet forwarding.
        }
    }

    function observeOwn(data, meta) {
        if (sessions.size === 0 && !buffering) return;
        try {
            if (!OWN_POSITION_PACKETS.has(meta?.name)) return;
            const record = { k: 'own' };
            if (Number.isFinite(Number(data?.x))) {
                record.x = data.x;
                record.y = data.y;
                record.z = data.z;
            }
            if (Number.isFinite(Number(data?.yaw))) {
                record.yaw = data.yaw;
                record.pitch = data.pitch;
            }
            if (typeof data?.onGround === 'boolean') record.g = data.onGround;
            if (record.x === undefined && record.yaw === undefined && record.g === undefined) return;
            commitRecord(record);
        } catch (e) {}
    }

    function mark(note = '') {
        if (sessions.size === 0) return { ok: false, reason: 'not-recording' };
        writeLine({ k: 'mark', t: now(), note: String(note || '').slice(0, 200) });
        flushNow();
        return { ok: true, sessions: sessions.size };
    }

    function clip(opts = {}) {
        if (!buffering) return { ok: false, reason: 'buffer-off' };
        const result = start(opts);
        if (!result.ok) return result;
        const session = sessions.get(result.player.toLowerCase());
        const buffered = ring.length;
        // Ring records keep their original timestamps, so the clip file
        // contains pre-command history followed by the live stream.
        ring.forEach(record => writeSessionLine(session, record));
        if (!session.closed) {
            writeSessionLine(session, { k: 'clipstart', t: now(), buffered });
        }
        flushNow();
        return { ...result, buffered };
    }

    function start({ player, label, source = 'live', meta = {} } = {}) {
        if (stopping) return { ok: false, reason: 'shutting-down' };
        const cleanPlayer = String(player || '').trim();
        if (!/^[A-Za-z0-9_]{1,16}$/.test(cleanPlayer)) {
            return { ok: false, reason: 'invalid-player' };
        }
        const cleanLabel = sanitizeLabel(label);
        if (!cleanLabel) return { ok: false, reason: 'invalid-label' };
        const key = cleanPlayer.toLowerCase();
        if (sessions.has(key)) return { ok: false, reason: 'already-recording' };

        let stream;
        let file;
        try {
            ensureDir();
            const suffix = source === 'replay' ? '_replay' : '';
            file = path.join(dir, `${fileTimestamp(now())}_${cleanPlayer}_${cleanLabel}${suffix}.jsonl`);
            stream = createWriteStream(file, { flags: 'a' });
        } catch (e) {
            return { ok: false, reason: `open-failed: ${e.message}` };
        }

        const session = {
            key,
            player: cleanPlayer,
            label: cleanLabel,
            source,
            file,
            stream,
            buffer: [],
            events: 0,
            maxEvents,
            startedAt: now(),
            closed: false
        };
        let finished = false;
        const completion = new Promise(resolve => {
            stream.on('finish', () => { finished = true; });
            stream.on('close', () => {
                if (!finished) failure ||= new Error('Recording closed before completion.');
                resolve();
            });
            stream.on('error', () => {
                failure ||= new Error('Recording write failed.');
                finishSession(session, 'stream-error');
            });
        });
        completions.add(completion);
        completion.then(() => completions.delete(completion));
        sessions.set(key, session);

        writeSessionLine(session, {
            k: 'header', v: 1, t: session.startedAt,
            player: cleanPlayer, label: cleanLabel, source, ...meta
        });
        let snapshot = [];
        try {
            snapshot = snapshotEntities() || [];
        } catch (e) {}
        snapshot.forEach(row => {
            const id = Number(row?.entityId);
            if (!Number.isFinite(id)) return;
            if (row.name) entityNames.set(id, row.name);
            writeSessionLine(session, {
                k: 'snap', t: session.startedAt, id,
                name: row.name || null, x: row.x, y: row.y, z: row.z
            });
        });

        startFlushTimer();
        log(`[RECORDER] Recording ${cleanPlayer} (${cleanLabel}, ${source}) -> ${file}`);
        return { ok: true, file, player: cleanPlayer, label: cleanLabel };
    }

    function stop(player, reason = 'manual') {
        const key = String(player || '').trim().toLowerCase();
        const session = sessions.get(key);
        if (!session) return { ok: false, reason: 'not-recording' };
        const summary = {
            ok: true,
            player: session.player,
            label: session.label,
            file: session.file,
            events: session.events,
            durationMs: now() - session.startedAt
        };
        finishSession(session, reason);
        return summary;
    }

    function stopAll(reason = 'stop-all') {
        const summaries = [];
        Array.from(sessions.values()).forEach(session => {
            summaries.push({
                player: session.player,
                label: session.label,
                file: session.file,
                events: session.events
            });
            finishSession(session, reason);
        });
        return summaries;
    }

    function status() {
        return Array.from(sessions.values()).map(session => ({
            player: session.player,
            label: session.label,
            source: session.source,
            file: session.file,
            events: session.events,
            startedAt: session.startedAt
        }));
    }

    return {
        async drain() {
            stopping = true;
            setBuffering(false);
            stopAll('shutdown');
            await Promise.all([...completions]);
            if (failure) throw failure;
        },
        start,
        stop,
        stopAll,
        status,
        observe,
        observeOwn,
        mark,
        clip,
        setBuffering,
        getBufferInfo,
        flushNow,
        isActive: () => sessions.size > 0,
        RECORDED_PACKETS
    };
}

module.exports = { createPacketRecorder, RECORDED_PACKETS };
