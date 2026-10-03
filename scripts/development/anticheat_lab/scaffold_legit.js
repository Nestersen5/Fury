'use strict';
const { JavaRandom } = require('./random');
const { Vec3 } = require('./runtime/node_modules/vec3');

function hasCollision(bot, box) {
    for (let x = Math.floor(box.minX); x < Math.ceil(box.maxX); x++)
        for (let y = Math.floor(box.minY); y < Math.ceil(box.maxY); y++)
            for (let z = Math.floor(box.minZ); z < Math.ceil(box.maxZ); z++) {
                const block = bot.blockAt(new Vec3(x, y, z));
                if (!block) throw new Error('Unloaded collision region; invalidate Scaffold trial');
                for (const shape of block.shapes) if (x + shape[3] > box.minX && x + shape[0] < box.maxX
                    && y + shape[4] > box.minY && y + shape[1] < box.maxY
                    && z + shape[5] > box.minZ && z + shape[2] < box.maxZ) return true;
            }
    return false;
}
function edgeBox(bot, contraction = 0.2, offsetX = bot.entity.velocity.x, offsetZ = bot.entity.velocity.z) {
    const p = bot.entity.position, half = 0.3 - contraction;
    return { minX: p.x - half + offsetX, maxX: p.x + half + offsetX,
        minY: p.y - 1, maxY: p.y + 0.8, minZ: p.z - half + offsetZ, maxZ: p.z + half + offsetZ };
}
class LegitScaffold {
    constructor({ seed = 421, minDelay = 100, maxDelay = 200, requireSneak = false, pitchCheck = false,
        pitchThreshold = 45, constructedAt = Date.now() - 10000 } = {}) {
        if (minDelay < 0 || maxDelay > 500 || minDelay > maxDelay) throw new Error('Invalid Legit Scaffold delay');
        Object.assign(this, { minDelay, maxDelay, requireSneak, pitchCheck, pitchThreshold });
        this.rng = new JavaRandom(seed); this.edgeAt = constructedAt; this.standAt = constructedAt;
        this.delay = this.sampleDelay(); this.physicalSaved = false;
    }
    sampleDelay() { return Math.trunc(this.minDelay + (this.maxDelay - this.minDelay) * this.rng.nextDouble()); }
    allowed(c) { return !c.gui && (!this.requireSneak || c.physicalSneak) && !c.onLadder
        && (!this.pitchCheck || c.pitch >= this.pitchThreshold) && c.canActivate; }
    before(c) {
        if (!this.allowed(c)) return null;
        this.physicalSaved = c.physicalSneak;
        let sneak = c.forward <= 0 && c.grounded && !c.hasProjectedCollision, retained = false;
        if (!sneak && c.now - this.edgeAt < this.delay && this.delay > 30) { sneak = true; retained = true; }
        if (!c.grounded) return null;
        if (sneak) {
            if (!c.wasSneaking) this.delay = this.sampleDelay();
            this.standAt = c.now;
            if (!retained) this.edgeAt = c.now;
            return true;
        }
        if (this.requireSneak) return c.now - this.standAt < 1000 && c.forward < 0 ? false : null;
        return !this.physicalSaved ? false : null;
    }
    after(c) { return this.allowed(c) ? this.physicalSaved : null; }
}
module.exports = { LegitScaffold, hasCollision, edgeBox };
