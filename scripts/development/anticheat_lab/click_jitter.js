'use strict';
const f = Math.fround;
const remainderFloor = value => Math.floor(f(value - f(Math.floor(value))));

class ClickJitter {
    constructor(rng, sensitivity = 0.5) {
        this.rng = rng; this.sensitivity = f(sensitivity);
        this.remaining = 0; this.steps = 0; this.pendingYaw = 0; this.pendingPitch = 0;
    }
    press() {
        this.horizontal = f(f(this.rng.nextFloat() * 14) - 7);
        this.vertical = f(f(this.rng.nextFloat() * 14) - 7);
        this.remaining = this.steps = (Math.abs(this.horizontal) + Math.abs(this.vertical)) * 0.45;
    }
    tick() {
        if (this.remaining > 0) {
            this.pendingYaw = f(this.pendingYaw + f(this.horizontal / this.steps));
            this.pendingPitch = f(this.pendingPitch + f(this.vertical / this.steps));
            this.remaining--;
        } else {
            this.pendingYaw = remainderFloor(this.pendingYaw);
            this.pendingPitch = remainderFloor(this.pendingPitch);
        }
    }
    render(yaw, pitch) {
        const factor = f(f(this.sensitivity * f(0.6)) + f(0.2));
        const scale = f(f(f(factor * factor) * factor) * 8);
        const yawDelta = f(Math.trunc(this.pendingYaw) * scale);
        const pitchDelta = f(Math.trunc(-this.pendingPitch) * scale);
        const result = { yaw: f(yaw + yawDelta * 0.15), pitch: Math.max(-90, Math.min(90, f(pitch - pitchDelta * 0.15))), yawDelta, pitchDelta };
        this.pendingYaw = remainderFloor(this.pendingYaw); this.pendingPitch = remainderFloor(this.pendingPitch);
        return result;
    }
}
module.exports = { ClickJitter };
