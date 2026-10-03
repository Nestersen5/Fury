'use strict';
// Correct derived presentation/metric fields only. Keep the original frozen
// measurement, raw recordings, timestamps and every verdict unchanged.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real');
const correction = JSON.parse(fs.readFileSync(path.join(base, 'F1_METRIC_ADDENDUM.json')));
const file = path.join(base, 'REPORT.md'); let report = fs.readFileSync(file, 'utf8');
const start = report.indexOf('## Per-scenario precision, recall and time'), end = report.indexOf('\n## OLD aggregate', start);
assert(start >= 0 && end > start);
let table = report.slice(start, end);
for (const row of correction.rows) {
    table = table.split('\n').map(line => {
        if (!line.startsWith(`| ${row.scenario} |`)) return line;
        const cells = line.split(' | ');
        for (const [index, variant] of [[1,'OLD'],[2,'NEW']]) {
            const f1 = row[variant].f1;
            assert(/\/\s*[\d.]+\s*\[[^\]]+\]\s*$/.test(cells[index]));
            cells[index] = cells[index].replace(/\/\s*[\d.]+\s*\[[^\]]+\]\s*$/,
                `/ ${f1.value.toFixed(2)} [${f1.low.toFixed(2)}, ${f1.high.toFixed(2)}]`);
        }
        return cells.join(' | ');
    }).join('\n');
}
report = report.slice(0, start) + table + report.slice(end);
report = report.replace('This corrects the descriptive envelopes for scenarios with no predictions in the earlier table.',
    'The primary table above uses these corrected descriptive envelopes for scenarios with no predictions.');
fs.writeFileSync(file, report);
const resultFile = path.join(base, 'FULL_RESULTS.json'), result = JSON.parse(fs.readFileSync(resultFile));
for (const row of correction.rows) for (const variant of ['OLD','NEW']) {
    result.stats[variant].scenarioVsPooledLegit[row.scenario].f1 = row[variant].f1;
    result.stats[variant].scenarios[row.scenario].f1 = row[variant].f1;
}
result.reportMetricCorrection = { appliedAt: new Date().toISOString(), verdictsAndTimestampsUnchanged: true,
    frozenOriginalUntouched: true, source: 'F1_METRIC_ADDENDUM.json',
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(base, 'F1_METRIC_ADDENDUM.json'))).digest('hex') };
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ corrected: correction.rows.map(row => row.scenario), rawVerdictsChanged: false }));
