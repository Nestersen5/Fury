'use strict';
const { JavaRandom } = require('./random');

// Independent state machines translated from the source audit. Context carries
// physical mouse state separately from the synthetic use key and sampled item use.
class BlockHit {
    constructor({ mode, seed = 421, chanceMin = 70, chanceMax = 90, requireMouse = true, ignoreManual = true, input, lag }) {
        if (!['manual', 'predict', 'auto', 'lag'].includes(mode)) throw new Error('Unknown BlockHit mode');
        Object.assign(this, { mode, chanceMin, chanceMax, requireMouse, ignoreManual, input, lag });
        this.rng = new JavaRandom(seed); this.blocking = false; this.releaseAt = 0;
        this.damageTriggered = false; this.completed = false; this.streak = 1; this.resetPending = false;
    }
    setBlocking(value) {
        if (value === this.blocking) return;
        this.blocking = value; this.releaseAt = 0; this.damageTriggered = false;
        // Recovered KeyBinding.setPressed(true) calls I(): set state AND tick.
        // Its false branch also clears pressTime; native mouse-up does not.
        this.input.setUse(value, true);
        if (!value && this.mode !== 'lag') this.input.usePresses = 0;
    }
    shouldBlock(c) {
        if (!c.sword || (this.requireMouse && !c.physicalUse)) return false;
        if (this.mode === 'manual') return this.chanceMin + (this.chanceMax - this.chanceMin) * this.rng.nextDouble() >= this.rng.nextDouble() * 100;
        if (this.mode !== 'auto') return false;
        const result = this.streak === 1 && c.crosshair;
        if (!result && this.streak >= 3) this.streak = 0;
        this.streak = c.crosshair ? this.streak + 1 : 1;
        return result;
    }
    mouseAttack(c) {
        if (!c.sword) return;
        if (this.mode === 'manual' && !c.clickerActive && this.shouldBlock(c) && !this.blocking && !this.input.using) {
            this.setBlocking(true); this.releaseAt = c.now + 50;
        }
        if (this.mode === 'predict' && (!this.requireMouse || c.physicalUse) && c.crosshair && c.target
            && c.targetHurt <= c.expectedHurt + 1 && !this.blocking && !this.input.using) {
            this.setBlocking(true); this.releaseAt = c.now + 50 * (c.expectedHurt + 2);
        }
    }
    preTick(c) {
        // EventPreTick.fire runs the scheduled executor before listeners.
        if (this.resetPending) { this.resetPending = false; this.setBlocking(false); }
        if (this.mode === 'auto' || !c.player) return;
        if (this.mode === 'manual') {
            if (c.clickerActive) return;
            if (c.ownHurt > c.expectedHurt + 1 || (this.releaseAt > 0 && c.now >= this.releaseAt)) this.setBlocking(false);
            return;
        }
        if (this.mode === 'predict') {
            if (!c.sword || c.gui) return;
            if (!c.target || c.ownHurt > c.expectedHurt + 1 || (this.releaseAt > 0 && c.now >= this.releaseAt)) {
                this.setBlocking(false); return;
            }
            if (this.requireMouse && !c.physicalUse) return;
            // The source's compound expression reduces to this when !blocking;
            // targetCanBeHit only participates in an already-blocking branch.
            if (!this.blocking && c.ownHurt > 0 && c.ownHurt <= c.expectedHurt + 3) {
                this.setBlocking(true); this.damageTriggered = true;
                this.releaseAt = c.now + 50 * (c.expectedHurt + 2);
            }
            return;
        }
        if (!c.focused) return;
        if (c.target) {
            const allowed = c.sword && (!this.requireMouse || c.physicalUse);
            if (c.ownHurt > c.expectedHurt + 1) { this.setBlocking(false); this.completed = false; return; }
            if (allowed) {
                if (this.lag.shouldReblock(c.now)) { this.setBlocking(true); return; }
                if (!this.completed) {
                    if (!this.blocking) this.setBlocking(true);
                    else { this.setBlocking(false); this.completed = true; }
                } else if (!this.blocking && !this.input.using) this.completed = false;
            } else if (this.blocking) { this.setBlocking(false); this.completed = false; }
            return;
        }
        if (c.sword && this.requireMouse && this.ignoreManual && !this.lag.buffering && c.physicalUse && this.input.using) {
            this.input.setUse(false); this.blocking = false; this.completed = false; return;
        }
        if (c.ownHurt > c.expectedHurt + 1 || this.blocking) { this.setBlocking(false); this.completed = false; }
    }
    livingUpdate(c, localPlayer) {
        if (this.mode !== 'predict' || !c.sword) return;
        this.releaseAt = c.now;
        if (localPlayer) this.resetPending = true;
    }
    flushed() { this.completed = false; }
    finish() { this.setBlocking(false); }
}
module.exports = { BlockHit };
