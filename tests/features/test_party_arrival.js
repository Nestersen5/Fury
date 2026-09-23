'use strict';

const assert = require('assert');
const { createPartyArrivalTracker } = require('../../src/dodge/partyArrival.js');

// Scenario numbers mirror the 2026-07-16 pregame recording: duplicated adds,
// a 4-burst party spread over ~80ms, a later duo, a solo, and the game-start
// remove+re-add churn followed by the entity-id un-obfuscation bridge.

function createHarness() {
    let fakeNow = 100_000;
    const announced = [];
    const labels = [];
    const uuidNames = new Map();
    const tracker = createPartyArrivalTracker({
        isOwnUuid: uuid => uuid === 'uuid-self',
        isOwnName: name => name === 'Me',
        getUuidMappedName: uuid => uuidNames.get(uuid) || null,
        announce: text => announced.push(text),
        appendLabelLine: record => labels.push(record),
        now: () => fakeNow
    });
    return {
        tracker,
        announced,
        labels,
        uuidNames,
        advance(ms) { fakeNow += ms; tracker.tick(); },
        at() { return fakeNow; }
    };
}

function addPacket(tracker, uuid, name) {
    tracker.observePlayerInfo({ action: 0, data: [{ UUID: uuid, name }] }, 'add_player');
}

function removePacket(tracker, uuid) {
    tracker.observePlayerInfo({ action: 4, data: [{ UUID: uuid }] }, 'remove_player');
}

// --- grouping: at-join cohort vs watched arrivals ----------------------------
{
    const h = createHarness();
    h.tracker.onPregameEnter(1);

    // Our own add plus two existing occupants land in the same instant.
    addPacket(h.tracker, 'uuid-self', 'Me');
    addPacket(h.tracker, 'uuid-pre1', '§kPreA');
    h.advance(30);
    addPacket(h.tracker, 'uuid-pre2', '§kPreB');

    // 300ms later a 4-party arrives, each add duplicated like Hypixel does.
    h.advance(300);
    addPacket(h.tracker, 'uuid-p1', '§kAaa');
    h.advance(10);
    addPacket(h.tracker, 'uuid-p2', '§kBbb');
    h.advance(30);
    addPacket(h.tracker, 'uuid-p1', '§kAaa'); // duplicate
    addPacket(h.tracker, 'uuid-p3', '§kCcc');
    h.advance(40);
    addPacket(h.tracker, 'uuid-p4', '§kDdd');
    addPacket(h.tracker, 'uuid-p2', '§kBbb'); // duplicate

    // 10s later: a duo, then a solo well after.
    h.advance(10_000);
    addPacket(h.tracker, 'uuid-d1', '§kEee');
    h.advance(50);
    addPacket(h.tracker, 'uuid-d2', '§kFff');
    h.advance(8_000);
    addPacket(h.tracker, 'uuid-s1', '§kGgg');

    const groups = h.tracker.getActiveGroups();
    assert.strictEqual(groups.length, 2, 'expected the 4-party and the duo (solo and at-join cohort excluded)');
    assert.deepStrictEqual(groups[0].aliases, ['Aaa', 'Bbb', 'Ccc', 'Ddd']);
    assert.strictEqual(groups[0].size, 4);
    assert.ok(groups[0].spreadMs <= 100, 'duplicates must not stretch the group spread');
    assert.deepStrictEqual(groups[1].aliases, ['Eee', 'Fff']);

    // Chat lines (same-tick flush) attach positions without affecting groups.
    h.tracker.observeChatLine('§b§kAaa§e has joined (§b2§e/§b8§e)!');
    h.tracker.observeChatLine('§b§kBbb§e has joined (§b3§e/§b8§e)!');
    assert.strictEqual(h.tracker.getActiveGroups().length, 2);
}

// --- quits: grace beats churn, real removes shrink groups --------------------
{
    const h = createHarness();
    h.tracker.onPregameEnter(2);
    addPacket(h.tracker, 'uuid-self', 'Me');
    h.advance(500);
    addPacket(h.tracker, 'uuid-a', '§kAaa');
    h.advance(20);
    addPacket(h.tracker, 'uuid-b', '§kBbb');
    assert.strictEqual(h.tracker.getActiveGroups().length, 1);

    // Churn: remove immediately followed by re-add is NOT a quit.
    removePacket(h.tracker, 'uuid-a');
    h.advance(200);
    addPacket(h.tracker, 'uuid-a', '§kAaa');
    h.advance(2_000);
    assert.strictEqual(h.tracker.getActiveGroups().length, 1, 'churned player must stay tracked');

    // Real quit: remove with no re-add within grace.
    removePacket(h.tracker, 'uuid-a');
    h.advance(1_500);
    const groups = h.tracker.getActiveGroups();
    assert.strictEqual(groups.length, 0, 'group of 2 collapses when one member quits');
    assert.ok(h.announced.some(a => a.includes('quit: Aaa')), 'quit should be announced');

    // Chat quit line alone also starts the grace clock.
    removePacket(h.tracker, 'uuid-b'); // already single, but must still mark quit
    h.advance(1_500);
    const state = h.tracker.getDebugState();
    assert.strictEqual(state.partyArrivalCount, 0, 'both strangers quit');
}

// --- buffered adds before pregame detection ----------------------------------
{
    const h = createHarness();
    // Adds arrive before the scoreboard flags pregame.
    addPacket(h.tracker, 'uuid-early1', '§kEarly1');
    h.advance(40);
    addPacket(h.tracker, 'uuid-early2', '§kEarly2');
    h.advance(500);
    h.tracker.onPregameEnter(3);
    // No own anchor yet: buffered arrivals count as at-join (unknown structure)
    // until our own add lands and re-anchors them.
    addPacket(h.tracker, 'uuid-self', 'Me');
    h.advance(1_000);
    addPacket(h.tracker, 'uuid-late1', '§kLate1');
    h.advance(30);
    addPacket(h.tracker, 'uuid-late2', '§kLate2');
    const groups = h.tracker.getActiveGroups();
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].aliases, ['Late1', 'Late2']);
}

// --- game start: entity-id bridge labels the groups ---------------------------
{
    const h = createHarness();
    h.tracker.onPregameEnter(4);
    addPacket(h.tracker, 'uuid-self', 'Me');
    h.advance(400);
    addPacket(h.tracker, 'uuid-a', '§kAaa');
    h.advance(20);
    addPacket(h.tracker, 'uuid-b', '§kBbb');
    h.tracker.observeEntitySpawn(50, 'uuid-a');
    h.tracker.observeEntitySpawn(51, 'uuid-b');

    h.advance(5_000);
    h.tracker.onPregameLeave('game_start');

    // Game start: same entity ids respawn with real uuids; teams arrive.
    h.uuidNames.set('uuid-real-a', 'RealA');
    h.uuidNames.set('uuid-real-b', 'RealB');
    h.tracker.observeEntitySpawn(50, 'uuid-real-a');
    h.tracker.observeEntitySpawn(51, 'uuid-real-b');
    h.tracker.observeTeamPlayers('Red8', ['RealA']);
    h.tracker.observeTeamPlayers('Red9', ['RealB']);

    h.advance(21_000); // resolution window closes
    assert.strictEqual(h.labels.length, 1, 'one label record per started game');
    const record = h.labels[0];
    assert.strictEqual(record.groups.length, 1);
    assert.strictEqual(record.groups[0].label, 'same_team');
    const reals = record.arrivals.filter(a => a.real).map(a => `${a.alias}=${a.real}:${a.team}`).sort();
    assert.deepStrictEqual(reals, ['Aaa=RealA:Red', 'Bbb=RealB:Red']);
}

// --- game start with split teams labels split ---------------------------------
{
    const h = createHarness();
    h.tracker.onPregameEnter(5);
    addPacket(h.tracker, 'uuid-self', 'Me');
    h.advance(400);
    addPacket(h.tracker, 'uuid-a', '§kAaa');
    h.advance(20);
    addPacket(h.tracker, 'uuid-b', '§kBbb');
    h.tracker.observeEntitySpawn(60, 'uuid-a');
    h.tracker.observeEntitySpawn(61, 'uuid-b');
    h.tracker.onPregameLeave('game_start');
    h.uuidNames.set('uuid-real-a', 'RealA');
    h.uuidNames.set('uuid-real-b', 'RealB');
    // Teams can arrive before the respawns resolve names.
    h.tracker.observeTeamPlayers('Blue3', ['RealA']);
    h.tracker.observeTeamPlayers('Green4', ['RealB']);
    h.tracker.observeEntitySpawn(60, 'uuid-real-a');
    h.tracker.observeEntitySpawn(61, 'uuid-real-b');
    h.advance(21_000);
    assert.strictEqual(h.labels[0].groups[0].label, 'split_teams');
}

// --- phantom pregame re-enter must not kill the resolution --------------------
// Measured: the scoreboard can flip back to "pregame" within ~100ms of game
// start, before the team packets arrive. The label must survive that.
{
    const h = createHarness();
    h.tracker.onPregameEnter(10);
    addPacket(h.tracker, 'uuid-self', 'Me');
    h.advance(400);
    addPacket(h.tracker, 'uuid-a', '§kAaa');
    h.advance(20);
    addPacket(h.tracker, 'uuid-b', '§kBbb');
    h.tracker.observeEntitySpawn(70, 'uuid-a');
    h.tracker.observeEntitySpawn(71, 'uuid-b');

    h.tracker.onPregameLeave('game_start');
    h.advance(50);
    // Phantom re-enter + churn re-adds (all land as at-join cohort).
    h.tracker.onPregameEnter(11);
    addPacket(h.tracker, 'uuid-self', 'Me');
    addPacket(h.tracker, 'uuid-a', '§kAaa');
    addPacket(h.tracker, 'uuid-b', '§kBbb');
    h.advance(100);
    h.tracker.onPregameLeave('game_activate');

    // Teams + real respawns arrive only now.
    h.uuidNames.set('uuid-real-a', 'RealA');
    h.uuidNames.set('uuid-real-b', 'RealB');
    h.tracker.observeEntitySpawn(70, 'uuid-real-a');
    h.tracker.observeEntitySpawn(71, 'uuid-real-b');
    h.tracker.observeTeamPlayers('Red1', ['RealA']);
    h.tracker.observeTeamPlayers('Red2', ['RealB']);

    h.advance(21_000);
    assert.strictEqual(h.labels.length, 1, 'exactly one label despite the phantom re-enter');
    assert.strictEqual(h.labels[0].endReason, 'window');
    assert.strictEqual(h.labels[0].groups.length, 1);
    assert.strictEqual(h.labels[0].groups[0].label, 'same_team',
        'teams arriving after the phantom re-enter must still resolve');
}

// --- leaving without a game start writes no label ------------------------------
{
    const h = createHarness();
    h.tracker.onPregameEnter(6);
    addPacket(h.tracker, 'uuid-self', 'Me');
    h.advance(400);
    addPacket(h.tracker, 'uuid-a', '§kAaa');
    h.tracker.onPregameLeave('requeue');
    h.advance(25_000);
    assert.strictEqual(h.labels.length, 0, 'dodged/left lobbies produce no label');
    // A fresh pregame starts clean.
    h.tracker.onPregameEnter(7);
    assert.strictEqual(h.tracker.getActiveGroups().length, 0);
}

console.log('Party arrival tracker tests passed.');
