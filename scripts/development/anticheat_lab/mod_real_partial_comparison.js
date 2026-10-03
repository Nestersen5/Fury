'use strict';
// Provisional read-only comparison at a user-requested pause. Never substitute
// this incomplete cohort for the frozen full-plan evaluation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real');
const evidenceFile = path.join(base, 'FULL_EVIDENCE.json');
const bytes = fs.readFileSync(evidenceFile);
const evidence = JSON.parse(bytes);
assert(evidence.part === 'autoblock' && !evidence.complete);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const pin = {
    'output/anticheat-lab/autoblock-v2/baseline-detectors/autoblockDetector.js': 'a7ce23bacdb1681c2f2d0711cab7c39f4c95385eae3d2f84c936e2facb5afc8e',
    'src/detect/autoblockDetector.js': 'eb13ff1a2303b1691033c7461a5a07fc89105086e4d92b2a3d8b411b011be6cf',
    'src/detect/detectorShared.js': '2113d07146dab75e9f77a48ebe17796087834fe3b663fd64c0478727b5efa986',
    'src/detect/scaffoldDetector.js': '4c4c7a6a2a7225b420bd5ddb38b9653f51a7337cf55ee90a976073e3a0212555'
};
for (const [file, expected] of Object.entries(pin))
    assert.strictEqual(sha(fs.readFileSync(path.join(root, file))), expected, file);
const dirs = {
    OLD: path.join(root, 'output/anticheat-lab/autoblock-v2/baseline-detectors'),
    NEW: path.join(root, 'src/detect')
};
function replay(trial, dir) {
    const recordingFile = path.join(trial.directory, trial.recorderFile);
    const recordingBytes = fs.readFileSync(recordingFile);
    assert.strictEqual(sha(recordingBytes), trial.recorderSha256, trial.id);
    const records = recordingBytes.toString().trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const flags = [];
    const factories = [
        ['Scaffold', 'createScaffoldDetector', { requireCleanPlayback: () => false }],
        ['Autoblock', 'createAutoblockDetector', {}],
        ['Stasis', 'createStasisDetector', {}]
    ];
    const detectors = factories.map(([family, factory, options]) => {
        const moduleName = family.toLowerCase() + 'Detector.js';
        return require(path.join(dir, moduleName))[factory]({ ...options,
            onFlag: flag => flags.push({ family, ...flag }) });
    });
    for (const record of records) for (const detector of detectors) detector.observeRecord(record);
    return flags.filter(flag => Number(flag.entityId) === Number(trial.actorId));
}
const rows = evidence.rows.map(trial => ({ id: trial.id, scenario: trial.scenario,
    effectExpected: trial.effectExpected, startedAt: trial.startedAt,
    OLD: replay(trial, dirs.OLD), NEW: replay(trial, dirs.NEW) }));
const median = values => {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a-b), m = Math.floor(s.length/2);
    return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
};
function summarize(name, subset) {
    const cheat = subset.filter(row => row.effectExpected), legit = subset.filter(row => !row.effectExpected);
    const target = row => row[name].filter(flag => flag.family === 'Autoblock' &&
        (!row.effectExpected || flag.at >= row.startedAt));
    const hits = cheat.filter(row => target(row).length);
    const confirmed = cheat.filter(row => target(row).some(flag => flag.tier === 'confirmed'));
    const falseAny = legit.filter(row => row[name].length);
    const falseTarget = legit.filter(row => target(row).length);
    const times = hits.map(row => (Math.min(...target(row).map(flag => flag.at)) - row.startedAt)/1000);
    return { cheat: cheat.length, hitAnyTier: hits.length, hitConfirmed: confirmed.length,
        legit: legit.length, falseAnyDetector: falseAny.length, falseAutoblock: falseTarget.length,
        medianTimeToFlagSeconds: median(times), detectedTimeN: times.length };
}
const scenarios = [...new Set(rows.map(row => row.scenario))].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
const result = { schema: 1, provisional: true, generatedAt: new Date().toISOString(),
    evidenceSha256: sha(bytes), validatedTrialIds: rows.length,
    caution: 'Incomplete, nonrandom interim subset. L3, food L5 and C6 correction trials are absent. These rates are not final estimates.',
    overall: { OLD: summarize('OLD', rows), NEW: summarize('NEW', rows) }, scenarios: {}, discordant: [] };
for (const scenario of scenarios) result.scenarios[scenario] = {
    OLD: summarize('OLD', rows.filter(row => row.scenario === scenario)),
    NEW: summarize('NEW', rows.filter(row => row.scenario === scenario))
};
for (const row of rows) {
    const flagged = name => row[name].some(flag => flag.family === 'Autoblock' &&
        (!row.effectExpected || flag.at >= row.startedAt));
    if (flagged('OLD') !== flagged('NEW')) result.discordant.push({ id: row.id,
        scenario: row.scenario, old: flagged('OLD'), now: flagged('NEW') });
}
fs.writeFileSync(path.join(base, 'PARTIAL_AUTOBLOCK_COMPARISON.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ trials: rows.length, overall: result.overall,
    discordant: result.discordant, scenarios: result.scenarios }));
