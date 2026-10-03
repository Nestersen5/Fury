'use strict';
// Descriptive breakdown of the frozen original measurement. Settings and
// labels select report rows only; they never enter a detector.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { stats } = require('./overnight_analysis_modules');
const output = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real');
const result = JSON.parse(fs.readFileSync(path.join(output, 'overnight/measurement-autoblock/FULL_RESULTS.json')));
const truths = new Map(result.trials.map(trial => {
    const bytes = fs.readFileSync(path.join(trial.trialDirectory, 'ground-truth.json'));
    assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), trial.groundTruthSha256);
    return [trial.id, JSON.parse(bytes)];
}));
const groups = {};
function add(label, predicate) {
    const trials = result.trials.filter(trial => predicate(trial, truths.get(trial.id)));
    assert(trials.length);
    groups[label] = { ids: trials.map(trial => trial.id), ...Object.fromEntries(['OLD','NEW'].map(variant =>
        [variant, stats.variantStats(trials, trials.map(trial => trial[variant.toLowerCase()]), 'Autoblock')])) };
}
for (const on of [true,false]) add(`C2: Sprint ${on ? 'on' : 'off'}`, (trial, truth) =>
    trial.scenario === 'C2' && truth.requestedEnabled.includes('Sprint') === on);
for (let ticks = 1; ticks <= 5; ticks++) add(`C4: ${ticks} block ticks`, (trial, truth) =>
    trial.scenario === 'C4' && truth.fullModuleSettings.AutoBlock.settings['Block ticks'] === ticks);
for (const slow of [false,true]) for (const cheat of [true,false]) add(`${cheat ? 'Cheats' : 'Legit'}: ${slow ? 'slow' : 'normal'} ticks`,
    (trial, truth) => trial.effectExpected === cheat && (truth.scenario.transport.server.minimumMs > 0) === slow);
const audit = { generatedAt: new Date().toISOString(), purpose: 'Descriptive original-cohort subgroups, not fresh evaluation or causal attribution', groups };
fs.writeFileSync(path.join(output, 'SUBGROUP_RESULTS.json'), JSON.stringify(audit, null, 2) + '\n');
const text = ['', '## Original setting and tick subgroups', '',
    '| Subgroup | n | OLD detection / false flags | NEW detection / false flags |', '| --- | ---: | --- | --- |'];
for (const [label, group] of Object.entries(groups)) {
    const legit = label.startsWith('Legit');
    text.push(`| ${label} | ${group.OLD.n} | ${stats.rateText(legit ? group.OLD.falseAnyDetector : group.OLD.targetAny)} | ${stats.rateText(legit ? group.NEW.falseAnyDetector : group.NEW.targetAny)} |`);
}
text.push('', 'These are descriptive partitions of the same original trials. Small subgroups have wide Wilson intervals; tick groups also mix scenarios and settings, so this is not an isolated causal latency experiment. Slow means the frozen server tick-agent minimum was above zero. Trials and raw subgroups: [SUBGROUP_RESULTS.json](SUBGROUP_RESULTS.json).', '');
text.push('Both five-block-tick C4 trials also used slow ticks. Their misses cannot establish that five-block-tick AutoBlock itself is undetectable; the settings and tick condition are confounded in this subgroup.', '');
const report = path.join(output, 'REPORT.md');
fs.writeFileSync(report, fs.readFileSync(report, 'utf8').split('\n## Original setting and tick subgroups')[0] + text.join('\n'));
console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([label, group]) => [label,
    { n: group.NEW.n, OLD: group.OLD.targetAny.k, NEW: group.NEW.targetAny.k }]))));
