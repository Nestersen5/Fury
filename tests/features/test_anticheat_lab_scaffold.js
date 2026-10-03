'use strict';
const assert = require('assert');
const { Rotation, RotationScheduler, angles, mouseScale, setAngles } = require('../../scripts/development/anticheat_lab/scaffold_rotation');
const { MovementTask, cardinal, placementY, offset, rotate } = require('../../scripts/development/anticheat_lab/scaffold_core');
const { anchor, pastCorner } = require('../../scripts/development/anticheat_lab/scaffold_godbridge');
const { ScaffoldCore, SourceListenerError } = require('../../scripts/development/anticheat_lab/scaffold_core');
const { movementTarget } = require('../../scripts/development/anticheat_lab/scaffold_tellybridge');
function fakeBot() {
    return { entity: { yaw: Math.PI, pitch: 0, position: { x: 0, y: 80, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, onGround: true },
        labClock: { speed: 1, partial: 0.5 } };
}
assert.deepStrictEqual([0, 90, 180, 270, -90].map(cardinal), [5, 6, 7, 8, 8]);
assert.deepStrictEqual([64, 64.5, 64.50001, -2.5].map(placementY), [63, 64, 63, -3]);
assert.deepStrictEqual(offset([2, 79, 3], 2, 4), [4, 79, 1]);
assert.strictEqual(rotate(5, -1), 3); assert.strictEqual(rotate(3, 1), 5);
assert.deepStrictEqual(anchor([2.9, -1.1], 6, true), [2.8, -1.2]);
assert.deepStrictEqual(movementTarget([2.9, -1.1], 6), [2.3, -1.4]);
assert.strictEqual(pastCorner({ x: 2.9, z: 0.9 }, 6), true);
assert.strictEqual(pastCorner({ x: -2.9, z: -0.9 }, 8), false, 'Preserve negative fraction quirk');
assert.strictEqual(mouseScale(0.5), 1);
{
    assert.throws(() => anchor(null, 2, false), SourceListenerError);
    const { EventEmitter } = require('events'), bot = Object.assign(new EventEmitter(), fakeBot());
    const core = new ScaffoldCore(bot, { tick() {} }); let continued = false, logged = 0;
    core.before = () => anchor(null, 2, false);
    bot.on('labSourceListenerError', () => logged++); core.attach();
    bot.on('labBeforeTick', () => { continued = true; }); bot.emit('labBeforeTick', { t: 1 });
    assert(continued && logged === 1, 'Recovered EventBus catches source listener exceptions and continues dispatch');
    core.before = () => { throw new Error('untraced lab bug'); };
    assert.throws(() => bot.emit('labBeforeTick', { t: 2 }), /untraced lab bug/, 'Do not hide implementation errors');
}
{
    const bot = fakeBot(), rotation = new Rotation(bot, { yaw: 90, pitch: 0, speed: 2 });
    rotation.update();
    assert.strictEqual(angles(bot)[0], 0.75, 'First step: .5 base + 4.5 error acceleration = five mouse counts');
    for (let i = 0; i < 1000; i++) rotation.update();
    assert(Math.abs(angles(bot)[0] - 90) <= 0.6);
    assert(Math.abs(angles(bot)[1]) < 0.001);
}
{
    const bot = fakeBot(), rotation = new Rotation(bot, { yaw: 1, pitch: 0, speed: 2, tolerance: 0 });
    rotation.update(); assert(angles(bot)[0] === 0 && rotation.pending[0] > 0.5);
    rotation.update(); assert(angles(bot)[0] > 0 && rotation.pending[0] > 0, 'Preserve fractional mouse residue');
    setAngles(bot, 0, 89.9); rotation.setTarget(0, 200);
    for (let i = 0; i < 100; i++) rotation.update();
    assert(Math.abs(angles(bot)[1]) <= 90, 'Mouse application clamps pitch');
}
{
    const bot = fakeBot(), scheduler = new RotationScheduler(bot); let updates = 0;
    scheduler.controller = { update() { updates++; } }; scheduler.reset(0);
    scheduler.preTick(0); assert.strictEqual(updates, 50);
    scheduler.render(8); scheduler.render(24); scheduler.render(48); assert.strictEqual(updates, 98);
    scheduler.preTick(50); assert.strictEqual(updates, 100, 'Pre-tick tops up elapsed render updates');
}
{
    const bot = fakeBot(), keys = {}, core = { bot, physical: {}, key(k, v) { keys[k] = v; },
        releaseMovement() { for (const k of ['forward', 'right', 'back', 'left']) keys[k] = false; }, restore() {} };
    const task = new MovementTask([1, 0]); task.check(core); task.apply(core);
    assert.strictEqual(keys.left, true); assert.strictEqual(keys.right, false);
    bot.entity.position.x = 0.9; bot.entity.onGround = false; task.check(core);
    assert.strictEqual(task.completed, true, 'Visible source completes on arrival even while airborne');
}
console.log('Scaffold numerical/state checks passed; automatic gameplay remains separately verified.');
{
    const { SprintState } = require('../../scripts/development/anticheat_lab/sprint_state');
    const s = new SprintState(), c = { forward: true, back: false, sneak: false, sprint: true, grounded: true };
    assert.strictEqual(s.tick(c), true);
    assert.strictEqual(s.tick({ ...c, forward: false, back: true }), false, 'Sprint key cannot sprint backward');
    assert.strictEqual(s.tick({ ...c, sneak: true }), false);
    assert.strictEqual(s.tick({ ...c, food: 6 }), false);
    assert.strictEqual(s.tick({ ...c, usingItem: true }), false);
}
