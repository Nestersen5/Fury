'use strict';
const assert = require('assert/strict');
const { createNicknameSharing } = require('../../src/party/nicknameSharing');

function fixture() {
    let time = 0, next = 0, own = 'MyNick';
    const timers = new Map(), remembered = [], accepted = [], acks = [], errors = [];
    const context = { world: '1', active: true, mode: 'BEDWARS', serverId: 'mini1A', account: 'Alice', busy: false, share: true, receive: true };
    let peers = [{ uuid: 'b'.repeat(32), name: 'Bob', nick: 'BobNick', id: '2'.repeat(24) }];
    const tracker = createNicknameSharing({ getContext: () => ({ ...context }), getOwnName: () => own,
        rememberOwn: nick => remembered.push(nick), getPeers: () => peers,
        acceptPeer: async (peer, valid) => { assert(valid()); accepted.push(peer); return true; },
        acknowledge: peer => { acks.push(peer); return true; }, onChange: () => {}, onError: error => errors.push(error),
        now: () => time, setTimer: (fn, delay) => { timers.set(++next, { fn, at: time + delay }); return next; }, clearTimer: id => timers.delete(id) });
    async function advance(ms) {
        const end = time + ms;
        let count = 0;
        while (true) {
            const entry = [...timers.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!entry) break;
            assert(++count < 100, 'no busy polling loop');
            timers.delete(entry[0]); time = entry[1].at; await entry[1].fn();
        }
        time = end;
    }
    return { tracker, context, timers, remembered, accepted, acks, errors, advance,
        own: value => { own = value; }, peers: value => { peers = value; } };
}
(async () => {
    const f = fixture();
    assert.equal(f.tracker.ownStatus().checked, false);
    assert.equal(f.timers.size, 0, 'reading status cannot schedule detection');
    assert.equal(f.remembered.length, 0, 'reading status cannot save a nickname');
    for (let i = 0; i < 50; i++) f.tracker.request();
    assert.equal(f.timers.size, 1, 'tab updates coalesce');
    await f.advance(7999); assert.equal(f.remembered.length, 0);
    f.context.busy = true; await f.advance(5001);
    assert.equal(f.accepted.length, 0, 'initial scanning takes priority');
    f.context.busy = false; await f.advance(1000);
    assert.deepEqual(f.remembered, ['MyNick']); assert.equal(f.accepted.length, 1);
    assert.equal(f.tracker.state().nick, 'MyNick');
    assert.equal(f.tracker.ownStatus().nick, 'MyNick');
    f.tracker.request(); await f.advance(0);
    assert.equal(f.accepted.length, 1, 'repeated observations do not repeat save or chat');
    assert.equal(f.remembered.length, 1, 'unchanged nick does not write history');
    f.context.share = false; f.own('NewNick'); f.tracker.request(); await f.advance(0);
    assert.deepEqual(f.remembered, ['MyNick', 'NewNick'], 'private history remains active with sharing off');
    assert.equal(f.tracker.state().nick, null);
    assert.equal(f.tracker.ownStatus().nick, 'NewNick', 'private diagnostic works with sharing off');
    f.context.share = true; f.tracker.request(); await f.advance(0);
    assert.equal(f.tracker.state().nick, 'NewNick', 'only newest nick is published');
    f.own('Alice'); f.tracker.request(); await f.advance(0);
    assert.equal(f.tracker.state().nick, null, 'real account name is never shared as a nickname');
    assert.equal(f.tracker.ownStatus().checked, true);
    assert.equal(f.tracker.ownStatus().nick, null, 'checked and unnicked differs from unknown');
    f.context.world = '2'; f.context.mode = 'SKYWARS'; f.tracker.request();
    assert.equal(f.tracker.state(), null, 'new game cannot reuse last-game identity');
    assert.equal(f.tracker.ownStatus().checked, false, 'diagnostic cannot report a previous game as current');
    await f.advance(8000); assert.equal(f.tracker.state().mode, 'SKYWARS');
    f.context.active = false; assert.equal(f.tracker.state(), null, 'unsupported/lobby modes cannot share');
    f.context.active = true; f.context.mode = 'DUELS'; f.context.receive = false;
    f.peers([{ uuid: 'c'.repeat(32), name: 'Charlie', nick: 'CharlieNick', id: '3'.repeat(24) }]);
    f.tracker.request(); await f.advance(0); assert.equal(f.accepted.length, 2, 'receiving off prevents a new save');
    f.context.receive = true;
    f.peers([{ uuid: 'c'.repeat(32), name: 'Charlie', nick: 'SameNick', id: '3'.repeat(24) },
        { uuid: 'd'.repeat(32), name: 'Dan', nick: 'SameNick', id: '4'.repeat(24) }]);
    f.tracker.request(); await f.advance(0); assert.equal(f.accepted.length, 2, 'duplicate nickname claims are blocked');
    f.tracker.request(1000); f.tracker.close(); assert.equal(f.timers.size, 0);
    assert.deepEqual(f.errors, []);
    console.log('Deferred own nickname tracking and party-sharing tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
