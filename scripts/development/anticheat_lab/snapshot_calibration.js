'use strict';
// Read only completed calibration trials while other frozen-plan trials run.
// Never opens evaluation recordings or detector verdicts. Final campaign
// validation still requires every planned ID and realized-condition checks.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [planFile, output, ...directories] = process.argv.slice(2);
const planBytes = fs.readFileSync(planFile), plan = JSON.parse(planBytes), expected = new Map(plan.trials.map(spec => [spec.id, spec]));
const rows = [], seen = new Set();
for (const directory of directories) {
    const campaign = JSON.parse(fs.readFileSync(path.join(directory, 'campaign.json')));
    assert.strictEqual(campaign.planSha256, sha(planBytes));
    const completeLines = fs.readFileSync(path.join(directory, 'outcomes.jsonl'), 'utf8').split('\n'); completeLines.pop();
    for (const line of completeLines) {
        const outcome = JSON.parse(line); if (outcome.split !== 'calibration' || !outcome.valid) continue;
        assert(!seen.has(outcome.id)); seen.add(outcome.id);
        const truthBytes = fs.readFileSync(path.join(directory, outcome.truthFile)); assert.strictEqual(sha(truthBytes), outcome.groundTruthSha256);
        const truth = JSON.parse(truthBytes); assert.deepStrictEqual(truth.spec, expected.get(outcome.id));
        assert.strictEqual(sha(fs.readFileSync(path.join(directory, truth.recorderFile))), truth.recorderSha256);
        assert.strictEqual(sha(fs.readFileSync(path.join(directory, `${outcome.id}.observer-packets.jsonl`))), truth.observerSha256);
        rows.push({ id: outcome.id, scenario: outcome.scenario, split: 'calibration', directory: path.resolve(directory),
            recorderFile: truth.recorderFile, recorderSha256: truth.recorderSha256, groundTruthSha256: outcome.groundTruthSha256,
            startedAt: truth.groundTruth.startedAt, effectExpected: truth.groundTruth.effectExpected });
    }
}
const report = { schema: 1, complete: false, scope: 'partial-calibration', planSha256: sha(planBytes), createdAt: new Date().toISOString(),
    limitation: 'Provisional completed calibration subset only; not final rates or full campaign/condition validation.', rows };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, calibrationTrials: rows.length }));
