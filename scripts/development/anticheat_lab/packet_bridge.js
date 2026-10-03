'use strict';
const assert = require('assert');

// Attach to one owned, already-joined protocol client. Delay decoded incoming
// delivery before both named events and the generic packet event, so packets
// are counted/delivered once. The pinned protocol library parses compression.
function attachBlink(client, buffer, trace = () => {}) {
    assert.strictEqual(client.state, 'play');
    const originalWrite = client.write, decoder = client.deserializer, originalEmit = decoder.emit;
    const send = (name, data) => {
        trace({ t: Date.now(), phase: 'delivered', direction: 'outgoing', name, data });
        return originalWrite.call(client, name, data);
    };
    const receive = (name, data) => {
        trace({ t: Date.now(), phase: 'delivered', direction: 'incoming', name });
        return originalEmit.call(decoder, 'data', data.parsed);
    };
    client.write = function (name, data) {
        trace({ t: Date.now(), phase: 'requested', direction: 'outgoing', name, data });
        return buffer.outgoing(name, data, send);
    };
    decoder.emit = function (event, ...args) {
        if (event !== 'data') return originalEmit.call(this, event, ...args);
        const parsed = args[0], name = parsed.data.name;
        trace({ t: Date.now(), phase: 'requested', direction: 'incoming', name });
        buffer.incoming(name, { parsed }, receive);
        return true;
    };
    return () => {
        buffer.disable();
        client.write = originalWrite; decoder.emit = originalEmit;
    };
}
module.exports = { attachBlink };
