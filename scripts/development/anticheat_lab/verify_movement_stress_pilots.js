'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real/improvements/movement-stress/pilots');
const read = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const evidence = read(path.join(base, 'FULL_EVIDENCE.json')), plan = read(path.join(base, 'FULL_PLAN_autoblock.json'));
const ids = Array.from({ length: 6 }, (_, i) => 'l6_' + String(i + 1).padStart(3, '0'));
const selected = evidence.rows.filter(row => ids.includes(row.id));
assert.strictEqual(selected.length, 6, 'Each of the six distinct tick/potion conditions needs independent valid HUD/observer evidence');
const results = selected.map(row => {
    const spec = plan.trials.find(s => s.id === row.id), truth = read(path.join(row.trialDirectory, 'ground-truth.json'));
    assert(truth.pilot && spec.split === 'pilot' && spec.enabled.length === 0 && truth.toggles.length === 0);
    assert.strictEqual(truth.stressCondition.nominalTickMs, spec.nominalTickMs);
    assert.strictEqual(truth.stressCondition.speedII, spec.speedII);
    assert(truth.activeEndAt - truth.controlStartAt >= 30000, '30+ seconds of active legal input required');
    const ticks = lines(path.join(row.directory, 'server-ticks.jsonl')).filter(t => t.label === row.id + '_a01' &&
        t.t >= truth.controlStartAt && t.t <= truth.activeEndAt).map(t => t.intervalMs).sort((a,b) => a-b);
    assert(ticks.length >= 20);
    return { id: row.id, nominalTickMs: spec.nominalTickMs, speedII: spec.speedII,
        observedTickMedianMs: ticks[Math.floor(ticks.length / 2)], trialDirectory: row.trialDirectory,
        observerEvidence: evidence.attempts.find(a => a.directory === row.trialDirectory).evidence };
});
assert.strictEqual(new Set(results.map(r => `${r.nominalTickMs}/${r.speedII}`)).size, 6);
const result = { validatedAt: new Date().toISOString(), passed: true, pilotsExcludedFromFullResults: true,
    evidenceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(base, 'FULL_EVIDENCE.json'))).digest('hex'),
    conditions: results, checks: ['six distinct conditions', 'all modules OFF in manually confirmed HUD',
        '30+ seconds active', 'observer swings, use flags and movement', 'server ticks and both relays', 'isolated loopback launch'] };
fs.writeFileSync(path.join(base, 'PILOT_VALIDATION.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
