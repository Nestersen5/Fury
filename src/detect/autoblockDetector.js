'use strict';

// Live Auto Block detector.
// Swing evidence requires certified 40-60 ms ticks. Movement evidence uses
// separately certified steady 40-125 ms ticks, retaining the same speed,
// lead, damage grace, step and window thresholds. Unknown or burst delivery
// cannot certify either evidence group.
//
// Vanilla 1.8 swallows attack clicks while an item is in use (Minecraft
// runTick: while isUsingItem, keyBindAttack presses are drained, and the
// tick that releases the item drains them too). A legit block-hitter
// therefore releases blocking before the next swing. Server metadata sampling
// can hide that transient release. Auto Block cheats release, attack and
// re-block inside one tick - or hold the release back (Vape BlockHit
// "Lag" mode queues it 50-100ms+ with the attack behind it) - so observers
// see the swing while blocking has been on the whole time.
//
// Corpus (2026-09-25, 61 players with >= 10 sword swings): 57 never swung
// while blocking; the rest 2-17% of swings, consistent with network
// jitter (release and swing landing in one server tick). Legit background
// rate is modelled at 10%.
//
// Tiers, over sword swings in the last 15s (a swing counts as "while
// blocking" when blocking has been on >= 100ms, i.e. 2 ticks, before it):
//   POSSIBLE  - >= 8 swings and binomial tail score < 0.003 at rate 0.1
//   CONFIRMED - score < 1e-6, sustained over >= 4s
// These are heuristic tier scores, not validated probabilities of innocence.
// Vape BlockHit Manual/Predict (block for ~1 tick after a hit) looks like
// consistent legit block-hitting from outside and is not claimed here.
// Slow server ticks can also hide a legitimate release/re-block interval.
// World-age updates must establish fresh, approximately 20 TPS delivery before
// swings count. Unknown, slow, or burst-delivered timing cannot certify swings.
// Evidence waits for the next world-age update to certify its interval; an
// unhealthy interval discards only the evidence inside it, so one Hypixel
// timing hiccup does not erase swings earlier healthy intervals certified.
// Ordinary client jitter can still hide occasional releases at healthy TPS.
// Require the pattern on >=80% of observed swings; the binomial model alone
// incorrectly treats those correlated losses as independent rare events.
//
// Movement while using an item. Vanilla scales movement input by 0.2 while
// an item is in use (blocking, eating, drinking, drawing a bow) and drops
// sprint: steady speed stays near 0.9 blocks/s (about 1.2 with Speed II).
// Momentum from before the block decays by at least x0.91 per tick, so
// after 1s it is gone. Cancelling the release packet (Vape NoItemRelease)
// leaves the server's use flag on while the client runs freely; NoSlowdown
// moves at full speed while really blocking. Either way observers see the
// flag on while the player covers sprint distances.
//   Counted: rel moves >= 1s after the flag turned on and >= 1.5s after
//   knockback/damage; teleports and oversized steps restart the window.
//   A 2s window averaging >= 3.5 blocks/s is one hit (about 3x legit max).
//   POSSIBLE  - one certified hit
//   CONFIRMED - hits sustained over >= 4s of one use, or in 2 separate uses
//               within 60s
// BlockHit Lag re-blocks every 50-100ms, so it never reaches the 1s lead and
// stays with the swing rule above.

const { binomialTail } = require('./detectorShared.js');

const SWORDS = new Set([267, 268, 272, 276, 283]); // iron, wood, stone, diamond, gold

const DEFAULTS = {
    windowMs: 15_000,
    blockingLeadMs: 100,
    minSwings: 8,
    minBlockedFraction: 0.8,
    legitRate: 0.1,
    possibleLuck: 0.003,
    confirmedLuck: 1e-6,
    confirmedSpanMs: 4000,
    minTickMs: 40,
    maxTickMs: 60,
    timingIntervals: 2,
    timingFreshMs: 2500,
    moveMinTickMs: 40,
    moveMaxTickMs: 125,
    moveTimingFreshMs: 3500,
    moveLeadMs: 1000,
    moveKnockbackGraceMs: 1500,
    moveWindowMs: 2000,
    moveMinSpeed: 3.5,
    moveMaxStepBlocks: 2,
    moveHitSpacingMs: 500,
    moveMemoryMs: 60_000,
    moveConfirmedSpanMs: 4000,
    moveConfirmedUses: 2
};

function createAutoblockDetector(deps = {}) {
    const {
        onFlag = () => {},
        nameOf = () => null,
        isEnabled = () => true,
        log = () => {},
        now = Date.now,
        thresholds = {}
    } = deps;
    const cfg = { ...DEFAULTS, ...thresholds };
    const entities = new Map();
    let lastTime = null;
    let validTimeIntervals = 0;
    let movementTimeIntervals = 0;
    // Entities with the use flag on. Movement records are the most frequent
    // input and matter only while someone is using an item.
    let usingCount = 0;

    function timingReady(t) {
        return lastTime && validTimeIntervals >= cfg.timingIntervals
            && t >= lastTime.t && t - lastTime.t <= cfg.timingFreshMs;
    }

    function movementTimingReady(t) {
        return lastTime && movementTimeIntervals >= cfg.timingIntervals
            && t >= lastTime.t && t - lastTime.t <= cfg.moveTimingFreshMs;
    }

    function noteTime(age, t) {
        const ticks = lastTime ? age - lastTime.age : 0;
        const elapsed = lastTime ? t - lastTime.t : 0;
        const tickMs = elapsed / ticks;
        const steady = Number.isSafeInteger(age) && ticks > 0 && elapsed >= 500;
        const strict = steady && tickMs >= cfg.minTickMs && tickMs <= cfg.maxTickMs;
        const movement = steady && tickMs >= cfg.moveMinTickMs && tickMs <= cfg.moveMaxTickMs;
        validTimeIntervals = strict ? Math.min(validTimeIntervals + 1, cfg.timingIntervals) : 0;
        movementTimeIntervals = movement ? Math.min(movementTimeIntervals + 1, cfg.timingIntervals) : 0;
        if (!strict) entities.forEach(state => discardUncertified(state, t, !movement));
        lastTime = Number.isSafeInteger(age) ? { age, t } : null;
        const swingReady = timingReady(t), movementReady = movementTimingReady(t);
        if (swingReady || movementReady) entities.forEach(state => {
            if (!state.pendingEvaluation) return;
            state.pendingEvaluation = false;
            if (swingReady) state.swings.forEach(swing => { swing.certified = true; });
            if (movementReady) {
                state.movePending.forEach(hit => state.moveHits.push(hit));
                state.movePending.length = 0;
            }
            prune(state.swings, t - cfg.windowMs);
            prune(state.moveHits, t - cfg.moveMemoryMs);
            evaluate(state, t, swingReady);
        });
    }

    function entityState(id) {
        let state = entities.get(id);
        if (!state) {
            state = {
                id,
                held: null,
                blocking: false,
                blockingSince: 0,
                swings: [], // {t, whileBlocking, certified}
                useCount: 0,
                knockbackAt: -Infinity,
                moveStart: -Infinity,
                moves: [], // {t, d} horizontal blocks per rel move, last moveWindowMs
                moveSum: 0,
                lastMoveHitAt: -Infinity,
                movePending: [], // {t, speed, use} awaiting timing certification
                moveHits: [], // certified {t, speed, use}
                pendingEvaluation: false,
                flagTier: null
            };
            entities.set(id, state);
        }
        return state;
    }

    function prune(list, cutoff) {
        let drop = 0;
        while (drop < list.length && list[drop].t < cutoff) drop += 1;
        if (drop > 0) list.splice(0, drop);
    }

    function restartMoves(state, t) {
        state.moves.length = 0;
        state.moveSum = 0;
        state.moveStart = t;
    }

    function discardUncertified(state, t, discardMoves = true) {
        if (state.swings.length) {
            let kept = 0;
            state.swings.forEach(swing => {
                if (swing.certified) state.swings[kept++] = swing;
            });
            state.swings.length = kept;
        }
        if (discardMoves) {
            state.movePending.length = 0;
            if (state.blocking) restartMoves(state, t);
        }
        state.pendingEvaluation = !discardMoves && state.movePending.length > 0;
    }

    function swingEvidence(state) {
        const n = state.swings.length;
        if (n < cfg.minSwings) return null;
        const blocked = state.swings.filter(s => s.whileBlocking);
        const k = blocked.length;
        if (k / n < cfg.minBlockedFraction) return null;
        const luck = binomialTail(n, k, cfg.legitRate);
        let tier = null;
        if (luck < cfg.confirmedLuck && blocked[blocked.length - 1].t - blocked[0].t >= cfg.confirmedSpanMs) {
            tier = 'confirmed';
        } else if (luck < cfg.possibleLuck) {
            tier = 'possible';
        }
        if (!tier) return null;
        return {
            tier,
            group: 'Blocking',
            reason: `swinging while blocking (${k}/${n} sword swings without a relayed release)`
        };
    }

    function moveEvidence(state) {
        const hits = state.moveHits;
        if (!hits.length) return null;
        const spans = new Map(); // use -> {first, last}
        let maxSpeed = 0;
        hits.forEach(hit => {
            const span = spans.get(hit.use);
            if (span) span.last = hit.t;
            else spans.set(hit.use, { first: hit.t, last: hit.t });
            maxSpeed = Math.max(maxSpeed, hit.speed);
        });
        let longest = 0;
        spans.forEach(span => { longest = Math.max(longest, span.last - span.first); });
        const tier = spans.size >= cfg.moveConfirmedUses || longest >= cfg.moveConfirmedSpanMs ? 'confirmed' : 'possible';
        return {
            tier,
            group: 'Movement',
            reason: `moving ${maxSpeed.toFixed(1)} blocks/s while blocking or using an item (vanilla allows about 1)`
        };
    }

    function evaluate(state, t, allowSwing = true) {
        if (state.flagTier === 'confirmed') return;
        const parts = [allowSwing ? swingEvidence(state) : null, moveEvidence(state)].filter(Boolean);
        if (!parts.length) return;
        const tier = parts.some(part => part.tier === 'confirmed') ? 'confirmed' : 'possible';
        if (tier === state.flagTier) return;
        state.flagTier = tier;
        const name = nameOf(state.id) || `entity #${state.id}`;
        log(`[AUTOBLOCK] ${tier} on ${name}: ${parts.map(part => part.reason).join(' | ')}`);
        onFlag({
            cheat: 'Autoblock',
            entityId: state.id,
            name,
            tier,
            evidence: parts.map(part => ({ group: part.group, reason: part.reason, hard: part.tier === 'confirmed' })),
            at: t
        });
    }

    function observeMove(state, dx, dz, t) {
        const start = Math.max(state.blockingSince + cfg.moveLeadMs,
            state.knockbackAt + cfg.moveKnockbackGraceMs, state.moveStart);
        if (t < start) return;
        const d = Math.hypot(Number(dx) || 0, Number(dz) || 0) / 32;
        if (d > cfg.moveMaxStepBlocks || !movementTimingReady(t)) {
            restartMoves(state, t);
            return;
        }
        state.moves.push({ t, d });
        state.moveSum += d;
        while (state.moves.length && state.moves[0].t <= t - cfg.moveWindowMs) state.moveSum -= state.moves.shift().d;
        if (t - start < cfg.moveWindowMs || t - state.lastMoveHitAt < cfg.moveHitSpacingMs) return;
        const speed = state.moveSum / (cfg.moveWindowMs / 1000);
        if (speed < cfg.moveMinSpeed) return;
        state.lastMoveHitAt = t;
        state.movePending.push({ t, speed, use: state.useCount });
        state.pendingEvaluation = true;
    }

    function observeRecord(r) {
        if (!r || !isEnabled()) return;
        try {
            const t = Number.isFinite(Number(r.t)) ? Number(r.t) : now();
            switch (r.k) {
                case 'time':
                    noteTime(Number(r.age), t);
                    break;
                case 'eq':
                    if (Number(r.slot) === 0) entityState(Number(r.id)).held = Number(r.item);
                    break;
                case 'meta': {
                    const flags = (Array.isArray(r.m) ? r.m : []).find(entry => Number(entry?.key) === 0);
                    if (!Number.isFinite(Number(flags?.value))) break;
                    const state = entityState(Number(r.id));
                    const using = (Number(flags.value) & 0x10) !== 0;
                    if (using && !state.blocking) {
                        state.blockingSince = t;
                        state.useCount += 1;
                        restartMoves(state, t);
                        usingCount += 1;
                    } else if (!using && state.blocking) usingCount -= 1;
                    state.blocking = using;
                    break;
                }
                case 'anim': {
                    if (Number(r.a) !== 0) break;
                    const state = entities.get(Number(r.id));
                    if (!state || !SWORDS.has(state.held)) break;
                    if (!timingReady(t)) break;
                    state.swings.push({
                        t,
                        whileBlocking: state.blocking && t - state.blockingSince >= cfg.blockingLeadMs,
                        certified: false
                    });
                    prune(state.swings, t - cfg.windowMs);
                    state.pendingEvaluation = true;
                    break;
                }
                case 'mv':
                case 'mvl': {
                    if (!usingCount) break;
                    const state = entities.get(Number(r.id));
                    if (state && state.blocking) observeMove(state, r.dx, r.dz, t);
                    break;
                }
                case 'spawn':
                case 'tp': {
                    if (!usingCount) break;
                    const state = entities.get(Number(r.id));
                    if (state && state.blocking) restartMoves(state, t);
                    break;
                }
                case 'vel': {
                    const state = entities.get(Number(r.id));
                    if (state) state.knockbackAt = t;
                    break;
                }
                case 'st': {
                    const state = Number(r.s) === 2 ? entities.get(Number(r.id)) : null;
                    if (state) state.knockbackAt = t;
                    break;
                }
                case 'destroy':
                    (Array.isArray(r.ids) ? r.ids : []).forEach(id => {
                        if (entities.get(Number(id))?.blocking) usingCount -= 1;
                        entities.delete(Number(id));
                    });
                    break;
            }
        } catch (e) {
            // A detector bug must never break packet handling.
        }
    }

    function clear() {
        entities.clear();
        lastTime = null;
        validTimeIntervals = 0;
        movementTimeIntervals = 0;
        usingCount = 0;
    }

    function getStatus() {
        const rows = [];
        entities.forEach(state => {
            const blocked = state.swings.filter(s => s.whileBlocking).length;
            if (!state.flagTier && blocked === 0 && !state.moveHits.length) return;
            const details = [`${blocked}/${state.swings.length} swings while blocking (15s)`];
            if (state.moveHits.length) {
                const fastest = Math.max(...state.moveHits.map(hit => hit.speed));
                details.push(`${fastest.toFixed(1)} blocks/s while using an item (60s)`);
            }
            rows.push({
                cheat: 'Autoblock',
                name: nameOf(state.id) || `entity #${state.id}`,
                detail: details.join(', '),
                tier: state.flagTier
            });
        });
        return rows;
    }

    return { observeRecord, clear, getStatus, thresholds: cfg };
}

module.exports = { createAutoblockDetector, SWORDS };
