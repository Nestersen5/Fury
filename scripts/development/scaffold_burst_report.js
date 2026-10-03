'use strict';

// Per-burst scaffold metrics across the recordings corpus. Feeds each
// recording through the live scaffold detector and prints, per player,
// the rotation/sneak/sprint/height profile of every qualifying bridging
// burst - the calibration input for the Vape-derived checks.
//
// Usage: node scripts/development/scaffold_burst_report.js [recordingsDir]

const fs = require('fs');
const path = require('path');
const { createScaffoldDetector } = require('../../src/detect/scaffoldDetector.js');
const { loadRecording, resolveTarget } = require('../../src/recorder/recordingAnalysis.js');

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'recordings');

function summarize(values) {
    const set = new Map();
    values.forEach(v => set.set(v, (set.get(v) || 0) + 1));
    const [mode, modeCount] = [...set.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
    return {
        distinct: set.size,
        range: values.length ? Math.max(...values) - Math.min(...values) : 0,
        mode,
        modeShare: values.length ? modeCount / values.length : 0
    };
}

for (const file of fs.readdirSync(dir).filter(f => /scaffold|legit/.test(f)).sort()) {
    const records = loadRecording(path.join(dir, file));
    const header = records.find(r => r.k === 'header') || {};
    const target = resolveTarget(records, { player: header.player });
    const flags = {};  // id -> [{t, sneak, sprint}]
    const bursts = new Map(); // id -> metrics[]
    let lastBurstEnd = new Map();
    const detector = createScaffoldDetector({
        onBurst: (state, placements, start, end) => {
            // Non-overlapping bursts only, so each 2s window counts once.
            if ((lastBurstEnd.get(state.id) || -Infinity) > start) return;
            lastBurstEnd.set(state.id, end);
            const before = state.pitches.filter(p => p.t <= start).pop();
            const inWin = state.pitches.filter(p => p.t > start && p.t <= end);
            const samples = (before ? [before] : []).concat(inWin);
            const pitch = summarize(samples.map(p => p.raw));
            const yaw = summarize(samples.filter(p => p.yaw !== null).map(p => p.yaw));
            const fl = (flags[state.id] || []);
            const sneakOns = fl.filter((f, i) => f.t > start && f.t <= end && f.sneak && !(fl[i - 1]?.sneak)).length;
            const sprintAny = fl.some(f => f.t > start && f.t <= end && f.sprint)
                || Boolean(fl.filter(f => f.t <= start).pop()?.sprint);
            const ys = state.trail.filter(p => p.t > start && p.t <= end).map(p => p.y);
            (bursts.get(state.id) || bursts.set(state.id, []).get(state.id)).push({
                n: placements.length,
                pitchMode: pitch.mode, pitchDistinct: pitch.distinct, pitchRange: pitch.range, pitchModeShare: pitch.modeShare,
                yawDistinct: yaw.distinct,
                lookSamples: inWin.length,
                sneakOns,
                sprint: sprintAny,
                yRange: ys.length ? Math.max(...ys) - Math.min(...ys) : 0
            });
        }
    });
    for (const r of records) {
        if (r.k === 'meta') {
            const e = (r.m || []).find(m => Number(m.key) === 0);
            if (e && Number.isFinite(Number(e.value))) {
                (flags[r.id] = flags[r.id] || []).push({ t: r.t, sneak: (e.value & 0x02) !== 0, sprint: (e.value & 0x08) !== 0 });
            }
        }
        detector.observeRecord(r);
    }
    console.log(`\n${header.label}  ${file}  (target ids ${[...target.ids].join(',')})`);
    bursts.forEach((list, id) => {
        const tag = target.ids.has(Number(id)) ? 'TARGET' : 'other ';
        console.log(`  ${tag} #${id}`);
        list.forEach(b => console.log(`    n${String(b.n).padStart(2)} pitch mode ${String(b.pitchMode).padStart(3)} (${(b.pitchMode * 360 / 256).toFixed(1)}deg) distinct ${b.pitchDistinct} range ${b.pitchRange} share ${b.pitchModeShare.toFixed(2)} | yaw distinct ${b.yawDistinct} | looks ${b.lookSamples} | sneakOns ${b.sneakOns} | sprint ${b.sprint ? 'Y' : '-'} | yRange ${b.yRange.toFixed(2)}`));
    });
}
