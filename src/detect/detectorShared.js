'use strict';

// Helpers shared by the live anticheat detectors (scaffold, autoblock,
// stasis). Detectors consume the same record shapes the /recordcheat
// recorder writes, so live packets and recorded JSONL run through the
// same code - that is how every detector is verified against the corpus.

// P(X >= k) for X ~ Binomial(n, p): the chance a legit player reaches k
// hits out of n purely by luck.
function binomialTail(n, k, p) {
    let term = (1 - p) ** n; // P(X = 0)
    let tail = 0;
    for (let i = 0; i <= n; i++) {
        if (i >= k) tail += term;
        term = term * (n - i) / (i + 1) * p / (1 - p);
    }
    return tail;
}

// Live packet -> recorder record shape, for the packets the autoblock and
// stasis detectors read (entity_status carries damage for knockback grace). Returns null for everything else, so the hot
// path stays a single switch.
function packetToRecord(name, data, t) {
    switch (name) {
        case 'animation':
            return { k: 'anim', t, id: data.entityId, a: data.animation };
        case 'entity_metadata': {
            const flags = (Array.isArray(data.metadata) ? data.metadata : [])
                .find(entry => Number(entry?.key ?? entry?.index) === 0);
            return flags === undefined ? null : { k: 'meta', t, id: data.entityId, m: [{ key: 0, value: flags.value }] };
        }
        case 'entity_equipment':
            return {
                k: 'eq', t, id: data.entityId, slot: data.slot,
                item: data.item ? (data.item.blockId ?? data.item.itemId ?? null) : null
            };
        case 'named_entity_spawn':
            return { k: 'spawn', t, id: data.entityId, x: data.x, y: data.y, z: data.z };
        case 'rel_entity_move':
            return { k: 'mv', t, id: data.entityId, dx: data.dX, dy: data.dY, dz: data.dZ, g: data.onGround };
        case 'entity_move_look':
            return { k: 'mvl', t, id: data.entityId, dx: data.dX, dy: data.dY, dz: data.dZ, g: data.onGround };
        case 'entity_teleport':
            return { k: 'tp', t, id: data.entityId, x: data.x, y: data.y, z: data.z, g: data.onGround };
        case 'entity_velocity':
            return { k: 'vel', t, id: data.entityId };
        case 'entity_status':
            return { k: 'st', t, id: data.entityId, s: data.entityStatus };
        case 'update_time': {
            // Match the existing recorder/scaffold signed-high, unsigned-low
            // conversion without importing their stateful owning modules.
            const age = Array.isArray(data.age) && data.age.length === 2
                ? Number(data.age[0]) * 4294967296 + Number(data.age[1] >>> 0) : Number(data.age);
            return { k: 'time', t, age };
        }
        case 'block_change':
            return { k: 'blk', t, x: data.location?.x, y: data.location?.y, z: data.location?.z, b: data.type };
        case 'multi_block_change':
            return {
                k: 'mblk', t, cx: data.chunkX, cz: data.chunkZ,
                r: (Array.isArray(data.records) ? data.records : []).map(record => ({
                    p: record.horizontalPos ?? record.horizontalPosition, y: record.y, b: record.blockId
                }))
            };
        case 'entity_destroy':
            return { k: 'destroy', t, ids: data.entityIds };
        default:
            return null;
    }
}

module.exports = { binomialTail, packetToRecord };
