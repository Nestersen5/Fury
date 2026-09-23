'use strict';

// Shared helpers for reading /recordcheat JSONL recordings.
// Used by compare_recordings.js (fidelity diff) and analyze_recording.js
// (per-cheat feature extraction).

const fs = require('fs');

function loadRecording(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const records = [];
    for (const line of lines) {
        try {
            records.push(JSON.parse(line));
        } catch (e) {}
    }
    return records;
}

function uuidNameMap(records) {
    const map = new Map();
    for (const r of records) {
        if (r.k === 'tab' && Array.isArray(r.named)) {
            r.named.forEach(entry => {
                if (entry.uuid && entry.name) map.set(String(entry.uuid).toLowerCase(), entry.name);
            });
        }
        if (r.k === 'spawn' && r.uuid && r.name) {
            map.set(String(r.uuid).toLowerCase(), r.name);
        }
    }
    return map;
}

function entityName(r, uuidNames) {
    return r.name || (r.uuid ? uuidNames.get(String(r.uuid).toLowerCase()) : null) || null;
}

// First known absolute position per entity. snap lines carry float coords;
// spawn/tp lines carry 1.8 fixed-point ints (x32).
function firstPositions(records) {
    const map = new Map();
    for (const r of records) {
        const id = Number(r.id);
        if (!Number.isFinite(id) || map.has(id)) continue;
        if (r.k === 'snap' && Number.isFinite(Number(r.x))) {
            map.set(id, { x: Number(r.x), y: Number(r.y), z: Number(r.z) });
        } else if ((r.k === 'spawn' || r.k === 'tp') && Number.isFinite(Number(r.x))) {
            map.set(id, { x: Number(r.x) / 32, y: Number(r.y) / 32, z: Number(r.z) / 32 });
        }
    }
    return map;
}

function entityActivity(records) {
    const uuidNames = uuidNameMap(records);
    const map = new Map();
    const bump = (id, field) => {
        if (!Number.isFinite(id)) return;
        const row = map.get(id) || { id, name: null, moves: 0, anims: 0, metas: 0 };
        row[field] += 1;
        map.set(id, row);
    };
    for (const r of records) {
        const id = Number(r.id);
        switch (r.k) {
            case 'mv': case 'mvl': case 'tp': case 'look':
                bump(id, 'moves');
                break;
            case 'anim':
                bump(id, 'anims');
                break;
            case 'meta':
                bump(id, 'metas');
                break;
            case 'spawn': case 'snap': {
                if (!Number.isFinite(id)) break;
                const row = map.get(id) || { id, name: null, moves: 0, anims: 0, metas: 0 };
                row.name = row.name || entityName(r, uuidNames);
                map.set(id, row);
                break;
            }
        }
    }
    return map;
}

// Average distance from each entity to the recorder's own camera over the
// file. The camera follows the sampled player, so the smallest distance
// identifies the target among unnamed replay actors.
function cameraProximity(records) {
    let cam = null;
    const track = new Map();
    const sums = new Map();
    const measure = (id, pos) => {
        if (!cam || !pos.known) return;
        const dx = pos.x - cam.x;
        const dy = pos.y - cam.y;
        const dz = pos.z - cam.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const row = sums.get(id) || { sum: 0, n: 0 };
        row.sum += dist;
        row.n += 1;
        sums.set(id, row);
    };
    for (const r of records) {
        if (r.k === 'own') {
            if (Number.isFinite(Number(r.x))) cam = { x: Number(r.x), y: Number(r.y), z: Number(r.z) };
            continue;
        }
        const id = Number(r.id);
        if (!Number.isFinite(id)) continue;
        let pos = track.get(id);
        if (!pos) {
            pos = { x: 0, y: 0, z: 0, known: false };
            track.set(id, pos);
        }
        if (r.k === 'snap' && Number.isFinite(Number(r.x))) {
            pos.x = Number(r.x); pos.y = Number(r.y); pos.z = Number(r.z);
            pos.known = true;
        } else if ((r.k === 'spawn' || r.k === 'tp') && Number.isFinite(Number(r.x))) {
            pos.x = Number(r.x) / 32; pos.y = Number(r.y) / 32; pos.z = Number(r.z) / 32;
            pos.known = true;
        } else if ((r.k === 'mv' || r.k === 'mvl') && pos.known) {
            pos.x += Number(r.dx || 0) / 32;
            pos.y += Number(r.dy || 0) / 32;
            pos.z += Number(r.dz || 0) / 32;
        } else {
            continue;
        }
        measure(id, pos);
    }
    const result = new Map();
    sums.forEach((row, id) => {
        if (row.n > 0) result.set(id, row.sum / row.n);
    });
    return result;
}

function findIdsByName(records, player) {
    const wanted = String(player || '').toLowerCase();
    const uuidNames = uuidNameMap(records);
    const ids = new Set();
    for (const r of records) {
        if (r.k !== 'spawn' && r.k !== 'snap') continue;
        const name = entityName(r, uuidNames);
        if (String(name || '').toLowerCase() === wanted) ids.add(Number(r.id));
    }
    return ids;
}

function matchByPosition(records, refPos, toleranceBlocks = 2.0) {
    if (!refPos) return new Set();
    const positions = firstPositions(records);
    const ids = new Set();
    positions.forEach((pos, id) => {
        const dx = pos.x - refPos.x;
        const dy = pos.y - refPos.y;
        const dz = pos.z - refPos.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= toleranceBlocks) ids.add(id);
    });
    return ids;
}

// Resolve the labeled target inside a single recording:
// explicit id > name match > busiest actor nearest the camera (replay case).
// Replays name only an idle placeholder while the real actor NPC is
// anonymous - so a name match that shows almost no activity loses to a
// much busier camera-proximate actor.
function resolveTarget(records, { player, id } = {}) {
    if (Number.isFinite(Number(id))) {
        return { ids: new Set([Number(id)]), how: 'explicit-id' };
    }

    const activity = entityActivity(records);
    const proximity = cameraProximity(records);
    const actorCandidates = [...activity.values()]
        .filter(row => (row.moves + row.anims) >= 10 && Number.isFinite(proximity.get(row.id)))
        .sort((a, b) => proximity.get(a.id) - proximity.get(b.id));
    const cameraActor = actorCandidates[0] || null;

    if (player) {
        const byName = findIdsByName(records, player);
        if (byName.size > 0) {
            const nameActivity = Math.max(
                ...[...byName].map(nid => {
                    const row = activity.get(nid);
                    return row ? row.moves + row.anims : 0;
                })
            );
            const actorActivity = cameraActor ? cameraActor.moves + cameraActor.anims : 0;
            if (cameraActor && !byName.has(cameraActor.id) && actorActivity > nameActivity * 5) {
                return {
                    ids: new Set([cameraActor.id]),
                    how: `camera-proximity (named entity ${[...byName].join(',')} is an idle placeholder)`
                };
            }
            return { ids: byName, how: 'name' };
        }
    }

    if (cameraActor) {
        return { ids: new Set([cameraActor.id]), how: 'camera-proximity' };
    }
    return { ids: new Set(), how: 'unresolved' };
}

function quantiles(values, qs = [0.5, 0.9, 1]) {
    if (!values.length) return qs.map(() => null);
    const sorted = values.slice().sort((a, b) => a - b);
    return qs.map(q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]);
}

function gaps(times) {
    const out = [];
    for (let i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]);
    return out;
}

// Replays duplicate some event packets (observed: every swing arrives
// twice). Collapse events closer than the threshold.
function dedupTimes(times, thresholdMs = 25) {
    const out = [];
    for (const t of times) {
        if (out.length === 0 || t - out[out.length - 1] > thresholdMs) out.push(t);
    }
    return out;
}

function usingItemFlag(metadataEntries) {
    const flags = (metadataEntries || []).find(entry => Number(entry.key) === 0);
    if (!Number.isFinite(Number(flags?.value))) return null;
    return (Number(flags.value) & 0x10) !== 0;
}

function sneakFlag(metadataEntries) {
    const flags = (metadataEntries || []).find(entry => Number(entry.key) === 0);
    if (!Number.isFinite(Number(flags?.value))) return null;
    return (Number(flags.value) & 0x02) !== 0;
}

module.exports = {
    loadRecording,
    uuidNameMap,
    entityName,
    firstPositions,
    entityActivity,
    cameraProximity,
    findIdsByName,
    matchByPosition,
    resolveTarget,
    quantiles,
    gaps,
    dedupTimes,
    usingItemFlag,
    sneakFlag
};
