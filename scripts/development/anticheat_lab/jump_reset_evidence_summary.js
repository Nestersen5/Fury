'use strict';
// Explain measured misses and alert exposure without changing the candidate.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { stats } = require('./overnight_analysis_modules');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/jump-reset');
const read = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const result = read(path.join(base, 'FULL_RESULTS_EVALUATION.json'));
assert.strictEqual(result.split, 'evaluation');
const evidence = read(path.join(base, 'FULL_EVIDENCE.json'));
const cfg = result.frozen.thresholds;
const rows = result.variants.CALIBRATED.trials.map(detail => {
    const trial = evidence.rows.find(r => r.id === detail.id && r.split === 'evaluation'); assert(trial);
    const first = detail.jumpFlags.filter(f => f.at >= trial.startedAt).sort((a,b) => a.at-b.at)[0];
    const packets = lines(path.join(trial.directory, trial.observerPacketFile));
    const hurts = packets.filter(p => p.name === 'entity_status' && Number(p.data.entityId) === Number(trial.actorId) &&
        p.data.entityStatus === 2 && p.t >= trial.startedAt && p.t <= trial.activeEndAt);
    const usable = detail.opportunities.filter(o => o.reason === 'landed' && o.damaged && o.samples >= cfg.minSamples &&
        o.maxStep <= cfg.maxStep && Math.abs(o.landingHeightChange) <= cfg.maxLandingChange);
    const matching = usable.filter(o => o.observedRise >= cfg.minRise && o.observedRise <= cfg.maxRise);
    const diagnostic = first ? 'flagged' : !usable.length ? 'no usable landed damage trajectory'
        : !matching.length ? 'no usable trajectory in the jump-like height band'
        : 'some matching motion; combined clock/window/count/fraction/span criteria did not produce a flag';
    return { id: trial.id, scenario: trial.scenario, effectExpected: trial.effectExpected, firstFlag: first || null,
        observedHurts: hurts.length, completedTrajectories: detail.opportunities.length, usableTrajectories: usable.length,
        matchingTrajectories: matching.length, usableReasons: Object.fromEntries([...new Set(detail.opportunities.map(o => o.reason))]
            .map(reason => [reason, detail.opportunities.filter(o => o.reason === reason).length])),
        hurtsBeforeFlag: first ? hurts.filter(p => p.t <= first.at).length : null, diagnostic };
});
const scenarios = Object.fromEntries([...new Set(rows.map(r => r.scenario))].map(id => {
    const group = rows.filter(r => r.scenario === id), detected = group.filter(r => r.firstFlag && r.effectExpected);
    return [id, { n: group.length, hurts: stats.distribution(group.map(r => r.observedHurts)),
        usableTrajectories: stats.distribution(group.map(r => r.usableTrajectories)),
        matchingTrajectories: stats.distribution(group.map(r => r.matchingTrajectories)),
        hurtsBeforeFlag: stats.distribution(detected.map(r => r.hurtsBeforeFlag)),
        diagnostics: Object.fromEntries([...new Set(group.map(r => r.diagnostic))].map(d => [d, group.filter(r => r.diagnostic === d).length])) }];
}));
const output = { generatedAt: new Date().toISOString(), split: 'evaluation', rows, scenarios,
    hurtsBeforeFlag: stats.distribution(rows.filter(r => r.effectExpected && r.firstFlag).map(r => r.hurtsBeforeFlag)),
    limitation: 'Usable trajectory counts are geometric diagnostics, not all clock-certified opportunities or proof of automation. Last-window detector thresholds are unchanged.' };
fs.writeFileSync(path.join(base, 'EVIDENCE_SUMMARY_EVALUATION.json'), JSON.stringify(output, null, 2) + '\n');
const text = ['# Jump Reset observer evidence and misses', '',
    'Fresh evaluation only. Module-on trials with no visible assistance remain misses. Damage and trajectories come from observer recordings; labels and activation times are used afterwards for scoring.', '',
    '| Scenario | n | Median observed damage events | Median usable trajectories | Median matching trajectories | Median damage events before flag (detected cheats only) |',
    '| --- | ---: | ---: | ---: | ---: | --- |'];
for (const [id, s] of Object.entries(scenarios)) text.push(`| ${id} | ${s.n} | ${s.hurts.median} | ${s.usableTrajectories.median} | ${s.matchingTrajectories.median} | ${s.hurtsBeforeFlag.n ? `${s.hurtsBeforeFlag.median} (n=${s.hurtsBeforeFlag.n})` : 'n/a'} |`);
text.push('', 'The usable-trajectory column applies landing, sample, movement-step and height-return gates. Clock freshness and the combined rolling-window decision are separate. Matching motion can be legal.', '',
    '[Per-trial diagnostics and exposure distributions](EVIDENCE_SUMMARY_EVALUATION.json).', '');
fs.writeFileSync(path.join(base, 'EVIDENCE_SUMMARY_EVALUATION.md'), text.join('\n'));
console.log(JSON.stringify({ trials: rows.length, hurtsBeforeFlag: output.hurtsBeforeFlag, scenarios: Object.keys(scenarios) }));
