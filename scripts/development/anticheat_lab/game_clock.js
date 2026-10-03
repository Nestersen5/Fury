'use strict';
const assert = require('assert');
const { Physics, PlayerState } = require('./runtime/node_modules/prismarine-physics');
const { SprintState } = require('./sprint_state');
const { VanillaMovementFactors } = require('./vanilla_movement_factors');

// Independent headless 1.8.9 tick/input/movement adapter. Collision integration
// belongs to trusted prismarine-physics. No recovered client code is loaded.
// Supported here: on-foot survival, controls, rotation, knockback and teleport.
// GUI, mounts, death/respawn and rendering require separate adapters/trials.
class GameClock {
    constructor(speed = 1) { this.partial = 0; this.setSpeed(speed); this.discardedTicks = 0; }
    setSpeed(speed) {
        assert(Number.isFinite(speed) && speed >= 0.1 && speed <= 2);
        this.speed = Math.fround(speed);
    }
    advance(elapsedMs) {
        this.partial = Math.fround(this.partial + Math.max(0, Math.min(1000, elapsedMs)) * this.speed / 50);
        const whole = Math.trunc(this.partial);
        this.partial = Math.fround(this.partial - whole);
        this.discardedTicks += Math.max(0, whole - 10);
        return Math.min(10, whole);
    }
}

function gamePhysics(bot, options = {}) {
    assert(bot.version.startsWith('1.8'), 'Lab clock supports Minecraft 1.8 only');
    const frameMs = options.labFrameMs ?? 8;
    assert(Number.isFinite(frameMs) && frameMs >= 1 && frameMs <= 50, 'Lab frame interval must be 1..50ms');
    const control = Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(key => [key, false]));
    const world = { getBlock: position => bot.blockAt(position, false) };
    const physics = Physics(bot.registry, world);
    const clock = new GameClock();
    const sprintState = new SprintState();
    const movementFactors = options.labVanillaFactors ? new VanillaMovementFactors() : null;
    bot.physics = physics; bot.labClock = clock; bot.physicsEnabled = true;
    bot.jumpQueued = false; bot.jumpTicks = 0;
    let active = false, timer, frameTime, tickNumber = 0, updateTicks = 0;
    let last = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, sneak: false, sprint: false };
    const yawDegrees = radians => Math.fround(180 - radians * 180 / Math.PI);
    const pitchDegrees = radians => Math.fround(-radians * 180 / Math.PI);
    bot.setControlState = (key, value) => {
        assert(key in control && typeof value === 'boolean');
        if (key === 'jump' && value && !control.jump) bot.jumpQueued = true;
        control[key] = value;
    };
    bot.getControlState = key => { assert(key in control); return control[key]; };
    bot.clearControlStates = () => { for (const key of Object.keys(control)) bot.setControlState(key, false); };
    bot.controlState = {};
    for (const key of Object.keys(control)) Object.defineProperty(bot.controlState, key, {
        get: () => control[key], set: value => bot.setControlState(key, value)
    });
    // Headless, explicit instantaneous rotation. Scaffold uses its own audited
    // interpolation controller before this method, rather than Mineflayer's turn cap.
    bot.look = async (yaw, pitch) => {
        assert(Number.isFinite(yaw) && Number.isFinite(pitch));
        bot.entity.yaw = yaw; bot.entity.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    };
    bot.lookAt = async point => {
        const delta = point.minus(bot.entity.position.offset(0, control.sneak ? 1.54 : 1.62, 0));
        return bot.look(Math.atan2(-delta.x, -delta.z), Math.atan2(delta.y, Math.hypot(delta.x, delta.z)));
    };
    bot.waitForTicks = ticks => new Promise((resolve, reject) => {
        if (ticks <= 0) return resolve();
        const timeout = setTimeout(() => { bot.removeListener('physicsTick', listener); reject(new Error('Lab tick wait timeout')); }, ticks * 500 + 5000);
        const listener = () => { if (--ticks <= 0) { clearTimeout(timeout); bot.removeListener('physicsTick', listener); resolve(); } };
        bot.on('physicsTick', listener);
    });
    function tick() {
        if (!active || !bot.physicsEnabled || bot._client.state !== 'play' || !bot.entity?.position || !bot.blockAt(bot.entity.position)) return;
        if (bot.isAlive === false) { active = false; bot.emit('labUnsupportedState', 'death'); return; }
        const event = { tick: ++tickNumber, t: Date.now(), speed: clock.speed };
        bot.emit('labBeforeTick', event);
        bot.emit('labInputTick', event);
        bot.emit('labPrePlayerTick', event);
        bot.labPreviousPosition = bot.entity.position.clone();
        let simulationControl = control;
        if (bot.labUseVanillaSprintGate) {
            physics.negligeableVelocity = 0.005;
            bot.labActualSprinting = sprintState.tick({ ...control, grounded: bot.entity.onGround, usingItem: bot.usingHeldItem,
                food: bot.food, collided: bot.entity.isCollidedHorizontally, blind: Boolean(bot.entity.effects?.[15]) });
            simulationControl = { ...control, sprint: bot.labActualSprinting };
        }
        const state = new PlayerState(bot, simulationControl);
        if (movementFactors) movementFactors.prepare(state, physics);
        physics.simulatePlayer(state, world).apply(bot);
        bot.entity.eyeHeight = control.sneak ? 1.54 : 1.62;
        const entity = bot.entity;
        // Packet order follows EntityPlayerSP.onUpdateWalkingPlayer: states first.
        for (const [key, enabled, disabled] of [['sprint', 3, 4], ['sneak', 0, 1]]) {
            if (simulationControl[key] !== last[key]) {
                bot._client.write('entity_action', { entityId: entity.id, actionId: simulationControl[key] ? enabled : disabled, jumpBoost: 0 });
                last[key] = simulationControl[key];
            }
        }
        const yaw = yawDegrees(entity.yaw), pitch = pitchDegrees(entity.pitch), position = entity.position;
        const moved = (position.x - last.x) ** 2 + (position.y - last.y) ** 2 + (position.z - last.z) ** 2 > 0.0009 || updateTicks >= 20;
        const looked = yaw !== last.yaw || pitch !== last.pitch;
        const packet = { onGround: entity.onGround };
        if (moved) Object.assign(packet, { x: position.x, y: position.y, z: position.z });
        if (looked) Object.assign(packet, { yaw, pitch });
        bot._client.write(moved ? (looked ? 'position_look' : 'position') : (looked ? 'look' : 'flying'), packet);
        updateTicks++;
        if (moved) { Object.assign(last, { x: position.x, y: position.y, z: position.z }); updateTicks = 0; }
        if (looked) Object.assign(last, { yaw, pitch });
        bot.emit('physicsTick');
        bot.emit('move');
        bot.emit('labPostPlayerTick', event);
    }
    bot._client.on('position', packet => {
        const entity = bot.entity;
        const angles = { yaw: yawDegrees(entity.yaw), pitch: pitchDegrees(entity.pitch) };
        for (const [key, bit] of [['x', 1], ['y', 2], ['z', 4]]) {
            if (packet.flags & bit) entity.position[key] += packet[key];
            else { entity.position[key] = packet[key]; entity.velocity[key] = 0; }
        }
        const yaw = packet.yaw + (packet.flags & 8 ? angles.yaw : 0);
        const pitch = packet.pitch + (packet.flags & 16 ? angles.pitch : 0);
        entity.yaw = (180 - yaw) * Math.PI / 180; entity.pitch = -pitch * Math.PI / 180;
        entity.height = 1.8; entity.eyeHeight = 1.62; entity.onGround = false;
        bot._client.write('position_look', { x: entity.position.x, y: entity.position.y, z: entity.position.z, yaw, pitch, onGround: false });
        last = { ...last, x: entity.position.x, y: entity.position.y, z: entity.position.z, yaw, pitch };
        updateTicks = 0; bot.jumpTicks = 0; active = true;
        bot.emit('forcedMove');
    });
    bot._client.on('explosion', packet => {
        if (bot.entity && bot.game.gameMode !== 'creative') for (const [axis, suffix] of [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) bot.entity.velocity[axis] += packet['playerMotion' + suffix] || 0;
    });
    bot.on('mount', () => { active = false; bot.emit('labUnsupportedState', 'mount'); });
    bot.on('login', () => {
        frameTime = performance.now();
        timer = setInterval(() => {
            const now = performance.now(), elapsed = now - frameTime; frameTime = now;
            const count = clock.advance(elapsed);
            try {
                for (let i = 0; i < count; i++) tick();
                bot.emit('labRenderFrame', { t: Date.now(), elapsedMs: elapsed, partialTicks: clock.partial });
            } catch (error) {
                active = false; clearInterval(timer);
                bot.emit('labUnsupportedState', { kind: 'adapter-error', message: error.message, stack: error.stack });
                bot.emit('error', error); // Lab owns this listener and invalidates the trial.
            }
        }, frameMs);
    });
    bot.on('end', () => clearInterval(timer));
}
module.exports = { GameClock, gamePhysics };
