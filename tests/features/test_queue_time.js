'use strict';
const assert = require('assert');
const { createQueueTimeTracker, formatQueueTime, formatQueueTimeWords } = require('../../src/session/queueTime');
let time = 0;
const messages = [];
const tracker = createQueueTimeTracker({ now: () => time, announce: message => messages.push(message) });
time = 300000; // main lobby never counts
tracker.enter(); time += 15000; tracker.enter(); // duplicate entry does not restart
tracker.leave(); time += 60000; tracker.leave(); // lobby gap never counts
tracker.enter(); time += 48000;
assert.equal(messages.length, 0); // no output before start
tracker.gameStart('BEDWARS');
assert.equal(messages.length, 0); // early game activation cannot announce
time += 1000; tracker.confirmStartMessage(); tracker.confirmStartMessage();
assert.equal(messages.length, 1); // repeated start text cannot duplicate
assert(messages[0].includes('1m 3s')); assert(messages[0].includes('folded 1 time'));
time += 600000; tracker.gameStart('BEDWARS'); tracker.confirmStartMessage(); assert.equal(messages.length, 1);
tracker.enter(); time += 8000; tracker.gameStart('BEDWARS'); tracker.confirmStartMessage();
assert(messages[1].includes('8s')); assert(!messages[1].includes('across'));
tracker.enter(); time += 5000; tracker.leave(); tracker.gameStart('SKYWARS');
tracker.enter(); time += 3000; tracker.gameStart('BEDWARS'); tracker.confirmStartMessage(); assert(messages[2].includes('3s'));
tracker.enter(); time += 10000; tracker.reset(); tracker.gameStart('BEDWARS'); tracker.confirmStartMessage();
assert.equal(messages.length, 3);
assert.equal(formatQueueTime(999), '0s'); assert.equal(formatQueueTime(60000), '1m 0s');
console.log('Queue time tests passed.');
assert.equal(formatQueueTimeWords(50000), '50 seconds');
assert.equal(formatQueueTimeWords(110000), '1 minute 50 seconds');
assert.equal(formatQueueTimeWords(61000), '1 minute 1 second');
assert.equal(formatQueueTimeWords(120000), '2 minutes');
const shared = [];
const sharingTracker = createQueueTimeTracker({ now: () => time, announce: () => {}, getShareEnabled: () => true, share: text => shared.push(text) });
sharingTracker.enter(); time += 110000; sharingTracker.gameStart('BEDWARS');
assert.equal(shared.length, 0);
sharingTracker.confirmStartMessage(); sharingTracker.confirmStartMessage();
sharingTracker.gameStart('BEDWARS'); sharingTracker.confirmStartMessage();
assert.deepEqual(shared, ['folded 0 times, took 1 minute 50 seconds']);
sharingTracker.enter(); time += 10000; sharingTracker.leave(); sharingTracker.leave();
time += 300000; // main lobby time is excluded
sharingTracker.enter(); time += 10000; sharingTracker.leave();
sharingTracker.enter(); sharingTracker.enter(); time += 30000;
sharingTracker.gameStart('BEDWARS'); sharingTracker.confirmStartMessage();
assert.equal(shared[1], 'folded 2 times, took 50 seconds');
sharingTracker.enter(); time += 1000; sharingTracker.leave();
sharingTracker.enter(); time += 60000; sharingTracker.gameStart('BEDWARS'); sharingTracker.confirmStartMessage();
assert.equal(shared[2], 'folded 1 time, took 1 minute 1 second');

tracker.enter('old'); time += 4000; tracker.gameStart('BEDWARS'); tracker.enter('new'); tracker.confirmStartMessage();
assert.equal(messages.length, 3); // a new queue discards an unannounced previous game

// Reproduce the real packet sequence: countdown start, stale pregame sidebar,
// then the Protect your bed message one second later.
for (const key of ['mini123', null]) {
    const output = [], party = [];
    const timer = createQueueTimeTracker({ now: () => time, announce: value => output.push(value), getShareEnabled: () => true, share: value => party.push(value) });
    timer.enter(key); time += 50000;
    timer.gameStart('BEDWARS'); timer.leave();
    time += 200; timer.enter(key); time += 800;
    timer.gameStart('BEDWARS');
    assert.equal(output.length, 0);
    timer.confirmStartMessage(); timer.confirmStartMessage();
    assert.equal(party[0], 'folded 0 times, took 51 seconds');
    assert.equal(output.length, 0);
}
{
    const party = [];
    const timer = createQueueTimeTracker({ now: () => time, announce: () => {}, getShareEnabled: () => true, share: value => party.push(value) });
    timer.enter('folded'); time += 10000; timer.leave();
    timer.enter('final'); time += 40000; timer.gameStart('BEDWARS');
    timer.gameStart('BEDWARS'); // duplicate activation preserves pending result
    timer.enter('final'); time += 1000; timer.gameStart('BEDWARS'); timer.confirmStartMessage();
    assert.equal(party[0], 'folded 1 time, took 51 seconds');
}

for (const partyEnabled of [false, true]) {
    const local = [], party = [];
    const timer = createQueueTimeTracker({ now: () => time, announce: x => local.push(x), share: x => party.push(x), getShareEnabled: () => partyEnabled });
    timer.enter('intro'); time += 48000; timer.gameStart('BEDWARS');
    timer.observeStartChat('------------------------------');
    timer.observeStartChat('Bed Wars');
    timer.observeStartChat('Protect your bed and destroy the enemy beds.');
    timer.observeStartChat('Upgrade yourself and your team by collecting');
    timer.observeStartChat('Iron, Gold, Emerald and Diamond from generators');
    timer.observeStartChat('to access powerful upgrades.');
    assert.equal(local.length + party.length, 0);
    timer.observeStartChat('------------------------------');
    timer.observeStartChat('------------------------------');
    assert.equal(local.length, partyEnabled ? 0 : 1);
    assert.equal(party.length, partyEnabled ? 1 : 0);
}

// The master switch suppresses either destination, even when turned off after
// game activation. Suppressed messages are consumed and never replayed.
for (const partyEnabled of [false, true]) {
    const local=[],party=[];
    let enabled=true;
    const timer=createQueueTimeTracker({now:()=>time,getEnabled:()=>enabled,
        getShareEnabled:()=>partyEnabled,announce:text=>local.push(text),share:text=>party.push(text)});
    timer.enter('disabled');time+=5000;timer.gameStart('BEDWARS');
    enabled=false;timer.confirmStartMessage();
    assert.deepStrictEqual([local,party],[[],[]]);
    enabled=true;timer.confirmStartMessage();
    assert.deepStrictEqual([local,party],[[],[]]);
    timer.enter('enabled');time+=3000;timer.gameStart('BEDWARS');timer.confirmStartMessage();
    assert.strictEqual(local.length,partyEnabled?0:1);
    assert.strictEqual(party.length,partyEnabled?1:0);
    assert((partyEnabled?party:local)[0].includes('folded 0 times'));
}
