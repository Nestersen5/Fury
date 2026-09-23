'use strict';

// Per-cheat detection-feature extraction from /recordcheat recordings.
// Used by analyze_recording.js (single file) and calibration_report.js
// (whole corpus). These numbers are the calibration inputs - thresholds
// come from comparing them between legit-labeled and cheat-labeled files.

const { quantiles, gaps, dedupTimes, usingItemFlag, sneakFlag } = require('./recordingAnalysis.js');

const YAW_DEG_PER_UNIT = 360 / 256; // 1.8 sends angles as signed bytes

function extractTargetTimeline(records, targetIds) {
    const isTarget = (r) => targetIds.has(Number(r.id));
    const timeline = {
        header: records.find(r => r.k === 'header') || {},
        swings: [],
        blockingChanges: [],
        sneakChanges: [],
        positions: [],
        yawSamples: [],
        moveTimes: [],
        teleports: 0,
        placements: [],
        breaks: [],
        marks: [],
        clipStartT: null
    };
    const pos = { x: 0, y: 0, z: 0, known: false };
    let lastBlocking = null;
    let lastSneak = null;

    for (const r of records) {
        if (r.k === 'mark') timeline.marks.push({ t: r.t, note: r.note || '' });
        if (r.k === 'clipstart') timeline.clipStartT = r.t;

        if (r.k === 'blk') {
            const entry = { t: r.t, x: Number(r.x), y: Number(r.y), z: Number(r.z), b: Number(r.b) };
            (entry.b === 0 ? timeline.breaks : timeline.placements).push(entry);
            continue;
        }
        if (r.k === 'mblk' && Array.isArray(r.r)) {
            r.r.forEach(rec => {
                const p = Number(rec.p);
                const entry = {
                    t: r.t,
                    x: Number(r.cx) * 16 + ((p >> 4) & 15),
                    y: Number(rec.y),
                    z: Number(r.cz) * 16 + (p & 15),
                    b: Number(rec.b)
                };
                (entry.b === 0 ? timeline.breaks : timeline.placements).push(entry);
            });
            continue;
        }

        if (!isTarget(r)) continue;

        switch (r.k) {
            case 'snap':
                if (Number.isFinite(Number(r.x))) {
                    pos.x = Number(r.x); pos.y = Number(r.y); pos.z = Number(r.z);
                    pos.known = true;
                    timeline.positions.push({ t: r.t, x: pos.x, y: pos.y, z: pos.z });
                }
                break;
            case 'spawn':
            case 'tp':
                if (Number.isFinite(Number(r.x))) {
                    pos.x = Number(r.x) / 32; pos.y = Number(r.y) / 32; pos.z = Number(r.z) / 32;
                    pos.known = true;
                    timeline.positions.push({ t: r.t, x: pos.x, y: pos.y, z: pos.z });
                }
                if (r.k === 'tp') timeline.teleports += 1;
                if (Number.isFinite(Number(r.yaw))) {
                    timeline.yawSamples.push({
                        t: r.t,
                        yaw: Number(r.yaw) * YAW_DEG_PER_UNIT,
                        pitch: Number.isFinite(Number(r.pitch)) ? Number(r.pitch) * YAW_DEG_PER_UNIT : null
                    });
                }
                break;
            case 'mv':
            case 'mvl':
                timeline.moveTimes.push(r.t);
                if (pos.known) {
                    pos.x += Number(r.dx || 0) / 32;
                    pos.y += Number(r.dy || 0) / 32;
                    pos.z += Number(r.dz || 0) / 32;
                    timeline.positions.push({ t: r.t, x: pos.x, y: pos.y, z: pos.z });
                }
                if (r.k === 'mvl' && Number.isFinite(Number(r.yaw))) {
                    timeline.yawSamples.push({
                        t: r.t,
                        yaw: Number(r.yaw) * YAW_DEG_PER_UNIT,
                        pitch: Number.isFinite(Number(r.pitch)) ? Number(r.pitch) * YAW_DEG_PER_UNIT : null
                    });
                }
                break;
            case 'look':
                if (Number.isFinite(Number(r.yaw))) {
                    timeline.yawSamples.push({
                        t: r.t,
                        yaw: Number(r.yaw) * YAW_DEG_PER_UNIT,
                        pitch: Number.isFinite(Number(r.pitch)) ? Number(r.pitch) * YAW_DEG_PER_UNIT : null
                    });
                }
                break;
            case 'anim':
                if (Number(r.a) === 0) timeline.swings.push(r.t);
                break;
            case 'meta': {
                const blocking = usingItemFlag(r.m);
                if (blocking !== null && blocking !== lastBlocking) {
                    timeline.blockingChanges.push({ t: r.t, on: blocking });
                    lastBlocking = blocking;
                }
                const sneak = sneakFlag(r.m);
                if (sneak !== null && sneak !== lastSneak) {
                    timeline.sneakChanges.push({ t: r.t, on: sneak });
                    lastSneak = sneak;
                }
                break;
            }
        }
    }
    timeline.swings = dedupTimes(timeline.swings);
    return timeline;
}

function blockingStateAt(changes, t) {
    let state = null;
    for (const change of changes) {
        if (change.t > t) break;
        state = change.on;
    }
    return state;
}

function analyzeAutoblock(timeline) {
    const { swings, blockingChanges } = timeline;
    const swingsWhileBlocking = swings.filter(t => blockingStateAt(blockingChanges, t) === true).length;

    const blockedPeriods = [];
    let onSince = null;
    for (const change of blockingChanges) {
        if (change.on && onSince === null) onSince = change.t;
        if (!change.on && onSince !== null) {
            blockedPeriods.push(change.t - onSince);
            onSince = null;
        }
    }
    const [medBlock, p90Block] = quantiles(blockedPeriods, [0.5, 0.9]);
    return {
        swings: swings.length,
        swingsWhileBlocking,
        swingsWhileBlockingPct: swings.length > 0 ? swingsWhileBlocking / swings.length * 100 : null,
        toggles: blockingChanges.length,
        blockedPeriods: blockedPeriods.length,
        medianBlockMs: medBlock,
        p90BlockMs: p90Block
    };
}

function analyzeCps(timeline) {
    const swings = timeline.swings;
    if (swings.length < 2) return { swings: swings.length };
    let max1s = 0;
    for (let i = 0; i < swings.length; i++) {
        let count = 0;
        for (let j = i; j < swings.length && swings[j] < swings[i] + 1000; j++) count += 1;
        max1s = Math.max(max1s, count);
    }
    let best5s = 0;
    for (let i = 0; i < swings.length; i++) {
        let count = 0;
        for (let j = i; j < swings.length && swings[j] < swings[i] + 5000; j++) count += 1;
        best5s = Math.max(best5s, count / 5);
    }
    const swingGaps = gaps(swings).filter(g => g < 1000); // only in-combat clicking
    const mean = swingGaps.reduce((a, b) => a + b, 0) / Math.max(swingGaps.length, 1);
    const variance = swingGaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(swingGaps.length, 1);
    const cv = mean > 0 ? Math.sqrt(variance) / mean : null;
    const [medGap] = quantiles(swingGaps, [0.5]);
    return {
        swings: swings.length,
        max1sCps: max1s,
        best5sAvgCps: best5s,
        medianGapMs: medGap,
        gapCv: cv
    };
}

function positionAt(positions, t, toleranceMs = 1500) {
    let best = null;
    for (const p of positions) {
        if (Math.abs(p.t - t) <= toleranceMs && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) {
            best = p;
        }
        if (p.t - t > toleranceMs) break;
    }
    return best;
}

// A placement burst only counts as BRIDGING when it looks like bridging:
// sustained horizontal progress, no free-fall, placements advancing along
// a path. This keeps anomalies - clutch-spamming blocks while falling,
// building a wall/tower in place - from inflating the legit ceiling.
function qualifyBridgingWindow(timeline, windowPlacements, start, end) {
    const inWindow = timeline.positions.filter(p => p.t >= start && p.t <= end);
    if (inWindow.length < 2) return { qualified: false, reason: 'no-positions' };
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const horizDisp = Math.sqrt((last.x - first.x) ** 2 + (last.z - first.z) ** 2);
    const vertDrop = first.y - last.y; // positive = falling

    // Falling: allow bridging down stairs (drop ~ horizontal progress) but
    // not free-fall clutches (drop far exceeds horizontal progress).
    if (vertDrop > Math.max(2.5, horizDisp * 1.2)) return { qualified: false, reason: 'falling' };
    // Tower/wall/clutch in place: placements without meaningful travel.
    if (horizDisp < 2) return { qualified: false, reason: 'stationary' };
    // Placements must advance along a path, not pile up in one spot.
    if (windowPlacements.length > 1) {
        const a = windowPlacements[0];
        const b = windowPlacements[windowPlacements.length - 1];
        const span = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
        if (span / (windowPlacements.length - 1) < 0.6) return { qualified: false, reason: 'clustered' };
    }

    const seconds = (last.t - first.t) / 1000;
    return {
        qualified: true,
        speed: seconds > 0.2 ? horizDisp / seconds : null
    };
}

function analyzeScaffold(timeline) {
    const attributed = [];
    for (const place of timeline.placements) {
        const pos = positionAt(timeline.positions, place.t);
        if (!pos) continue;
        const horiz = Math.sqrt((place.x + 0.5 - pos.x) ** 2 + (place.z + 0.5 - pos.z) ** 2);
        const dy = pos.y - place.y;
        // Floor blocks only (below the player's feet): walls and
        // body-level placements while running are not bridging.
        if (horiz <= 4 && dy >= 0.8 && dy <= 3.5) attributed.push(place);
    }
    if (attributed.length === 0) {
        return { attributedPlacements: 0, totalWorldPlacements: timeline.placements.length };
    }

    let rawBest2s = 0;
    let best2s = 0;
    let bestWindow = null;
    let bestSpeed = null;
    let bestPlacements = null;
    for (let i = 0; i < attributed.length; i++) {
        const start = attributed[i].t;
        const end = start + 2000;
        const windowPlacements = [];
        for (let j = i; j < attributed.length && attributed[j].t < end; j++) {
            windowPlacements.push(attributed[j]);
        }
        rawBest2s = Math.max(rawBest2s, windowPlacements.length);
        if (windowPlacements.length <= best2s) continue;
        const verdict = qualifyBridgingWindow(timeline, windowPlacements, start, end);
        if (!verdict.qualified) continue;
        best2s = windowPlacements.length;
        bestSpeed = verdict.speed;
        bestWindow = { start, end };
        bestPlacements = windowPlacements;
    }

    let sneakTogglesInBurst = 0;
    let burstPlacementGapCv = null;
    let burstMedianPitchDeg = null;
    let burstDirection = null;
    if (bestWindow && bestPlacements && bestPlacements.length >= 2) {
        // Path direction: straight bridging advances along one axis,
        // diagonal advances both. Ambiguous paths count as diagonal
        // (the conservative side for thresholds).
        const a = bestPlacements[0];
        const b = bestPlacements[bestPlacements.length - 1];
        const adx = Math.abs(b.x - a.x);
        const adz = Math.abs(b.z - a.z);
        const maxAxis = Math.max(adx, adz);
        if (maxAxis > 0) {
            const ratio = Math.min(adx, adz) / maxAxis;
            burstDirection = ratio <= 0.3 ? 'straight' : (ratio >= 0.5 ? 'diagonal' : 'mixed');
        }
    }
    if (bestWindow) {
        sneakTogglesInBurst = timeline.sneakChanges
            .filter(c => c.t >= bestWindow.start && c.t <= bestWindow.end).length;
        // Placement rhythm: humans vary their placement timing; scaffold
        // mods are metronome-regular (low CV) or tick-quantized.
        if (bestPlacements && bestPlacements.length >= 4) {
            const placementGaps = gaps(bestPlacements.map(p => p.t));
            const mean = placementGaps.reduce((a, b) => a + b, 0) / placementGaps.length;
            if (mean > 0) {
                const variance = placementGaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / placementGaps.length;
                burstPlacementGapCv = Math.sqrt(variance) / mean;
            }
        }
        // Pitch while bridging: legit bridgers look DOWN at the edge
        // (pitch ~60-90deg); scaffold cheats let you look ahead.
        const pitches = timeline.yawSamples
            .filter(s => s.t >= bestWindow.start && s.t <= bestWindow.end && Number.isFinite(s.pitch))
            .map(s => s.pitch);
        if (pitches.length > 0) {
            [burstMedianPitchDeg] = quantiles(pitches, [0.5]);
        }
    }

    // Placement geometry: horizontal distance from the player to each
    // placed block at placement time. A robotic scaffold places at
    // machine-consistent range; humans scatter (early, late, stretched).
    let placementDistMean = null;
    let placementDistCv = null;
    {
        const dists = [];
        for (const place of attributed) {
            const pos = positionAt(timeline.positions, place.t, 400);
            if (!pos) continue;
            dists.push(Math.sqrt((place.x + 0.5 - pos.x) ** 2 + (place.z + 0.5 - pos.z) ** 2));
        }
        if (dists.length >= 6) {
            const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
            const variance = dists.reduce((a, b) => a + (b - mean) * (b - mean), 0) / dists.length;
            placementDistMean = mean;
            if (mean > 0) placementDistCv = Math.sqrt(variance) / mean;
        }
    }

    // Sneak (double-shift) rhythm: humans in a bridging rhythm re-sneak
    // with metronomic consistency (off-gap CV <= ~0.19 in the corpus);
    // legit-scaffold cheats add randomization jitter and overshoot
    // (>= ~0.43). Only sneaks near attributed placements count, and only
    // rhythm-range gaps (<800ms) - mid-bridge pauses are not rhythm.
    let sneakOffGapCv = null;
    let sneakOffGapCount = 0;
    {
        const nearPlacement = (t) => attributed.some(p => Math.abs(p.t - t) <= 2500);
        const offGaps = [];
        let offAt = null;
        for (const change of timeline.sneakChanges) {
            if (!nearPlacement(change.t)) {
                offAt = null;
                continue;
            }
            if (change.on) {
                if (offAt !== null) {
                    const gap = change.t - offAt;
                    if (gap > 0 && gap < 800) offGaps.push(gap);
                }
            } else {
                offAt = change.t;
            }
        }
        sneakOffGapCount = offGaps.length;
        if (offGaps.length >= 8) {
            const mean = offGaps.reduce((a, b) => a + b, 0) / offGaps.length;
            const variance = offGaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / offGaps.length;
            if (mean > 0) sneakOffGapCv = Math.sqrt(variance) / mean;
        }
    }

    // Double-shift correction counting: legit diagonal bridging is ONE
    // sneak press+release per 2 blocks placed. The "double shift" scaffold
    // cheat fires a corrective sneak cycle on EACH placement when
    // mispositioned - two sneak-ons landing between consecutive placements
    // where legit play has at most one. Count intervals between
    // consecutive attributed placements (<1.5s apart, same bridge run)
    // that contain >= 2 sneak-on events.
    let doubleShiftIntervals = 0;
    let bridgingIntervals = 0;
    let sneakOnsPerPlacement = null;
    {
        const sneakOnTimes = timeline.sneakChanges.filter(c => c.on).map(c => c.t);
        for (let i = 1; i < attributed.length; i++) {
            const prev = attributed[i - 1].t;
            const cur = attributed[i].t;
            if (cur - prev > 1500) continue;
            bridgingIntervals += 1;
            const onsInInterval = sneakOnTimes.filter(t => t > prev && t <= cur).length;
            if (onsInInterval >= 2) doubleShiftIntervals += 1;
        }
        const bridgingOns = sneakOnTimes.filter(t =>
            attributed.some(p => Math.abs(p.t - t) <= 2500)
        ).length;
        if (attributed.length > 0) sneakOnsPerPlacement = bridgingOns / attributed.length;
    }

    // Swing coverage: legit placements come with an arm swing; scaffold
    // mods frequently place silently. Measured over ALL attributed
    // placements, not just the burst.
    const covered = attributed.filter(place =>
        timeline.swings.some(s => Math.abs(s - place.t) <= 250)
    ).length;
    const swingCoveragePct = attributed.length > 0 ? covered / attributed.length * 100 : null;

    return {
        attributedPlacements: attributed.length,
        totalWorldPlacements: timeline.placements.length,
        best2sPlacements: best2s,
        bestBurstBlocksPerSec: best2s / 2,
        burstHorizontalSpeed: bestSpeed,
        sneakTogglesInBurst,
        rawBest2sPlacements: rawBest2s,
        anomalousBurstExcluded: rawBest2s > best2s,
        burstPlacementGapCv,
        burstMedianPitchDeg,
        burstDirection,
        swingCoveragePct,
        sneakOffGapCv,
        sneakOffGapCount,
        doubleShiftIntervals,
        bridgingIntervals,
        sneakOnsPerPlacement,
        placementDistMean,
        placementDistCv
    };
}

function analyzeAim(timeline) {
    const samples = timeline.yawSamples;
    if (samples.length < 3) return { yawSamples: samples.length };
    const deltas = [];
    for (let i = 1; i < samples.length; i++) {
        let d = samples[i].yaw - samples[i - 1].yaw;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        const dt = samples[i].t - samples[i - 1].t;
        if (dt > 0 && dt < 300) deltas.push({ t: samples[i].t, deg: Math.abs(d) });
    }
    const degs = deltas.map(d => d.deg);
    const [p50, p99, max] = quantiles(degs, [0.5, 0.99, 1]);
    return {
        yawSamples: samples.length,
        medianDeltaDeg: p50,
        p99DeltaDeg: p99,
        maxDeltaDeg: max,
        snapsOver40: deltas.filter(d => d.deg > 40).length,
        snapsOver90: deltas.filter(d => d.deg > 90).length
    };
}

function analyzeMovementGaps(timeline) {
    const moveGaps = gaps(timeline.moveTimes);
    const [p50, p90, max] = quantiles(moveGaps, [0.5, 0.9, 1]);
    return {
        movePackets: timeline.moveTimes.length,
        p50GapMs: p50,
        p90GapMs: p90,
        maxGapMs: max,
        freezesOver400ms: moveGaps.filter(g => g > 400).length,
        teleports: timeline.teleports
    };
}

function extractFeatures(records, targetIds) {
    const timeline = extractTargetTimeline(records, targetIds);
    return {
        timeline,
        autoblock: analyzeAutoblock(timeline),
        cps: analyzeCps(timeline),
        scaffold: analyzeScaffold(timeline),
        aim: analyzeAim(timeline),
        movement: analyzeMovementGaps(timeline)
    };
}

module.exports = {
    extractTargetTimeline,
    analyzeAutoblock,
    analyzeCps,
    analyzeScaffold,
    analyzeAim,
    analyzeMovementGaps,
    extractFeatures
};
