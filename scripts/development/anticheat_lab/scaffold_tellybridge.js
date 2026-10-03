'use strict';
const { ScaffoldCore, offset, vectors, placementY } = require('./scaffold_core');
const { angles, rotationSpeed, directionSpeed } = require('./scaffold_rotation');
const { blockAtCursor } = require('./interactions');
const f = Math.fround;
const sameBlock = (a, b) => a && b && a.every((v, i) => Math.floor(v) === Math.floor(b[i]));
const targetFractions = { 6: [0.3, 0.6], 8: [0.7, 0.4], 7: [0.4, 0.3], 5: [0.6, 0.7] };
function movementTarget(p, direction) { return p.map((v, i) => Math.floor(v) + targetFractions[direction][i]); }

class TellyBridge extends ScaffoldCore {
    constructor(bot, input, options = {}) {
        super(bot, input, { yIncrease: 1, requireRightClick: true, ...options });
        this.path = []; this.level = 0; this.wasAirborne = false; this.manualActivationComplete = false;
        this.verticalTarget = null; this.lastAim = null; this.resetState();
    }
    pending() { return this.resetPending; }
    resetState() {
        this.resetPending = true; this.increases = 0; this.task = null; this.bridgingActive = false;
        this.direction = 0; this.path = []; this.heldType = null;
    }
    elevated(p, lateral) {
        const random = 0.45 + this.random.nextDouble() * 0.2, [x, y, z] = p;
        return this.direction === 6 ? [x + random, y + 1, z + 0.5 - lateral]
            : this.direction === 8 ? [x + 1 - random, y + 1, z + 0.5 + lateral]
                : this.direction === 7 ? [x + 0.5 + lateral, y + 1, z + random] : [x + 0.5 - lateral, y + 1, z + 1 - random];
    }
    nextAim() {
        const p = this.path.at(-1); if (!p) throw new Error('Telly path unexpectedly empty');
        if (this.level !== 0 && this.path.length === 4) return this.elevated(p, 0.2);
        const [x, y, z] = p;
        return this.direction === 6 ? [x + 1, y + 0.7, z + 0.2] : this.direction === 8 ? [x, y + 0.7, z + 0.8]
            : this.direction === 7 ? [x + 0.8, y + 0.7, z + 1] : [x + 0.2, y + 0.7, z];
    }
    updateRotation() {
        const target = this.nextAim();
        if (!sameBlock(this.lastAim, target)) {
            this.lastAim = target;
            this.rotation.point(target, directionSpeed(angles(this.bot)[0], this.direction), this.direction, this.path.at(-1));
        }
    }
    repeat(size) { const last = this.path.at(-1); if (!last) throw new Error('Empty Telly path'); this.path = Array(size).fill(last); }
    nextPath(p, size) { const next = p.slice(); if (this.level !== 0 && size === 4) next[1]++; else return offset(next, 1, this.direction); return next; }
    extend() {
        for (let i = this.path.length - 1; i >= Math.max(0, this.path.length - 3) && this.air(this.path[i]); i--) {
            this.lastAim = null; this.path.splice(i, 1);
        }
        const size = this.path.length; if (!size) return;
        const next = this.nextPath(this.path.at(-1), size);
        if (!this.air(next)) { if (size === 6) this.path = []; this.path.push(next); this.rotation.release(); }
    }
    moveTarget(initial) {
        const p = offset(this.path.at(-1), initial ? this.manualActivationComplete ? 4 : 3 : 2, this.direction);
        return movementTarget([p[0], p[2]], this.direction);
    }
    taskTo(target) { this.task = this.submit(target); }
    axisMotion() { return Math.abs(this.direction % 2 === 0 ? this.bot.entity.velocity.x : this.bot.entity.velocity.z); }
    passedPathEdge() {
        const p = this.bot.entity.position, last = this.path.at(-1), d = this.direction;
        if (d === 6) return p.x - (last[0] + 1) < -0.1 && Math.abs(p.z - (last[2] + 0.6)) <= 0.15;
        if (d === 8) return p.x - last[0] > 0.1 && Math.abs(p.z - (last[2] + 0.4)) <= 0.15;
        if (d === 7) return p.z - (last[2] + 1) < -0.1 && Math.abs(p.x - (last[0] + 0.4)) <= 0.15;
        return p.z - last[2] > 0.1 && Math.abs(p.x - (last[0] + 0.6)) <= 0.15;
    }
    heightThreshold() {
        const random = this.random.nextDouble(), n = this.options.yIncrease;
        return n === 0 ? 0 : random < 0.15 ? n + 1 : random < 0.25 ? n - 1 : n;
    }
    initialRotation() {
        let yaw = ({ 6: 230, 8: 50, 7: 320, 5: 140 })[this.direction];
        const sign = this.random.nextDouble() < 0.5 ? -1 : 1;
        yaw += this.random.nextDouble() * sign * 4;
        return [f(yaw), f(90 - this.random.nextDouble() * 5)];
    }
    jumpAtEdge() {
        const last = this.path.at(-1); if (!last) return;
        const p = this.bot.entity.position, d = this.direction;
        const reached = d === 6 ? p.x - (last[0] + 0.8) >= -0.05 : d === 8 ? p.x - (last[0] - 0.2) <= 0.05
            : d === 7 ? p.z - (last[2] + 0.8) >= -0.05 : p.z - (last[2] - 0.2) <= 0.05;
        if (this.bot.entity.onGround && (this.level !== 0 || this.bot.labActualSprinting) && reached) { this.key('jump', true); return; }
        this.key('jump', false); this.key('sprint', true);
    }
    groundClear() {
        const p = this.bot.entity.position, vector = vectors[this.direction];
        return this.bot.entity.onGround && !this.air([Math.floor(p.x + vector[0] * 0.15), placementY(p.y), Math.floor(p.z + vector[1] * 0.15)]);
    }
    lookingAtPlacement() {
        const hit = blockAtCursor(this.bot); if (!hit || !this.path.length) return false;
        return sameBlock(this.path.at(-1), [hit.position.x, hit.position.y, hit.position.z])
            && (this.level !== 0 && this.path.length === 4 ? hit.face === 1 : hit.face > 1);
    }
    updateBridge() {
        if (!this.bridgingActive) return;
        const grounded = this.bot.entity.onGround;
        if (!grounded) this.wasAirborne = true;
        this.extend();
        if (!this.path.length) throw new Error('Visible Telly source would access an empty bridgePath');
        if (grounded && (this.manualActivationComplete || this.wasAirborne)) {
            this.level = this.manualActivationComplete || (this.axisMotion() < 0.1 && this.passedPathEdge()) ? 0 : 1;
            this.manualActivationComplete = false; this.lastAim = null; this.verticalTarget = null;
            if (this.increases >= this.heightThreshold() && this.level === 1) {
                if (this.options.yIncrease === 0 && this.axisMotion() >= 0.6) {
                    this.taskTo(this.moveTarget(false)); this.repeat(5); this.wasAirborne = false;
                    this.jumpAtEdge(); return;
                }
                this.level = 0;
                this.verticalTarget = this.elevated(offset(this.path.at(-1), 1, this.direction), 0);
                this.taskTo(movementTarget([this.verticalTarget[0], this.verticalTarget[2]], this.direction));
                this.repeat(1); this.updateRotation(); return;
            }
            if (this.level === 0) {
                const rotation = this.initialRotation(); this.rotation.fixed(rotation, rotationSpeed(angles(this.bot)[0], rotation[0]));
                this.key('sprint', true); this.taskTo(this.moveTarget(true)); this.repeat(1); this.wasAirborne = false; this.increases = 0;
            } else {
                this.taskTo(this.moveTarget(false)); this.repeat(4); this.increases++; this.wasAirborne = false;
            }
        }
        if (!grounded) this.updateRotation();
        this.jumpAtEdge();
    }
    before(now) {
        if (!this.resetPending && this.bridgingActive && this.lookingAtPlacement()) this.input.presses = 1;
        this.input.held = this.bridgingActive ? false : !!this.physical.use;
        if (this.resetPending) {
            if (this.bridgingActive) { this.resetEdge(now); this.releaseControls(); }
            this.resetState();
            this.resetPending = this.activationStep(position => {
                this.path.push(position);
                const anchor = this.elevated(offset(position, -1, this.direction), 0);
                this.taskTo(movementTarget([anchor[0], anchor[2]], this.direction));
                this.heldType = this.bot.heldItem.type; this.manualActivationComplete = true;
            });
            return;
        }
        if (!this.rotationOwned) { this.resetPending = true; this.restore(); this.resetEdge(now); return; }
        if (!this.ensureBlock(this.heldType, 5)) { this.resetPending = true; this.releaseAll(); this.resetEdge(now); return; }
        if (!this.physical.back || (this.options.requireRightClick && !this.physical.use)) {
            if (!this.bridgingActive || this.groundClear()) {
                if (this.bridgingActive) this.releaseAll();
                this.resetPending = true; this.resetEdge(now); return;
            }
            // Source shouldReset returns false immediately while airborne: it
            // skips the mouse-history check but still runs the bridge below.
        } else if (this.inputHistory() >= 10 && this.bridgingActive) {
            this.releaseAll(); this.resetPending = true; this.resetEdge(now); return;
        }
        if (!this.bridgingActive && this.task?.completed) this.bridgingActive = true;
        this.updateBridge();
    }
}
module.exports = { TellyBridge, movementTarget };
