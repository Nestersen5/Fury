'use strict';
// A promotion decision after untouched evaluation. No threshold search here.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real');
const read = file => JSON.parse(fs.readFileSync(file));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const frozenFile = path.join(base, 'improvements/fresh/FROZEN_DECISION.json'), frozen = read(frozenFile);
const files = {
    autoblock: path.join(base, 'improvements/fresh/EVALUATION_RESULTS.json'),
    scaffold: path.join(base, 'improvements/fresh/scaffold/EVALUATION_RESULTS.json'),
    stress: path.join(base, 'improvements/movement-stress/EVALUATION_RESULTS.json'),
    jump: path.join(base, 'jump-reset/FULL_RESULTS_EVALUATION.json'),
    safety: path.join(base, 'jump-reset/FROZEN_SAFETY_CHECK.json')
};
const results = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)]));
for (const [key, count] of [['autoblock', 24], ['scaffold', 20], ['stress', 20]]) {
    const result = results[key];
    assert.strictEqual(result.split, 'evaluation'); assert.strictEqual(result.trials.length, count);
    assert(result.trials.every(t => t.split === 'evaluation'));
    assert.strictEqual(path.resolve(result.candidateDirectory), path.resolve(frozen.candidateDirectory));
    for (const [name, expected] of Object.entries(frozen.sourceHashes)) assert.strictEqual(result.candidateHashes[name], expected);
}
function comparison(result, family) {
    const regressions = [], newFalseFlags = [];
    for (const trial of result.trials) {
        const before = result.details.BASELINE.find(r => r.id === trial.id);
        const after = result.details.CANDIDATE.find(r => r.id === trial.id);
        assert(before && after);
        const flags = row => row.flags.filter(f => !trial.effectExpected || f.at >= trial.startedAt);
        if (trial.effectExpected && flags(before).some(f => f.family === family) && !flags(after).some(f => f.family === family)) regressions.push(trial.id);
        if (!trial.effectExpected && !flags(before).length && flags(after).length) newFalseFlags.push(trial.id);
    }
    return { lostCheatDetections: regressions, additionalLegitFalseFlags: newFalseFlags,
        baseline: result.summaries.BASELINE.overall, candidate: result.summaries.CANDIDATE.overall };
}
const a = comparison(results.autoblock, 'Autoblock'), b = comparison(results.scaffold, 'Scaffold');
const stress = comparison(results.stress, 'Autoblock');
const crosscheckFile = process.argv.find(a => a.startsWith('--crosscheck='))?.slice(13);
assert(crosscheckFile, 'Pass the frozen 320-recording cross-family audit');
const crosscheck = read(crosscheckFile);
assert(crosscheck.frozen && crosscheck.trials === 320, 'Original 192 + fresh 88 + movement stress 40 required');
assert(results.safety.passed && results.safety.frozenThresholds);
const jump = results.jump.variants.CALIBRATED.overall;
assert(results.jump.split === 'evaluation' && jump.n === 160 && jump.cheatN === 80 && jump.legitN === 80);
const frozenJumpFile = path.join(base, 'jump-reset/FROZEN_CANDIDATE.json'), frozenJump = read(frozenJumpFile);
assert.deepStrictEqual(results.jump.frozen.thresholds, frozenJump.thresholds);
assert.deepStrictEqual(crosscheck.thresholds, frozenJump.thresholds);
const accepted = {
    movementClock: frozen.accepted.movementClock && !a.lostCheatDetections.length && !a.additionalLegitFalseFlags.length &&
        !stress.additionalLegitFalseFlags.length && stress.candidate.falseAnyDetector.k === 0,
    scaffoldCorroboration: frozen.accepted.scaffoldCorroboration && !b.lostCheatDetections.length && !b.additionalLegitFalseFlags.length,
    jumpResetExperimental: jump.targetAny.k > 0 && jump.falseTarget.k === 0 && crosscheck.unintendedActorFlags.length === 0
};
const decision = { decidedAt: new Date().toISOString(), heldOutEvaluationComplete: true,
    reviewed: false, noHeldOutRetuning: true, accepted, autoblock: a, scaffold: b, stress,
    jump: { heldOut: jump, crossFamilyFlags: crosscheck.unintendedActorFlags,
        policy: 'An opt-in Possible pattern only, default OFF; require held-out sensitivity >0, zero Jump Reset control flags and zero additional cross-family alerts.' },
    frozenDecisionSha256: hash(frozenFile), frozenJumpSha256: hash(frozenJumpFile),
    artifacts: Object.fromEntries([...Object.entries(files), ['crosscheck', path.resolve(crosscheckFile)]].map(([key, file]) =>
        [key, { file, sha256: hash(file) }])),
    limitation: 'Finite scripted data cannot prove a zero human false-positive rate or support confirmed Jump Reset verdicts.' };
const destination = path.join(base, 'improvements/PRODUCTION_GATE.json');
assert(!fs.existsSync(destination), 'Review the existing promotion decision; do not silently replace it');
fs.writeFileSync(destination, JSON.stringify(decision, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ destination, accepted, reviewRequired: 'Root code/evidence review before applying, no user approval needed.' }));
