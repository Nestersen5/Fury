'use strict';
const assert = require('assert');
const { createPartyArrivalCheck } = require('../../src/party/arrivalCheck');
function fixture({ enabled = true } = {}) {
    let time = 0, id = 0, members = ['Self', 'Alice', 'Bob'], visible = [];
    const timers = new Map(), messages = [], sounds = [];
    const checker = createPartyArrivalCheck({
        enabled,
        getMembers: () => members,
        getVisibleNames: () => visible,
        getKnownDenick: name => name === 'bobsnick' ? { realIGN: 'Bob' } : null,
        isOwnName: name => name.toLowerCase() === 'self',
        sendChat: message => messages.push(message), playSound: sound => sounds.push(sound),
        setTimer: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
        clearTimer: key => timers.delete(key)
    });
    function advance(ms) {
        const end = time + ms;
        while (true) {
            const next = [...timers].sort((a,b) => a[1].at-b[1].at)[0];
            if (!next || next[1].at > end) break;
            time = next[1].at; timers.delete(next[0]); next[1].fn();
        }
        time = end;
    }
    return { checker, messages, sounds, advance, timers, setMembers: value => { members = value; }, setVisible: value => { visible = value; } };
}
const join = name => `${name} has joined (3/16)!`;
{
    const f = fixture(); f.checker.enter();
    f.checker.observeChatLine('Party > Alice: Bob has joined (3/16)!');
    f.advance(5000); assert.equal(f.sounds.length, 0); assert.equal(f.timers.size, 0);
    f.checker.observeChatLine(join('Self')); f.checker.observeChatLine(join('Alice'));
    f.advance(999); assert.equal(f.sounds.length, 0);
    f.advance(1); assert.equal(f.sounds.length, 1); assert(f.messages[1].includes('Bob'));
    assert.deepStrictEqual(f.messages[2].extra[1].clickEvent,
        { action: 'run_command', value: '/partycheck dismiss' });
    f.checker.observeChatLine(join('Alice')); // duplicates cannot extend the deadline
    f.advance(2500); assert.equal(f.sounds.length, 2);
    f.checker.observeChatLine(join('BobsNick'));
    assert(f.messages.at(-1).includes('all current party members'));
    f.advance(10000); assert.equal(f.sounds.length, 2);
    f.checker.enter(); f.checker.observeChatLine(join('Self')); f.advance(1000);
    assert(f.messages.at(-2).includes('Alice, Bob')); // previous lobby arrivals cleared
    f.checker.stop(); f.advance(10000); assert.equal(f.sounds.length, 3);
    assert.equal(f.timers.size, 0);
    f.checker.observeChatLine(join('Alice')); f.advance(5000);
    assert.equal(f.sounds.length, 3); // dismissal lasts despite further join messages
    f.checker.enter(); f.checker.observeChatLine(join('Self')); f.advance(1000);
    assert.equal(f.sounds.length, 4); // next queue automatically checks again
    f.checker.stop();
}
{
    const f = fixture(); f.checker.enter();
    f.checker.observeChatLine(join('ALICE')); f.advance(900);
    f.checker.observeChatLine('\u00a7aBobsNick has joined (3/16)!'); f.advance(10000);
    assert.equal(f.sounds.length, 0); assert.equal(f.messages.length, 0);
}
{
    const f = fixture(); f.setMembers(null); f.checker.enter(); f.checker.observeChatLine(join('Self'));
    f.advance(6000); assert.equal(f.messages.length, 1); assert.equal(f.sounds.length, 0);
    f.setMembers(['Alice']); f.advance(2500); assert.equal(f.sounds.length, 1);
    f.setMembers([]); f.advance(2500); assert.equal(f.timers.size, 0);
}
{
    const f = fixture(); f.checker.enter(); f.checker.observeChatLine(join('Self'));
    f.checker.stop(); f.advance(10000); assert.equal(f.messages.length, 0);
}
{
    const f = fixture(); f.checker.enter(); f.checker.observeChatLine(join('Self'));
    f.setVisible(['ALICE', 'BobsNick']); f.advance(1000);
    assert.equal(f.sounds.length, 0); // live Tab/entities cover missing join announcements
}
{
    const f = fixture(); f.checker.enter(); f.checker.observeChatLine(join('Alice'));
    f.setVisible(['UnrelatedPlayer']); f.advance(1000);
    assert.equal(f.sounds.length, 1); // an unknown nick is still unconfirmed
    f.setVisible(['Bob']); f.advance(2500);
    assert.equal(f.sounds.length, 1); assert.equal(f.timers.size, 0);
    assert(f.messages.at(-1).includes('all current party members'));
    f.checker.enter(); f.setVisible([]); f.checker.observeChatLine(join('Self')); f.advance(1000);
    assert.equal(f.sounds.length, 2); // fallback evidence isn't remembered across queues
}
{
    const f = fixture({ enabled: false });
    for (let lobby = 0; lobby < 3; lobby++) {
        f.checker.enter(); f.checker.observeChatLine(join('Self')); f.advance(10000);
        assert.equal(f.timers.size, 0);
        assert.equal(f.messages.length, 0);
        assert.equal(f.sounds.length, 0);
    }
    f.checker.setEnabled(true); f.advance(999); assert.equal(f.sounds.length, 0);
    f.checker.setEnabled(true); f.advance(1); assert.equal(f.sounds.length, 1);
    f.checker.setEnabled(false); assert.equal(f.timers.size, 0);
    const count = f.messages.length;
    f.advance(10000); assert.equal(f.sounds.length, 1); assert.equal(f.messages.length, count);
    f.checker.observeChatLine(join('Alice')); f.checker.observeChatLine(join('BobsNick'));
    f.checker.setEnabled(true); f.advance(10000);
    assert.equal(f.sounds.length, 1); // preserve arrivals recorded while muted
    assert.equal(f.timers.size, 0);
}
{
    const f = fixture(); f.checker.enter(); f.checker.observeChatLine(join('Self'));
    f.checker.setEnabled(false); f.advance(1000);
    assert.equal(f.sounds.length, 0); assert.equal(f.messages.length, 0);
    f.checker.stop(); f.checker.setEnabled(true); f.advance(10000);
    assert.equal(f.sounds.length, 0); // re-enabling respects a dismissed lobby
    f.checker.enter(); f.checker.observeChatLine(join('Self')); f.advance(1000);
    assert.equal(f.sounds.length, 1);
}
console.log('Party arrival check and permanent warning toggle tests passed.');
