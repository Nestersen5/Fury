'use strict';
// Select only from completed calibration cohorts. Held-out files are never read.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'output/anticheat-lab/mod-real');
const fresh = path.join(output, 'improvements/fresh');
const destination = path.join(output, 'improvements/selected-candidate');
const decisionFile = path.join(fresh, 'FROZEN_DECISION.json');
assert(!fs.existsSync(decisionFile) && !fs.existsSync(destination), 'Decision already frozen');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = {
    autoblock: path.join(fresh, 'CALIBRATION_RESULTS.json'),
    scaffold: path.join(fresh, 'scaffold/CORROBORATION_CALIBRATION_RESULTS.json'),
    stress: path.join(output, 'improvements/movement-stress/CALIBRATION_RESULTS.json')
};
const results = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, JSON.parse(fs.readFileSync(file))]));
for (const [key, result] of Object.entries(results)) {
    assert.strictEqual(result.split, 'calibration');
    assert.strictEqual(result.trials.length, key === 'autoblock' ? 24 : 20);
    assert(result.trials.every(trial => trial.split === 'calibration'));
}
const a = results.autoblock.summaries, b = results.scaffold.summaries, stress = results.stress.summaries;
const acceptsMovement = a.CANDIDATE.overall.targetAny.k > a.BASELINE.overall.targetAny.k &&
    a.CANDIDATE.overall.falseAnyDetector.k <= a.BASELINE.overall.falseAnyDetector.k &&
    stress.CANDIDATE.overall.falseAnyDetector.k === 0;
const acceptsScaffold = b.CANDIDATE.overall.targetAny.k >= b.BASELINE.overall.targetAny.k &&
    b.CANDIDATE.overall.falseAnyDetector.k < b.BASELINE.overall.falseAnyDetector.k;
const baseline = path.join(output, 'overnight/baseline-source/src/detect');
const movement = path.join(output, 'improvements/movement-clock-candidate');
const scaffold = path.join(output, 'improvements/scaffold-corroboration-candidate');
assert.strictEqual(path.resolve(results.autoblock.candidateDirectory), movement);
assert.strictEqual(path.resolve(results.stress.candidateDirectory), movement);
assert.strictEqual(path.resolve(results.scaffold.candidateDirectory), scaffold);
fs.mkdirSync(destination, { recursive: true });
const sourceHashes = {};
for (const name of ['autoblockDetector.js','scaffoldDetector.js','detectorShared.js','stasisDetector.js']) {
    const source = name === 'autoblockDetector.js' && acceptsMovement ? movement :
        name === 'scaffoldDetector.js' && acceptsScaffold ? scaffold : baseline;
    fs.copyFileSync(path.join(source, name), path.join(destination, name), fs.constants.COPYFILE_EXCL);
    sourceHashes[name] = hash(path.join(destination, name));
}
const decision = {
    frozenAt: new Date().toISOString(), candidateDirectory: destination, sourceHashes,
    selectionUsesOnly: '24 fresh Autoblock calibration trials, 20 fresh Scaffold calibration trials, 20 all-off movement stress calibration trials',
    heldOutDataRead: false,
    rules: {
        movement: 'Additional cheat detections, no extra legitimate false flags, and zero stress false flags.',
        scaffold: 'Fewer legitimate false flags without losing cheat detections.'
    },
    accepted: { movementClock: acceptsMovement, scaffoldCorroboration: acceptsScaffold },
    calibration: {
        autoblock: { baseline: a.BASELINE.overall, candidate: a.CANDIDATE.overall },
        scaffold: { baseline: b.BASELINE.overall, candidate: b.CANDIDATE.overall },
        stress: { baseline: stress.BASELINE.overall, candidate: stress.CANDIDATE.overall }
    },
    artifactHashes: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { file, sha256: hash(file) }])),
    productionGate: 'No threshold retuning from held-out data. Reject promotion if fresh or stress evaluation adds false flags or loses cheat detections; report the failed candidate.'
};
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(decision, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(decisionFile, JSON.stringify(decision, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ frozen: decisionFile, accepted: decision.accepted, sourceHashes }));
