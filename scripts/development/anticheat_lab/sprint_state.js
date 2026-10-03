'use strict';
// Independent on-foot EntityPlayerSP.onLivingUpdate sprint state, from the
// inert trusted 1.8.9 reference. Distinguishes sprint key from actual sprinting.
class SprintState {
    constructor() { this.active = false; this.remaining = 0; this.toggle = 0; this.previousForward = 0; this.previousSneak = false; }
    set(active) { this.active = active; this.remaining = active ? 600 : 0; }
    tick({ forward, back, sneak, sprint, grounded, usingItem = false, food = 20, collided = false, blind = false }) {
        if (this.remaining > 0 && --this.remaining === 0) this.set(false);
        if (this.toggle > 0) this.toggle--;
        let movement = Number(forward) - Number(back);
        if (sneak) movement *= 0.3;
        if (usingItem) { movement *= 0.2; this.toggle = 0; }
        const enough = food > 6;
        if (grounded && !this.previousSneak && this.previousForward < 0.8 && movement >= 0.8
            && !this.active && enough && !usingItem && !blind) {
            if (this.toggle <= 0 && !sprint) this.toggle = 7; else this.set(true);
        }
        if (!this.active && movement >= 0.8 && enough && !usingItem && !blind && sprint) this.set(true);
        if (this.active && (movement < 0.8 || collided || !enough)) this.set(false);
        this.previousForward = movement; this.previousSneak = sneak;
        return this.active;
    }
}
module.exports = { SprintState };
