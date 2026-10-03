'use strict';
// Analysis-only trajectory extraction. It sees observer records, never module
// states, key presses, attack schedules, scenario IDs, or labels.
function ballisticPeak(initialVelocity) {
    let velocity = initialVelocity, height = 0, peak = 0;
    for (let tick = 0; tick < 30 && velocity > 0; tick++) {
        height += velocity; peak = Math.max(peak, height);
        velocity = (velocity - 0.08) * 0.98;
    }
    return peak;
}

function createJumpResetFeatures({ onOpportunity = () => {}, now = Date.now } = {}) {
    const entities = new Map();
    function entity(id) {
        let state = entities.get(id);
        if (!state) {
            state = { id, x: null, y: null, z: null, g: null, groundAt: -Infinity,
                positionAt: -Infinity, damageAt: -Infinity, pending: null };
            entities.set(id, state);
        }
        return state;
    }
    function finish(state, reason, at) {
        const opportunity = state.pending;
        if (!opportunity) return;
        state.pending = null;
        onOpportunity({ entityId: state.id, at, reason, ...opportunity,
            spanMs: at - opportunity.velocityAt,
            observedRise: opportunity.maxY - opportunity.startY,
            apexExcess: opportunity.maxY - opportunity.startY - opportunity.expectedPeak,
            damaged: Math.abs(state.damageAt - opportunity.velocityAt) <= 200,
            landingHeightChange: reason === 'landed' ? state.y - opportunity.startY : null });
    }
    function observeRecord(record) {
        const t = Number.isFinite(record.t) ? record.t : now();
        if (record.k === 'destroy') {
            for (const id of record.ids || []) entities.delete(Number(id));
            return;
        }
        // Shared live conversion has no velocity components, and compact
        // recordings may omit nested components too. Use damage plus motion
        // uniformly; velocity records must not cancel a pending trajectory or
        // give offline playback information unavailable to the live detector.
        // Pure look packets are not part of the shared live record converter.
        // Ignore their ground flag offline too; only positional packets can
        // establish ground freshness or finish the observed landing.
        if (!['spawn', 'snap', 'mv', 'mvl', 'tp', 'st'].includes(record.k)) return;
        const id = Number(record.id);
        if (!Number.isInteger(id)) return;
        const state = entity(id);
        if (state.pending && t - state.pending.velocityAt > 1600) finish(state, 'timeout', t);
        if (record.k === 'st') {
            if (record.s === 2) {
                state.damageAt = t;
                if (state.pending) finish(state, 'overlapping damage', t);
                if (Number.isFinite(state.y) && state.g === true && t - state.groundAt <= 400 && t - state.positionAt <= 400)
                    state.pending = { velocityAt: t, startX: state.x, startY: state.y, startZ: state.z,
                        horizontalVelocity: null, verticalVelocity: null,
                        expectedPeak: ballisticPeak(0.4), velocitySource: 'damage proxy; velocity unknown',
                        maxY: state.y, samples: 0, airborne: false, maxStep: 0, quantizationBlocks: 1 / 32 };
            }
            return;
        }
        const relative = record.k === 'mv' || record.k === 'mvl';
        const absolute = record.k === 'spawn' || record.k === 'snap' || record.k === 'tp';
        if (absolute) {
            // Snap is the entity tracker's block coordinates; spawn/tp are
            // protocol fixed point, matching the established recorder contract.
            const scale = record.k === 'snap' ? 1 : 32;
            const step = Math.hypot(Number(record.x) / scale - state.x,
                Number(record.y) / scale - state.y, Number(record.z) / scale - state.z);
            if (state.pending && (record.k !== 'tp' || step > 2)) finish(state, 'teleport or large absolute resync', t);
            if (state.pending) state.pending.maxStep = Math.max(state.pending.maxStep, step);
            state.x = Number(record.x) / scale; state.y = Number(record.y) / scale; state.z = Number(record.z) / scale;
        } else if (relative) {
            if (!Number.isFinite(state.y)) return;
            const dx = Number(record.dx) / 32, dy = Number(record.dy) / 32, dz = Number(record.dz) / 32;
            state.x += dx; state.y += dy; state.z += dz;
            if (state.pending) state.pending.maxStep = Math.max(state.pending.maxStep, Math.hypot(dx, dy, dz));
        }
        if (relative || absolute) {
            state.positionAt = t;
            if (state.pending) {
                state.pending.samples++;
                state.pending.maxY = Math.max(state.pending.maxY, state.y);
                if (record.g === false || state.y > state.pending.startY + 1 / 32) state.pending.airborne = true;
            }
        }
        if (typeof record.g === 'boolean') {
            state.g = record.g;
            if (record.g) {
                state.groundAt = t;
                if (state.pending?.airborne) finish(state, 'landed', t);
            }
        }
    }
    function flush(t = now()) { for (const state of entities.values()) finish(state, 'end of clip', t); }
    return { observeRecord, flush, clear: () => entities.clear() };
}

module.exports = { createJumpResetFeatures, ballisticPeak };
