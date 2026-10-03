'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { campaignStatus } = require('./campaign_status');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [planFile, output, mode, workerText, workersText, ...directories] = process.argv.slice(2);
assert(['remaining', 'replace-jitter'].includes(mode), 'Usage: select_campaign.js plan output remaining|replace-jitter worker workers completedRun...');
const bytes = fs.readFileSync(planFile), plan = JSON.parse(bytes), worker = Number(workerText), workers = Number(workersText);
const assigned = plan.trials.filter((_, i) => i % workers === worker), byId = new Map(assigned.map(spec => [spec.id, spec]));
const performed = new Set(), excluded = [], sourceRuns = [];
for (const directory of directories) {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'campaign.json')));
    assert.strictEqual(manifest.planSha256, sha(bytes));
    const result = campaignStatus(directory);
    assert(result.errors.length === 0, 'Diagnose errors before selecting a retry');
    const rows = fs.readFileSync(path.join(directory, 'outcomes.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    sourceRuns.push({ directory: path.resolve(directory), result });
    for (const row of rows) {
        if (!byId.has(row.id)) continue;
        assert(row.valid, 'Invalid trials need a specific diagnosed exclusion');
        performed.add(row.id);
        if (mode === 'replace-jitter' && byId.get(row.id).jitter) {
            excluded.push({ directory: path.resolve(directory), id: row.id, groundTruthSha256: row.groundTruthSha256,
                reason: 'Original worker used an unnecessary float rounding in ClickJitter step-count calculation; rerun with promoted double sum.' });
        }
    }
}
const includeIds = assigned.filter(spec => mode === 'remaining' ? !performed.has(spec.id) : excluded.some(row => row.id === spec.id)).map(spec => spec.id);
const selection = { schema: 1, createdAt: new Date().toISOString(), mode, planSha256: sha(bytes), worker, workers, sourceRuns,
    reason: mode === 'remaining' ? 'Resume frozen schedule after a recorded checkpoint or diagnosed interruption, without repeating completed valid trials.'
        : 'Correct a diagnosed behavior fidelity bug; selection is independent of detector verdicts.', includeIds, excluded };
fs.writeFileSync(output, JSON.stringify(selection, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, selected: includeIds.length, excluded: excluded.length }));
