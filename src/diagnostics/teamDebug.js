'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const TEAM_MODES = { create: 0, remove: 1, update: 2, add_players: 3, remove_players: 4 };
const TAB_ACTIONS = { add_player: 0, update_game_mode: 1, update_latency: 2, update_display_name: 3, remove_player: 4 };
const PACKETS = new Set(['scoreboard_team', 'player_info', 'scoreboard_objective', 'scoreboard_display_objective', 'scoreboard_score', 'login', 'respawn']);
const text = (value, length = 256) => String(value ?? '').slice(0, length);
const display = value => value == null ? null : text(typeof value === 'string' ? value : JSON.stringify(value), 2048);

// Explicit allowlist: no chat, authentication, skin properties, API data, or packet buffers.
function compactPacket(name, data = {}) {
    if (!PACKETS.has(name)) return null;
    if (name === 'scoreboard_team') {
        const packet = { team: text(data.team, 64), mode: TEAM_MODES[data.mode] ?? data.mode };
        for (const key of ['name', 'displayName', 'prefix', 'suffix', 'nameTagVisibility']) {
            if (data[key] != null) packet[key] = text(data[key]);
        }
        for (const key of ['color', 'friendlyFire']) if (data[key] != null) packet[key] = data[key];
        if (Array.isArray(data.players)) {
            packet.players = data.players.slice(0, 128).map(entry => text(entry, 64));
            if (data.players.length > 128) packet.omittedPlayers = data.players.length - 128;
        }
        return packet;
    }
    if (name === 'player_info') {
        const action = TAB_ACTIONS[data.action] ?? data.action;
        // Latency packets carry no team evidence and can dominate the history.
        if (action !== 0 && action !== 3 && action !== 4) return null;
        return { action, data: (data.data || []).slice(0, 128).map(row => ({
            uuid: text(row.UUID || row.uuid, 64),
            ...(row.name != null ? { name: text(row.name, 64) } : {}),
            ...(action === 0 || action === 3 ? { displayName: display(row.displayName) } : {})
        })) };
    }
    if (name === 'scoreboard_objective') return { name: text(data.name), action: data.action, displayText: display(data.displayText) };
    if (name === 'scoreboard_display_objective') return { name: text(data.name), position: data.position };
    if (name === 'scoreboard_score') return { itemName: text(data.itemName), scoreName: text(data.scoreName), action: data.action, value: data.value };
    return { dimension: data.dimension, gameMode: data.gameMode };
}

// Independent packet view, separate from Fury's normalized/cached team registry.
function createPacketView() {
    const teams = new Map(), entries = new Map(), tab = new Map();
    let evicted = 0;
    const trim = (map, max) => {
        while (map.size > max) { map.delete(map.keys().next().value); evicted += 1; }
    };
    const forgetMembers = team => {
        for (const [entry, owner] of entries) if (owner === team) entries.delete(entry);
    };
    return {
        observe(name, packet) {
            if (name === 'scoreboard_team') {
                const { team, mode, players = [] } = packet;
                if (mode === 0 || mode === 1) forgetMembers(team);
                if (mode === 1) teams.delete(team);
                if (mode === 0 || mode === 2) {
                    const { players: ignored, ...properties } = packet;
                    teams.set(team, { ...(mode === 0 ? {} : teams.get(team)), ...properties });
                }
                if (mode === 0 || mode === 3) for (const entry of players) entries.set(entry, team);
                if (mode === 4) for (const entry of players) if (entries.get(entry) === team) entries.delete(entry);
                trim(teams, 512);
                trim(entries, 2048);
            } else if (name === 'player_info') {
                for (const row of packet.data) {
                    if (!row.uuid) continue;
                    if (packet.action === 4) tab.delete(row.uuid);
                    else tab.set(row.uuid, { ...tab.get(row.uuid), ...row });
                }
                trim(tab, 256);
            }
        },
        snapshot: () => ({ teams: Array.from(teams.values()), entries: Array.from(entries), tab: Array.from(tab.values()), evicted })
    };
}

function createTeamDebugRecorder({ directory, now = Date.now, maxEvents = 4000, maxBytes = 2 * 1024 * 1024, maxAgeMs = 120000 } = {}) {
    const events = [];
    const server = createPacketView(), client = createPacketView();
    let head = 0, bytes = 0, dropped = 0, sequence = 0, saving = false, lastSave = -Infinity;
    const startedAt = now();
    const prune = time => {
        while (head < events.length && (events.length - head > maxEvents || bytes > maxBytes || time - events[head].event.at > maxAgeMs)) {
            bytes -= events[head].bytes;
            events[head++] = null;
            dropped += 1;
        }
        if (head > 1024) { events.splice(0, head); head = 0; }
    };
    const append = event => {
        const item = { sequence: ++sequence, at: now(), ...event };
        const size = Buffer.byteLength(JSON.stringify(item));
        if (size > maxBytes) { dropped += 1; return; }
        events.push({ event: item, bytes: size });
        bytes += size;
        prune(item.at);
    };
    return {
        observe(direction, name, data) {
            if (!PACKETS.has(name)) return;
            try {
                const packet = compactPacket(name, data);
                if (!packet) return;
                (direction === 'server' ? server : client).observe(name, packet);
                append({ direction, name, packet });
            } catch (_) { dropped += 1; }
        },
        mark(name, details = {}) {
            try { append({ direction: 'fury', name, details }); } catch (_) { dropped += 1; }
        },
        snapshot(state = {}, annotation = {}) {
            const capturedAt = now();
            prune(capturedAt);
            return {
                version: 1, capturedAt, connectionStartedAt: startedAt, annotation, state,
                history: { maxAgeMs, maxEvents, maxBytes, dropped, firstEventAt: events[head]?.event.at ?? null, bytes },
                server: server.snapshot(), client: client.snapshot(), events: events.slice(head).map(row => row.event)
            };
        },
        async save(state, annotation) {
            if (saving) throw new Error('A team report is already being saved.');
            if (now() - lastSave < 5000) throw new Error('Wait five seconds before saving another team report.');
            saving = true;
            try {
                // Freeze the report before async I/O while packets continue to arrive.
                const report = this.snapshot(state, annotation);
                const content = JSON.stringify(report, null, 2);
                const filename = `team-debug-${new Date(report.capturedAt).toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`;
                await fs.promises.mkdir(directory, { recursive: true });
                const file = path.join(directory, filename);
                await fs.promises.writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
                lastSave = now();
                return { file, events: report.events.length, capturedAt: report.capturedAt };
            } finally { saving = false; }
        }
    };
}

// Observe every display write, including identity-renaming and restore packets.
// Preserve the method's receiver, arguments, return value, and errors.
function observeClientWrites(client, recorder) {
    const originalWrite = client.write;
    client.write = function (name, data, ...rest) {
        const writable = this.serializer?.writable !== false;
        const result = originalWrite.call(this, name, data, ...rest);
        if (writable) recorder.observe('client', name, data);
        return result;
    };
}

module.exports = { compactPacket, createPacketView, createTeamDebugRecorder, observeClientWrites };
