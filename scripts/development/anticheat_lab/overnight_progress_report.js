'use strict';
// A single readable entry point. Missing work is explicitly pending, never zero.
const fs = require('fs'), path = require('path');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real');
const read = relative => { const f = path.join(base, relative); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : null; };
const rate = r => r?.n ? `${r.k}/${r.n} · ${(100*r.p).toFixed(1)}% (95% ${(100*r.low).toFixed(1)}–${(100*r.high).toFixed(1)}%)` : 'n/a';
const time = d => d?.n ? `${d.median.toFixed(2)} s (n=${d.n}; mean ${d.mean.toFixed(2)}, p90 ${d.p90.toFixed(2)})` : 'n/a — no detected trials';
const out = ['# Overnight anticheat results', '',
    `Updated: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/Warsaw' })} Europe/Warsaw.`, '',
    'Rates count trials, not individual packets or notifications. A detection is a detector callback before teammate and Possible-alert chat filtering. Confidence bounds are Wilson 95% for binomial rates. F1 bound envelopes are descriptive, not independent 95% intervals.', '',
    '## 1. Original Autoblock comparison — completed', ''];
const pauseCheckpoint = read('overnight/PAUSE_CHECKPOINT.json');
if (pauseCheckpoint?.status === 'paused') out.splice(4, 0,
    `**Paused at the user's request. ${pauseCheckpoint.totalValidatedFullTrials} full trials independently validated; pilots excluded. All owned lab processes are stopped. Production changes are unapplied.**`,
    '[Saved resume checkpoint](overnight/PAUSE_CHECKPOINT.json).', '');
const a = read('overnight/measurement-autoblock/FULL_RESULTS.json');
if (a) {
    const old = a.stats.OLD.overall, now = a.stats.NEW.overall;
    out.push('| Measure | OLD | NEW |', '| --- | --- | --- |',
        `| Cheat trials detected | ${rate(old.targetAny)} | ${rate(now.targetAny)} |`,
        `| Confirmed detection | ${rate(old.targetConfirmed)} | ${rate(now.targetConfirmed)} |`,
        `| Legit trials falsely flagged by any detector | ${rate(old.falseAnyDetector)} | ${rate(now.falseAnyDetector)} |`,
        `| Overall trial accuracy | ${rate(old.accuracyAnyDetector)} | ${rate(now.accuracyAnyDetector)} |`,
        `| Cheat trials missed | ${old.cheatN - old.targetAny.k}/${old.cheatN} | ${now.cheatN - now.targetAny.k}/${now.cheatN} |`,
        `| Precision | ${rate(old.precision)} | ${rate(now.precision)} |`,
        `| F1 | ${old.f1.value.toFixed(3)} | ${now.f1.value.toFixed(3)} |`,
        `| Time to first flag, detected cheats only | ${time(old.timeToFlagSeconds)} | ${time(now.timeToFlagSeconds)} |`, '',
        `Same ${a.trials.length} recordings: OLD-only ${a.pair.oldOnly}; NEW-only ${a.pair.newOnly}; exact McNemar p=${a.pair.mcnemarExactTwoSidedP.toPrecision(6)}.`, '',
        '| Cheat scenario | OLD | NEW |', '| --- | ---: | ---: |');
    const names = { C1:'NoItemRelease', C2:'NoSlowdown, Sprint on/off', C3:'AutoBlock + AutoClicker', C4:'Manual AutoBlock, 1–5 ticks', C5:'SilentAura + AutoBlock', C6:'NoItemRelease + AutoBlock + AutoClicker' };
    for (const [id, label] of Object.entries(names)) {
        const x = a.stats.OLD.scenarios[id].targetAny, y = a.stats.NEW.scenarios[id].targetAny;
        out.push(`| ${id}: ${label} | ${x.k}/${x.n} | ${y.k}/${y.n} |`);
    }
    out.push('', '**Neither detector caught C3 or C5.** NEW’s gain was eight NoSlowdown trials. No cross-family actor flags were observed.', '',
        'On the 20 cheat trials detected by both versions, every first-flag timestamp was identical. The lower overall NEW median comes from its eight additional fast Movement detections, not earlier flags on shared detections. [Paired timing audit](PAIRED_TIME_AUDIT.json).', '',
        '[Detailed Autoblock report](REPORT.md) · [frozen original measurement](overnight/measurement-autoblock/manifest.json) · [launch/settings audit](LAUNCH_QUALITY_AUDIT.json) · [setting/tick subgroups](SUBGROUP_RESULTS.json).');
    if (fs.existsSync(path.join(base, 'overnight/figures/autoblock-original.png'))) out.push('', '![Original Autoblock comparison](overnight/figures/autoblock-original.png)');
} else out.push('Pending.');
out.push('', '## 2. Original Scaffold measurement', '');
const b = read('overnight/measurement-scaffold/FULL_RESULTS.json');
if (b) {
    const s = b.stats.NEW.overall;
    out.push(`Validated trials: ${b.trials.length}. Detector source identical in OLD and NEW.`, '',
        '| Measure | Scaffold |', '| --- | --- |', `| Detection | ${rate(s.targetAny)} |`,
        `| Confirmed | ${rate(s.targetConfirmed)} |`, `| Legit false flags, any detector | ${rate(s.falseAnyDetector)} |`,
        `| Overall trial accuracy | ${rate(s.accuracyAnyDetector)} |`,
        `| Cheat trials missed | ${s.cheatN - s.targetAny.k}/${s.cheatN} |`,
        `| Precision | ${rate(s.precision)} |`, `| F1 | ${s.f1.value.toFixed(3)} |`,
        `| Time to first flag | ${time(s.timeToFlagSeconds)} |`,
        `| Blocks accepted before first flag | ${s.blocksBeforeFlag.n ? `median ${s.blocksBeforeFlag.median}; mean ${s.blocksBeforeFlag.mean.toFixed(2)}; p90 ${s.blocksBeforeFlag.p90}; n=${s.blocksBeforeFlag.n}` : 'n/a'} |`, '',
        '| Scenario | Detection / false flags |', '| --- | --- |');
    const names = { S1:'Scaffold Legit, straight', S2:'Scaffold Legit, diagonal', S3:'GodBridge, straight', S4:'GodBridge, direction changes', S5:'TellyBridge',
        L7:'Manual sneak bridge, straight', L8:'Manual sneak bridge, diagonal', L9:'Ninja bridge with edge taps', L10:'Careful bridge with pauses / air clicks', L11:'Pillaring / wall' };
    for (const id of Object.keys(names)) {
        const row = b.stats.NEW.scenarios[id];
        out.push(`| ${id}: ${names[id]} | ${rate(id.startsWith('L') ? row.falseAnyDetector : row.targetAny)} |`);
    }
    out.push('', '**Missed all Legit and TellyBridge trials.** GodBridge combined: 9/18, split into 1/10 straight and 8/8 with direction changes. All nine detections remained Possible; no cross-family flags.', '',
        '[Detailed Scaffold report](scaffold/REPORT.md) · [rules, weights and mode totals](scaffold/RULE_AND_MODE_RESULTS.json).');
    if (fs.existsSync(path.join(base, 'overnight/figures/scaffold-original.png'))) out.push('', '![Original Scaffold results](overnight/figures/scaffold-original.png)');
} else {
    const evidence = read('scaffold/FULL_EVIDENCE.json');
    out.push(`**Running / validation pending.** ${evidence?.valid ?? 0}/82 independently validated. No full-cohort rate is claimed.`, '',
        'Earlier captures were superseded systematically because live position context differed from recorder snapshots. All raw evidence is retained. Careful controls are also repeated with deliberate missed clicks.');
}
out.push('', '## 3. Improvement calibration and independent evaluation', '',
    'These comparisons use the original NEW detector as their baseline. They are separate from OLD vs NEW above. Calibration results do not count as independent evaluation.', '');
for (const part of ['autoblock','scaffold']) {
    const prefix = part === 'scaffold' ? 'improvements/fresh/scaffold/' : 'improvements/fresh/';
    const calibration = read(prefix + (part === 'scaffold' ? 'CORROBORATION_' : '') + 'CALIBRATION_RESULTS.json');
    if (calibration) {
        const x = calibration.summaries.BASELINE.overall, y = calibration.summaries.CANDIDATE.overall;
        out.push(`- **Calibration only — ${part}:** detection ${rate(x.targetAny)} → ${rate(y.targetAny)}; any-detector false flags ${rate(x.falseAnyDetector)} → ${rate(y.falseAnyDetector)}. Candidate selection uses these trials; this is not held-out accuracy.`);
    }
    const result = read(prefix + 'EVALUATION_RESULTS.json');
    if (!result) { out.push(`- ${part}: independent evaluation pending.`); continue; }
    const x = result.summaries.BASELINE.overall, y = result.summaries.CANDIDATE.overall;
    out.push(`- ${part}: detection ${rate(x.targetAny)} → ${rate(y.targetAny)}; any-detector false flags ${rate(x.falseAnyDetector)} → ${rate(y.falseAnyDetector)}. [Comparison](${prefix}EVALUATION_REPORT.md).`);
}
const stress = read('improvements/movement-stress/EVALUATION_RESULTS.json');
if (stress) out.push(`- **Legal movement stress, independent evaluation:** ${rate(stress.summaries.BASELINE.overall.falseAnyDetector)} → ${rate(stress.summaries.CANDIDATE.overall.falseAnyDetector)} false flags. [Report](improvements/movement-stress/EVALUATION_REPORT.md).`);
else out.push(`- Legal movement stress: ${read('improvements/movement-stress/FULL_EVIDENCE.json')?.valid ?? 0}/40 full trials independently validated; calibration/evaluation pending. Six distinct condition pilots passed and are excluded from the accuracy totals.`);
const stressCalibration = read('improvements/movement-stress/CALIBRATION_RESULTS.json');
if (stressCalibration) out.push(`- **Calibration stress controls:** ${rate(stressCalibration.summaries.BASELINE.overall.falseAnyDetector)} → ${rate(stressCalibration.summaries.CANDIDATE.overall.falseAnyDetector)} false flags. Scripted boundary controls, not human-population evidence.`);
const decision = read('improvements/fresh/FROZEN_DECISION.json');
if (decision) out.push(`- **Frozen candidate for held-out evaluation:** movement clock ${decision.accepted.movementClock ? 'selected' : 'rejected'}; Scaffold corroboration ${decision.accepted.scaffoldCorroboration ? 'selected' : 'rejected'}. This is a calibration decision, not production promotion. [Decision](improvements/fresh/FROZEN_DECISION.json).`);
const shadow = read('improvements/SCAFFOLD_SHADOW_POLICY_AUDIT.json');
if (shadow) out.push(`- **Unpromoted shadow-profile diagnostic:** profile-only alerts would mark ${shadow.cohorts.original.profileOnlyDetection.k}/${shadow.cohorts.original.profileOnlyDetection.n} original cheat trials and ${shadow.cohorts.original.profileOnlyFalseFlags.k}/${shadow.cohorts.original.profileOnlyFalseFlags.n} original controls. This is hypothetical, not an actual detection improvement. Known legitimate human GodBridge/TellyBridge coverage is missing. [Diagnostic and rejection](improvements/SCAFFOLD_SHADOW_POLICY_AUDIT.md).`);
for (const split of ['calibration', 'evaluation']) {
    if (fs.existsSync(path.join(base, `overnight/figures/followup-${split}.png`)))
        out.push('', `![Fresh ${split} comparison](overnight/figures/followup-${split}.png)`);
}
out.push('', '## 4. Jump Reset — experimental possible alerts', '');
const jumpNames = { J1: '100% chance, perfect timing', J2: 'Default chance and timing', J3: '70% chance, tight timing', J4: 'Perfect timing, targeting only',
    L12: 'No manual jumps', L13: 'Independent random jumps', L14: 'Manual reactive jumps', L15: 'Manual anticipatory jumps' };
const j = read('jump-reset/FULL_RESULTS_EVALUATION.json');
if (j) {
    const x = j.variants.PILOT_BASELINE.overall, y = j.variants.CALIBRATED.overall;
    out.push(`Independent evaluation: ${y.n} trials. Detection ${rate(x.targetAny)} → ${rate(y.targetAny)}.`,
        `Any-detector false flags: ${rate(y.falseAnyDetector)}. Time to flag: ${time(y.timeToFlagSeconds)}.`, '',
        '| Scenario | Calibrated detection / false flags |', '| --- | --- |');
    for (const [id, s] of Object.entries(j.variants.CALIBRATED.scenarios)) out.push(`| ${id}: ${jumpNames[id] || id} | ${rate(id.startsWith('L') ? s.falseAnyDetector : s.targetAny)} |`);
    out.push('', '[Full Jump Reset evaluation](jump-reset/REPORT_EVALUATION.md).');
} else {
    const evidence = read('jump-reset/FULL_EVIDENCE.json');
    out.push(`**Evaluation pending.** ${evidence?.valid ?? 0}/320 full trials independently validated: ${evidence?.rows.filter(r => r.split === 'calibration').length ?? 0}/160 calibration and ${evidence?.rows.filter(r => r.split === 'evaluation').length ?? 0}/160 held-out evaluation. The partial held-out set is unscored. Pilots do not count. The candidate was frozen before evaluation.`);
}
const jumpCalibration = read('jump-reset/FULL_RESULTS_CALIBRATION.json');
if (jumpCalibration) {
    const x = jumpCalibration.variants.PILOT_BASELINE.overall, y = jumpCalibration.variants.CALIBRATED.overall;
    out.push('', '**Calibration only: initial vs frozen thresholds.** This data selected the candidate and is not held-out accuracy.', '',
        '| Measure | Initial thresholds | Frozen thresholds |', '| --- | --- | --- |',
        `| Cheat trials detected | ${rate(x.targetAny)} | ${rate(y.targetAny)} |`,
        `| Legit false flags, any detector | ${rate(x.falseAnyDetector)} | ${rate(y.falseAnyDetector)} |`,
        `| Time to flag, detected cheats only | ${time(x.timeToFlagSeconds)} | ${time(y.timeToFlagSeconds)} |`, '',
        'Both initial false alerts were on manual anticipatory jumps. The frozen candidate missed all default-chance trials in calibration. [Full calibration breakdown](jump-reset/REPORT_CALIBRATION.md).');
    const paired = jumpCalibration.paired.sharedTiming?.calibratedMinusInitialSeconds;
    if (paired?.n) out.push('', `On ${paired.n} commonly detected cheat trials, paired calibrated-minus-initial delay: median ${paired.median.toFixed(2)} s; mean ${paired.mean.toFixed(2)} s; p90 ${paired.p90.toFixed(2)} s. Overall medians use different detected subsets.`);
}
if (fs.existsSync(path.join(base, 'overnight/figures/jump-reset-calibration-tradeoff.png')))
    out.push('', '![Jump Reset calibration tradeoff](overnight/figures/jump-reset-calibration-tradeoff.png)');
if (read('jump-reset/PROTOTYPE_SAFETY_CHECK.json')) out.push('', 'Eight pilot fixture safety checks passed, including corrected legal controls and shared live/replay input-shape checks. They are technical verification, not full-campaign accuracy results.');
out.push('', 'Legal jump timing can produce identical observer packets. Jump Reset never emits Confirmed, and finite scripted trials cannot prove a zero false-positive rate for human players.', '',
    '## Original performance and evidence checks', '');
for (const part of ['autoblock','scaffold']) {
    const performance = read(`overnight/${part}-original-performance.json`);
    if (!performance) continue;
    const [before, after] = performance.measurements;
    out.push(`- ${part}: OLD ${before.medianWallMs.toFixed(2)} ms → NEW ${after.medianWallMs.toFixed(2)} ms (${((performance.medianWallRatio-1)*100).toFixed(1)}%) for ${performance.datasets.length} complete recordings / ${performance.totalRecords.toLocaleString('en-GB')} pre-parsed observer records. [Raw samples](overnight/${part}-original-performance.json).`);
}
out.push('', 'Detector CPU processing only: three warm-ups and nine alternating passes with GC outside timing. These measurements do not establish game or launcher responsiveness.', '',
    'Original live/offline decisions and evidence excluding timing fields matched on all 192 valid trials. Exact timing matched 109/110 Autoblock and 81/82 Scaffold streams; each remaining discrepancy was 1 ms. Raw timestamps are preserved.', '',
    `Invalid/superseded completed original attempts: Autoblock ${a?.invalidAttempts.length ?? 'pending'}; Scaffold ${b?.invalidAttempts.length ?? 'pending'}. Scaffold also has one interrupted attempt without completed ground truth. All are retained and listed in the detailed reports; pilots are excluded.`, '',
    ...(pauseCheckpoint?.status === 'paused' ? [
        `At the pause, Jump Reset added ${pauseCheckpoint.jumpReset.invalidAttempts.length} invalid attempts for l13_026 after focus loss, plus one interrupted l13_040 attempt without completed ground truth. These do not count toward results and must be rerun with the same IDs and seeds.`, ''
    ] : []),
    '## Scope and limits', '',
    '- Read-only Vape-based Forge port, not Vape itself. [Fidelity audit](MOD_FIDELITY.md).',
    '- Vape BlockHit Lag/Manual/Predict/Auto modes are absent and untested.',
    '- Scripted input, vanilla 1.8.9 server, loopback relays, one Windows PC; no public server play.',
    '- Mod RNG is unseeded; inputs, transport, tick schedules and plans are seeded.',
    '- Misses remain misses. Rejected candidates and invalid trials remain evidence.', '',
    '[Further accuracy proposals and data priorities](improvements/PROPOSALS.md). These proposals are separate from applied changes.', '',
    '## Completion / cleanup', '',
    read('overnight/PAUSE_CHECKPOINT.json')?.status === 'paused'
        ? '**Paused at the user’s request. All owned lab processes are stopped.** Mod class/JAR hashes and production source match the start, and Git status matches the initial dirty tree. Held-out evaluation and final integration are unfinished. [Resume checkpoint](overnight/PAUSE_CHECKPOINT.json).'
        : read('overnight/finish-manifest.json') ? 'Final mod hashes and Git status saved in [finish manifest](overnight/finish-manifest.json). See the final completion note for process cleanup and implementation verification.' : '**Work is still active.** Final implementation verification, performance comparison and cleanup are pending.', '');
fs.writeFileSync(path.join(base, 'OVERNIGHT_REPORT.md'), out.join('\n'));
console.log(path.join(base, 'OVERNIGHT_REPORT.md'));
