'use strict';
// Exploratory replays of already measured data. Not independent evaluation and
// never a selection input to freeze_followup_decision.js.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { stats, analysis } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'output/anticheat-lab/mod-real');
const baseline = path.join(output, 'overnight/baseline-source/src/detect');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result = { generatedAt: new Date().toISOString(), purpose: 'Exploratory original-recording diagnostics, not independent evaluation or calibration selection', parts: {} };
for (const [part, candidateName] of [['autoblock','movement-clock-candidate'],['scaffold','scaffold-corroboration-candidate']]) {
    const directory = path.join(output, 'overnight', `measurement-${part}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
    const file = path.join(directory, 'FULL_EVIDENCE.json');
    assert.strictEqual(hash(file), manifest.files['FULL_EVIDENCE.json']);
    const evidence = JSON.parse(fs.readFileSync(file)); assert(evidence.complete);
    const candidate = path.join(output, 'improvements', candidateName), target = part === 'scaffold' ? 'Scaffold' : 'Autoblock';
    const summaries = {}, details = {};
    for (const [variant, source] of Object.entries({ BASELINE: baseline, CANDIDATE: candidate })) {
        details[variant] = evidence.rows.map(row => ({ id: row.id, scenario: row.scenario, effectExpected: row.effectExpected,
            ...analysis.replayTrial(row, source) }));
        summaries[variant] = stats.variantStats(evidence.rows, details[variant], target);
    }
    result.parts[part] = { evidenceSha256: hash(file), candidate,
        candidateSourceHashes: Object.fromEntries(['autoblockDetector.js','scaffoldDetector.js','detectorShared.js','stasisDetector.js'].map(name => [name, hash(path.join(candidate, name))])),
        summaries, details };
}
fs.writeFileSync(path.join(output, 'improvements/ORIGINAL_DIAGNOSTICS.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.parts).map(([part, data]) => [part,
    Object.fromEntries(Object.entries(data.summaries).map(([variant, s]) => [variant, { detection: s.targetAny, falseFlags: s.falseAnyDetector }]))]))));
