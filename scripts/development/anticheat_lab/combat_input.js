'use strict';

// Independent 1.8 combat-input sampling model. Mirrors the documented vanilla
// key-press queue / item-use ordering, not native Windows input injection.
// No block-digging or GUI support: those scenarios must not use this adapter.
class CombatInput {
    constructor({ attack, swing, beginUse, endUse, targetAtCursor, canUse = () => true }) {
        Object.assign(this, { attack, swing, beginUse, endUse, targetAtCursor, canUse });
        this.attackHeld = false; this.useHeld = false;
        this.attackPresses = 0; this.usePresses = 0;
        this.using = false; this.rightDelay = 0; this.missDelay = 0;
        this.stats = { sampledTicks: 0, attackRequests: 0, attacks: 0, missedSwings: 0, drainedAttacks: 0 };
    }
    setAttack(held) {
        this.attackHeld = held;
        if (held) { this.attackPresses++; this.stats.attackRequests++; }
    }
    setUse(held, enqueuePress = true) {
        this.useHeld = held;
        if (held && enqueuePress) this.usePresses++;
    }
    tick() {
        this.stats.sampledTicks++;
        if (this.rightDelay > 0) this.rightDelay--;
        if (this.missDelay > 0) this.missDelay--;
        if (this.using) {
            if (!this.useHeld) { this.endUse(); this.using = false; }
            // Vanilla drains attacks on the release tick as well.
            this.stats.drainedAttacks += this.attackPresses;
        } else {
            for (let i = 0; i < this.attackPresses; i++) {
                if (this.missDelay > 0) continue;
                const target = this.targetAtCursor();
                if (target) { this.attack(target); this.stats.attacks++; }
                else { this.swing(); this.stats.missedSwings++; this.missDelay = 10; }
            }
            for (let i = 0; i < this.usePresses; i++) this.use();
        }
        this.attackPresses = 0; this.usePresses = 0;
        if (this.useHeld && this.rightDelay === 0 && !this.using) this.use();
        if (!this.attackHeld) this.missDelay = 0;
    }
    use() {
        this.rightDelay = 4;
        if (this.canUse()) { this.beginUse(); this.using = true; }
    }
    finish() {
        this.attackHeld = false; this.useHeld = false;
        this.attackPresses = 0; this.usePresses = 0;
        if (this.using) this.endUse();
        this.using = false;
    }
}
module.exports = { CombatInput };
