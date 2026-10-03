'use strict';
const { JavaRandom } = require('./random');
const { Vec3 } = require('./runtime/node_modules/vec3');
const { RotationScheduler, angles, normalized } = require('./scaffold_rotation');
const { edgeBox, hasCollision } = require('./scaffold_legit');
const vectors = { 1: [1, 1], 2: [-1, 1], 3: [-1, -1], 4: [1, -1], 5: [0, -1], 6: [1, 0], 7: [0, 1], 8: [-1, 0] };
const cycle = [5, 4, 6, 1, 7, 2, 8, 3];
const offset = (p, n, d) => [p[0] + (vectors[d]?.[0] ?? 0) * n, p[1], p[2] + (vectors[d]?.[1] ?? 0) * n];
const rotate = (d, n) => cycle[(cycle.indexOf(d) + n + cycle.length) % cycle.length];
const placementY = y => Math.abs(y - Math.trunc(y)) === 0.5 ? Math.floor(y) : Math.floor(y - 1);
class SourceListenerError extends Error {
    constructor(message) { super(message); this.name = 'SourceListenerError'; }
}
function cardinal(yaw) { const a = (normalized(yaw) + 180) % 360; return a > 315 || a <= 45 ? 7 : a <= 135 ? 8 : a <= 225 ? 5 : 6; }
const movementKeys = ['forward', 'right', 'back', 'left'];

class MovementTask {
    constructor(target, restore = false) { this.target = target; this.restore = restore; this.remaining = [0, 0]; this.completed = false; }
    apply(core) {
        if (this.remaining.every(v => v === 0)) return;
        const bot = core.bot, p = bot.entity.position, v = bot.entity.velocity;
        core.key('sneak', !!core.physical.sneak);
        const target = [p.x + this.remaining[0], p.z + this.remaining[1]], projected = [p.x + v.x, p.z + v.z];
        let best = Math.hypot(target[0] - projected[0], target[1] - projected[1]);
        for (const [index, key] of movementKeys.entries()) {
            let step = core.lastSneaking && bot.entity.onGround ? 0.06 : (bot.labActualSprinting ?? core.lastSprinting) && key === 'forward' ? 0.3 : 0.2;
            if (!bot.entity.onGround) step *= 0.02;
            const radians = ((normalized(angles(bot)[0]) + index * 90) % 360) * Math.PI / 180;
            const delta = [-Math.sin(radians) * step, Math.cos(radians) * step];
            const distance = Math.hypot(target[0] - projected[0] - delta[0], target[1] - projected[1] - delta[1]);
            const selected = distance < best;
            if (selected) { projected[0] += delta[0]; projected[1] += delta[1]; best = distance; }
            core.key(key, selected);
        }
    }
    check(core) {
        this.remaining = [this.target[0] - core.bot.entity.position.x, this.target[1] - core.bot.entity.position.z];
        if (this.remaining.every(v => Math.abs(v) <= 0.2)) this.completed = true;
        // Visible Java completes here even if waitForGroundAfterArrival was set.
        if (this.completed) { if (this.restore) core.restore(); else core.releaseMovement(); }
    }
}

class ScaffoldCore {
    constructor(bot, input, options = {}) {
        this.bot = bot; this.input = input; this.options = { activationBlocks: 2, pitchCheck: false, pitchThreshold: 45, ...options };
        bot.labUseVanillaSprintGate = true;
        this.random = new JavaRandom(options.seed ?? 421); this.rotation = new RotationScheduler(bot, options.sensitivity ?? 0.5);
        this.physical = { back: true, use: true }; this.rotationOwned = false; this.history = [];
        this.edgeAt = Date.now() - 10000; this.edgeDelay = 0; this.savedSneak = false;
        this.activeTask = null; this.lastSneaking = false; this.lastSprinting = false;
        this.activationPosition = null; this.activationCount = 0;
    }
    key(key, value) { this.bot.setControlState(key, Boolean(value)); }
    releaseMovement() { for (const key of movementKeys) this.key(key, false); }
    releaseAll() { this.bot.clearControlStates(); this.input.held = false; }
    restore() { for (const key of [...movementKeys, 'jump', 'sneak', 'sprint']) this.key(key, !!this.physical[key]); }
    releaseControls() { this.rotation.release(); if (this.activeTask) this.activeTask.completed = true; this.releaseAll(); this.restore(); }
    submit(target) { const task = new MovementTask(target); this.activeTask = task; return task; }
    air(p) {
        const block = this.bot.blockAt(new Vec3(...p).floored());
        if (!block) throw new Error('Unloaded Scaffold path region');
        return block.type === 0;
    }
    // Full stone is the supported placement material. Item gates are explicit;
    // unsupported blacklist/whitelist block shapes must not count as coverage.
    usable(stack) { return stack?.name === 'stone' && stack.count > 0 && !this.options.rejectStone; }
    blockCount() { return this.bot.inventory.slots.slice(36, 45).reduce((sum, stack) => sum + (this.usable(stack) ? stack.count : 0), 0); }
    ensureBlock(type, minimum = 1) {
        const slots = this.bot.inventory.slots.slice(36, 45), first = slots.findIndex(stack => this.usable(stack));
        if (first < 0 || this.blockCount() < minimum) return false;
        if (type && (!this.usable(this.bot.heldItem) || this.bot.heldItem.type !== type)) {
            const matching = slots.findIndex(stack => this.usable(stack) && stack.type === type);
            this.bot.setQuickBarSlot(matching < 0 ? first : matching);
        }
        return true;
    }
    playerBlock() { const p = this.bot.entity.position; return [Math.floor(p.x), placementY(p.y), Math.floor(p.z)]; }
    edge(contraction = 0.2) { return !hasCollision(this.bot, edgeBox(this.bot, contraction)); }
    resetEdge(now) { this.edgeAt = now; this.edgeDelay = Math.trunc(100 + this.random.nextDouble() * 100); }
    edgeBefore(now) {
        if (this.options.pitchCheck && angles(this.bot)[1] < this.options.pitchThreshold) { this.rotationOwned = false; return; }
        this.savedSneak = this.bot.getControlState('sneak');
        const forward = Number(!!this.physical.forward) - Number(!!this.physical.back);
        let sneak = forward <= 0 && this.bot.entity.onGround && this.edge(), retained = false;
        if (sneak) this.rotationOwned = true;
        if (this.rotationOwned && (forward > 0 || (!sneak && now - this.edgeAt >= 500))) this.rotationOwned = false;
        if (!sneak && now - this.edgeAt < this.edgeDelay && this.edgeDelay > 30) { sneak = true; retained = true; }
        if (sneak && this.bot.entity.onGround) {
            if (!this.lastSneaking) this.edgeDelay = Math.trunc(100 + this.random.nextDouble() * 100);
            this.key('sneak', true); if (!retained) this.edgeAt = now;
        } else if (!this.savedSneak) this.key('sneak', false);
    }
    edgeAfter() { if (!this.options.pitchCheck || angles(this.bot)[1] >= this.options.pitchThreshold) this.key('sneak', this.savedSneak); }
    inputHistory() {
        // Same list mutation (normally six entries); fixture supplies genuine
        // external mouse movement counts, never the controller's own rotations.
        this.history.unshift(Math.abs(this.physical.mouseX || 0)); this.history.unshift(Math.abs(this.physical.mouseY || 0));
        for (let i = 6; i < this.history.length; i++) this.history.splice(i, 1);
        this.physical.mouseX = this.physical.mouseY = 0;
        return this.history.reduce((sum, value) => sum + value, 0);
    }
    activationStep(onReady) {
        if (!this.usable(this.bot.heldItem)) { this.activationPosition = null; this.activationCount = 0; return true; }
        const d = cardinal(angles(this.bot)[0]), player = this.playerBlock();
        if (this.direction !== 0 && this.direction !== d) { this.activationPosition = null; this.activationCount = 0; }
        this.direction = d;
        if (!this.activationPosition && this.bot.entity.onGround) {
            this.activationPosition = [player, offset(player, 1, d), offset(player, 2, d)].find(p => this.air(p)) ?? null;
        } else if (this.activationPosition) {
            if (this.activationCount >= this.options.activationBlocks) {
                onReady(this.activationPosition.slice()); this.activationPosition = null; this.activationCount = 0; return false;
            }
            if (!this.air(this.activationPosition)) {
                this.activationCount++;
                const next = offset(this.activationPosition, 1, d);
                if (this.air(next) && this.activationCount < this.options.activationBlocks) this.activationPosition = next;
                else if (!this.air(next)) { this.activationPosition = null; this.activationCount = 0; }
            } else {
                const p = this.activationPosition, perpendicular = d % 2 === 0 ? 2 : 0;
                const origin = offset(p, -this.activationCount, d);
                if ((d > 4 && p[perpendicular] !== player[perpendicular]) || (d < 5 && Math.abs(p[0] - player[0]) >= 4)
                    || Math.abs(p[2] - player[2]) >= 4 || p[1] !== player[1]
                    || Math.hypot(...origin.map((value, i) => value - player[i])) > this.options.activationBlocks + 2) {
                    this.activationPosition = null; this.activationCount = 0;
                }
            }
        }
        return true;
    }
    attach() {
        // EventBus iterates enum values ascending: LOWEST rotation precedes
        // NORMAL movement/module. Vape.registerListeners registers the task
        // manager before the module manager. Do not infer order from the names.
        this.onBefore = e => {
            this.rotation.preTick(performance.now()); this.activeTask?.apply(this);
            try { this.before(e.t); }
            catch (error) {
                // EventBus.java:132 catches Throwable per listener. Preserve only
                // an explicitly traced source exception, never swallow lab bugs.
                if (!(error instanceof SourceListenerError)) throw error;
                this.bot.emit('labSourceListenerError', { t: e.t, message: error.message });
            }
        };
        this.onInput = () => this.input.tick();
        this.onPlayer = e => {
            if (this.pending()) this.edgeBefore(e.t);
            if (this.activeTask) { this.activeTask.check(this); if (this.activeTask.completed) this.activeTask = null; }
            this.lastSneaking = this.bot.getControlState('sneak'); this.lastSprinting = !!this.bot.labActualSprinting;
        };
        this.onPost = () => { if (this.pending()) this.edgeAfter(); };
        this.onRender = () => this.rotation.render(performance.now());
        for (const [event, fn] of [['labBeforeTick', this.onBefore], ['labInputTick', this.onInput], ['labPrePlayerTick', this.onPlayer],
            ['labPostPlayerTick', this.onPost], ['labRenderFrame', this.onRender]]) this.bot.on(event, fn);
    }
    detach() {
        for (const [event, fn] of [['labBeforeTick', this.onBefore], ['labInputTick', this.onInput], ['labPrePlayerTick', this.onPlayer],
            ['labPostPlayerTick', this.onPost], ['labRenderFrame', this.onRender]]) this.bot.removeListener(event, fn);
        this.releaseControls(); this.releaseAll();
    }
}
module.exports = { ScaffoldCore, MovementTask, SourceListenerError, vectors, cycle, offset, rotate, placementY, cardinal };
