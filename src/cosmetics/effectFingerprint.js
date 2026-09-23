'use strict';

// Pure packet->fingerprint logic for the cosmetic effect classifier
// (effectRecorder.js). Hypixel cosmetics are deterministic packet recipes -
// a given final-kill / bed-destroy effect replays the same particles, sounds
// and entity spawns in the same arrangement every time - so classification
// is fingerprint extraction + nearest-neighbor, not hand-written rules.
//
// No allocation-heavy work happens per packet here: normalizeEffectPacket
// produces one small flat record, and the expensive aggregation
// (buildFingerprint) only runs once per capture window, seconds after a
// final kill / bed break, never on the hot packet-relay path.

const EFFECT_PACKET_NAMES = new Set([
    'world_particles',
    'named_sound_effect',
    'world_event',
    'spawn_entity',
    'spawn_entity_living',
    'spawn_entity_experience_orb',
    'spawn_entity_weather'
]);

// Capture geometry/timing. Effects can start a tick or two before the chat
// line lands, hence the negative lead-in on the capture window.
const CAPTURE_LEAD_MS = 600;
const CAPTURE_WINDOW_MS = 2_500;
const BACKGROUND_WINDOW_MS = 1_000;
const CAPTURE_RADIUS = 12;
// Timing buckets relative to the anchor: early burst / main body / tail.
const BUCKET_BOUNDS_MS = [500, 1_500];
const BUCKET_DURATIONS_MS = [CAPTURE_LEAD_MS + 500, 1_000, CAPTURE_WINDOW_MS - 1_500];

const SHAPE_WEIGHT = 0.1;
const SHAPE_SCALE = 8; // blocks of height/radius difference for shape score to hit 0

function normalizeEffectPacket(name, data = {}, timestamp) {
    if (name === 'world_particles') {
        return {
            t: timestamp,
            key: `p:${Number(data.particleId)}`,
            n: Math.max(1, Number(data.particles) || 1),
            x: Number(data.x) || 0,
            y: Number(data.y) || 0,
            z: Number(data.z) || 0
        };
    }
    if (name === 'named_sound_effect') {
        return {
            t: timestamp,
            key: `s:${String(data.soundName || '')}@${Number(data.pitch) || 0}`,
            n: 1,
            x: (Number(data.x) || 0) / 8,
            y: (Number(data.y) || 0) / 8,
            z: (Number(data.z) || 0) / 8
        };
    }
    if (name === 'world_event') {
        const location = data.location || {};
        return {
            t: timestamp,
            key: `e:${Number(data.effectId)}:${Number(data.data) || 0}`,
            n: 1,
            x: Number(location.x) || 0,
            y: Number(location.y) || 0,
            z: Number(location.z) || 0
        };
    }
    if (name === 'spawn_entity' || name === 'spawn_entity_living'
        || name === 'spawn_entity_experience_orb' || name === 'spawn_entity_weather') {
        const prefix = name === 'spawn_entity' ? 'o'
            : name === 'spawn_entity_living' ? 'm'
                : name === 'spawn_entity_experience_orb' ? 'x' : 'w';
        return {
            t: timestamp,
            key: `${prefix}:${Number(data.type) || 0}`,
            n: 1,
            x: (Number(data.x) || 0) / 32,
            y: (Number(data.y) || 0) / 32,
            z: (Number(data.z) || 0) / 32
        };
    }
    return null;
}

function withinRadius(record, anchor) {
    return Math.abs(record.x - anchor.x) <= CAPTURE_RADIUS
        && Math.abs(record.y - anchor.y) <= CAPTURE_RADIUS
        && Math.abs(record.z - anchor.z) <= CAPTURE_RADIUS;
}

function bucketFor(offsetMs) {
    if (offsetMs < BUCKET_BOUNDS_MS[0]) return 0;
    if (offsetMs < BUCKET_BOUNDS_MS[1]) return 1;
    return 2;
}

// captureRecords: near the anchor, t in [anchorAt - CAPTURE_LEAD_MS,
// anchorAt + CAPTURE_WINDOW_MS]. backgroundRecords: near the anchor in the
// second BEFORE that - ambient combat noise (crits, fires, TNT) that gets
// rate-subtracted so only the cosmetic remains.
function buildFingerprint(captureRecords, backgroundRecords, anchorAt) {
    const backgroundRate = new Map(); // key -> occurrences per ms
    (backgroundRecords || []).forEach((record) => {
        backgroundRate.set(record.key, (backgroundRate.get(record.key) || 0) + record.n / BACKGROUND_WINDOW_MS);
    });

    const counts = {};
    let height = 0;
    let radius = 0;
    let anchorY = null;
    let anchorX = null;
    let anchorZ = null;

    (captureRecords || []).forEach((record) => {
        const bucket = bucketFor(record.t - anchorAt);
        const key = `${record.key}|${bucket}`;
        counts[key] = (counts[key] || 0) + record.n;
        if (anchorY === null) { anchorX = record.x; anchorY = record.y; anchorZ = record.z; }
        height = Math.max(height, record.y - anchorY);
        radius = Math.max(radius, Math.abs(record.x - anchorX), Math.abs(record.z - anchorZ));
    });

    // Subtract expected background per bucket, floor at zero, drop empties.
    backgroundRate.forEach((ratePerMs, baseKey) => {
        for (let bucket = 0; bucket < 3; bucket += 1) {
            const key = `${baseKey}|${bucket}`;
            if (!(key in counts)) continue;
            counts[key] = Math.max(0, counts[key] - ratePerMs * BUCKET_DURATIONS_MS[bucket]);
            if (counts[key] < 0.5) delete counts[key];
        }
    });

    let total = 0;
    Object.keys(counts).forEach((key) => { total += counts[key]; });

    return {
        counts,
        height: Math.round(height * 2) / 2,
        radius: Math.round(radius * 2) / 2,
        total
    };
}

function similarity(a, b) {
    if (!a?.counts || !b?.counts) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const keys = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
    keys.forEach((key) => {
        const valueA = a.counts[key] || 0;
        const valueB = b.counts[key] || 0;
        dot += valueA * valueB;
        normA += valueA * valueA;
        normB += valueB * valueB;
    });
    if (normA === 0 || normB === 0) return 0;
    const cosine = dot / Math.sqrt(normA * normB);
    const shapeDelta = Math.abs((a.height || 0) - (b.height || 0)) + Math.abs((a.radius || 0) - (b.radius || 0));
    const shape = Math.max(0, 1 - shapeDelta / SHAPE_SCALE);
    return (1 - SHAPE_WEIGHT) * cosine + SHAPE_WEIGHT * shape;
}

module.exports = {
    EFFECT_PACKET_NAMES,
    CAPTURE_LEAD_MS,
    CAPTURE_WINDOW_MS,
    BACKGROUND_WINDOW_MS,
    CAPTURE_RADIUS,
    normalizeEffectPacket,
    withinRadius,
    buildFingerprint,
    similarity
};
