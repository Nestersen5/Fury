'use strict';

// Per-cheat feature report for a single /recordcheat recording.
//
// Usage:
//   node scripts/development/analyze_recording.js <file.jsonl>              (target from header/camera)
//   node scripts/development/analyze_recording.js <file.jsonl> --id N
//   node scripts/development/analyze_recording.js <file.jsonl> --player Name
//
// Prints the raw detection features for the labeled player. It does NOT
// declare "cheating" - thresholds must be calibrated by comparing these
// numbers across your legit corpus vs your cheat corpus (see
// calibration_report.js for the whole-corpus view).

const { loadRecording, resolveTarget } = require('../../src/recorder/recordingAnalysis.js');
const { extractFeatures } = require('../../src/recorder/featureExtraction.js');

function fmt(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    return Number(value).toFixed(digits);
}

function main() {
    const argv = process.argv.slice(2);
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--id') flags.id = Number(argv[++i]);
        else if (argv[i] === '--player') flags.player = argv[++i];
        else positional.push(argv[i]);
    }
    const file = positional[0];
    if (!file) {
        console.log('Usage: node scripts/development/analyze_recording.js <file.jsonl> [--id N | --player Name]');
        process.exit(1);
    }

    const records = loadRecording(file);
    const header = records.find(r => r.k === 'header') || {};
    const target = resolveTarget(records, {
        player: flags.player || header.player,
        id: flags.id
    });

    console.log(`\nFile:   ${file}`);
    console.log(`Label:  ${header.label || '-'} (source: ${header.source || '-'}, account: ${header.account || '-'})`);
    console.log(`Target: ${flags.player || header.player || '-'} -> entity id(s) ${[...target.ids].join(', ') || 'UNRESOLVED'} (${target.how})`);
    if (target.ids.size === 0) {
        console.log('\nCould not resolve the target entity. Try:');
        console.log('  node scripts/development/compare_recordings.js inspect ' + file);
        console.log('  node scripts/development/analyze_recording.js ' + file + ' --id <entityId>');
        process.exit(2);
    }

    const { timeline, autoblock, cps, scaffold, aim, movement } = extractFeatures(records, target.ids);
    if (timeline.marks.length) {
        console.log(`Marks:  ${timeline.marks.map(m => m.note || '(no note)').join(' | ')}`);
    }

    console.log('\n== AUTOBLOCK ==');
    console.log(`  swings (deduped):        ${autoblock.swings}`);
    console.log(`  swings while blocking:   ${autoblock.swingsWhileBlocking} (${fmt(autoblock.swingsWhileBlockingPct, 1)}%)   <- legit blockhitters release before swinging`);
    console.log(`  blocking toggles:        ${autoblock.toggles}`);
    console.log(`  blocked periods:         ${autoblock.blockedPeriods} (median ${fmt(autoblock.medianBlockMs, 0)}ms, p90 ${fmt(autoblock.p90BlockMs, 0)}ms)`);

    console.log('\n== AUTOCLICKER / CPS ==');
    console.log(`  max 1s CPS:              ${cps.max1sCps ?? '-'}`);
    console.log(`  best 5s avg CPS:         ${fmt(cps.best5sAvgCps, 1)}`);
    console.log(`  median swing gap:        ${fmt(cps.medianGapMs, 0)}ms`);
    console.log(`  gap CV (regularity):     ${fmt(cps.gapCv, 3)}   <- lower = more machine-like`);

    console.log('\n== SCAFFOLD ==');
    console.log(`  placements near player:  ${scaffold.attributedPlacements} (of ${scaffold.totalWorldPlacements} world placements)`);
    if (scaffold.attributedPlacements > 0) {
        console.log(`  best 2s BRIDGING burst:  ${scaffold.best2sPlacements} blocks (${fmt(scaffold.bestBurstBlocksPerSec, 1)}/s, ${scaffold.burstDirection || 'direction unknown'})`);
        console.log(`  speed during burst:      ${fmt(scaffold.burstHorizontalSpeed, 2)} blocks/s`);
        console.log(`  sneak toggles in burst:  ${scaffold.sneakTogglesInBurst}   <- godbridge sneaks rhythmically; keep-y cheats often do not`);
        console.log(`  swing coverage:          ${fmt(scaffold.swingCoveragePct, 0)}%   <- legit placements swing; silent placements are a scaffold tell`);
        console.log(`  placement rhythm CV:     ${fmt(scaffold.burstPlacementGapCv, 2)}   <- lower = metronome-like placement timing`);
        console.log(`  median pitch in burst:   ${fmt(scaffold.burstMedianPitchDeg, 0)}deg   <- legit bridging looks down (~60-90); low pitch = looking ahead`);
        if (scaffold.anomalousBurstExcluded) {
            console.log(`  excluded anomaly burst:  raw max was ${scaffold.rawBest2sPlacements} blocks/2s (falling clutch / tower spam - not bridging)`);
        }
    }

    console.log('\n== AIM / ROTATION ==');
    console.log(`  yaw samples:             ${aim.yawSamples}`);
    console.log(`  median / p99 / max step: ${fmt(aim.medianDeltaDeg, 1)} / ${fmt(aim.p99DeltaDeg, 1)} / ${fmt(aim.maxDeltaDeg, 1)} deg`);
    console.log(`  snaps >40deg / >90deg:   ${aim.snapsOver40 ?? '-'} / ${aim.snapsOver90 ?? '-'}`);

    console.log('\n== MOVEMENT GAPS (blink/lag-range - live recordings only) ==');
    console.log(`  move packets:            ${movement.movePackets}`);
    console.log(`  gap p50 / p90 / max:     ${fmt(movement.p50GapMs, 0)} / ${fmt(movement.p90GapMs, 0)} / ${fmt(movement.maxGapMs, 0)}ms`);
    console.log(`  freezes >400ms:          ${movement.freezesOver400ms}, teleports: ${movement.teleports}`);
    if ((header.source || '') === 'replay') {
        console.log('  NOTE: replay source - movement timing is re-paced by the replay server, ignore this section.');
    }

    console.log('\nThese are raw features, not verdicts. Compare each number against the same');
    console.log('feature from your legit recordings - run: node scripts/development/calibration_report.js');
}

main();
