'use strict';
// Independently authored numerical/state model. Audited references:
// FixedRotationController, MouseRotationController, PointRotationController,
// ScaffoldPointRotationController and RotationManager (see SOURCE_AUDIT.md).
const f = Math.fround;
const wrap = a => { a %= 360; return a >= 180 ? a - 360 : a < -180 ? a + 360 : a; };
const normalized = a => (a % 360 + 360) % 360;
const angularDistance = (a, b) => Math.min(Math.abs(a - b), Math.abs(360 - a + b));
function mouseScale(sensitivity) {
    const base = f(f(f(sensitivity) * f(0.6)) + f(0.2));
    return f(f(f(base * base) * base) * 8);
}
function angles(bot) { return [f(180 - bot.entity.yaw * 180 / Math.PI), f(-bot.entity.pitch * 180 / Math.PI)]; }
function setAngles(bot, yaw, pitch) { bot.entity.yaw = (180 - f(yaw)) * Math.PI / 180; bot.entity.pitch = -f(Math.max(-90, Math.min(90, pitch))) * Math.PI / 180; }
function rotationSpeed(yaw, target, divisor = 8) { return f(Math.min(2 + angularDistance(normalized(yaw), target) / divisor, 12)); }
function directionSpeed(yaw, direction) { return rotationSpeed(yaw, ({ 6: 90, 8: 270, 7: 0, 5: 180 })[direction] ?? normalized(yaw)); }

class Rotation {
    constructor(bot, { sensitivity = 0.5, yaw = 0, pitch = 90, speed = 2, tolerance = 0.5, proportional = false,
        point = null, direction = null, placement = null } = {}) {
        Object.assign(this, { bot, sensitivity, tolerance, proportional, point, direction, placement });
        this.pending = [0, 0]; this.speedInitialized = false; this.setTarget(yaw, pitch, speed);
    }
    setTarget(yaw, pitch, speed = this.speed) { this.target = [f(yaw), f(pitch)]; this.speed = f(Math.max(2, Math.min(12, speed))); }
    errors(pitchAxis) {
        const current = angles(this.bot), scale = mouseScale(this.sensitivity);
        if (pitchAxis && current[1] === -90) current[1] = f(-89.99);
        const predicted = [f(current[0] + f(f(Math.trunc(this.pending[0]) * scale) * f(0.15))),
            f(current[1] - f(f(Math.trunc(-this.pending[1]) * scale) * f(0.15)))];
        return this.target.map((target, i) => wrap(f(f(target - predicted[i]) % 360)));
    }
    axis(index) {
        const error = this.errors(index === 1), absolute = Math.abs(error[index]), perStep = f(mouseScale(this.sensitivity) * f(0.15));
        if (Math.round(absolute / perStep) <= Math.max(Math.round(f(this.tolerance / perStep)), 0)) return;
        let step = this.speed * 0.25;
        const ratio = absolute / Math.abs(error[1 - index]);
        if (this.proportional && ratio < 1) step *= ratio;
        step += absolute * 0.05;
        step = Math.min(step, Math.abs(error[index] / perStep));
        this.pending[index] = f(this.pending[index] + (error[index] > 0 ? step : -step));
    }
    updatePoint() {
        const bot = this.bot, p = bot.entity.position, previous = bot.labPreviousPosition ?? p, partial = bot.labClock?.partial ?? 1;
        const eye = [previous.x + (p.x - previous.x) * partial,
            previous.y + (p.y - previous.y) * partial + (bot.entity.eyeHeight ?? 1.62),
            previous.z + (p.z - previous.z) * partial];
        const delta = eye.map((v, i) => v - this.point[i]), yaw = Math.atan2(delta[0], -delta[2]) * 180 / Math.PI;
        let pitchRadians = Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
        // Literal recovered degree/radian quirk: 90 is assigned before conversion.
        if (Math.abs(wrap(Math.trunc((yaw - angles(bot)[0]) % 360))) > 90) pitchRadians = 90;
        this.target = [f(yaw), f(pitchRadians * 180 / Math.PI)];
        this.axis(1);
        const priorX = Math.floor(p.x - bot.entity.velocity.x), priorZ = Math.floor(p.z - bot.entity.velocity.z);
        const canTurn = this.direction === 6 ? priorX > Math.floor(this.placement[0])
            : this.direction === 8 ? priorX < Math.floor(this.placement[0])
                : this.direction === 7 ? priorZ > Math.floor(this.placement[2]) : priorZ < Math.floor(this.placement[2]);
        if (canTurn) {
            if (!this.speedInitialized) { this.speed = directionSpeed(angles(bot)[0], this.direction); this.speedInitialized = true; }
            this.axis(0);
        }
    }
    update() {
        if (this.point) this.updatePoint(); else { this.axis(0); this.axis(1); }
        const scale = mouseScale(this.sensitivity), current = angles(this.bot), integer = this.pending.map(Math.trunc);
        // Fractional mouse counts survive this controller, unlike ClickJitter.
        this.pending = this.pending.map((value, i) => f(value - integer[i]));
        setAngles(this.bot, f(current[0] + f(integer[0] * scale) * 0.15), f(current[1] + f(integer[1] * scale) * 0.15));
    }
}

class RotationScheduler {
    constructor(bot, sensitivity = 0.5) { Object.assign(this, { bot, sensitivity }); this.controller = null; this.reset(); }
    reset(now = Date.now()) { this.accumulator = 0; this.updatesThisTick = 0; this.lastTime = now; }
    advance(count) {
        this.accumulator += count;
        const whole = Math.round(this.accumulator);
        if (whole > 20000) throw new Error('Rotation scheduler overload; invalidate trial');
        for (let i = 0; i < whole; i++) { this.controller.update(); this.updatesThisTick++; }
        this.accumulator -= whole;
    }
    preTick(now) {
        if (!this.controller) { this.reset(now); return; }
        this.lastTime = now;
        const scale = f(1 / mouseScale(this.sensitivity));
        this.advance(Math.max(Math.round(f(50 * scale)) - this.updatesThisTick, 0));
        this.updatesThisTick = 0;
    }
    render(now) {
        if (!this.controller) { this.reset(now); return; }
        this.advance((now - this.lastTime) * this.bot.labClock.speed * f(1 / mouseScale(this.sensitivity)));
        this.lastTime = now;
    }
    fixed(target, speed, local = false) {
        if (!this.controller || this.controller.point) this.controller = new Rotation(this.bot, {
            sensitivity: this.sensitivity, yaw: target[0], pitch: target[1], speed, tolerance: local ? 0 : 0.5, proportional: local
        });
        else this.controller.setTarget(...target, speed);
    }
    point(target, speed, direction, placement) {
        if (!this.controller?.point) this.controller = new Rotation(this.bot, {
            sensitivity: this.sensitivity, speed, tolerance: 0, point: target, direction, placement: placement.slice()
        });
        else { this.controller.point = target; this.controller.speed = f(Math.min(12, Math.max(2, speed))); }
    }
    release() { this.controller = null; }
}
module.exports = { Rotation, RotationScheduler, wrap, normalized, angularDistance, mouseScale, angles, setAngles, rotationSpeed, directionSpeed };
