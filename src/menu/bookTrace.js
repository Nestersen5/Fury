'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nbt = require('prismarine-nbt');
const { simplifyNbt, decodeTitle } = require('./menuMonitor');
const { encode } = require('./quickBuyTrace');

const PACKETS = new Set(['custom_payload', 'open_window', 'close_window', 'window_click', 'window_items',
    'set_slot', 'set_creative_slot', 'held_item_slot', 'block_place', 'use_entity', 'chat', 'tab_complete',
    'transaction', 'respawn', 'login']);
const BOOK_IDS = new Set([386, 387]); // Installed Minecraft 1.8.9 item/protocol data.

function describeBook(item) {
    if (!item || !BOOK_IDS.has(item.blockId)) return null;
    const data = simplifyNbt(item.nbtData) || {};
    const source = Array.isArray(data.pages) ? data.pages : [];
    const actions = [];
    const pages = source.slice(0, 128).map((value, index) => {
        const original = typeof value === 'string' ? value : JSON.stringify(value);
        const raw = original.slice(0, 16384);
        let component;
        try { component = JSON.parse(raw); } catch { component = raw; }
        function walk(node, depth = 0) {
            if (depth > 20 || node == null) return '';
            if (typeof node === 'string') return node;
            if (Array.isArray(node)) return node.map(v => walk(v, depth + 1)).join('');
            if (typeof node !== 'object') return '';
            if (node.clickEvent && typeof node.clickEvent.action === 'string') {
                actions.push({ page: index + 1, action: node.clickEvent.action, value: node.clickEvent.value });
            }
            return String(node.text || node.translate || '') + (node.extra ? walk(node.extra, depth + 1) : '');
        }
        return { page: index + 1, raw, text: walk(component), truncated: raw.length !== original.length };
    });
    const book = { itemId: item.blockId, title: data.title || null, author: data.author || null,
        generation: data.generation, pageCount: source.length, pages, actions,
        truncated: source.length > pages.length || pages.some(p => p.truncated) };
    return { id: crypto.createHash('sha256').update(JSON.stringify(book)).digest('hex').slice(0, 20), ...book };
}

function decodeBookPayload(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 5) throw new Error('Missing or short slot payload');
    if (buffer.length > 65536) throw new Error('Book payload exceeds the 64 KiB decode limit');
    const blockId = buffer.readInt16BE(0);
    if (!BOOK_IDS.has(blockId)) throw new Error('Payload does not contain a 1.8 book item');
    return { blockId, itemCount: buffer.readInt8(2), itemDamage: buffer.readInt16BE(3),
        nbtData: buffer[5] ? nbt.parseUncompressed(buffer.subarray(5)) : null };
}

function createBookTrace({ dir, sendChat, now = Date.now, durationMs = 180000, maxBytes = 16 * 1024 * 1024 }) {
    let recording = null, timer = null, lastFile = null;
    let selected = 0;
    let recentOpen = null;
    const inventory = new Map();
    const windows = new Map();
    const say = (text, color = '§7') => sendChat(`§b§lBook Trace §8» ${color}${text}`);

    function stop(reason = 'manual', notify = true) {
        if (!recording) return;
        clearTimeout(timer);
        timer = null;
        const saved = recording;
        recording = null;
        try {
            fs.writeFileSync(saved.file.replace(/\.jsonl$/, '.summary.json'), JSON.stringify({
                reason, durationMs: now() - saved.started, packets: saved.seq, bytes: saved.bytes,
                books: [...saved.books.values()], openings: saved.openings, channels: [...saved.channels],
                possibleLinkCommands: saved.commands,
                limitations: 'Page turns and closing a normal book are client-local in vanilla 1.8.9. Inventory close_window is not proof a book closed. Matching commands may also have been typed. No actions are replayed.'
            }, null, 2) + '\n');
            if (notify) say(`Saved §f${path.basename(saved.file)} §8· ${saved.books.size} book versions`, '§a');
        } catch (error) { if (notify) say(`Summary failed: ${error.message}`, '§c'); }
    }

    function append(event) {
        if (!recording) return false;
        const line = JSON.stringify({ seq: recording.seq + 1, t: now(), ...event }) + '\n';
        if (recording.bytes + Buffer.byteLength(line) > maxBytes) { stop('size limit'); return false; }
        fs.appendFileSync(recording.file, line);
        recording.seq++;
        recording.bytes += Buffer.byteLength(line);
        return true;
    }

    function rememberBook(item, source, event) {
        const book = describeBook(item);
        if (!book) return null;
        if (recording) {
            if (!recording.books.has(book.id)) {
                if (!append({ event: 'book-content', source, book })) return book;
                recording.books.set(book.id, book);
            }
            event?.books.push({ id: book.id, source });
        }
        return book;
    }

    function observe(direction, name, data, origin = null) {
        if (!PACKETS.has(name)) return;
        try {
            // Warm inventory state lets a capture associate MC|BOpen even if
            // the book was received before /booktrace start.
            if (direction === 'server' && ['respawn', 'login'].includes(name)) {
                inventory.clear(); windows.clear(); recentOpen = null; selected = 0;
            }
            if (name === 'held_item_slot') {
                if (direction === 'upstream') selected = data.slotId;
                if (direction === 'server') selected = data.slot;
            }
            if (direction === 'server' && name === 'open_window') windows.set(data.windowId, data.slotCount);
            if (direction === 'server' && name === 'close_window') windows.delete(data.windowId);
            const event = { event: 'packet', direction, origin, packet: name, books: [], annotations: [] };
            const slotItem = (item, slot) => {
                if (direction === 'server') {
                    let playerSlot = data.windowId === 0 ? slot : null;
                    const size = windows.get(data.windowId);
                    if (size != null && slot >= size && slot < size + 36) playerSlot = 9 + slot - size;
                    if (playerSlot !== null) {
                        if (BOOK_IDS.has(item?.blockId)) inventory.set(playerSlot, item);
                        else inventory.delete(playerSlot);
                    }
                }
                if (recording) rememberBook(item, { packet: name, windowId: data.windowId, slot }, event);
            };
            if (name === 'window_items' && Array.isArray(data.items)) data.items.forEach(slotItem);
            if (['set_slot', 'window_click', 'set_creative_slot'].includes(name)) slotItem(data.item, data.slot);
            if (!recording) return;

            if (name === 'custom_payload') {
                const channel = String(data.channel || data.channelName || 'unknown');
                recording.channels.add(`${direction}: ${channel}`);
                if (channel === 'MC|BOpen' && direction === 'server') {
                    const book = rememberBook(inventory.get(36 + selected), 'held item at open request', event);
                    if (!recording) return;
                    recentOpen = { t: now(), bookId: book?.id || null, evidence: 'MC|BOpen', direction };
                    event.annotations.push({ type: 'server-book-open-request', ...recentOpen });
                    recording.openings.push(recentOpen);
                }
                if (channel === 'MC|BEdit' || channel === 'MC|BSign') {
                    event.annotations.push({ type: channel === 'MC|BEdit' ? 'book-edit-payload' : 'book-sign-payload' });
                    try { rememberBook(decodeBookPayload(data.data), channel, event); }
                    catch (error) { event.annotations.push({ type: 'decode-error', reason: error.message }); }
                }
            }
            if (!recording) return;
            if (name === 'block_place' && BOOK_IDS.has(data.heldItem?.blockId)) {
                const book = rememberBook(data.heldItem, 'used book item', event);
                if (!recording) return;
                event.annotations.push({ type: 'book-use-request', bookId: book.id });
                if (direction === 'upstream') {
                    recentOpen = { t: now(), bookId: book.id, evidence: 'book-use (opening not confirmed)', direction };
                    recording.openings.push(recentOpen);
                }
            }
            if (name === 'close_window') event.annotations.push({ type: 'inventory-close', note: 'Not a book-close event' });
            if (name === 'open_window') event.annotations.push({ type: 'inventory-open', title: decodeTitle(data.windowTitle) });
            if (name === 'chat' && direction !== 'server' && typeof data.message === 'string') {
                const candidates = [...recording.books.values()].flatMap(book => book.actions
                    .filter(action => action.action === 'run_command' && action.value === data.message)
                    .map(action => ({ bookId: book.id, page: action.page })));
                if (candidates.length) {
                    const match = { t: now(), direction, command: data.message, candidates,
                        note: 'Possible book link click; typed commands are indistinguishable' };
                    recording.commands.push(match);
                    event.annotations.push({ type: 'possible-book-command', ...match });
                }
            }
            event.recentBook = recentOpen;
            event.data = encode(data);
            if (Buffer.byteLength(JSON.stringify(event.data)) > 256 * 1024) {
                event.data = { truncated: true, reason: '256 KiB packet limit', preview: JSON.stringify(event.data).slice(0, 8192) };
            }
            append(event);
        } catch (error) { if (recording) stop(`capture error: ${error.message}`); }
    }

    function command(args) {
        const sub = String(args[1] || 'status').toLowerCase();
        if (sub === 'stop' || sub === 'off') { stop(); return; }
        if (sub === 'start' || sub === 'on') {
            if (recording) { say('Already recording. §f/booktrace stop', '§e'); return; }
            try {
                fs.mkdirSync(dir, { recursive: true });
                const file = path.join(dir, `book-trace-${now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
                fs.writeFileSync(file, '', { flag: 'wx' });
                recording = { file, started: now(), seq: 0, bytes: 0, books: new Map(), openings: [], channels: new Set(), commands: [] };
                lastFile = file;
                append({ event: 'start', durationMs, maxBytes, note: 'Passive capture. Local page turns and book closes may send no packet.' });
                for (const [slot, item] of inventory) rememberBook(item, { cachedPlayerSlot: slot });
                if (!recording) return;
                timer = setTimeout(() => stop('time limit'), durationMs);
                timer.unref?.();
                say('Recording for 3 minutes. Open a book and try its links.');
                say('Finish: §f/booktrace stop §8· §7Path: §f/booktrace status');
            } catch (error) { stop('start error', false); say(`Couldn’t start: ${error.message}`, '§c'); }
            return;
        }
        if (sub === 'mark') {
            if (!recording) { say('Use §f/booktrace start §efirst.', '§e'); return; }
            try { append({ event: 'manual-marker', label: args.slice(2).join(' ').slice(0, 200) || 'marker' }); }
            catch (error) { stop(error.message); }
            return;
        }
        say(`Trace: ${recording ? '§aon' : '§7off'} §8· §f/booktrace start|stop|mark <label>`);
        if (lastFile) say(`Log: §f${lastFile}`);
    }
    return { command, observe, dispose: () => stop('disconnect', false) };
}

module.exports = { createBookTrace, describeBook, decodeBookPayload };
