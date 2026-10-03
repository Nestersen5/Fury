'use strict';
const { ScaffoldCore, SourceListenerError, offset, rotate, vectors, placementY } = require('./scaffold_core');
const { angles, normalized, angularDistance, rotationSpeed } = require('./scaffold_rotation');
const { blockAtCursor } = require('./interactions');
const f = Math.fround;
const bounds = { 6: [135, 45], 8: [315, 225], 7: [225, 135], 5: [45, 315] };
const fractions = { 1: [[0.35, 0.65], [0.65, 0.35]], 2: [[0.35, 0.35], [0.65, 0.65]],
    3: [[0.65, 0.35], [0.35, 0.65]], 4: [[0.65, 0.65], [0.35, 0.35]],
    6: [[0.8, 0.2], [0.8, 0.8]], 8: [[0.2, 0.8], [0.2, 0.2]],
    7: [[0.8, 0.8], [0.2, 0.8]], 5: [[0.2, 0.2], [0.8, 0.2]] };
function anchor(point, direction, reversed) {
    if (point == null) throw new SourceListenerError('GodBridge computePlacementPoint received null pendingPos after recovery while switching (BlatantScaffoldMode.java:462,471,703).');
    const fraction = fractions[direction]?.[Number(reversed)];
    return fraction ? point.map((value, i) => Math.floor(value) + fraction[i]) : point.slice();
}
function pastCorner(p, d) {
    const x = p.x - Math.floor(p.x), z = p.z - Math.floor(p.z);
    // Preserve recovered asymmetric negative-direction tests verbatim in meaning.
    return d < 5 ? vectors[d][0] * x + vectors[d][1] * z > 1
        : d === 6 ? x > 0.5 : d === 8 ? -x > 0.5 : d === 7 ? z > 0.5 : -z > 0.5;
}

class GodBridge extends ScaffoldCore {
    constructor(bot, input, options) {
        super(bot, input, options); this.reversed = false; this.rotationPending = false; this.taskBlocks = false;
        this.moveAt = Date.now() - 10000; this.switchAt = this.moveAt; this.resetState();
    }
    pending() { return this.activationPending; }
    resetState() {
        Object.assign(this, { activationPending: true, target: null, task: null, taskTicks: 0, targetRotation: null,
            prevLeft: false, prevRight: false, switching: false, atEdge: true, direction: 0, pendingDirection: 0,
            heldType: null, pendingReversed: false, keyIdle: true }); this.history = [];
        // place/count, reversed, rotationPending, taskBlocks and timers are not reset in visible source.
    }
    reverseFor(d) {
        if (d < 5) return !this.reversed;
        const yaw = normalized(angles(this.bot)[0]);
        return angularDistance(yaw, bounds[d][0]) <= angularDistance(yaw, bounds[d][1]);
    }
    sampleSupport(distance) {
        const p = this.bot.entity.position, d = this.direction;
        let x = p.x + vectors[d][0] * distance, z = p.z + vectors[d][1] * distance;
        if (d > 4) { if (d % 2 === 0) z = this.target[1]; else x = this.target[0]; }
        return !this.air([Math.floor(x), placementY(p.y), Math.floor(z)]);
    }
    edgeNow() { return this.direction > 4 ? !this.sampleSupport(-0.15) : this.edge(0.16); }
    bridgeKeys(now) {
        this.atEdge = this.edgeNow(); if (!this.atEdge) this.moveAt = now;
        if (this.atEdge) { this.key('back', false); this.key('left', false); this.key('right', false); }
        else {
            this.key('back', true);
            if (this.direction > 4) this.key(this.reversed ? 'right' : 'left', true);
            else { this.key('left', false); this.key('right', false); }
        }
    }
    targetAngles(now) {
        const d = this.direction;
        if (d < 5 && d > 0) {
            const target = anchor(this.target, d, this.reversed), p = this.bot.entity.position;
            const length = Math.trunc(Math.hypot(target[0] - p.x, target[1] - p.z) + this.blockCount());
            const side = f(length * vectors[d][0] * (p.z - target[1]) - length * vectors[d][1] * (p.x - target[0]));
            return [f(({ 1: 135, 2: -135, 3: -45, 4: 45 })[d] - f(f(0.1) * side)), now - this.moveAt > 500 ? 83 : 81];
        }
        const p = this.bot.labPreviousPosition ?? this.bot.entity.position, [tx, tz] = this.target;
        const yaw = d === 6 ? (this.reversed ? 135 : 45) + 20 * (tz - p.z)
            : d === 8 ? (this.reversed ? -45 : -135) - 20 * (tz - p.z)
                : d === 7 ? (this.reversed ? -135 : 135) + 20 * (p.x - tx)
                    : d === 5 ? (this.reversed ? 45 : -45) + 20 * (tx - p.x) : angles(this.bot)[0];
        return [f(yaw), now - this.moveAt >= 300 ? 80 : 78];
    }
    setRotation(target, divisor, local = false) {
        this.targetRotation = target;
        this.rotation.fixed(target, rotationSpeed(angles(this.bot)[0], target[0], divisor), local);
    }
    startTask(target, limit = 40) { this.task = this.submit(target); this.taskTicks = 0; this.taskLimit = limit; this.taskBlocks = true; }
    advanceTask() {
        if (!this.task) return false;
        if (!this.task.completed && this.taskTicks < this.taskLimit) { this.taskTicks++; return this.taskBlocks; }
        if (this.task.completed) { this.taskTicks = 0; this.taskBlocks = false; return false; }
        this.task.completed = true; this.task = null; this.taskTicks = 0; this.taskBlocks = false; return true;
    }
    switchingStep(now) {
        if (this.task?.completed && this.switching) {
            Object.assign(this, { atEdge: true, task: null, target: this.pendingTarget, direction: this.pendingDirection,
                reversed: this.pendingReversed, switching: false, moveAt: now, switchAt: now });
            this.releaseMovement(); this.setRotation(this.targetAngles(now), this.direction < 5 ? 15 : 12, true);
            this.rotationPending = true; return true;
        }
        const left = !!this.physical.left, right = !!this.physical.right;
        if (!this.switching) {
            const lt = this.keyIdle ? left && !this.prevLeft : !left && this.prevLeft;
            const rt = this.keyIdle ? right && !this.prevRight : !right && this.prevRight;
            this.prevLeft = left; this.prevRight = right;
            if (this.keyIdle && now - this.switchAt >= 0) {
                this.keyIdle = !lt && !rt;
                if (lt) this.pendingDirection = rotate(this.direction, 1); else if (rt) this.pendingDirection = rotate(this.direction, -1);
            } else if (!this.keyIdle) {
                this.keyIdle = lt || rt;
                if (lt) this.pendingDirection = rotate(this.direction, -1); else if (rt) this.pendingDirection = rotate(this.direction, 1);
            } else { if (left) this.key('left', false); else if (right) this.key('right', false); return false; }
            this.switching = lt || rt;
        }
        if (!this.switching) return false;
        this.task = null;
        const p = this.bot.entity.position, block = this.playerBlock();
        if (!this.air(block) && !this.edge() && !pastCorner(p, this.direction)) {
            this.pendingReversed = this.reverseFor(this.pendingDirection);
            this.pendingTarget = anchor([block[0], block[2]], this.pendingDirection, this.pendingReversed);
            this.releaseControls();
            if ((this.direction > 4 && !this.reversed && this.pendingDirection === rotate(this.direction, -1))
                || (this.direction > 4 && this.reversed && this.pendingDirection === rotate(this.direction, 1))
                || (Math.abs(p.x - this.pendingTarget[0]) <= 0.15 && Math.abs(p.z - this.pendingTarget[1]) <= 0.15)) this.task = { completed: true };
            else this.startTask(this.pendingTarget);
        } else if (!this.reversed) {
            if (left && this.edgeNow()) this.key('left', false); else if (right) this.key('right', false);
        } else if (right && this.edgeNow()) this.key('right', false); else if (left) this.key('left', false);
        return false;
    }
    recoveryAnchor() {
        let p = this.playerBlock(); if (this.bot.entity.velocity.y > 0) p[1]++;
        if (this.air(p)) {
            p = offset(p, -1, this.direction);
            if (this.air(p)) { p = offset(p, 1, rotate(this.direction, 2)); if (this.air(p)) p = offset(p, -2, rotate(this.direction, 2)); }
        }
        return p;
    }
    before(now) {
        const hit = blockAtCursor(this.bot);
        if (!this.activationPending && hit && (Math.abs(this.bot.entity.velocity.y) > 0.1 || this.switching ? hit.face !== 0 : hit.face > 1)) this.input.presses = 1;
        if (!this.activationPending && !this.rotationPending && !this.taskBlocks) this.bridgeKeys(now);
        if (this.activationPending) {
            if (this.task || this.targetRotation) { this.releaseControls(); this.resetEdge(now); }
            this.resetState();
            this.activationPending = this.activationStep(position => {
                this.reversed = this.reverseFor(this.direction); this.target = anchor([position[0], position[2]], this.direction, this.reversed);
                this.heldType = this.bot.heldItem.type;
                if (!this.physical.jump) { this.startTask(this.target); this.setRotation(this.targetAngles(now), 15); }
                this.moveAt = now;
            });
            this.input.held = !!this.physical.use;
            return;
        }
        this.input.held = false;
        let release = !this.rotationOwned || !this.ensureBlock(this.heldType);
        if (!release && !this.physical.back && this.sampleSupport(this.direction < 5 ? 0.2 : 0.25)) release = true;
        if (!release && this.inputHistory() >= 10) release = true;
        if (release) { this.activationPending = true; this.releaseMovement(); this.rotation.release(); this.resetEdge(now); return; }
        let offTarget = false;
        if (this.rotationPending && this.rotation.controller) {
            if (angularDistance(normalized(angles(this.bot)[0]), this.rotation.controller.target[0]) > 4) offTarget = true;
            else { this.rotation.release(); this.rotationPending = false; }
        }
        const taskBlocking = this.advanceTask();
        if (offTarget || taskBlocking || this.switchingStep(now)) return;
        if (now - this.moveAt >= 800) {
            const point = this.recoveryAnchor(); this.target = anchor([point[0], point[2]], this.direction, this.reversed);
            this.setRotation(this.targetAngles(now), 15); this.startTask(this.target); this.atEdge = true; this.moveAt = now; return;
        }
        if (this.direction === 0) this.targetRotation = [angles(this.bot)[0], 90];
        else {
            const target = this.targetAngles(now);
            if (!this.rotation.controller || !this.targetRotation || target.some((value, i) => value !== this.targetRotation[i])) this.setRotation(target, 15);
        }
        this.bridgeKeys(now);
    }
}
module.exports = { GodBridge, anchor, pastCorner };
