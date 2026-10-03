'use strict';

// Live scaffold detector.
//
// Consumes the same event shapes the packet recorder produces (mv/mvl/tp/
// spawn/snap/blk/anim/look/destroy), either from live packets via
// observePacket() or from recorded JSONL via observeRecord() - the offline
// path is how the detector is shadow-verified against the labeled corpus
// before its flags are trusted.
//
// Calibration (from calibration_report.js on the 2026-07-15 corpus):
//   legit ceilings by direction: STRAIGHT 8 placements/2s, DIAGONAL 10.
//   100% swing coverage everywhere legit; bridging pitch ~79deg down.
//   scaffold clips: 9-12/2s; one with 0% swing coverage and 32deg pitch.
// Rules:
//   A. silent bridging  - burst with swing coverage < 50%          weight 2
//   B. forward pitch    - burst of >= 8 FLOOR placements with
//      median pitch < 35deg (cheats measured 21-32; legit ~79;
//      legit front-face extension bridging sits ~30-45)             weight 2
//   C. rate, per burst direction (from the placement path):
//        straight: >= 10 blocks/2s weight 2, >= 9 weight 1 (legit max 8)
//        diagonal/mixed: >= 12 weight 2, >= 11 weight 1 (legit max 10)
//      Ambiguous direction uses the diagonal (higher) thresholds.
//   D. randomized double-shift rhythm - humans re-sneak with metronomic
//      consistency while bridging (off-gap CV <= 0.19 in the corpus);
//      legit-scaffold "humanization" jitter overshoots (>= 0.43).
//      >= 10 bridging-context off-gaps with CV >= 0.30           weight 2
//   E. double-shift corrections - legit diagonal bridging is ONE sneak
//      cycle per 2 blocks (corpus: 0.53-0.57 sneak-ons/placement); the
//      double-shift cheat fires a corrective cycle per placement when
//      mispositioned, i.e. >= 2 sneak-ons inside one placement interval.
//      Corpus legit rate: ~0 (max 1 stray). >= 4 such intervals
//      within 15s                                                weight 2
//   F. irregular placement cadence in STRAIGHT bridging - human straight
//      speed-bridging is a fixed motor loop (placement gap CV 0.06-0.09
//      in the corpus); reactive scaffold configs wobble (0.39-0.58).
//      CONTINUOUS straight burst of >= 7 placements (no gap > 600ms -
//      pauses between runs are not wobble) with gap CV >= 0.30.
//      Diagonal excluded: legit diag cadence is naturally irregular
//      (0.68-0.84). Corroborating evidence only - cannot flag alone
//      (legit pair-placing/jump-synced styles alternate gaps)     weight 1
//   G. far placement - bridging blocks are placed adjacent (corpus:
//      0.29-0.49 mean player->block distance, every legit AND most cheat
//      files); extended-reach scaffold places blocks far ahead with
//      robotic consistency (observed: 3.41 mean, CV 0.10). Burst mean
//      distance >= 1.2 AND distance CV <= 0.30                   weight 2
//   H. sneak lands with the click - legit sneak-bridgers crouch 2-3
//      ticks before placing (<= 30% of level placements within 1 tick of
//      the sneak-on, legit corpus); edge-sneak automation crouches the
//      tick support runs out, with right-click held (affiyy27 clip: 88%).
//      Strikes when the within-1-tick count over the last 12s would be
//      a < 0.3% fluke at the legit 30% rate (5/5, 8/10, 13/20)  weight 2
// Flag when total weight >= 4, or weight >= 3 across bursts >= 4s apart.
// A legit-speed scaffold with swings and normal pitch does NOT flag -
// that is the deliberate cost of near-zero false positives.
//
// Vape 4.21 modes (from the decompiled Scaffold source review):
//   Legit       - automated edge sneak with a random 100-200ms release; its
//                 jitter is what rule D (sneak rhythm) measures.
//   GodBridge   - unsneaked, rotation eased onto 78/80deg (cardinal) or
//                 81/83deg (diagonal) pitch and held; places per tick on a
//                 ray-trace hit, no fixed delay.
//   TellyBridge - sprint-jump path bridging, initial aim 85-90deg.
// GodBridge/TellyBridge are SHADOW profiles (observeProfiles): counted and
// reported, never strike weight. Corpus check: a legit bridger holds the
// exact 78.8deg (raw 56) GodBridge pitch, so rotation alone cannot convict.
// Promote them only after scaffold_burst_report.js separates labeled Vape
// clips from legit godbridge/telly clips.

const { binomialTail } = require('./detectorShared.js');

const YAW_DEG_PER_UNIT = 360 / 256;

const DEFAULTS = {
    minBurstPlacements: 6,
    burstWindowMs: 2000,
    rateSuspect: 11,
    rateBlatant: 12,
    rateSuspectStraight: 9,
    rateBlatantStraight: 10,
    coverageStrikePct: 50,
    pitchStrikeDeg: 35,
    pitchMinSamples: 3,
    pitchMinPlacements: 8,
    flagWeight: 3,
    instantFlagWeight: 4,
    strikeSpacingMs: 4000,
    strikeCooldownMs: 3000,
    strikeMemoryMs: 60_000,
    minBridgeShape: 0.75,
    minFarLineShape: 0.9,
    trailMs: 3500,
    swingWindowMs: 250,
    sneakCvStrike: 0.30,
    sneakCvMinGaps: 10,
    sneakGapMaxMs: 800,
    sneakNearPlacementMs: 2500,
    sneakWindowMs: 15000,
    sneakStrikeCooldownMs: 8000,
    cadenceCvStrike: 0.30,
    cadenceMinPlacements: 7,
    cadenceMaxGapMs: 600,
    farPlaceMinDist: 1.2,
    farPlaceMaxCv: 0.30,
    doubleShiftIntervalMaxMs: 800,
    doubleShiftMinEvents: 4,
    doubleShiftWindowMs: 15000,
    doubleShiftCooldownMs: 8000,
    // Rule H (sneak lands with the click). Tight = sneak-on at most
    // ~1 tick before the placement (75ms absorbs tick jitter); the
    // sneak-on may trail the block by a few ms in the same tick.
    sneakLeadTightMs: 75,
    sneakLeadMaxMs: 400,
    sneakLeadAfterMs: 25,
    sneakLeadWindowMs: 12000,
    // Strike only when the tight count would be a < 0.3% fluke for the
    // latest-sneaking legit bridger in the corpus (30% tight). Small
    // samples need near-perfect runs (5/5, 8/10); long ones less (13/20).
    sneakLeadMinSamples: 5,
    sneakLeadLegitRate: 0.3,
    sneakLeadMaxLuck: 0.003,
    sneakLeadCooldownMs: 8000,
    // Hard evidence (CONFIRMED tier). Proposals checked against the corpus:
    // no legit clip reaches any of these.
    hardCoveragePct: 20,          // swings on < 20% of placements...
    hardCoverageMinPlacements: 8, // ...across >= 8 blocks
    hardRateMargin: 3,            // >= legit max + 3 level blocks/2s
    hardSneakLeadLuck: 1e-6,      // sneak-lead fluke chance below 1 in a million
    // Sneak-based rules (D and E) only collect evidence while the player
    // is verifiably bridging at speed: >= this many floor placements in
    // the last 2s AND the window passes the bridging gates (movement, no
    // falling, path progression). A slow struggling bridger who panics
    // on sneak produces messy sneak data but never qualifies.
    sneakContextMinPlacements: 5,
    // Shadow Vape-mode profiles (report-only, no strike weight).
    profileMinPlacements: 6,
    godbridgePitchMin: 55,
    godbridgePitchMax: 59,
    tellyPitchMin: 60
};

function i64ToNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (Array.isArray(value) && value.length === 2) {
        return Number(value[0]) * 4294967296 + Number(value[1] >>> 0);
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function createScaffoldDetector(deps = {}) {
    const {
        onFlag = () => {},
        getUuidMappedName = () => null,
        isEnabled = () => true,
        // When true (replay viewing), strikes only count while playback is
        // verifiably clean 1x: world ticks advancing at ~20/s with fresh
        // samples. Pausing, rewinding, or speed changes suspend evaluation.
        requireCleanPlayback = () => false,
        log = () => {},
        // Analysis-only hook: sees every qualifying bridging burst.
        onBurst = null,
        now = Date.now,
        thresholds = {}
    } = deps;
    const cfg = { ...DEFAULTS, ...thresholds };

    // entityId -> tracked state
    const entities = new Map();
    const timeSamples = []; // {wall, age} from update_time, last ~12
    let lastEventT = 0;
    // uuid -> name, captured from player_info adds. Replays add each
    // actor's uuid+name to the tab list just long enough to spawn the NPC,
    // then remove it - so the mapping must be remembered, not looked up.
    const uuidNames = new Map();

    function rememberUuidName(uuid, name) {
        if (!uuid || !name) return;
        uuidNames.set(String(uuid).toLowerCase(), name);
    }

    function nameForUuid(uuid) {
        if (!uuid) return null;
        return uuidNames.get(String(uuid).toLowerCase()) || null;
    }

    function noteTime(age, t) {
        if (!Number.isFinite(Number(age))) return;
        timeSamples.push({ wall: t, age: Number(age) });
        if (timeSamples.length > 12) timeSamples.shift();
    }

    function playbackClean() {
        if (timeSamples.length < 3) return false;
        const last = timeSamples[timeSamples.length - 1];
        // Stale time updates = paused playback (or no data): suspend.
        if (lastEventT - last.wall > 2500) return false;
        const first = timeSamples.find(s => last.wall - s.wall <= 6000);
        const spanMs = last.wall - first.wall;
        if (spanMs < 2000) return false;
        const rate = (last.age - first.age) / (spanMs / 1000);
        return rate >= 17 && rate <= 23; // ~20 ticks/s = true 1x
    }

    function entityState(id) {
        let state = entities.get(id);
        if (!state) {
            state = {
                id,
                name: null,
                uuid: null,
                x: 0, y: 0, z: 0, known: false,
                trail: [],       // {t,x,y,z} last ~3.5s
                swings: [],      // timestamps, last ~10s
                pitches: [],     // {t,deg} last ~3.5s
                placements: [],  // {t,x,y,z} attributed, last ~10s
                sneakOn: null,
                sneakOnTimes: [], // timestamps of sneak-on edges, last ~10s
                sprinting: false,
                sprintSeenAt: -Infinity,
                // Shadow (report-only) Vape-mode profile matches.
                profiles: { godbridge: 0, telly: 0 },
                lastProfileAt: -Infinity,
                lastSneakOffAt: null,
                sneakGaps: [],   // {t,gap} bridging-context re-sneak gaps
                sneakOnsSincePlacement: 0,
                doubleShiftEvents: [], // {t} intervals with >=2 sneak-ons
                lastDoubleShiftStrikeAt: -Infinity,
                // -Infinity, not 0: cooldowns compare against these, and a
                // zero init would silently suppress strikes early in the
                // timestamp space (recordings, tests).
                lastSneakStrikeAt: -Infinity,
                sneakLeads: [],  // {t,tight} rule H samples
                lastSneakLeadStrikeAt: -Infinity,
                strikes: [],     // {t,weight,reason}
                lastStrikeAt: -Infinity,
                flagged: false,
                flagTier: null   // null | 'possible' | 'confirmed'
            };
            entities.set(id, state);
        }
        return state;
    }

    function prune(list, cutoff) {
        let drop = 0;
        while (drop < list.length && (list[drop].t ?? list[drop]) < cutoff) drop += 1;
        if (drop > 0) list.splice(0, drop);
    }

    function setPosition(state, x, y, z, t) {
        state.x = x; state.y = y; state.z = z;
        state.known = true;
        state.trail.push({ t, x, y, z });
        prune(state.trail, t - cfg.trailMs);
    }

    function moveBy(state, dx, dy, dz, t) {
        if (!state.known) return;
        setPosition(state, state.x + dx / 32, state.y + dy / 32, state.z + dz / 32, t);
    }

    function addPitch(state, rawPitch, t, rawYaw) {
        if (!Number.isFinite(Number(rawPitch))) return;
        state.pitches.push({
            t,
            deg: Number(rawPitch) * YAW_DEG_PER_UNIT,
            raw: Number(rawPitch),
            yaw: Number.isFinite(Number(rawYaw)) ? Number(rawYaw) : null
        });
        prune(state.pitches, t - cfg.trailMs);
    }

    // Same bridging gates as the offline analyzer: horizontal progress,
    // no free-fall, placements advancing along a path.
    function qualifyBurst(state, windowPlacements, start, end) {
        const inWindow = state.trail.filter(p => p.t >= start && p.t <= end);
        if (inWindow.length < 2) return false;
        const first = inWindow[0];
        const last = inWindow[inWindow.length - 1];
        const horizDisp = Math.sqrt((last.x - first.x) ** 2 + (last.z - first.z) ** 2);
        const vertDrop = first.y - last.y;
        if (vertDrop > Math.max(2.5, horizDisp * 1.2)) return false;
        if (horizDisp < 2) return false;
        const a = windowPlacements[0];
        const b = windowPlacements[windowPlacements.length - 1];
        const span = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
        if (span / (windowPlacements.length - 1) < 0.6) return false;
        return true;
    }

    // Share of consecutive placements that continue a bridge: next to the
    // previous block (<= 1.5 apart) on the same level or one step up.
    // Every bridge in the corpus, legit or cheat, scores >= 0.80; blocks
    // thrown down in front while running (clusters, gaps, changing
    // heights - the BowSpammerr false flag) score far lower.
    function bridgeShape(windowPlacements, allowStep = true) {
        let connected = 0;
        for (let i = 1; i < windowPlacements.length; i++) {
            const a = windowPlacements[i - 1];
            const b = windowPlacements[i];
            const rise = b.y - a.y;
            if (Math.hypot(b.x - a.x, b.z - a.z) <= 1.5 && (rise === 0 || (allowStep && rise === 1))) connected += 1;
        }
        return connected / Math.max(1, windowPlacements.length - 1);
    }

    // Bridging lays blocks at the player's feet (corpus mean distance
    // 0.29-0.49). Blocks landing well ahead are either extended-reach
    // scaffold - a perfectly flat line out in front - or a player throwing
    // blocks down ahead while running (clusters at changing heights, the
    // BowSpammerr false flag). Far windows must therefore be a flat line.
    function isBridgeLike(windowPlacements) {
        const dists = windowPlacements.map(p => p.dist).filter(Number.isFinite);
        const meanDist = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
        if (meanDist >= cfg.farPlaceMinDist) {
            return bridgeShape(windowPlacements, false) >= cfg.minFarLineShape;
        }
        return bridgeShape(windowPlacements) >= cfg.minBridgeShape;
    }

    function evaluateBurst(state, t) {
        if (requireCleanPlayback() && !playbackClean()) return;
        const start = t - cfg.burstWindowMs;
        // Strictly-after start: a 2000ms window at 250ms spacing holds 8
        // placements, matching the offline analyzer's [t, t+2000) windows.
        const windowPlacements = state.placements.filter(p => p.t > start);
        if (windowPlacements.length < cfg.minBurstPlacements) return;
        if (!qualifyBurst(state, windowPlacements, start, t)) return;
        if (onBurst) {
            try { onBurst(state, windowPlacements, start, t); } catch (e) {}
        }
        observeProfiles(state, windowPlacements, start, t);
        // Strikes only on bridge-shaped windows (the shadow profiles above
        // see every burst - telly bridging is not a connected line).
        if (!isBridgeLike(windowPlacements)) return;
        if (t - state.lastStrikeAt < cfg.strikeCooldownMs) return;

        // Evidence parts: group (family) for the tier logic, and whether
        // the value is practically impossible for a human (hard).
        const parts = [];
        const burstSpan = t - windowPlacements[0].t;

        const covered = windowPlacements.filter(place =>
            state.swings.some(s => Math.abs(s - place.t) <= cfg.swingWindowMs)
        ).length;
        const coveragePct = covered / windowPlacements.length * 100;
        if (coveragePct < cfg.coverageStrikePct) {
            parts.push({
                family: 'swing',
                weight: 2,
                reason: `silent placement (${coveragePct.toFixed(0)}% swings)`,
                hard: coveragePct < cfg.hardCoveragePct && windowPlacements.length >= cfg.hardCoverageMinPlacements,
                spanMs: burstSpan
            });
        }

        // Pitch strike only on substantial bursts: casually placing floor
        // blocks while running rarely sustains 8 in 2s, real scaffold does.
        if (windowPlacements.length >= cfg.pitchMinPlacements) {
            const pitchSamples = state.pitches
                .filter(p => p.t >= start && p.t <= t)
                .map(p => p.deg)
                .sort((a, b) => a - b);
            if (pitchSamples.length >= cfg.pitchMinSamples) {
                const median = pitchSamples[Math.floor(pitchSamples.length / 2)];
                if (median < cfg.pitchStrikeDeg) {
                    // Never hard: legit front-face extension sits ~30-45deg.
                    parts.push({ family: 'aim', weight: 2, reason: `bridging looking ahead (pitch ${median.toFixed(0)}deg)`, hard: false, spanMs: burstSpan });
                }
            }
        }

        // Direction-aware rate thresholds: straight bridging has a lower
        // legit ceiling (8/2s) than diagonal (10/2s). Ambiguous paths use
        // the diagonal thresholds - the conservative choice.
        const first = windowPlacements[0];
        const last = windowPlacements[windowPlacements.length - 1];
        const adx = Math.abs(last.x - first.x);
        const adz = Math.abs(last.z - first.z);
        const maxAxis = Math.max(adx, adz);
        const isStraight = maxAxis > 0 && (Math.min(adx, adz) / maxAxis) <= 0.3;
        const blatantAt = isStraight ? cfg.rateBlatantStraight : cfg.rateBlatant;
        const suspectAt = isStraight ? cfg.rateSuspectStraight : cfg.rateSuspect;
        const dirLabel = isStraight ? 'straight, legit max 8' : 'diagonal, legit max 10';
        // Staircase bridging (flat run, jump, one block up, flat again):
        // the step-up block is placed from a jump, not a bridging stride.
        // The legit ceilings were measured on level bridges, so step-up
        // blocks do not count toward the rate.
        const levelPlacements = windowPlacements.filter((place, i) => i === 0 || place.y <= windowPlacements[i - 1].y);
        const steppedUp = levelPlacements.length < windowPlacements.length;
        const legitMax = isStraight ? cfg.rateBlatantStraight - 2 : cfg.rateBlatant - 2;
        if (levelPlacements.length >= blatantAt) {
            parts.push({
                family: 'speed',
                weight: 2,
                reason: `${levelPlacements.length} blocks/2s (${dirLabel})`,
                hard: levelPlacements.length >= legitMax + cfg.hardRateMargin,
                spanMs: burstSpan
            });
        } else if (levelPlacements.length >= suspectAt) {
            parts.push({ family: 'speed', weight: 1, reason: `${levelPlacements.length} blocks/2s elevated (${dirLabel})`, hard: false, spanMs: burstSpan });
        }

        // Far placement: bridging blocks land adjacent to the player
        // (corpus max 0.49 mean distance); extended-reach scaffold places
        // far ahead with robotic consistency. Both conditions required so
        // legit long-reach extension styles (varied distance) never match.
        const dists = windowPlacements.map(p => p.dist).filter(Number.isFinite);
        if (dists.length >= cfg.minBurstPlacements) {
            const distMean = dists.reduce((a, b) => a + b, 0) / dists.length;
            if (distMean >= cfg.farPlaceMinDist) {
                const distVariance = dists.reduce((a, b) => a + (b - distMean) * (b - distMean), 0) / dists.length;
                const distCv = Math.sqrt(distVariance) / distMean;
                if (distCv <= cfg.farPlaceMaxCv) {
                    // Hard: legit bridging never exceeded 0.49 mean distance.
                    parts.push({ family: 'reach', weight: 2, reason: `placing ${distMean.toFixed(1)} blocks ahead, robotic (CV ${distCv.toFixed(2)}; legit max 0.5)`, hard: true, spanMs: burstSpan });
                }
            }
        }

        // Irregular placement cadence, straight bridging only: human
        // straight speed-bridge cadence is metronomic (CV 0.06-0.09);
        // reactive scaffold placement wobbles (0.39+). Diagonal cadence
        // is naturally irregular, so it never enters this check.
        // Guards (field FP reports): the burst must be CONTINUOUS - any
        // gap > 600ms means the window straddles a pause between bridge
        // runs, and a pause is not wobble. Weight 1 so cadence alone can
        // never flag: it corroborates rate/sneak/pitch evidence, because
        // legit straight styles outside the corpus (pair-placing,
        // jump-synced rhythms) can alternate gaps at legit speed.
        // A step-up jump interrupts the stride, so a window containing
        // one is not a single straight run.
        if (isStraight && !steppedUp && windowPlacements.length >= cfg.cadenceMinPlacements) {
            const placementGaps = [];
            for (let i = 1; i < windowPlacements.length; i++) {
                placementGaps.push(windowPlacements[i].t - windowPlacements[i - 1].t);
            }
            const continuous = placementGaps.every(gap => gap <= cfg.cadenceMaxGapMs);
            const mean = placementGaps.reduce((a, b) => a + b, 0) / placementGaps.length;
            if (continuous && mean > 0) {
                const variance = placementGaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / placementGaps.length;
                const cadenceCv = Math.sqrt(variance) / mean;
                if (cadenceCv >= cfg.cadenceCvStrike) {
                    parts.push({ family: 'speed', weight: 1, reason: `irregular straight cadence (CV ${cadenceCv.toFixed(2)}, legit <=0.09)`, hard: false, spanMs: burstSpan });
                }
            }
        }

        if (parts.length === 0) return;
        state.lastStrikeAt = t;
        addStrike(state, t, parts);
        maybeFlag(state, t);
    }

    // The player is actively bridging: enough floor placements in the last
    // window AND the window passes the movement/fall/path gates. Sneak
    // evidence collected outside this state is noise (struggling players,
    // edge peeking), not technique.
    function isActivelyBridging(state, t) {
        const start = t - cfg.burstWindowMs;
        const windowPlacements = state.placements.filter(p => p.t > start);
        if (windowPlacements.length < cfg.sneakContextMinPlacements) return false;
        return qualifyBurst(state, windowPlacements, start, t)
            && isBridgeLike(windowPlacements);
    }

    function observeSprint(state, sprinting, t) {
        if (sprinting || state.sprinting) state.sprintSeenAt = t;
        state.sprinting = sprinting;
    }

    // Vape 4.21 scaffold-mode profiles (see file header). SHADOW ONLY: a
    // match is counted, logged and shown in /scafdetect status, but adds
    // no strike weight. Legit godbridge/telly bridging is observably
    // similar, and the corpus shows legit bridgers holding the exact
    // GodBridge pitch - these become strikes only once calibrated against
    // labeled GodBridge/TellyBridge and legit godbridge/telly recordings.
    function observeProfiles(state, windowPlacements, start, t) {
        if (t - state.lastProfileAt < cfg.burstWindowMs) return;
        if (windowPlacements.length < cfg.profileMinPlacements) return;
        const sneakOns = state.sneakOnTimes.filter(s => s > start).length;
        if (sneakOns > 0 || state.sneakOn) return; // both modes bridge unsneaked
        const carried = state.pitches.filter(p => p.t <= start).pop();
        const samples = state.pitches.filter(p => p.t > start && p.t <= t);
        if (carried) samples.unshift(carried);
        if (samples.length === 0) return;
        const raws = samples.map(p => p.raw);
        const minPitch = Math.min(...raws);
        const maxPitch = Math.max(...raws);
        const heights = state.trail.filter(p => p.t > start && p.t <= t).map(p => p.y);
        const yRange = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
        const who = state.name || nameForUuid(state.uuid) || `entity #${state.id}`;
        const pitchText = `${(minPitch * YAW_DEG_PER_UNIT).toFixed(1)}-${(maxPitch * YAW_DEG_PER_UNIT).toFixed(1)}deg`;

        // GodBridge: flat, unsneaked bridging with rotation parked on its
        // 78/80 (cardinal) or 81/83 (diagonal) pitch targets. 1.8 encodes
        // pitch as floor(deg * 256/360): 78->55, 80->56, 81->57, 83->59.
        // The eased controller settles exactly (0 tolerance), so allow at
        // most one target transition (range <= 2 units) inside 55..59.
        if (yRange < 0.5
            && minPitch >= cfg.godbridgePitchMin && maxPitch <= cfg.godbridgePitchMax
            && maxPitch - minPitch <= 2) {
            state.profiles.godbridge += 1;
            state.lastProfileAt = t;
            log(`[SCAFFOLD] shadow: ${who} GodBridge-like burst (${windowPlacements.length} blocks/2s, no sneak, pitch ${pitchText})`);
            return;
        }

        // TellyBridge: sprint-jumping (height swings >= ~1 block) while
        // floor blocks keep landing at a flat or stepping-up level, aim
        // pointed steeply down (initial target 85-90deg -> units 60-64).
        const placementYs = windowPlacements.map(p => p.y);
        const nonDecreasing = placementYs.every((y, i) => i === 0 || y >= placementYs[i - 1]);
        // Metadata only arrives on change: sprinting now, or dropped
        // sprint (jump/place transitions) within the window.
        if ((state.sprinting || t - state.sprintSeenAt <= cfg.burstWindowMs)
            && yRange >= 1
            && nonDecreasing
            && maxPitch >= cfg.tellyPitchMin) {
            state.profiles.telly += 1;
            state.lastProfileAt = t;
            log(`[SCAFFOLD] shadow: ${who} TellyBridge-like burst (${windowPlacements.length} blocks/2s, sprint-jumping, no sneak, pitch ${pitchText})`);
        }
    }

    // Player climbed more than half a block between two moments.
    function roseSince(state, since, t) {
        let low = Infinity;
        let high = -Infinity;
        for (const p of state.trail) {
            if (p.t < since || p.t > t) continue;
            if (p.y < low) low = p.y;
            if (p.y > high) high = p.y;
        }
        return high - low > 0.5;
    }

    function observeSneak(state, sneaking, t) {
        if (sneaking === state.sneakOn) return;
        state.sneakOn = sneaking;
        if (!sneaking) {
            state.lastSneakOffAt = t;
            return;
        }
        state.sneakOnsSincePlacement += 1;
        state.sneakOnTimes.push(t);
        prune(state.sneakOnTimes, t - 10_000);
        if (state.lastSneakOffAt === null) return;
        const gap = t - state.lastSneakOffAt;
        if (gap <= 0 || gap >= cfg.sneakGapMaxMs) return;
        if (!isActivelyBridging(state, t)) return;
        // Stepping up a level (jump + place) replaces a sneak cycle; that
        // longer gap is technique, not randomized scaffold timing.
        if (roseSince(state, state.lastSneakOffAt, t)) return;
        state.sneakGaps.push({ t, gap });
        prune(state.sneakGaps, t - cfg.sneakWindowMs);
        evaluateSneakRhythm(state, t);
    }

    function evaluateSneakRhythm(state, t) {
        if (t - state.lastSneakStrikeAt < cfg.sneakStrikeCooldownMs) return;
        if (requireCleanPlayback() && !playbackClean()) return;
        if (state.sneakGaps.length < cfg.sneakCvMinGaps) return;
        const gapValues = state.sneakGaps.map(g => g.gap);
        const mean = gapValues.reduce((a, b) => a + b, 0) / gapValues.length;
        if (mean <= 0) return;
        const variance = gapValues.reduce((a, b) => a + (b - mean) * (b - mean), 0) / gapValues.length;
        const cv = Math.sqrt(variance) / mean;
        if (cv < cfg.sneakCvStrike) return;
        state.lastSneakStrikeAt = t;
        addStrike(state, t, [{
            family: 'sneak',
            weight: 2,
            reason: `randomized double-shift rhythm (CV ${cv.toFixed(2)}, legit <=0.19)`,
            hard: false,
            spanMs: t - state.sneakGaps[0].t
        }]);
        maybeFlag(state, t);
    }

    function addStrike(state, t, parts) {
        const weight = parts.reduce((sum, part) => sum + part.weight, 0);
        const reason = parts.map(part => part.reason).join(', ');
        state.strikes.push({ t, weight, reason, parts });
        // Evidence only combines within one stretch of play: a stray
        // strike minutes earlier must not top up an unrelated one.
        prune(state.strikes, t - cfg.strikeMemoryMs);
        log(`[SCAFFOLD] strike on ${state.name || `entity #${state.id}`}: ${reason} (weight ${weight})`);
    }

    // Tiers. POSSIBLE = enough weight (instant, or accumulated over time).
    // CONFIRMED additionally needs, spanning separate bridges (>= 4s):
    //   - hard evidence (practically impossible for a human), either one
    //     piece covering >= 4s or two pieces >= 4s apart; or
    //   - strong (weight 2) evidence from >= 2 independent groups.
    // Groups: sneak (rhythm, double-shift, sneak lead - one behaviour, so
    // agreeing sneak checks count once), speed, swing, aim, reach.
    function tierFor(state) {
        const total = state.strikes.reduce((sum, s) => sum + s.weight, 0);
        const spread = state.strikes.length >= 2
            ? state.strikes[state.strikes.length - 1].t - state.strikes[0].t
            : 0;
        const possible = total >= cfg.instantFlagWeight
            || (total >= cfg.flagWeight && spread >= cfg.strikeSpacingMs);
        if (!possible) return null;

        const hard = [];
        const strongByFamily = new Map(); // family -> [t]
        state.strikes.forEach(strike => (strike.parts || []).forEach(part => {
            if (part.hard) hard.push({ t: strike.t, spanMs: part.spanMs || 0 });
            if (part.weight >= 2) {
                if (!strongByFamily.has(part.family)) strongByFamily.set(part.family, []);
                strongByFamily.get(part.family).push(strike.t);
            }
        }));
        const hardSustained = hard.some(h => h.spanMs >= cfg.strikeSpacingMs)
            || (hard.length >= 2 && hard[hard.length - 1].t - hard[0].t >= cfg.strikeSpacingMs);
        let familiesApart = false;
        if (strongByFamily.size >= 2) {
            const times = [...strongByFamily.values()].flat();
            familiesApart = Math.max(...times) - Math.min(...times) >= cfg.strikeSpacingMs;
        }
        return hardSustained || familiesApart ? 'confirmed' : 'possible';
    }

    function maybeFlag(state, t) {
        if (state.flagTier === 'confirmed') return;
        const tier = tierFor(state);
        if (!tier || tier === state.flagTier) return;
        // At most two lines per player: POSSIBLE, then one upgrade.
        state.flagTier = tier;
        state.flagged = true;
        const total = state.strikes.reduce((sum, s) => sum + s.weight, 0);
        onFlag({
            entityId: state.id,
            name: state.name || nameForUuid(state.uuid) || `entity #${state.id}`,
            tier,
            weight: total,
            strikes: state.strikes.slice(),
            reason: state.strikes.map(s => s.reason).join(' | '),
            at: t
        });
    }

    function attributePlacement(x, y, z, t) {
        let best = null;
        let bestDist = Infinity;
        let contested = false;
        entities.forEach(state => {
            if (!state.known) return;
            if (t - (state.trail[state.trail.length - 1]?.t || 0) > cfg.trailMs) return;
            const horiz = Math.sqrt((x + 0.5 - state.x) ** 2 + (z + 0.5 - state.z) ** 2);
            const dy = state.y - y;
            // Floor blocks only (below the player's feet): walls and
            // body-level placements while running are not bridging.
            if (horiz > 4 || dy < 0.8 || dy > 3.5) return;
            if (horiz < bestDist) {
                contested = best !== null && horiz > bestDist - 1;
                best = state;
                bestDist = horiz;
            } else if (horiz < bestDist + 1) {
                contested = true;
            }
        });
        // Two players close to the same block: skip rather than guess -
        // wrong attribution is how false positives happen.
        if (!best || contested) return;
        const previous = best.placements[best.placements.length - 1];
        best.placements.push({ t, x, y, z, dist: bestDist });
        prune(best.placements, t - 10_000);
        // Double-shift correction check: >= 2 sneak-ons landed inside the
        // interval since the previous placement of the same bridge run,
        // and only while verifiably bridging at speed - a struggling
        // player panic-tapping sneak on a slow bridge must not count.
        if (previous
            && t - previous.t <= cfg.doubleShiftIntervalMaxMs
            && previous.y === y
            && best.sneakOnsSincePlacement >= 2
            && isActivelyBridging(best, t)) {
            best.doubleShiftEvents.push({ t });
            prune(best.doubleShiftEvents, t - cfg.doubleShiftWindowMs);
            evaluateDoubleShift(best, t);
        }
        // Sneak-lead check runs on the PREVIOUS placement: by now any
        // sneak metadata from that same server tick has arrived.
        if (previous
            && t - previous.t <= cfg.doubleShiftIntervalMaxMs
            && previous.y === y
            && isActivelyBridging(best, t)) {
            observeSneakLead(best, previous, t);
        }
        best.sneakOnsSincePlacement = 0;
        evaluateBurst(best, t);
    }

    // Rule H - sneak lands with the click. Legit sneak-bridgers crouch
    // ~100-150ms (2-3 ticks) before placing: at most 30% of placements
    // within 1 tick of the sneak-on across the legit corpus (straight
    // 3-21%, diagonal 22-30%). Edge-sneak automation (Vape Legit mode)
    // crouches the tick support runs out while right-click is held, so
    // the block lands with the sneak: 88% on the 2026-09-25 affiyy27 clip.
    function observeSneakLead(state, place, t) {
        let sneakOnAt = null;
        for (let i = state.sneakOnTimes.length - 1; i >= 0; i--) {
            const on = state.sneakOnTimes[i];
            if (on > place.t + cfg.sneakLeadAfterMs) continue;
            if (place.t - on <= cfg.sneakLeadMaxMs) sneakOnAt = on;
            break;
        }
        if (sneakOnAt === null) return;
        state.sneakLeads.push({ t: place.t, tight: place.t - sneakOnAt <= cfg.sneakLeadTightMs });
        prune(state.sneakLeads, t - cfg.sneakLeadWindowMs);
        evaluateSneakLead(state, t);
    }

    function evaluateSneakLead(state, t) {
        if (t - state.lastSneakLeadStrikeAt < cfg.sneakLeadCooldownMs) return;
        if (requireCleanPlayback() && !playbackClean()) return;
        if (state.sneakLeads.length < cfg.sneakLeadMinSamples) return;
        const tight = state.sneakLeads.filter(lead => lead.tight).length;
        const samples = state.sneakLeads.length;
        if (binomialTail(samples, tight, cfg.sneakLeadLegitRate) >= cfg.sneakLeadMaxLuck) return;
        const share = tight / samples;
        state.lastSneakLeadStrikeAt = t;
        const luck = binomialTail(samples, tight, cfg.sneakLeadLegitRate);
        addStrike(state, t, [{
            family: 'sneak',
            weight: 2,
            reason: `sneak lands with the click (${tight}/${samples} = ${Math.round(share * 100)}% within 1 tick, legit ~30%)`,
            // Hard: far beyond any legit fluke, not just unlikely.
            hard: luck < cfg.hardSneakLeadLuck,
            spanMs: t - state.sneakLeads[0].t
        }]);
        log(`[SCAFFOLD] sneak lead on ${state.name || `entity #${state.id}`}: ${tight}/${samples} within 1 tick`);
        maybeFlag(state, t);
    }

    function evaluateDoubleShift(state, t) {
        if (t - state.lastDoubleShiftStrikeAt < cfg.doubleShiftCooldownMs) return;
        if (requireCleanPlayback() && !playbackClean()) return;
        if (state.doubleShiftEvents.length < cfg.doubleShiftMinEvents) return;
        state.lastDoubleShiftStrikeAt = t;
        addStrike(state, t, [{
            family: 'sneak',
            weight: 2,
            reason: `double-shift corrections (${state.doubleShiftEvents.length} in 15s, legit ~0)`,
            hard: false,
            spanMs: t - state.doubleShiftEvents[0].t
        }]);
        maybeFlag(state, t);
    }

    function observeRecord(r) {
        if (!r) return;
        // Name bookkeeping (tab/spawn/destroy) runs even while disabled -
        // replays surface each actor's name only once, before the detector
        // may have switched on, and losing it means anonymous flags.
        const enabled = isEnabled();
        if (!enabled && r.k !== 'tab' && r.k !== 'spawn' && r.k !== 'destroy') return;
        try {
            const t = Number.isFinite(Number(r.t)) ? Number(r.t) : now();
            if (t > lastEventT) lastEventT = t;
            switch (r.k) {
                case 'time':
                    noteTime(r.age, t);
                    break;
                case 'tab':
                    (Array.isArray(r.named) ? r.named : []).forEach(entry => rememberUuidName(entry.uuid, entry.name));
                    break;
                case 'spawn': {
                    const state = entityState(Number(r.id));
                    if (r.uuid) state.uuid = String(r.uuid).toLowerCase();
                    state.name = r.name || nameForUuid(r.uuid) || state.name;
                    if (enabled && Number.isFinite(Number(r.x))) setPosition(state, r.x / 32, r.y / 32, r.z / 32, t);
                    if (enabled) addPitch(state, r.pitch, t, r.yaw);
                    break;
                }
                case 'snap': {
                    const state = entityState(Number(r.id));
                    if (r.name) state.name = r.name;
                    if (Number.isFinite(Number(r.x))) setPosition(state, r.x, r.y, r.z, t);
                    break;
                }
                case 'tp': {
                    const state = entityState(Number(r.id));
                    if (Number.isFinite(Number(r.x))) setPosition(state, r.x / 32, r.y / 32, r.z / 32, t);
                    addPitch(state, r.pitch, t, r.yaw);
                    break;
                }
                case 'mv':
                    moveBy(entityState(Number(r.id)), r.dx || 0, r.dy || 0, r.dz || 0, t);
                    break;
                case 'mvl': {
                    const state = entityState(Number(r.id));
                    moveBy(state, r.dx || 0, r.dy || 0, r.dz || 0, t);
                    addPitch(state, r.pitch, t, r.yaw);
                    break;
                }
                case 'look':
                    addPitch(entityState(Number(r.id)), r.pitch, t, r.yaw);
                    break;
                case 'anim': {
                    if (Number(r.a) !== 0) break;
                    const state = entityState(Number(r.id));
                    state.swings.push(t);
                    prune(state.swings, t - 10_000);
                    break;
                }
                case 'meta': {
                    const flagsEntry = (Array.isArray(r.m) ? r.m : [])
                        .find(entry => Number(entry?.key) === 0);
                    if (!Number.isFinite(Number(flagsEntry?.value))) break;
                    const metaState = entityState(Number(r.id));
                    observeSprint(metaState, (Number(flagsEntry.value) & 0x08) !== 0, t);
                    observeSneak(metaState, (Number(flagsEntry.value) & 0x02) !== 0, t);
                    break;
                }
                case 'blk':
                    if (Number(r.b) !== 0) attributePlacement(Number(r.x), Number(r.y), Number(r.z), t);
                    break;
                case 'mblk':
                    (Array.isArray(r.r) ? r.r : []).forEach(rec => {
                        if (Number(rec.b) === 0) return;
                        const p = Number(rec.p);
                        attributePlacement(Number(r.cx) * 16 + ((p >> 4) & 15), Number(rec.y), Number(r.cz) * 16 + (p & 15), t);
                    });
                    break;
                case 'destroy':
                    (Array.isArray(r.ids) ? r.ids : []).forEach(id => entities.delete(Number(id)));
                    break;
            }
        } catch (e) {
            // A detector bug must never break packet handling.
        }
    }

    // Live path: translate raw clientbound packets into record shapes.
    // Name-carrying packets (player_info, spawns, destroys) pass through
    // even while disabled; high-volume packets bail out immediately.
    function observePacket(data, meta) {
        if (!meta) return;
        if (!isEnabled()
            && meta.name !== 'player_info'
            && meta.name !== 'named_entity_spawn'
            && meta.name !== 'entity_destroy') return;
        try {
            const t = now();
            switch (meta.name) {
                case 'player_info': {
                    const named = (Array.isArray(data.data) ? data.data : [])
                        .filter(entry => entry?.name)
                        .map(entry => ({ uuid: entry.UUID || entry.uuid || null, name: entry.name }));
                    if (named.length) observeRecord({ k: 'tab', t, named });
                    break;
                }
                case 'named_entity_spawn': {
                    const uuid = data.playerUUID || data.UUID || data.uuid || null;
                    observeRecord({
                        k: 'spawn', t, id: data.entityId, uuid,
                        name: uuid ? getUuidMappedName(uuid) : null,
                        x: data.x, y: data.y, z: data.z, pitch: data.pitch, yaw: data.yaw
                    });
                    break;
                }
                case 'entity_teleport':
                    observeRecord({ k: 'tp', t, id: data.entityId, x: data.x, y: data.y, z: data.z, pitch: data.pitch, yaw: data.yaw });
                    break;
                case 'rel_entity_move':
                    observeRecord({ k: 'mv', t, id: data.entityId, dx: data.dX, dy: data.dY, dz: data.dZ });
                    break;
                case 'entity_move_look':
                    observeRecord({ k: 'mvl', t, id: data.entityId, dx: data.dX, dy: data.dY, dz: data.dZ, pitch: data.pitch, yaw: data.yaw });
                    break;
                case 'entity_look':
                    observeRecord({ k: 'look', t, id: data.entityId, pitch: data.pitch, yaw: data.yaw });
                    break;
                case 'animation':
                    observeRecord({ k: 'anim', t, id: data.entityId, a: data.animation });
                    break;
                case 'entity_metadata': {
                    const flagsEntry = (Array.isArray(data.metadata) ? data.metadata : [])
                        .find(entry => Number(entry?.key ?? entry?.index) === 0);
                    if (flagsEntry !== undefined) {
                        observeRecord({ k: 'meta', t, id: data.entityId, m: [{ key: 0, value: flagsEntry.value }] });
                    }
                    break;
                }
                case 'block_change':
                    observeRecord({ k: 'blk', t, x: data.location?.x, y: data.location?.y, z: data.location?.z, b: data.type });
                    break;
                case 'multi_block_change':
                    observeRecord({
                        k: 'mblk', t, cx: data.chunkX, cz: data.chunkZ,
                        r: (data.records || []).map(rec => ({
                            p: rec.horizontalPos ?? rec.horizontalPosition, y: rec.y, b: rec.blockId
                        }))
                    });
                    break;
                case 'entity_destroy':
                    observeRecord({ k: 'destroy', t, ids: data.entityIds });
                    break;
                case 'update_time':
                    observeRecord({ k: 'time', t, age: i64ToNumber(data.age) });
                    break;
            }
        } catch (e) {}
    }

    function setEntityName(id, name) {
        if (!Number.isFinite(Number(id)) || !name) return;
        entityState(Number(id)).name = name;
    }

    function clear() {
        entities.clear();
        timeSamples.length = 0;
        lastEventT = 0;
        uuidNames.clear();
    }

    function getStatus() {
        const rows = [];
        entities.forEach(state => {
            const profiled = state.profiles.godbridge + state.profiles.telly;
            if (state.strikes.length === 0 && profiled === 0) return;
            rows.push({
                name: state.name || nameForUuid(state.uuid) || `entity #${state.id}`,
                weight: state.strikes.reduce((sum, s) => sum + s.weight, 0),
                strikes: state.strikes.length,
                flagged: state.flagged,
                tier: state.flagTier,
                profiles: { ...state.profiles }
            });
        });
        return rows.sort((a, b) => b.weight - a.weight);
    }

    // Best-known name for an entity id (tab/spawn bookkeeping runs even
    // while disabled) - shared with the other detectors.
    function nameOf(id) {
        const state = entities.get(Number(id));
        if (!state) return null;
        return state.name || nameForUuid(state.uuid) || null;
    }

    return { observeRecord, observePacket, setEntityName, clear, getStatus, nameOf, thresholds: cfg };
}

module.exports = { createScaffoldDetector };
