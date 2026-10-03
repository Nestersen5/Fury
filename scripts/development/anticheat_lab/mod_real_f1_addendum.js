'use strict';
const fs = require('fs'), path = require('path');
const { stats } = require('./overnight_analysis_modules');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real');
const result = JSON.parse(fs.readFileSync(path.join(base, 'FULL_RESULTS.json')));
const detail = JSON.parse(fs.readFileSync(path.join(base, 'FULL_REPLAY_DETAILS.json')));
const rows = [];
for (const id of ['C1','C2','C3','C4','C5','C6']) {
    const trials = result.trials.filter(r => r.scenario === id || !r.effectExpected);
    const variants = {};
    for (const variant of ['OLD','NEW']) {
        const s = stats.variantStats(trials, detail.variants[variant], 'Autoblock');
        variants[variant] = { f1: s.f1, precision: s.precision, recall: s.recall };
    }
    rows.push({ scenario: id, ...variants });
}
const output = { generatedAt: new Date().toISOString(), detectorResultsUnchanged: true,
    explanation: 'Zero predictions leave precision unidentified. F1 point score is still zero when all positives are missed; the upper descriptive envelope uses precision <=1 instead of treating undefined precision as certainly zero. F1 has no Wilson binomial interval.', rows };
fs.writeFileSync(path.join(base, 'F1_METRIC_ADDENDUM.json'), JSON.stringify(output, null, 2) + '\n');
const section = ['','## F1 uncertainty detail','', output.explanation, '',
    '| Scenario | OLD F1 and revised bound envelope | NEW F1 and revised bound envelope |', '| --- | --- | --- |',
    ...rows.map(r => `| ${r.scenario} | ${r.OLD.f1.value.toFixed(3)} [${r.OLD.f1.low.toFixed(3)}, ${r.OLD.f1.high.toFixed(3)}] | ${r.NEW.f1.value.toFixed(3)} [${r.NEW.f1.low.toFixed(3)}, ${r.NEW.f1.high.toFixed(3)}] |`), '',
    'This corrects the descriptive envelopes for scenarios with no predictions in the earlier table. It changes no trial verdict, threshold, detection rate, time, or aggregate F1. The original frozen measurement snapshot remains untouched. Raw revised metrics: [F1_METRIC_ADDENDUM.json](F1_METRIC_ADDENDUM.json).',''].join('\n');
const file = path.join(base, 'REPORT.md');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n## F1 uncertainty detail')[0] + section);
console.log(JSON.stringify(rows.map(r => ({ id: r.scenario, old: r.OLD.f1, new: r.NEW.f1 }))));
