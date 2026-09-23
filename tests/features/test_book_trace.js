'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const nbt = require('prismarine-nbt');
const { createBookTrace, describeBook, decodeBookPayload } = require('../../src/menu/bookTrace');

const tag = { type: 'compound', name: '', value: {
    title: { type: 'string', value: 'Menu book' }, author: { type: 'string', value: 'Server' },
    pages: { type: 'list', value: { type: 'string', value: [JSON.stringify({ text: 'Menu', extra: [
        { text: 'Open shop', clickEvent: { action: 'run_command', value: '/shop' } },
        { text: 'Next', clickEvent: { action: 'change_page', value: '2' } },
        { text: 'Website', clickEvent: { action: 'open_url', value: 'https://example.com' } }
    ] }), 'Plain second page'] } }
} };
const item = { blockId: 387, itemCount: 1, itemDamage: 0, nbtData: tag };
const header = Buffer.from([1, 131, 1, 0, 0]); // Written book 387, count 1, damage 0.
const payload = Buffer.concat([header, nbt.writeUncompressed(tag)]);
assert.strictEqual(describeBook(item).actions.length, 3);
assert.strictEqual(describeBook(decodeBookPayload(payload)).title, 'Menu book');
assert.throws(() => decodeBookPayload(Buffer.from([1])), /short/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-trace-test-'));
const trace = createBookTrace({ dir, sendChat: () => {} });
try {
    trace.observe('server', 'set_slot', { windowId: 0, slot: 36, item });
    assert.strictEqual(fs.readdirSync(dir).length, 0, 'no recording before opt-in');
    trace.command(['/booktrace', 'start']);
    trace.observe('server', 'custom_payload', { channel: 'MC|BOpen', data: Buffer.alloc(0) });
    // Common virtual-book flow restores the hand immediately after opening.
    trace.observe('server', 'set_slot', { windowId: 0, slot: 36, item: { blockId: -1 } });
    trace.observe('client', 'chat', { message: '/shop' });
    trace.observe('upstream', 'chat', { message: '/shop' }, 'relay-or-proxy-feature');
    trace.observe('client', 'custom_payload', { channel: 'MC|BEdit', data: payload });
    trace.observe('upstream', 'custom_payload', { channel: 'MC|BSign', data: payload });
    trace.observe('server', 'custom_payload', { channel: 'unknown:book', data: Buffer.from([255, 0, 4]) });
    trace.observe('client', 'custom_payload', { channel: 'MC|BEdit', data: Buffer.from([1]) });
    trace.observe('client', 'close_window', { windowId: 0 });
    trace.command(['/booktrace', 'mark', 'closed', 'book']);
    trace.command(['/booktrace', 'stop']);
    const file = fs.readdirSync(dir).find(n => n.endsWith('.jsonl'));
    const events = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map(JSON.parse);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, file.replace('.jsonl', '.summary.json'))));
    assert.strictEqual(summary.books.length, 1, 'deduplicate repeated contents but retain cached book on open');
    assert.strictEqual(summary.openings[0].bookId, summary.books[0].id);
    assert.strictEqual(summary.books[0].pages[1].text, 'Plain second page');
    assert.strictEqual(summary.possibleLinkCommands.length, 2);
    assert.deepStrictEqual(summary.possibleLinkCommands.map(e => e.direction), ['client', 'upstream']);
    assert(events.some(e => e.annotations?.some(a => a.type === 'book-sign-payload')));
    assert(events.some(e => e.annotations?.some(a => a.type === 'decode-error')));
    assert(events.some(e => e.annotations?.some(a => a.type === 'inventory-close')));
    assert(!events.some(e => e.annotations?.some(a => a.type === 'book-close')));
    assert(events.some(e => e.event === 'manual-marker' && e.label === 'closed book'));
    assert.deepStrictEqual(Buffer.from(events.find(e => e.data?.channel === 'unknown:book').data.data.base64, 'base64'), Buffer.from([255, 0, 4]));
    const bytes = fs.statSync(path.join(dir, file)).size;
    trace.observe('server', 'custom_payload', { channel: 'MC|BOpen', data: Buffer.alloc(0) });
    assert.strictEqual(fs.statSync(path.join(dir, file)).size, bytes);
    const bounded = createBookTrace({ dir, sendChat: () => {}, maxBytes: 512 });
    bounded.command(['/booktrace', 'start']);
    bounded.observe('server', 'set_slot', { windowId: 0, slot: 36, item });
    bounded.dispose();
    assert(fs.readdirSync(dir).filter(n => n.endsWith('.summary.json')).some(n => JSON.parse(fs.readFileSync(path.join(dir, n))).reason === 'size limit'));
    console.log('Book trace tests passed');
} finally { trace.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
