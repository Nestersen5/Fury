'use strict';

// Corpus-wide calibration report: extracts detection features from EVERY
// recording in recordings/ and tabulates them grouped by label, so you can
// see where the legit population ends and the cheat population begins.
//
// Usage:
//   node scripts/development/calibration_report.js [dir]
//
// Reading the report: for each feature, look at the range across your
// legit_* files vs the range across a cheat label. A live detector
// threshold is only trustworthy where those ranges DO NOT overlap - with
// margin. If they overlap, you need more samples or a better feature,
// not a braver threshold.

const fs = require('fs');
const path = require('path');
const { dataPath } = require('../../src/storage/runtimePaths.js');
const { loadRecording, resolveTarget } = require('../../src/recorder/recordingAnalysis.js');
const { extractFeatures } = require('../../src/recorder/featureExtraction.js');

function fmt(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    return Number(value).toFixed(digits);
}

function shortFile(file) {
    const base = path.basename(file, '.jsonl');
    return base.length > 44 ? `${base.slice(0, 41)}...` : base;
}

function main() {
    const dir = process.argv[2] || dataPath('recordings');
    if (!fs.existsSync(dir)) {
        console.log(`No recordings directory at ${dir}`);
        process.exit(1);
    }
    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => path.join(dir, f))
        .sort();
    if (files.length === 0) {
        console.log(`No .jsonl recordings in ${dir}`);
        process.exit(1);
    }

    const rows = [];
    for (const file of files) {
        try {
            const records = loadRecording(file);
            const header = records.find(r => r.k === 'header') || {};
            const target = resolveTarget(records, { player: header.player });
            if (target.ids.size === 0) {
                rows.push({ file, label: header.label || '?', error: 'target unresolved' });
                continue;
            }
            const { autoblock, cps, scaffold, aim, movement } = extractFeatures(records, target.ids);
            rows.push({
                file,
                label: header.label || '?',
                source: header.source || 'live',
                player: header.player || '?',
                resolvedBy: target.how.split(' ')[0],
                autoblock,
                cps,
                scaffold,
                aim,
                movement
            });
        } catch (e) {
            rows.push({ file, label: '?', error: e.message });
        }
    }

    const byLabel = new Map();
    rows.forEach(row => {
        if (!byLabel.has(row.label)) byLabel.set(row.label, []);
        byLabel.get(row.label).push(row);
    });

    console.log(`\nCalibration report - ${rows.length} recording(s) in ${dir}\n`);
    const header = `${'label'.padEnd(16)} ${'src'.padEnd(6)} ${'swings'.padStart(6)} ${'swBlk%'.padStart(7)} ${'cps1s'.padStart(6)} ${'gapCV'.padStart(6)} ${'scf/2s'.padStart(7)} ${'dir'.padStart(5)} ${'spd'.padStart(6)} ${'snk'.padStart(4)} ${'cov%'.padStart(5)} ${'pCV'.padStart(5)} ${'pitch'.padStart(6)} ${'snkCV'.padStart(6)} ${'dbl'.padStart(6)} ${'sn/pl'.padStart(6)}  file`;
    console.log(header);
    console.log('-'.repeat(header.length + 10));

    for (const [label, group] of [...byLabel.entries()].sort()) {
        for (const row of group) {
            if (row.error) {
                console.log(`${label.padEnd(16)} ${'-'.padEnd(6)} ERROR: ${row.error}  (${shortFile(row.file)})`);
                continue;
            }
            console.log(
                `${label.padEnd(16)} ${row.source.padEnd(6)}`
                + ` ${String(row.autoblock.swings).padStart(6)}`
                + ` ${fmt(row.autoblock.swingsWhileBlockingPct).padStart(7)}`
                + ` ${String(row.cps.max1sCps ?? '-').padStart(6)}`
                + ` ${fmt(row.cps.gapCv, 2).padStart(6)}`
                + ` ${(String(row.scaffold.best2sPlacements ?? '-') + (row.scaffold.anomalousBurstExcluded ? '*' : '')).padStart(7)}`
                + ` ${String(row.scaffold.burstDirection ? row.scaffold.burstDirection.slice(0, 4) : '-').padStart(5)}`
                + ` ${fmt(row.scaffold.burstHorizontalSpeed).padStart(6)}`
                + ` ${String(row.scaffold.sneakTogglesInBurst ?? '-').padStart(4)}`
                + ` ${fmt(row.scaffold.swingCoveragePct, 0).padStart(5)}`
                + ` ${fmt(row.scaffold.burstPlacementGapCv, 2).padStart(5)}`
                + ` ${fmt(row.scaffold.burstMedianPitchDeg, 0).padStart(6)}`
                + ` ${fmt(row.scaffold.sneakOffGapCv, 2).padStart(6)}`
                + ` ${(row.scaffold.bridgingIntervals ? `${row.scaffold.doubleShiftIntervals}/${row.scaffold.bridgingIntervals}` : '-').padStart(6)}`
                + ` ${fmt(row.scaffold.sneakOnsPerPlacement, 2).padStart(6)}`
                + `  ${shortFile(row.file)}`
            );
        }
    }

    // Per-label min..max ranges for the headline features - the separation
    // (or overlap) between legit_* rows and cheat rows is the calibration.
    console.log('\nPer-label ranges (min..max across recordings):');
    const rangeOf = (group, pick) => {
        const values = group.map(pick).filter(v => Number.isFinite(Number(v)) && v !== null);
        if (!values.length) return '-';
        return `${fmt(Math.min(...values))}..${fmt(Math.max(...values))}`;
    };
    for (const [label, group] of [...byLabel.entries()].sort()) {
        const ok = group.filter(r => !r.error);
        if (!ok.length) continue;
        console.log(`  ${label.padEnd(18)} (${ok.length} file(s))`);
        console.log(`    swings-while-blocking %: ${rangeOf(ok, r => r.autoblock.swingsWhileBlockingPct)}`);
        console.log(`    max 1s CPS:              ${rangeOf(ok, r => r.cps.max1sCps)}`);
        console.log(`    swing gap CV:            ${rangeOf(ok, r => r.cps.gapCv)}`);
        console.log(`    best 2s placements:      ${rangeOf(ok, r => r.scaffold.best2sPlacements)}`);
        console.log(`    burst speed (blocks/s):  ${rangeOf(ok, r => r.scaffold.burstHorizontalSpeed)}`);
        console.log(`    swing coverage %:        ${rangeOf(ok, r => r.scaffold.swingCoveragePct)}`);
        console.log(`    placement rhythm CV:     ${rangeOf(ok, r => r.scaffold.burstPlacementGapCv)}`);
        console.log(`    median burst pitch deg:  ${rangeOf(ok, r => r.scaffold.burstMedianPitchDeg)}`);
        console.log(`    sneak off-gap CV:        ${rangeOf(ok, r => r.scaffold.sneakOffGapCv)}`);
        console.log(`    yaw snaps >40deg:        ${rangeOf(ok, r => r.aim.snapsOver40)}`);
    }

    console.log('\nHow to use this: a detector threshold must sit ABOVE the max of every');
    console.log('legit_* label with margin, and BELOW the min of the cheat label it targets.');
    console.log('Overlapping ranges = collect more samples (especially fast legit play).');
    console.log('scf/2s marked with * had an anomalous burst excluded (falling clutch /');
    console.log('tower spam) - only bridging-shaped bursts count toward the feature.');
}

main();
