'use strict';

const fs = require('fs');
const path = require('path');
const { decodeTitle } = require('./menuMonitor');
const { quickBuyMessage } = require('./quickBuyMessages');

const SERVER_PACKETS = new Set(['open_window', 'window_items', 'set_slot', 'close_window', 'transaction',
    'craft_progress_bar', 'custom_payload', 'chat', 'tab_complete', 'open_sign_entity', 'update_sign', 'respawn', 'login', 'position']);
const CLIENT_NOISE = new Set(['keep_alive', 'flying', 'position', 'position_look', 'look']);

function encode(value, depth = 0) {
    if (Buffer.isBuffer(value)) {
        const part = value.subarray(0, 65536);
        return { encoding: 'base64', bytes: value.length, truncated: part.length !== value.length,
            base64: part.toString('base64'), utf8: part.toString('utf8'), hex: part.toString('hex') };
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value.length > 65536 ? { text: value.slice(0, 65536), truncated: true } : value;
    if (value == null || typeof value !== 'object') return value;
    if (depth >= 20) return { truncated: true, reason: 'depth' };
    if (Array.isArray(value)) return value.length > 4096
        ? { values: value.slice(0, 4096).map(v => encode(v, depth + 1)), truncated: true }
        : value.map(v => encode(v, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v, depth + 1)]));
}

function createQuickBuyTrace({ dir, sendChat, now = Date.now, durationMs = 180000, maxBytes = 16 * 1024 * 1024 }) {
    let capture = null;
    let lastFile = null;
    let timer = null;
    let menu = null;
    const say = (text, tone) => sendChat(quickBuyMessage(text, tone));

    function append(event) {
        const line = JSON.stringify({ t: now(), seq: ++capture.seq, ...event }) + '\n';
        if (capture.bytes + Buffer.byteLength(line) > maxBytes) { stop('size limit'); return false; }
        fs.appendFileSync(capture.file, line);
        capture.bytes += Buffer.byteLength(line);
        return true;
    }

    function stop(reason = 'manual', notify = true) {
        if (!capture) return;
        clearTimeout(timer);
        timer = null;
        const saved = capture;
        capture = null;
        const summary = { reason, elapsedMs: now() - saved.started, events: saved.seq, bytes: saved.bytes,
            commandsSent: [...saved.commands], payloadChannels: [...saved.channels], menuOpenings: saved.openings,
            note: 'Nearby packets are timing correlations, not proof of causation. Server-internal commands are not observable.' };
        try {
            fs.writeFileSync(saved.file.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(summary, null, 2) + '\n');
            if (notify) say(`Trace saved: §f${path.basename(saved.file)} §8· ${saved.openings.length} menus`, 'success');
        } catch (error) { if (notify) say(`Summary save failed: ${error.message}`, 'error'); }
    }

    function observe(direction, name, data, origin = null) {
        // Keep title context current even before recording starts.
        if (direction === 'server' && name === 'open_window') menu = { id: data.windowId, title: decodeTitle(data.windowTitle) };
        if (direction === 'server' && name === 'close_window' && menu?.id === data.windowId) menu = null;
        if (direction === 'server' && (name === 'respawn' || name === 'login')) menu = null;
        if (!capture || (direction === 'server' ? !SERVER_PACKETS.has(name) : CLIENT_NOISE.has(name))) return;
        try {
            const at = now();
            let encoded = encode(data);
            if (Buffer.byteLength(JSON.stringify(encoded)) > 256 * 1024) {
                encoded = { truncated: true, reason: 'packet size', preview: JSON.stringify(encoded).slice(0, 8192) };
            }
            const event = { direction, origin, packet: name, menu: menu ? { ...menu } : null, data: encoded };
            if (!append(event)) return;
            if (name === 'custom_payload') capture.channels.add(`${direction}: ${String(data.channel || data.channelName || 'unknown')}`);
            if (direction === 'upstream') {
                if (name === 'chat' && typeof data.message === 'string' && data.message.startsWith('/')) capture.commands.add(data.message);
                capture.recent.push({ seq: capture.seq, t: at, packet: name, origin,
                    command: name === 'chat' ? data.message : undefined,
                    channel: name === 'custom_payload' ? data.channel : undefined,
                    slot: data.slot, windowId: data.windowId });
                capture.recent = capture.recent.filter(e => at - e.t <= 2000).slice(-12);
            }
            if (direction === 'server' && name === 'open_window') {
                capture.openings.push({ seq: capture.seq, t: at, ...menu,
                    nearbyOutbound: capture.recent.filter(e => at - e.t <= 2000) });
            }
        } catch (error) {
            stop(`write/encoding error: ${error.message}`);
        }
    }

    function command(args) {
        const sub = String(args[2] || 'status').toLowerCase();
        if (sub === 'stop' || sub === 'off') { stop(); return; }
        if (sub === 'start' || sub === 'on') {
            if (capture) { say('Already recording. §f/quickbuy trace stop', 'warning'); return; }
            try {
                fs.mkdirSync(dir, { recursive: true });
                const file = path.join(dir, `quickbuy-trace-${now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
                fs.writeFileSync(file, '', { flag: 'wx' });
                capture = { file, started: now(), bytes: 0, seq: 0, commands: new Set(), channels: new Set(), recent: [], openings: [] };
                lastFile = file;
                append({ event: 'start', durationMs, maxBytes, directions: {
                    client: 'received from your client; may be intercepted by proxy',
                    upstream: 'actually submitted to the server connection', server: 'received from server' } });
                timer = setTimeout(() => stop('time limit'), durationMs);
                timer.unref?.();
                say('Trace on for 3 minutes. Open menus and edit normally.');
                say('Finish: §f/quickbuy trace stop §8· §7Path: §f/quickbuy trace status');
            } catch (error) { capture = null; say(`Couldn’t start trace: ${error.message}`, 'error'); }
            return;
        }
        if (sub === 'mark') {
            if (!capture) { say('Start with §f/quickbuy trace start', 'warning'); return; }
            try { append({ event: 'mark', label: args.slice(3).join(' ').slice(0, 200) || 'manual marker' }); }
            catch (error) { stop(error.message); }
            return;
        }
        say(`Trace: ${capture ? '§aon' : '§7off'}. §7Use §f/quickbuy trace start|stop`);
        if (lastFile) say(`Log: §f${lastFile}`);
    }

    return { command, observe, dispose: () => stop('disconnect', false) };
}

module.exports = { createQuickBuyTrace, encode };
