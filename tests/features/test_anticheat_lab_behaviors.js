'use strict';
const assert = require('assert');
const { JavaRandom, JavaSplittableRandom } = require('../../scripts/development/anticheat_lab/random');
const { ClickCadence, ExtraPlusCadence } = require('../../scripts/development/anticheat_lab/clicks');
const { BlinkBuffer, BlockHitLagBuffer } = require('../../scripts/development/anticheat_lab/packet_behaviors');
const { CombatInput } = require('../../scripts/development/anticheat_lab/combat_input');

// Known public Java seed vector; full cross-language checks are verify_rng.js.
assert.strictEqual(new JavaRandom(0).nextInt(), -1155484576);
for (const Rng of [JavaRandom, JavaSplittableRandom]) {
    for (const invalid of [0, -1, 0.5, 2147483648]) assert.throws(() => new Rng(0).nextInt(invalid));
}

// Source-range lower endpoint exclusion and the reachable 20 CPS cycle clamp.
const normal = new ClickCadence({ min: 6, max: 7, mode: 'normal', seed: 421 });
for (let i = 0; i < 50; i++) assert.strictEqual(normal.engineDelay(i * 100), 142);
const fast = new ClickCadence({ min: 20, max: 20, mode: 'normal' }).cycle(1000);
assert.strictEqual(fast.engineDelayMs, 50);
assert(fast.holdMs + fast.releaseMs === 44 || fast.holdMs + fast.releaseMs === 45);
assert.strictEqual(fast.workerPauseMs, 5);
const plus = new ExtraPlusCadence(421);
plus.configure(6, 13);
assert.strictEqual(plus.min, 9);
assert.strictEqual(plus.max, 19.5);
for (let i = 0; i < 100; i++) assert(plus.next(1000 + i * 100) >= 1);
assert.strictEqual(plus.fatigue, 0.4);
plus.next(20000);
assert.strictEqual(plus.fatigue, 0.015, 'Idle recovery occurs before this call adds fatigue');
for (const mode of ['normal', 'extra', 'extra+']) {
    const a = new ClickCadence({ mode, seed: 421 }), b = new ClickCadence({ mode, seed: 421 });
    let now = 100000;
    for (let i = 0; i < 1000; i++) {
        const cycle = a.cycle(now);
        assert.deepStrictEqual(cycle, b.cycle(now));
        assert(cycle.holdMs >= 0 && cycle.releaseMs >= 0 && cycle.cycleMs >= 5);
        now += cycle.cycleMs;
    }
}

// Movement-only selective choke vs legitimate all-stream lag: actions pass,
// movement preserves order and snapshots its values before the caller mutates.
{
    const delivered = [], send = (name, data) => delivered.push([name, data.x]);
    const blink = new BlinkBuffer({ type: 'movement', autoSend: true, threshold: 2 });
    blink.enable();
    const position = { x: 1 };
    blink.outgoing('position', position, send); position.x = 99;
    blink.outgoing('arm_animation', {}, send);
    assert.deepStrictEqual(delivered, [['arm_animation', undefined]]);
    blink.outgoing('position', { x: 2 }, send);
    assert.deepStrictEqual(delivered, [['arm_animation', undefined], ['position', 1], ['position', 2]]);
    assert.strictEqual(blink.queue.length, 0);
}
// Bidirectional incoming packets count even with movement-only selected;
// reaching threshold in the receive callback defers its drain until send.
{
    const delivered = [], send = (name, data) => delivered.push(data.id);
    const blink = new BlinkBuffer({ type: 'movement', direction: 'both', autoSend: true, threshold: 2 });
    blink.enable();
    blink.incoming('entity_metadata', { id: 1 }, send);
    blink.incoming('entity_velocity', { id: 2 }, send);
    assert.strictEqual(blink.pending, true);
    assert.deepStrictEqual(delivered, []);
    blink.outgoing('flying', { id: 3 }, send);
    assert.deepStrictEqual(delivered, [1, 2, 3]);
}
// Server correction flushes all prior work and disables non-auto Blink.
{
    const delivered = [], send = (name, data) => delivered.push(data.id);
    const blink = new BlinkBuffer(); blink.enable();
    blink.outgoing('position', { id: 1 }, send);
    blink.outgoing('arm_animation', { id: 2 }, send);
    blink.incoming('position', { id: 3 }, send);
    assert.deepStrictEqual(delivered, [1, 2, 3]);
    assert.strictEqual(blink.enabled, false);
}
// Lag mode must delay the release and subsequent attack, bypass keepalive,
// reblock at delay-50, and flush BEFORE forwarding the expiry-trigger packet.
{
    const delivered = [], send = (name, data) => delivered.push(data.id);
    const lag = new BlockHitLagBuffer({ minDelay: 100, maxDelay: 100 });
    lag.outgoing('block_dig', { id: 1, status: 5 }, send, { now: 1000 });
    lag.outgoing('use_entity', { id: 2 }, send, { now: 1040 });
    lag.outgoing('keep_alive', { id: 3 }, send, { now: 1040 });
    assert.deepStrictEqual(delivered, [3]);
    assert.strictEqual(lag.shouldReblock(1049), false);
    assert.strictEqual(lag.shouldReblock(1050), true);
    lag.outgoing('block_dig', { id: 4, status: 5 }, send, { now: 1100 });
    assert.deepStrictEqual(delivered, [3, 1, 2, 4]);
    assert.strictEqual(lag.buffering, false, 'Expiry release does not immediately re-arm');
}
// Vanilla item-use consumes pending attacks even on the tick that releases use.
{
    const actions = [];
    const input = new CombatInput({ targetAtCursor: () => ({}), attack: () => actions.push('attack'),
        swing: () => actions.push('swing'), beginUse: () => actions.push('block'), endUse: () => actions.push('release') });
    input.setAttack(true); input.setUse(true); input.tick();
    assert.deepStrictEqual(actions, ['attack', 'block']);
    input.setAttack(true); input.setUse(false); input.tick();
    assert.deepStrictEqual(actions, ['attack', 'block', 'release']);
    assert.strictEqual(input.stats.drainedAttacks, 1);
    input.setAttack(true); input.tick();
    assert.deepStrictEqual(actions, ['attack', 'block', 'release', 'attack']);
    input.finish();
}
// Incoming delivery may synchronously emit a keepalive response. The source's
// dispatch guard forwards it, instead of trapping a second queue during drain.
{
    const blink = new BlinkBuffer({ direction: 'both' }), delivered = [];
    blink.enable();
    blink.incoming('keep_alive', { id: 1 }, () => blink.outgoing('keep_alive', { id: 1 }, () => delivered.push('reply')));
    blink.disable();
    assert.deepStrictEqual(delivered, ['reply']); assert.strictEqual(blink.queue.length, 0);
}
{
    const { PlaceInput } = require('../../scripts/development/anticheat_lab/interactions');
    for (const [setting, expected] of [[0, 20], [1, 20], [2, 10], [3, 7], [4, 5]]) {
        let uses = 0; const input = new PlaceInput({ use: () => uses++ }); input.held = true;
        for (let i = 0; i < 20; i++) { input.preTickFastPlace({ enabled: true, delay: setting }); input.tick(); }
        assert.strictEqual(uses, expected, `FastPlace pre-runTick delay ${setting}`);
    }
    let uses = 0; const input = new PlaceInput({ use: () => uses++, heldItem: () => 'projectile' }); input.held = true;
    for (let i = 0; i < 20; i++) { input.preTickFastPlace({ enabled: true, delay: 0, mode: 'blocks' }); input.tick(); }
    assert.strictEqual(uses, 5, 'Item filter keeps vanilla held-use cadence');
    input.held = false;
    for (let i = 0; i < 20; i++) { input.preTickFastPlace({ enabled: true, delay: 0 }); input.tick(); }
    assert.strictEqual(uses, 5, 'FastPlace never supplies use input');
}
{
    const { BlockHit } = require('../../scripts/development/anticheat_lab/blockhit');
    const input = new CombatInput({ targetAtCursor: () => ({}), attack: () => {}, swing: () => {}, beginUse: () => {}, endUse: () => {} });
    const manual = new BlockHit({ mode: 'manual', chanceMin: 100, chanceMax: 100, input, requireMouse: false });
    const c = { now: 1000, player: true, sword: true, ownHurt: 0, expectedHurt: 0, target: true, crosshair: true, targetHurt: 0 };
    manual.mouseAttack(c);
    assert.strictEqual(input.usePresses, 1, 'KeyBinding.setPressed(true) includes a press tick');
    manual.preTick({ ...c, now: 1050 });
    assert.strictEqual(input.usePresses, 0, 'KeyBinding.setPressed(false) clears pending presses');
    const auto = new BlockHit({ mode: 'auto', input, requireMouse: false });
    assert.deepStrictEqual(Array.from({ length: 6 }, () => auto.shouldBlock(c)), [true, false, false, true, false, false]);
    assert.strictEqual(auto.shouldBlock({ ...c, crosshair: false }), false);
    assert.strictEqual(auto.shouldBlock(c), true, 'Target loss resets Auto streak');
    const predict = new BlockHit({ mode: 'predict', input, requireMouse: false });
    predict.mouseAttack(c); assert.strictEqual(predict.blocking, true);
    predict.livingUpdate({ ...c, now: 1010 }, true);
    predict.preTick({ ...c, now: 1050 });
    assert.strictEqual(predict.blocking, false, 'Living-update executor resets before next pre-tick');
}
{
    const { ClickJitter } = require('../../scripts/development/anticheat_lab/click_jitter');
    assert.strictEqual(new JavaRandom(0).nextFloat(), 0.7309677600860596);
    const draws = [0, 0.5], jitter = new ClickJitter({ nextFloat: () => draws.shift() });
    jitter.press(); assert.strictEqual(jitter.steps, 3.15);
    jitter.tick(); const rotation = jitter.render(0, 0);
    assert.strictEqual(rotation.yaw, Math.fround(-0.3)); assert.strictEqual(rotation.pitch, 0);
    assert.strictEqual(jitter.pendingYaw, 0, 'Recovered floor(normalized remainder) discards fractional residue');
}
{
    const { LegitScaffold } = require('../../scripts/development/anticheat_lab/scaffold_legit');
    const scaffold = new LegitScaffold({ minDelay: 100, maxDelay: 100, constructedAt: 0 });
    const c = { now: 1000, physicalSneak: false, onLadder: false, pitch: 80, canActivate: true,
        forward: -1, grounded: true, wasSneaking: false, hasProjectedCollision: false };
    assert.strictEqual(scaffold.before(c), true);
    assert.strictEqual(scaffold.after(c), false, 'Post-tick restores physical key state');
    assert.strictEqual(scaffold.before({ ...c, now: 1099, wasSneaking: true, hasProjectedCollision: true }), true);
    assert.strictEqual(scaffold.before({ ...c, now: 1100, wasSneaking: true, hasProjectedCollision: true }), false);
    assert.strictEqual(scaffold.before({ ...c, onLadder: true }), null, 'Ladder guard resolves through actual mappings');
    const zero = new LegitScaffold({ minDelay: 0, maxDelay: 0, constructedAt: 0 });
    zero.before(c);
    assert.strictEqual(zero.before({ ...c, now: 1001, hasProjectedCollision: true }), false, 'Zero delay does not retain sneak');
}
console.log('Lab cadence, jitter, packet, input, BlockHit, FastPlace and Legit Scaffold state tests passed; not gameplay trials.');
