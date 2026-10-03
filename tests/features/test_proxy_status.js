'use strict';

const assert = require('assert/strict');
const { createProxyStatus } = require('../../src/net/proxyStatus');

function checkStatus(host, port, address, addressWidth) {
    const status = createProxyStatus({
        host, port,
        ping: () => { throw new Error('Server-list pings must not probe the target'); }
    });
    const players = { online: 1, max: 20, sample: [{ name: 'Local player' }] };
    const response = { players, favicon: 'fury-icon', description: { text: 'old' } };
    assert.equal(status.beforePing(response), response);
    assert.equal(response.players, players, 'the proxy-owned player count is untouched');
    assert.equal(response.favicon, 'fury-icon');
    assert.equal(response.description.text, status.motd);

    const lines = status.motd.split('\n');
    assert.equal(lines.length, 2);
    const title = /^( *)§6§lFURY PROXY$/.exec(lines[0]);
    const target = /^§r( *)(.+)$/.exec(lines[1]);
    assert(title, 'colored title');
    assert(target, 'bold is reset before the address padding');
    assert.equal(target[2].replace(/§[0-9a-f]/g, ''), address);
    assert.deepEqual(Array.from(target[2].matchAll(/§([0-9a-f])/g), match => match[1]),
        ['c', '6', 'e', 'a', 'b', '9', 'd'], 'the address has one full rainbow gradient');
    // The title is 68 pixels wide in the default 1.8.9 font when bold.
    const titleCenter = title[1].length * 4 + 68 / 2;
    const addressCenter = target[1].length * 4 + addressWidth / 2;
    assert(Math.abs(titleCenter - addressCenter) <= 2,
        `${address} must share the title's visible center within half a space`);
}

checkStatus('mc.hypixel.net', 25565, 'mc.hypixel.net', 67);
checkStatus('hypixel.fast', 25565, 'hypixel.fast', 58);
checkStatus('free.stopthelag.lol', 25565, 'free.stopthelag.lol', 92);
checkStatus('localhost', 25565, 'localhost', 46);
checkStatus('127.0.0.1', 25565, '127.0.0.1', 42);
checkStatus('play.example.org', 25566, 'play.example.org:25566', 114);
checkStatus('::1', 25566, '[::1]:25566', 50);

console.log('Proxy status aligns its two colored lines and leaves player counts and favicon local.');
