'use strict';
// Record this narrow, explicitly authorized adoption while the main campaign stays paused.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto'), cp = require('child_process'), Module = require('module');
const { stats } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'output/anticheat-lab/mod-real');
const directory = path.join(output, 'improvements/autoblock-adoption-20260930');
const read = file => JSON.parse(fs.readFileSync(file));
const logText = file => {
    const bytes = fs.readFileSync(file);
    return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8');
};
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const verification = read(path.join(directory, 'postapply.json'));
const before = read(path.join(directory, 'before.json'));
const performance = read(path.join(directory, 'performance.json'));
assert.strictEqual(verification.detectorDirectory, path.join(root, 'src/detect'));
assert(verification.safeguards.every(s => s.passed));
assert(logText(path.join(directory, 'combat-regression.log')).includes('Shadow gate passed'));
assert(logText(path.join(directory, 'observer-regression.log')).includes('Real defensive blockhitting jitter regression passed'));
assert.strictEqual(sha(path.join(root, 'src/detect/autoblockDetector.js')), verification.sourceHashes['autoblockDetector.js']);
const changedExisting = Object.entries(before.files).filter(([relative, hash]) =>
    (fs.existsSync(path.join(root, relative)) ? sha(path.join(root, relative)) : null) !== hash).map(([relative]) => relative);
assert(changedExisting.includes('src/detect/autoblockDetector.js'));
const unrelatedObservedChanges = changedExisting.filter(relative => relative !== 'src/detect/autoblockDetector.js');
const classRoot = 'C:/Users/Admin/Desktop/vape-test-mod-codex/build/classes/java/main';
const modBefore = read(path.join(output, 'mod-build-before.json'));
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const classFiles = walk(classRoot);
assert.strictEqual(classFiles.length, Object.keys(modBefore.classFiles).length);
for (const [relative, hash] of Object.entries(modBefore.classFiles)) assert.strictEqual(sha(path.join(classRoot, relative)), hash);
assert.strictEqual(sha('C:/Users/Admin/Desktop/vape-test-mod-codex/build/libs/ClientEnhancer-1.0.0.jar'), modBefore.jarSha256);
assert(fs.existsSync(path.join(output, 'overnight/STOP_AFTER_TRIAL')));
const checkpointFile = path.join(output, 'overnight/PAUSE_CHECKPOINT.json');
const checkpoint = read(checkpointFile);
assert.strictEqual(checkpoint.status, 'paused');
const currentStatus = cp.execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
const adoption = {
    appliedAt: new Date().toISOString(), authorization: 'User: if its actaully better, implement it',
    productionFile: 'src/detect/autoblockDetector.js',
    beforeSha256: verification.baselineHashes['autoblockDetector.js'],
    frozenCandidateSha256: verification.frozenCandidateHashes['autoblockDetector.js'],
    afterSha256: verification.sourceHashes['autoblockDetector.js'],
    codeMatchesFrozenCandidate: true, commentHeaderUpdatedForProduction: true,
    validatedObserverRecordingsReplayed: 154, legitimateControls: 84, addedDetections: 3, lostDetections: 0, additionalFalseFlags: 0,
    taskEditedExistingFiles: ['src/detect/autoblockDetector.js'], changedExisting,
    otherExistingRepositoryFilesUnchanged: unrelatedObservedChanges.length === 0,
    unrelatedObservedChanges,
    preservationNote: 'Other repository work changed files concurrently. This task did not write or restore those files; before/after snapshots record their hashes without attributing the changes to this task.',
    newScripts: ['scripts/development/anticheat_lab/verify_autoblock_movement_adoption.js', 'scripts/development/anticheat_lab/finalize_autoblock_adoption.js'],
    regressions: ['Autoblock/Stasis unit tests and recording corpus shadow gate', 'Real observer timing, jitter, Lag, grounded and ladder regressions', '19 clock and movement safeguards', 'Byte-verified all-three-detector replays reproduce cached callbacks'],
    modClassFiles: classFiles.length, modClassFilesAndJarUnchanged: true,
    gitStatus: currentStatus, committed: false, proxyRestarted: false,
    independentHeldOutEvaluationCompleted: false, gameplayCampaignStillPaused: true,
    broadPreparedIntegrationApplied: false,
    resumeRequirement: 'Before any future live capture, copy/adapt the lab helpers and isolated preload to use the immutable overnight/baseline-source/src/detect baseline for historical NEW live callbacks and hash checks. Current production intentionally has a different Autoblock hash; do not overwrite it or change frozen candidate/evidence archives. Follow-up offline comparison already reads immutable baseline and frozen selected-candidate directories.'
};
write('ADOPTION.json', adoption);
write('after.json', { createdAt: adoption.appliedAt, gitStatus: currentStatus, changedExisting,
    files: Object.fromEntries(Object.keys(before.files).map(relative => [relative, fs.existsSync(path.join(root, relative)) ? sha(path.join(root, relative)) : null])) });
const lines = ['# Autoblock movement-clock adoption', '', `Applied: ${adoption.appliedAt}.`, '',
    'The user explicitly authorized this narrow production change while the larger gameplay campaign remains paused. The historical NEW detector is the previous production baseline; it is distinct from archived OLD.', '',
    '## Change', '',
    'Movement evidence now has a separate certified 40-125 ms server clock. Swing evidence still requires certified 40-60 ms ticks. Both require two valid intervals and certification of the interval containing the evidence. Unknown, non-advancing, out-of-range and burst clocks discard pending evidence. Movement retains the 3.5 blocks/s threshold, 1 s lead, 1.5 s damage grace, step limits, evidence windows and tiers.', '',
    'The proxy already imports the owning detector. The update takes effect on the next proxy start; no proxy was restarted or client window opened.', '',
    '## Results available so far', '',
    '| Cohort | Previous detection | Updated detection | False flags, previous / updated | Previous / updated trial accuracy |',
    '| --- | --- | --- | --- | --- |'];
for (const [name, c] of Object.entries(verification.cohorts)) {
    const a = c.summaries.BASELINE, b = c.summaries.CANDIDATE;
    lines.push(`| ${name} | ${stats.rateText(a.targetAny)} | ${stats.rateText(b.targetAny)} | ${a.falseAnyDetector.k}/${a.legitN} / ${b.falseAnyDetector.k}/${b.legitN} | ${(100*a.accuracyAnyDetector.p).toFixed(1)}% / ${(100*b.accuracyAnyDetector.p).toFixed(1)}% |`);
}
lines.push('', 'Original recordings are exploratory; fresh and stress recordings are calibration. Independent held-out gameplay evaluation is unfinished. The gain is three NoSlowdown trials: original c2_010 and c2_005, fresh c2_002. No existing detection was lost. All 84 legitimate controls remained clear, but these samples do not establish zero false flags for human players.', '',
    '| Cohort | Previous time to first flag | Updated time to first flag |', '| --- | --- | --- |');
for (const [name, c] of Object.entries(verification.cohorts)) if (name !== 'stressCalibration') lines.push(`| ${name} | ${stats.timeText(c.summaries.BASELINE.timeToFlagSeconds)} | ${stats.timeText(c.summaries.CANDIDATE.timeToFlagSeconds)} |`);
lines.push('', 'Times use detected cheats only; changed detections mean different subsets. AutoBlock + AutoClicker and SilentAura + AutoBlock still have no detections in these data.', '',
    '## Verification and performance', '',
    ...adoption.regressions.map(s => `- Passed: ${s}.`),
    `- Mod: all ${classFiles.length} class files and the JAR match the read-only baseline.`,
    '- This task edited only the owning Autoblock detector and added two lab verification/report scripts. Other repository work changed files concurrently; those changes were preserved and are listed in the adoption manifest. No commit.', '',
    `All-three-detector processing of ${performance.datasets.length} pre-parsed recordings (${performance.totalRecords} records): median ${performance.measurements[0].medianWallMs.toFixed(3)} ms before and ${performance.measurements[1].medianWallMs.toFixed(3)} ms after (${((performance.medianWallRatio - 1)*100).toFixed(3)}%). Three warm-ups, nine alternating passes; no material median change in this measurement.`,
    `p95 wall time: ${performance.measurements[0].p95WallMs.toFixed(3)} / ${performance.measurements[1].p95WallMs.toFixed(3)} ms. CPU and noisy heap deltas are retained in [raw performance samples](performance.json); peak/retained memory, live forwarding, IPC, rendering and gameplay responsiveness were not measured. The measured frozen candidate has exactly the same executable body as production; only explanatory header comments differ.`, '',
    '## Limits and continuation', '',
    ...verification.limitations.map(s => `- ${s}`),
    '- Vape BlockHit Lag/Manual/Predict/Auto modes are absent from the port and were not tested in this real-mod campaign. See [MOD_FIDELITY.md](../../MOD_FIDELITY.md).',
    '- Scaffold and Jump Reset are unchanged. The broader prepared integration remains unapplied.',
    '- Existing frozen OLD/NEW reports retain their historical code and results; production adoption does not retroactively change live trace evidence.', '',
    adoption.resumeRequirement, '',
    '[Full per-trial replays and clock checks](postapply.json) · [Source hashes and adoption manifest](ADOPTION.json) · [Before snapshot](before.json) · [After snapshot](after.json).', '');
fs.writeFileSync(path.join(directory, 'REPORT.md'), lines.join('\n'), { flag: 'wx' });
checkpoint.autoblockAdoption = { ...adoption, report: 'improvements/autoblock-adoption-20260930/REPORT.md' };
checkpoint.preservationScope = 'The original preservation fields describe the pause snapshot. This later, explicitly authorized Autoblock adoption changes only that detector.';
checkpoint.resumeSteps.splice(1, 0, adoption.resumeRequirement);
fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n');

// Preserve the original generator and original measurement reports; adjust its
// two current-state statements in memory and append this later adoption note.
const reportFile = path.join(__dirname, 'overnight_progress_report.js');
let source = fs.readFileSync(reportFile, 'utf8');
function replace(before, after) { assert.strictEqual(source.split(before).length, 2); source = source.replace(before, after); }
replace('All owned lab processes are stopped. Production changes are unapplied.',
    'All owned lab processes are stopped. The Autoblock movement-clock update was subsequently applied at the user\'s request; the broader integration remains unapplied.');
replace('Mod class/JAR hashes and production source match the start, and Git status matches the initial dirty tree. Held-out evaluation and final integration are unfinished.',
    'Mod class/JAR hashes match the start. The pause snapshot preserved production; the later authorized Autoblock update is documented below. Unrelated working-tree changes are preserved. Held-out evaluation and final integration are unfinished.');
const anchor = "fs.writeFileSync(path.join(base, 'OVERNIGHT_REPORT.md'), out.join('\\n'));";
replace(anchor, `out.push('## Later authorized Autoblock update', '', 'The movement-clock update is now in production source. Original exploratory detections: 28/58 to 30/58. Fresh calibration: 3/12 to 4/12. Legitimate controls: 0/84 false flags before and after. Independent held-out evaluation is unfinished. Historical OLD/NEW tables above retain the original pinned versions.', '', '[Implementation and verification report](improvements/autoblock-adoption-20260930/REPORT.md). No gameplay was resumed; the campaign remains paused.', '');\n` + anchor);
const compiled = new Module(reportFile, module);
compiled.filename = reportFile; compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, reportFile);
console.log(JSON.stringify({ report: path.join(directory, 'REPORT.md'), changedExisting, modClassFiles: classFiles.length,
    productionHash: adoption.afterSha256, campaignStatus: checkpoint.status }));
