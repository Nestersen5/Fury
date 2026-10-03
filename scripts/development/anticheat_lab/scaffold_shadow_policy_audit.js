'use strict';
// Counterfactual diagnostics only: no detector edits, no profile promotion.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { createScaffoldDetector } = require('../../../src/detect/scaffoldDetector');
const { loadRecording, resolveTarget } = require('../../../src/recorder/recordingAnalysis');
const { stats } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real');
const read = file => JSON.parse(fs.readFileSync(file));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function observe(records, targetIds) {
    const states = new Map(), flags = [];
    const detector = createScaffoldDetector({ onFlag: f => flags.push(f), onBurst: state => states.set(state.id, state) });
    for (const record of records) detector.observeRecord(record);
    const targetStates = [...states.values()].filter(s => targetIds.has(Number(s.id)));
    return { originalFlags: flags.filter(f => targetIds.has(Number(f.entityId))),
        godbridge: targetStates.reduce((n, s) => n + s.profiles.godbridge, 0),
        telly: targetStates.reduce((n, s) => n + s.profiles.telly, 0) };
}
const cohorts = {};
for (const [name, relative] of [['original', 'scaffold/FULL_EVIDENCE.json'], ['freshCalibration', 'improvements/fresh/scaffold/FULL_EVIDENCE.json']]) {
    const evidence = read(path.join(base, relative));
    const trials = evidence.rows.filter(t => name === 'original' || t.split === 'calibration');
    assert.strictEqual(trials.length, name === 'original' ? 82 : 20);
    const rows = trials.map(trial => {
        const file = path.join(trial.directory, trial.recorderFile), bytes = fs.readFileSync(file);
        assert.strictEqual(hash(bytes), trial.recorderSha256);
        const result = observe(loadRecording(file), new Set([Number(trial.actorId)]));
        return { id: trial.id, scenario: trial.scenario, effectExpected: trial.effectExpected,
            ...result, wouldAlertIfAnyProfileWerePromoted: result.godbridge > 0 || result.telly > 0 };
    });
    const positives = rows.filter(r => r.effectExpected), negatives = rows.filter(r => !r.effectExpected);
    cohorts[name] = { rows, profileOnlyDetection: stats.wilson(positives.filter(r => r.wouldAlertIfAnyProfileWerePromoted).length, positives.length),
        profileOnlyFalseFlags: stats.wilson(negatives.filter(r => r.wouldAlertIfAnyProfileWerePromoted).length, negatives.length) };
}
const historical = [];
for (const file of fs.readdirSync(path.join(root, 'recordings')).filter(f => f.endsWith('.jsonl'))) {
    const full = path.join(root, 'recordings', file), records = loadRecording(full);
    const header = records.find(r => r.k === 'header') || {}, label = header.label || '';
    if (!label.startsWith('legit') && label !== 'fidelitytest') continue;
    const target = resolveTarget(records, { player: header.player });
    const result = observe(records, target.ids);
    historical.push({ file, label, player: header.player, ...result,
        wouldAlertIfAnyProfileWerePromoted: result.godbridge > 0 || result.telly > 0 });
}
const result = { generatedAt: new Date().toISOString(), noDetectorChanges: true, heldOutDataUsed: false, cohorts, historical,
    decision: 'Do not promote the shadow profiles. Dedicated known legitimate manual GodBridge/TellyBridge coverage is missing, and the production header documents overlapping legal pitches.',
    limitation: 'Counterfactual profile matches are not actual detector flags or held-out improvement scores. Historical labels are inherited, not independently reverified.' };
fs.writeFileSync(path.join(base, 'improvements/SCAFFOLD_SHADOW_POLICY_AUDIT.json'), JSON.stringify(result, null, 2) + '\n');
const table = ['# Scaffold shadow-profile promotion diagnostic', '',
    'No detector was changed. These are hypothetical profile-only alerts, not production detections or independent improvement results.', '',
    '| Cohort | Would alert on cheat trials | Would alert on legitimate controls |', '| --- | --- | --- |'];
for (const [name, cohort] of Object.entries(cohorts)) table.push(`| ${name} | ${stats.rateText(cohort.profileOnlyDetection)} | ${stats.rateText(cohort.profileOnlyFalseFlags)} |`);
table.push('', `Inherited historical legit-labelled targets with a profile match: ${historical.filter(r => r.wouldAlertIfAnyProfileWerePromoted).length}/${historical.length}. These labels were not independently reverified.`, '',
    '**Decision: keep the profiles report-only.** Flat unsneaked bridging at these pitches can also be legal. Dedicated, known legitimate human GodBridge/TellyBridge examples are needed before using a mode profile as alert evidence.', '',
    'No evaluation recordings were opened. No thresholds were tuned. Ground truth was used for scoring after observer-only detection.', '',
    '[Raw profile hits and targets](SCAFFOLD_SHADOW_POLICY_AUDIT.json).', '');
fs.writeFileSync(path.join(base, 'improvements/SCAFFOLD_SHADOW_POLICY_AUDIT.md'), table.join('\n'));
console.log(JSON.stringify({ cohorts: Object.fromEntries(Object.entries(cohorts).map(([name,c]) => [name,
    { detection: c.profileOnlyDetection, falseFlags: c.profileOnlyFalseFlags }])), historicalMatches: historical.filter(r => r.wouldAlertIfAnyProfileWerePromoted).length,
    historicalTargets: historical.length, noDetectorChanges: true }));
