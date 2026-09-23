'use strict';

const assert = require('assert');
const { createEntityTracker } = require('../../src/net/session/entityTracking.js');

const playerPackets = new Set([
    'named_entity_spawn',
    'entity_teleport',
    'rel_entity_move',
    'entity_move_look',
    'entity_equipment',
    'entity_metadata',
    'entity_destroy'
]);
const tracker = createEntityTracker({
    isValidPlayerName: name => /^[A-Za-z0-9_]{3,16}$/.test(name),
    normalizeUuid: value => String(value || '').replace(/-/g, '').toLowerCase(),
    nickKey: value => String(value || '').toLowerCase(),
    packetEntityId: data => Number.isFinite(Number(data?.entityId)) ? Number(data.entityId) : null,
    entityPositionFromFixedPacket: data => ({ x: Number(data.x) / 32, y: Number(data.y) / 32, z: Number(data.z) / 32 }),
    getUuidMappedName: uuid => (uuid ? 'NickyBoi' : null),
    playerEntityPacketNames: playerPackets
});

const uuid = 'a'.repeat(32);
tracker.observePlayerEntityPacket({
    entityId: 42,
    playerUUID: uuid,
    x: 32,
    y: 64,
    z: 96,
    metadata: [{ key: 0, value: 0 }]
}, { name: 'named_entity_spawn' });
tracker.observePlayerEntityPacket({ entityId: 42, slot: 0, item: { name: 'diamond_sword' } }, { name: 'entity_equipment' });
tracker.observePlayerEntityPacket({ entityId: 42, metadata: [{ key: 0, value: 0x20 }] }, { name: 'entity_metadata' });
tracker.observePlayerEntityPacket({ entityId: 42, x: 320, y: 640, z: 960 }, { name: 'entity_teleport' });

const replay = tracker.replayPacketsForUuid(uuid);
assert.strictEqual(replay.length, 1, 'a visible player has one replay entry');
assert.deepStrictEqual(
    { x: replay[0].spawnPacket.x, y: replay[0].spawnPacket.y, z: replay[0].spawnPacket.z },
    { x: 320, y: 640, z: 960 },
    'the cached spawn packet follows the player instead of teleporting them back'
);
assert.deepStrictEqual(replay[0].equipmentPackets, [{ entityId: 42, slot: 0, item: { name: 'diamond_sword' }, metadata: undefined }]);
assert.deepStrictEqual(replay[0].metadataPacket.metadata, [{ key: 0, value: 0x20 }]);

replay[0].spawnPacket.x = -1;
assert.strictEqual(tracker.replayPacketsForUuid(uuid)[0].spawnPacket.x, 320, 'replay callers receive copies, not mutable tracker state');

console.log('test_entity_tracking.js: all assertions passed');
