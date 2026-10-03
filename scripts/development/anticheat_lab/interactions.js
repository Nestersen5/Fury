'use strict';
const { Vec3 } = require('./runtime/node_modules/vec3');
const { RaycastIterator } = require('./runtime/node_modules/prismarine-world').iterators;
const faces = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]].map(v => new Vec3(...v));
function eye(bot) { return bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0); }
function direction(bot) {
    const e = bot.entity;
    return new Vec3(-Math.sin(e.yaw) * Math.cos(e.pitch), Math.sin(e.pitch), -Math.cos(e.yaw) * Math.cos(e.pitch));
}
function blockAtCursor(bot, reach = 4.5) { return bot.world.raycast(eye(bot), direction(bot), reach); }
function entityAtCursor(bot, reach = 3) {
    const origin = eye(bot), view = direction(bot), block = blockAtCursor(bot, reach);
    let distance = block ? block.intersect.distanceTo(origin) : reach, target = null;
    const ray = new RaycastIterator(origin, view, reach);
    for (const entity of Object.values(bot.entities)) {
        if (entity.id === bot.entity.id || entity.type !== 'player') continue;
        // Vanilla expands the entity pick box by its 0.1 collision border.
        const width = entity.width / 2 + 0.1;
        const hit = ray.intersect([[-width, -0.1, -width, width, entity.height + 0.1, width]], entity.position);
        if (hit && hit.pos.distanceTo(origin) < distance) { target = entity; distance = hit.pos.distanceTo(origin); }
    }
    return target;
}

// Only full stone blocks are predicted here. Other block shapes/materials must
// supply their own vanilla item-placement rules, rather than reuse this blindly.
function placeStoneAtCursor(bot) {
    const hit = blockAtCursor(bot), held = bot.heldItem;
    if (!hit || !faces[hit.face] || held?.name !== 'stone' || held.count <= 0) return null;
    const destination = hit.position.plus(faces[hit.face]), current = bot.blockAt(destination);
    if (!current || current.type !== 0) return null;
    const p = bot.entity.position;
    if (destination.x + 1 > p.x - 0.3 && destination.x < p.x + 0.3
        && destination.z + 1 > p.z - 0.3 && destination.z < p.z + 0.3
        && destination.y + 1 > p.y && destination.y < p.y + 1.8) return null;
    for (const entity of Object.values(bot.entities)) {
        if (entity.id === bot.entity.id || entity.type !== 'player') continue;
        if (destination.x + 1 > entity.position.x - 0.3 && destination.x < entity.position.x + 0.3
            && destination.z + 1 > entity.position.z - 0.3 && destination.z < entity.position.z + 0.3
            && destination.y + 1 > entity.position.y && destination.y < entity.position.y + entity.height) return null;
    }
    const Item = require('./runtime/node_modules/prismarine-item')(bot.registry);
    const offset = hit.intersect.minus(hit.position);
    bot._client.write('block_place', { location: hit.position, direction: hit.face, heldItem: Item.toNotch(held),
        cursorX: Math.floor(offset.x * 16), cursorY: Math.floor(offset.y * 16), cursorZ: Math.floor(offset.z * 16) });
    bot.world.setBlockStateId(destination, 16); // 1.8 stone id 1, data 0; server can correct prediction.
    held.count--;
    bot.swingArm();
    return { support: hit.position.clone(), face: hit.face, destination, predictedAt: Date.now() };
}

class PlaceInput {
    constructor({ use, heldItem = () => 'block' }) {
        this.use = use; this.heldItem = heldItem; this.held = false; this.presses = 0; this.counter = 0;
        this.attempts = 0;
    }
    press() { this.presses++; }
    preTickFastPlace({ enabled, delay = 1, mode = 'all', useClaimed = false }) {
        const kind = this.heldItem();
        if (enabled && !useClaimed && (mode === 'all' || (mode === 'blocks' && kind === 'block') || (mode === 'projectiles' && kind === 'projectile'))) {
            this.counter = Math.min(this.counter, delay);
        }
    }
    tick() {
        if (this.counter > 0) this.counter--;
        while (this.presses > 0) { this.presses--; this.attempt(); }
        if (this.held && this.counter === 0) this.attempt();
    }
    attempt() { this.counter = 4; this.attempts++; this.use(); }
}
module.exports = { eye, direction, blockAtCursor, entityAtCursor, placeStoneAtCursor, PlaceInput, faces };
