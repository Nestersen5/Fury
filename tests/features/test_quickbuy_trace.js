'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createQuickBuyTrace } = require('../../src/menu/quickBuyTrace');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickbuy-trace-test-'));
let now = 1000;
const messages = [];
const trace = createQuickBuyTrace({ dir, sendChat: m => messages.push(m), now: () => now });
try {
    trace.observe('client', 'chat', { message: '/not-recorded' });
    assert.strictEqual(fs.readdirSync(dir).length, 0);
    trace.command(['/quickbuy', 'trace', 'start']);
    trace.observe('client', 'chat', { message: '/settings' });
    trace.observe('upstream', 'chat', { message: '/settings' }, 'relay-or-proxy-feature');
    const binary = Buffer.from([0, 255, 1, 120]);
    trace.observe('client', 'custom_payload', { channel: 'test:menu', data: binary });
    trace.observe('upstream', 'custom_payload', { channel: 'test:menu', data: binary }, 'relay-or-proxy-feature');
    now += 150;
    trace.observe('server', 'open_window', { windowId: 2, windowTitle: '{"text":"Edit Quick Buy"}', slotCount: 54 });
    trace.observe('upstream', 'window_click', { windowId: 2, slot: 10, mouseButton: 0, action: 1 }, 'quickbuy-automation');
    trace.observe('server', 'custom_payload', { channel: 'reply', data: Buffer.from('hello') });
    trace.observe('server', 'chat', { message: JSON.stringify({ text: 'open', clickEvent: { action: 'run_command', value: '/candidate' } }) });
    trace.observe('client', 'chat', { message: '/quickbuy list' }); // Intercepted locally: no upstream event.
    trace.observe('client', 'position', { x: 1 });
    trace.observe('server', 'position', { x: 100, y: 70, z: 200, yaw: 0, pitch: 0, flags: 0 });
    trace.observe('server', 'entity_move', { entityId: 42 });
    trace.command(['/quickbuy', 'trace', 'mark', 'changed', 'wool']);
    trace.command(['/quickbuy', 'trace', 'stop']);
    const file = fs.readdirSync(dir).find(n => n.endsWith('.jsonl'));
    const events = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map(JSON.parse);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, file.replace('.jsonl', '.summary.json'))));
    assert.deepStrictEqual(summary.commandsSent, ['/settings']);
    assert.deepStrictEqual(Buffer.from(events.find(e => e.packet === 'custom_payload').data.data.base64, 'base64'), binary);
    assert(events.some(e => e.packet === 'chat' && e.direction === 'server' && e.data.message.includes('/candidate')));
    assert(events.some(e => e.event === 'mark' && e.label === 'changed wool'));
    assert(!events.some(e => e.packet === 'entity_move' || e.packet === 'position' && e.direction === 'client'));
    assert(events.some(e => e.packet === 'position' && e.direction === 'server' && e.data.x === 100), 'record server teleports while filtering routine client movement');
    assert.strictEqual(summary.menuOpenings[0].title, 'Edit Quick Buy');
    assert.strictEqual(summary.menuOpenings[0].nearbyOutbound.length, 2);
    assert(summary.payloadChannels.includes('upstream: test:menu'));
    const before = fs.statSync(path.join(dir, file)).size;
    trace.observe('client', 'chat', { message: '/after' });
    assert.strictEqual(fs.statSync(path.join(dir, file)).size, before);

    const bounded = createQuickBuyTrace({ dir, sendChat: () => {}, maxBytes: 1024 });
    bounded.command(['/quickbuy', 'trace', 'start']);
    bounded.observe('client', 'custom_payload', { channel: 'large', data: Buffer.alloc(4096) });
    bounded.dispose();
    assert(fs.readdirSync(dir).filter(n => n.endsWith('.summary.json')).some(n => JSON.parse(fs.readFileSync(path.join(dir, n))).reason === 'size limit'));
    console.log('Quick Buy trace tests passed');
} finally { trace.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
