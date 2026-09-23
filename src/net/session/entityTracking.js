'use strict';

// Per-connection player-entity tracker, extracted from createProxyServer.
//
// Mirrors the Hypixel-side world entity table the proxy sees: entity id →
// last-known name, position, held wood-skin, etc. Three maps work
// together — playerEntities (entityId → entry), playerEntityIdsByName
// (lowercase name → entityId), and recentPlayerPositions (lowercase name
// → last known position even after the entity despawns).
//
// observePlayerEntityPacket() consumes the relevant clientbound entity
// packets and keeps the maps current. Callers that need to read the table
// (nametag visibility)
// use forEachEntity()/getEntityByName().

const ENTITY_FLAG_INVISIBLE = 0x20;

// Packet payloads are retained only long enough to re-spawn a visible player
// after their display profile changes. Keep the copies shallow and explicit:
// protocol Buffers/items are immutable for this use, while the outer packet
// and metadata array are the parts that other listeners commonly replace.
function copyEntityPacket(packet = {}) {
    return {
        ...packet,
        metadata: Array.isArray(packet.metadata)
            ? packet.metadata.map(entry => ({ ...entry }))
            : packet.metadata
    };
}

function entityMetadataFlags(metadata = []) {
    const entries = Array.isArray(metadata) ? metadata : [];
    const flags = entries.find(entry => Number(entry?.key ?? entry?.index ?? entry?.id) === 0);
    const value = Number(flags?.value);
    return Number.isFinite(value) ? value & 0xff : null;
}

function createEntityTracker(deps) {
    const {
        isValidPlayerName,
        normalizeUuid,
        nickKey,
        packetEntityId,
        entityPositionFromFixedPacket,
        getUuidMappedName,
        playerEntityPacketNames
    } = deps;

    const playerEntities = new Map();
    const playerEntityIdsByName = new Map();
    const recentPlayerPositions = new Map();

    function rememberRecentPlayerPosition(name, position, source = 'entity', at = Date.now()) {
        if (!isValidPlayerName(name) || !position) return null;
        const x = Number(position.x);
        const y = Number(position.y);
        const z = Number(position.z);
        if (![x, y, z].every(Number.isFinite)) return null;
        const key = nickKey(name);
        const entry = recentPlayerPositions.get(key);
        if (entry) {
            // Movement packets are one of the busiest paths in a populated
            // lobby. Reuse the last-position record instead of creating a new
            // object for every step made by every visible player.
            entry.name = name;
            entry.x = x;
            entry.y = y;
            entry.z = z;
            entry.source = source;
            entry.at = at;
            return entry;
        }
        const created = { name, x, y, z, source, at };
        recentPlayerPositions.set(key, created);
        return created;
    }

    function getRecentPlayerPosition(name, maxAgeMs = 12000) {
        if (!isValidPlayerName(name)) return null;
        const entry = recentPlayerPositions.get(nickKey(name));
        if (!entry || Date.now() - (entry.at || 0) > maxAgeMs) return null;
        return entry;
    }

    function normalizePacketUuid(value) {
        if (!value) return null;
        if (Buffer.isBuffer(value)) return normalizeUuid(value.toString('hex'));
        return normalizeUuid(value);
    }

    function setPlayerEntityName(entityId, name, source = 'entity') {
        if (!Number.isFinite(Number(entityId)) || !isValidPlayerName(name)) return;
        const id = Number(entityId);
        const current = playerEntities.get(id) || { entityId: id };
        if (current.name && current.name !== name) playerEntityIdsByName.delete(nickKey(current.name));
        current.name = name;
        current.nameSource = source;
        const at = Date.now();
        current.updatedAt = at;
        playerEntities.set(id, current);
        playerEntityIdsByName.set(nickKey(name), id);
        rememberRecentPlayerPosition(name, current, source, at);
    }

    function attachNameToPlayerEntities(uuid, name) {
        const normalized = normalizePacketUuid(uuid);
        if (!normalized || !isValidPlayerName(name)) return;
        playerEntities.forEach((entry, entityId) => {
            if (entry.uuid === normalized) setPlayerEntityName(entityId, name, 'uuid_map');
        });
    }

    function forgetPlayerEntity(entityId) {
        const id = Number(entityId);
        if (!Number.isFinite(id)) return;
        const entry = playerEntities.get(id);
        if (entry?.name) rememberRecentPlayerPosition(entry.name, entry, 'entity_destroy', Date.now());
        if (entry?.name) playerEntityIdsByName.delete(nickKey(entry.name));
        playerEntities.delete(id);
    }

    function updatePlayerEntityPositionValues(id, x, y, z, source, at) {
        const current = playerEntities.get(id);
        if (!current) return;
        current.x = x;
        current.y = y;
        current.z = z;
        current.positionSource = source;
        current.updatedAt = at;
        if (current.spawnPacket) {
            current.spawnPacket.x = Math.round(x * 32);
            current.spawnPacket.y = Math.round(y * 32);
            current.spawnPacket.z = Math.round(z * 32);
        }
        // `current` is already the object stored in the Map; setting the same
        // reference again only repeats hashing work on every movement packet.
        if (current.name) rememberRecentPlayerPosition(current.name, current, source, at);
    }

    function updatePlayerEntityPosition(entityId, position, source = 'packet') {
        if (!Number.isFinite(Number(entityId)) || !position) return;
        const x = Number(position.x);
        const y = Number(position.y);
        const z = Number(position.z);
        if (![x, y, z].every(Number.isFinite)) return;
        updatePlayerEntityPositionValues(Number(entityId), x, y, z, source, Date.now());
    }

    function updatePlayerEntityRelativePosition(entityId, data = {}) {
        const id = Number(entityId);
        const current = playerEntities.get(id);
        if (!current) return;
        const dx = Number(data.dX ?? data.dx ?? data.deltaX ?? 0) / 32;
        const dy = Number(data.dY ?? data.dy ?? data.deltaY ?? 0) / 32;
        const dz = Number(data.dZ ?? data.dz ?? data.deltaZ ?? 0) / 32;
        if (![dx, dy, dz].every(Number.isFinite)) return;
        updatePlayerEntityPositionValues(
            id,
            Number(current.x || 0) + dx,
            Number(current.y || 0) + dy,
            Number(current.z || 0) + dz,
            'relative_move',
            Date.now()
        );
    }

    function rememberPlayerEntityHeldItem(entityId, item) {
        const id = Number(entityId);
        const current = playerEntities.get(id);
        if (!current) return;
        const at = Date.now();
        current.heldItemAt = at;
        current.updatedAt = at;
    }

    function applyPlayerEntityMetadata(entityId, metadata) {
        const id = Number(entityId);
        const current = playerEntities.get(id);
        if (!current) return null;
        const flags = entityMetadataFlags(metadata);
        if (flags === null) return null;
        const nextInvisible = Boolean(flags & ENTITY_FLAG_INVISIBLE);
        const previousInvisible = Boolean(current.invisible);
        current.metadataFlags = flags;
        current.invisible = nextInvisible;
        current.updatedAt = Date.now();
        return previousInvisible !== nextInvisible;
    }

    function observePlayerEntityPacket(data = {}, meta = {}) {
        const name = meta?.name;
        if (!playerEntityPacketNames.has(name)) return null;
        if (name === 'named_entity_spawn') {
            const entityId = packetEntityId(data);
            if (entityId === null) return null;
            const uuid = normalizePacketUuid(data.playerUUID ?? data.playerUuid ?? data.uuid ?? data.UUID);
            const mappedName = getUuidMappedName(uuid);
            const position = entityPositionFromFixedPacket(data);
            const existing = playerEntities.get(entityId) || {};
            const metadataFlags = entityMetadataFlags(data.metadata);
            const invisible = metadataFlags === null
                ? Boolean(existing.invisible)
                : Boolean(metadataFlags & ENTITY_FLAG_INVISIBLE);
            const at = Date.now();
            playerEntities.set(entityId, {
                ...existing,
                entityId,
                uuid,
                name: mappedName || existing.name || null,
                x: position?.x,
                y: position?.y,
                z: position?.z,
                metadataFlags: metadataFlags ?? existing.metadataFlags,
                invisible,
                spawnPacket: copyEntityPacket(data),
                equipmentPackets: new Map(),
                metadataPacket: null,
                spawnedAt: at,
                updatedAt: at
            });
            if (mappedName) playerEntityIdsByName.set(nickKey(mappedName), entityId);
            if (mappedName && position) rememberRecentPlayerPosition(mappedName, position, 'named_entity_spawn', at);
            return { type: name, entityId, invisible };
        }

        if (name === 'entity_teleport') {
            const entityId = packetEntityId(data);
            const position = entityPositionFromFixedPacket(data);
            if (entityId !== null && position) updatePlayerEntityPosition(entityId, position, 'teleport');
            return { type: name, entityId };
        }

        if (name === 'rel_entity_move' || name === 'entity_move_look') {
            const entityId = packetEntityId(data);
            if (entityId !== null) updatePlayerEntityRelativePosition(entityId, data);
            return { type: name, entityId };
        }

        if (name === 'entity_equipment') {
            const entityId = packetEntityId(data);
            const current = entityId !== null ? playerEntities.get(entityId) : null;
            if (current) {
                if (!current.equipmentPackets) current.equipmentPackets = new Map();
                current.equipmentPackets.set(Number.isFinite(Number(data.slot)) ? Number(data.slot) : -1, copyEntityPacket(data));
                current.updatedAt = Date.now();
            }
            const slot = Number(data.slot);
            if (entityId !== null && (!Number.isFinite(slot) || slot === 0)) {
                rememberPlayerEntityHeldItem(entityId, data.item ?? data.itemStack ?? data.heldItem);
            }
            return { type: name, entityId };
        }

        if (name === 'entity_metadata') {
            const entityId = packetEntityId(data);
            const invisibleChanged = entityId !== null
                ? applyPlayerEntityMetadata(entityId, data.metadata)
                : null;
            const current = entityId !== null ? playerEntities.get(entityId) : null;
            if (current) {
                current.metadataPacket = copyEntityPacket(data);
                current.updatedAt = Date.now();
            }
            return { type: name, entityId, invisibleChanged };
        }

        if (name === 'entity_destroy') {
            const ids = Array.isArray(data.entityIds) ? data.entityIds : [data.entityId ?? data.entityID].filter(value => value !== undefined);
            ids.forEach(forgetPlayerEntity);
            return { type: name, entityIds: ids.map(Number).filter(Number.isFinite) };
        }

        return null;
    }

    function forEachEntity(fn) {
        playerEntities.forEach(fn);
    }

    function getEntityByName(name) {
        const id = playerEntityIdsByName.get(nickKey(name));
        if (id === undefined) return null;
        return playerEntities.get(id) || null;
    }

    function replayPacketsForUuid(uuid) {
        const normalized = normalizePacketUuid(uuid);
        if (!normalized) return [];
        const packets = [];
        playerEntities.forEach((entry) => {
            if (entry?.uuid !== normalized || !entry.spawnPacket) return;
            packets.push({
                entityId: entry.entityId,
                spawnPacket: copyEntityPacket(entry.spawnPacket),
                equipmentPackets: Array.from(entry.equipmentPackets?.values() || [])
                    .map(copyEntityPacket),
                metadataPacket: entry.metadataPacket ? copyEntityPacket(entry.metadataPacket) : null
            });
        });
        return packets;
    }

    function isPlayerEntityInvisible(name) {
        return Boolean(getEntityByName(name)?.invisible);
    }

    function clear() {
        playerEntities.clear();
        playerEntityIdsByName.clear();
        recentPlayerPositions.clear();
    }

    return {
        rememberRecentPlayerPosition,
        getRecentPlayerPosition,
        setPlayerEntityName,
        attachNameToPlayerEntities,
        forgetPlayerEntity,
        updatePlayerEntityPosition,
        updatePlayerEntityRelativePosition,
        rememberPlayerEntityHeldItem,
        observePlayerEntityPacket,
        forEachEntity,
        getEntityByName,
        replayPacketsForUuid,
        isPlayerEntityInvisible,
        clear
    };
}

module.exports = {
    ENTITY_FLAG_INVISIBLE,
    entityMetadataFlags,
    createEntityTracker
};
