'use strict';
// Experimental pattern detector. A legal jump can produce the same packets.
// This detector NEVER emits a confirmed cheating verdict. Ground truth and
// injected input logs are not accepted by this API.
const { createJumpResetFeatures } = require('./jump_reset_observer_features');
const DEFAULTS = {
    windowMs: 20000, minOpportunities: 10, minHits: 7, minHitFraction: 0.7,
    minSpanMs: 7000, minRise: 1.17, maxRise: 1.29, minSamples: 4,
    maxStep: 2, maxLandingChange: 1 / 32,
    minTickMs: 40, maxTickMs: 125, timingIntervals: 2, timingFreshMs: 3500
};

function createJumpResetDetector({ onFlag = () => {}, nameOf = () => null,
    isEnabled = () => true, onOpportunity = null, log = () => {}, now = Date.now, thresholds = {} } = {}) {
    const cfg = { ...DEFAULTS, ...thresholds }, entities = new Map();
    let lastTime = null, intervals = 0, lastEvent = -Infinity;
    const timingReady = t => lastTime && intervals >= cfg.timingIntervals &&
        t >= lastTime.t && t - lastTime.t <= cfg.timingFreshMs;
    function entity(id) {
        let state = entities.get(id);
        if (!state) { state = { id, samples: [], pending: [], flagged: false }; entities.set(id, state); }
        return state;
    }
    const features = createJumpResetFeatures({ now, onOpportunity: opportunity => {
        if (onOpportunity) onOpportunity(opportunity);
        const t = opportunity.at;
        if (!timingReady(t) || opportunity.reason !== 'landed' || !opportunity.damaged ||
            opportunity.samples < cfg.minSamples || opportunity.maxStep > cfg.maxStep ||
            Math.abs(opportunity.landingHeightChange) > cfg.maxLandingChange) return;
        const hit = opportunity.observedRise >= cfg.minRise && opportunity.observedRise <= cfg.maxRise;
        entity(opportunity.entityId).pending.push({ t, hit, hurtAt: opportunity.velocityAt,
            observedRise: opportunity.observedRise, velocityKnown: opportunity.velocitySource === 'observer velocity' });
    } });
    function evaluate(state, t) {
        const samples = state.samples.filter(sample => sample.t > t - cfg.windowMs);
        state.samples = samples;
        if (state.flagged || samples.length < cfg.minOpportunities) return;
        const hits = samples.filter(sample => sample.hit);
        if (hits.length < cfg.minHits || hits.length / samples.length < cfg.minHitFraction ||
            samples.at(-1).hurtAt - samples[0].hurtAt < cfg.minSpanMs) return;
        state.flagged = true;
        const name = nameOf(state.id) || `entity #${state.id}`;
        const reason = `${hits.length}/${samples.length} grounded hits followed by matching jump-like motion; manual timing can look the same`;
        const flag = { cheat: 'Jump Reset', entityId: state.id, name, tier: 'possible', at: t,
            evidence: [{ group: 'Jump timing', reason, hard: false }],
            hits: hits.length, opportunities: samples.length, fraction: hits.length / samples.length,
            experimental: true };
        log(`[JUMP RESET] possible pattern on ${name}: ${reason}`); onFlag(flag);
    }
    function observeRecord(record) {
        if (!record || !isEnabled()) return;
        try {
            const t = Number.isFinite(Number(record.t)) ? Number(record.t) : now();
            if (t < lastEvent) { clear(); }
            lastEvent = t;
            if (record.k === 'time') {
                const age = Number(record.age), deltaTicks = lastTime ? age - lastTime.age : 0;
                const elapsed = lastTime ? t - lastTime.t : 0, tickMs = elapsed / deltaTicks;
                const healthy = Number.isSafeInteger(age) && deltaTicks > 0 && elapsed >= 500 &&
                    tickMs >= cfg.minTickMs && tickMs <= cfg.maxTickMs;
                intervals = healthy ? Math.min(intervals + 1, cfg.timingIntervals) : 0;
                lastTime = Number.isSafeInteger(age) ? { t, age } : null;
                for (const state of entities.values()) {
                    if (!healthy) state.pending.length = 0;
                    if (timingReady(t)) {
                        state.samples.push(...state.pending); state.pending.length = 0;
                        evaluate(state, t);
                    }
                }
                return;
            }
            if (record.k === 'destroy') for (const id of record.ids || []) entities.delete(Number(id));
            features.observeRecord(record);
        } catch (_) {
            // Preserve Fury's detector contract: a failed check or callback
            // must not interrupt the already-forwarded packet handler.
        }
    }
    function clear() {
        features.clear(); entities.clear(); lastTime = null; intervals = 0; lastEvent = -Infinity;
    }
    function getStatus() {
        const rows = [];
        for (const state of entities.values()) {
            const hits = state.samples.filter(sample => sample.hit).length;
            if (!hits) continue;
            rows.push({ cheat: 'Jump Reset', name: nameOf(state.id) || `entity #${state.id}`,
                tier: state.flagged ? 'possible' : null,
                detail: `${hits}/${state.samples.length} jump-like responses; experimental`,
                hits, opportunities: state.samples.length, experimental: true });
        }
        return rows;
    }
    return { observeRecord, clear, getStatus, thresholds: cfg };
}
module.exports = { createJumpResetDetector, DEFAULTS };
