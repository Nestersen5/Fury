'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAutoDenickPossibleMatches } = require('../../src/stats/scanLine');
const { sendChat, extractText, stripAnsi } = require('../../features/minecraft_chat');
const { harness, candidate, match, deferred, flush } = require('../../scripts/test_support/auto_stats_denick');

function packets(h) {
    const output = [];
    h.rawMessages.forEach(message => sendChat({ write(name, packet) {
        assert.equal(name, 'chat');
        assert.equal(packet.position, 0);
        output.push(JSON.parse(packet.message));
    } }, message));
    return output;
}
const components = message => [message, ...(message.extra || []).flatMap(components)];

test('possible matches use one heading and up to three native stat rows', () => {
    for (const count of [0, 1, 2, 3, 4]) {
        const messages = formatAutoDenickPossibleMatches('HiddenNick', Array.from({ length: count }, (_, i) => candidate(`Player${i}`)), { getInteractiveTags: () => [] });
        assert.equal(messages.length, count ? 1 + Math.min(count, 3) : 0);
        if (!count) continue;
        assert.equal(stripAnsi(extractText(messages[0])), '[AutoDenick] Possible matches:');
        messages.slice(1).forEach((message, i) => {
            const text = stripAnsi(extractText(message));
            assert(text.includes(`HiddenNick (Player${i}) ?`));
            assert(/FKDR:.*WLR:.*WS:/.test(text));
            assert(!/AutoDenick|Finals:|Beds:|detected |diff /.test(text));
        });
    }
});

test('message showcase prints every remaining stats message with interactive tags and no requests or saved state', async () => {
    const h = harness({ local: false, detected: false, find: () => { throw new Error('Preview must not search'); },
        profileLookup: () => { throw new Error('Preview must not fetch profiles'); } });
    h.context.gameActive = false;
    h.context.currentGamemode = null;
    h.context.autoStatsDenickEnabled = false;
    await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'messages']);
    const wire = packets(h), text = wire.map(extractText);
    assert.equal(wire.length, 18);
    assert.equal(text.filter(line => line.includes('Started denicking')).length, 3);
    assert.equal(text.filter(line => line === '[AutoDenick] Possible matches:').length, 3);
    assert.equal(text.filter(line => /\) \?/.test(line)).length, 6);
    assert.equal(text.filter(line => line.includes('Confirmed match:')).length, 2);
    const full = text.find(line => line.includes('Confirmed match:') && line.includes('FKDR:'));
    assert(/ExampleNick \(ExampleAlpha\).*✔.*FKDR:.*WLR:.*WS:/.test(full));
    const unavailable = text.find(line => line.includes('Stats unavailable right now.'));
    assert(unavailable.endsWith('| Stats unavailable right now.'));
    assert(!/FKDR:|WLR:|WS:/.test(unavailable));
    assert(text.some(line => line.includes('Could not confidently denick ExampleNick using their finals and beds.')));
    assert.equal(text.filter(line => line.includes('Could not identify')).length, 0);
    assert.equal(text.filter(line => line.includes('Could not check')).length, 2);
    assert(!text.some(line => /Checking |Too many players match|Finals:|Beds:|detected |diff /.test(line)));
    const tag = wire.flatMap(components).find(part => part.text?.includes('[Caution'));
    assert(tag);
    assert.equal(tag.clickEvent.value, '/urchin ExampleAlpha');
    assert(tag.hoverEvent.value.includes('Example tag shown only in the message preview.'));
    assert.equal(h.queries.length, 0);
    assert.equal(h.saved.length, 0);
    assert.equal(h.tracker.autoDenickStats.size, 0);
    assert.equal(h.tracker.autoDenickResults.size, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.partyAnnounced.length, 0);
    assert.equal(h.cosmetics.length, 0);
    assert.equal(h.updates.length, 0);
    await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'MESSAGES']);
    assert.equal(h.rawMessages.length, 36);
    assert.equal(h.queries.length, 0);
});

test('message showcase preserves live identities, pending test requests and carried-over counts', async () => {
    const pending = deferred();
    const h = harness({ find: () => pending.promise });
    const active = h.context.handleAutoDenickTestCommand(['/denick', 'test', 'finals', '1000']);
    await flush();
    const live = { name: 'TestNick', finals: 777, beds: null, sessionId: 1 };
    const resolved = { realName: 'AlreadyKnown' };
    h.tracker.autoDenickStats.set('testnick', live);
    h.tracker.autoDenickResults.set('testnick', resolved);
    h.context.autoDenickRetryTimers.set('testnick', 123);
    await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'messages']);
    assert.equal(h.queries.length, 1);
    assert.equal(h.rawMessages.length, 19, 'Pending search start plus the full showcase');
    pending.resolve(match());
    await active;
    assert.equal(h.rawMessages.length, 21, 'the original pending search still delivers its heading and row');
    await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'beds', '500']);
    assert.equal(JSON.stringify(h.queries.at(-1).targets), JSON.stringify({ finals: 1000, beds: 500 }));
    assert.equal(h.tracker.autoDenickStats.get('testnick'), live);
    assert.equal(h.tracker.autoDenickResults.get('testnick'), resolved);
    assert.equal(h.context.autoDenickRetryTimers.get('testnick'), 123);
    assert.equal(h.saved.length, 0);
    assert.equal(h.partyAnnounced.length, 0);
});
