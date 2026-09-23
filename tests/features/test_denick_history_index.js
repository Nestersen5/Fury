'use strict';

const assert = require('assert');
const { buildDenickHistoryIndex } = require('../../src/denick/denick_history_index.js');
const { createDenickHistory } = require('../../src/denick/history.js');

const index = buildDenickHistoryIndex([
    {
        realIGN: 'RealPlayer',
        nicks: ['OldNick', 'CurrentNick'],
        methods: ['stats'],
        events: [
            { nick: 'CurrentNick', method: 'stats', at: '2026-01-01T00:00:00.000Z' },
            { nick: 'CurrentNick', method: 'manual', at: '2026-02-01T00:00:00.000Z' }
        ]
    },
    {
        realIGN: 'SecondPlayer',
        nicks: ['CurrentNick'],
        methods: ['skin'],
        events: []
    }
]);

assert.deepStrictEqual(index.get('currentnick'), {
    nick: 'CurrentNick',
    realName: 'RealPlayer',
    source: 'manual',
    method: 'manual'
});
assert.deepStrictEqual(index.get('oldnick'), {
    nick: 'OldNick',
    realName: 'RealPlayer',
    source: 'history',
    method: 'stats'
});
assert.strictEqual(index.size, 2);

{
    const writes = [];
    const history = createDenickHistory({
        historyFile: `missing-denick-history-${Date.now()}.json`,
        writeJsonOffThread: (file, value) => writes.push(value)
    });
    history.appendDenickHistory({ nick: 'FirstNick', realIGN: 'RealPlayer', method: 'manual' });
    history.appendDenickHistory({ nick: 'SecondNick', realIGN: 'RealPlayer', method: 'skin' });

    const firstRemoval = history.removeDenickMapping('RealPlayer', 'FirstNick');
    assert.strictEqual(firstRemoval.removed, true, 'one saved nickname can be removed without deleting its real account');
    assert.strictEqual(firstRemoval.removedPlayer, false);
    assert.strictEqual(history.findKnownDenickByNick('FirstNick'), null);
    assert.strictEqual(history.findKnownDenickByNick('SecondNick').realName, 'RealPlayer');

    const secondRemoval = history.removeDenickMapping('realplayer', 'secondnick');
    assert.strictEqual(secondRemoval.removedPlayer, true, 'the identity row disappears after its last saved nick is removed');
    assert.strictEqual(history.loadDenickHistoryStore().players.length, 0);
    assert.ok(writes.length >= 4, 'each append and removal is persisted');
}

console.log('Denick history index tests passed.');
