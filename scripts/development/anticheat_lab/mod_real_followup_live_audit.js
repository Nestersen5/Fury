'use strict';
// Independently compare the pinned live baseline callbacks with its compact
// observer replay on accepted follow-up/stress clips. Candidates remain offline.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { analysis } = require('./overnight_analysis_modules');
const args = process.argv.slice(2), root = path.resolve(__dirname, '../../..');
const baseline = path.join(root, 'output/anticheat-lab/mod-real/overnight/baseline-source/src/detect');
const read = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const normalize = flags => flags.map(flag => JSON.stringify({ family: flag.family, tier: flag.tier,
    at: flag.at, evidence: flag.evidence, weight: flag.weight, strikes: flag.strikes })).sort();
function withoutTiming(value) {
    if (Array.isArray(value)) return value.map(withoutTiming);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['at','t','span','spanMs'].includes(key))
        .map(([key, data]) => [key, withoutTiming(data)]));
}
for (const input of args) {
    const evidence = read(input), traces = new Map(), rows = [];
    for (const trial of evidence.rows) {
        const offline = analysis.replayTrial(trial, baseline);
        if (!traces.has(trial.directory)) traces.set(trial.directory, lines(path.join(trial.directory, 'fury-profile/lab-detector-trace.jsonl')));
        const live = traces.get(trial.directory).filter(row => row.kind === 'flag' &&
            Number(row.flag?.entityId) === Number(trial.actorId) && row.observedAt >= offline.recordingStartAt &&
            row.observedAt <= offline.recordingEndAt).map(row => ({ family: row.family, ...row.flag }));
        const exact = JSON.stringify(normalize(live)) === JSON.stringify(normalize(offline.flags));
        const decisionAndEvidence = JSON.stringify(normalize(live).map(JSON.parse).map(withoutTiming)) ===
            JSON.stringify(normalize(offline.flags).map(JSON.parse).map(withoutTiming));
        rows.push({ id: trial.id, split: trial.split, exact, decisionAndEvidence, live, offline: offline.flags });
    }
    const result = { generatedAt: new Date().toISOString(), evidence: path.resolve(input),
        checked: rows.length, exact: rows.filter(r => r.exact).length,
        decisionsAndEvidence: rows.filter(r => r.decisionAndEvidence).length,
        divergences: rows.filter(r => !r.exact), rows,
        limitation: 'Timing fields are preserved. The second count is an explicit diagnostic, not exact replay or timestamp repair.' };
    const output = path.join(path.dirname(input), 'BASELINE_LIVE_REPLAY_AUDIT.json');
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ output, checked: result.checked, exact: result.exact, decisionsAndEvidence: result.decisionsAndEvidence }));
    assert.strictEqual(result.decisionsAndEvidence, rows.length, 'Investigate differing decisions/evidence before reporting the cohort');
}
