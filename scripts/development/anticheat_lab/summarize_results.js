'use strict';
// Summarize previously scored, immutable observer evidence; never tunes detectors.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [rootArg, outputArg] = process.argv.slice(2);
const root = path.resolve(rootArg), output = path.resolve(outputArg);
const campaigns = ['timer', 'clicker', 'blockhit', 'fastplace', 'blink', 'scaffold', 'ladder', 'blink-sneak', 'defensive-blockhit'];
const median = values => values.length ? values.slice().sort((a,b) => a-b)[Math.floor(values.length/2)] : null;
function stats(rows) {
    const flagged = rows.filter(r => r.targetFlags.length);
    return { trials: rows.length, flagged: flagged.length, rate: rows.length ? flagged.length/rows.length : null,
        possible: rows.filter(r => r.targetFlags.some(f => f.tier === 'possible')).length,
        confirmed: rows.filter(r => r.targetFlags.some(f => f.tier === 'confirmed')).length,
        medianFirstFlagMs: median(flagged.map(r => Math.min(...r.targetFlags.map(f => f.timeToFlagMs)))),
        byFamily: Object.fromEntries(['Scaffold', 'Autoblock', 'Stasis'].map(family => [family, rows.filter(r => r.targetFlags.some(f => f.cheat === family)).length])) };
}
const inputs = [], scenarios = [], all = { calibration: { baseline: [], candidate: [] }, evaluation: { baseline: [], candidate: [] } };
function read(file) { const bytes = fs.readFileSync(file); inputs.push({ file: path.resolve(file), sha256: sha(bytes) }); return JSON.parse(bytes); }
let trials = 0, rawPackets = 0, records = 0;
for (const campaign of campaigns) {
    const evidence = read(path.join(root, `${campaign}-v1-evidence.json`)); assert(evidence.complete);
    trials += evidence.rows.length;
    rawPackets += evidence.rows.reduce((n,r) => n+r.observerPackets, 0);
    const scores = {};
    for (const split of ['calibration', 'evaluation']) for (const variant of ['baseline', 'candidate']) {
        const suffix = variant === 'candidate' && split === 'calibration' ? 'current' : variant;
        const score = read(path.join(root, `${campaign}-v1-${suffix}-${split}.json`));
        assert.strictEqual(score.evidenceSha256, inputs.find(i => i.file === path.resolve(root, `${campaign}-v1-evidence.json`)).sha256);
        assert.strictEqual(score.split, split); scores[`${split}.${variant}`] = score;
        all[split][variant].push(...score.rows);
        if (variant === 'candidate') records += score.rows.reduce((n,r) => n+r.records, 0);
    }
    for (const scenario of Object.keys(evidence.counts).sort()) {
        const row = { campaign, scenario, performed: evidence.counts[scenario], splits: {} };
        for (const split of ['calibration', 'evaluation']) {
            row.splits[split] = {};
            for (const variant of ['baseline', 'candidate']) {
                const rows = scores[`${split}.${variant}`].rows.filter(r => r.scenario === scenario);
                row.splits[split][variant] = { all: stats(rows), effect: stats(rows.filter(r => r.effectExpected === true)),
                    noEffect: stats(rows.filter(r => r.effectExpected === false)) };
            }
        }
        scenarios.push(row);
    }
}
const totals = {};
for (const split of ['calibration', 'evaluation']) {
    totals[split] = {};
    for (const variant of ['baseline', 'candidate']) {
        const rows = all[split][variant]; assert.strictEqual(new Set(rows.map(r=>r.id)).size, rows.length);
        totals[split][variant] = { all: stats(rows), legitimate: stats(rows.filter(r=>r.legitimate)),
            effect: stats(rows.filter(r=>!r.legitimate && r.effectExpected === true)),
            enabledNoEffect: stats(rows.filter(r=>!r.legitimate && r.effectExpected === false)) };
    }
}
const report = { createdAt: new Date().toISOString(), trials, scenarios: scenarios.length, rawObserverPackets: rawPackets,
    furyRecords: records, inputs, totals, perScenario: scenarios,
    limits: ['Rates are scripted per-trial rates, not human-population estimates.',
        'Any-family detections are explicit; family-specific counts are retained.',
        'Time to flag is cold-start observer-record replay, conditional on detected trials.',
        '100 varied trials per scenario means 50 calibration plus 50 evaluation, not 100 per parameter combination.',
        'Effect expected denotes the planned enabled behavior, not proof that every setting is distinguishable at the observer.'] };
fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n', {flag:'wx'});
console.log(JSON.stringify({output,trials,scenarios:scenarios.length,totals},null,2));
