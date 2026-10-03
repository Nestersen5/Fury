'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { stats } = require('./overnight_analysis_modules');
const part = process.argv[2]; assert(['autoblock','scaffold'].includes(part));
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real', part === 'scaffold' ? part : '');
const result = JSON.parse(fs.readFileSync(path.join(base,'FULL_RESULTS.json')));
const family = part === 'scaffold' ? 'Scaffold' : 'Autoblock';
const rows = [];
for (const trial of result.trials.filter(r => r.effectExpected)) {
    const first = version => trial[version].flags.filter(f => f.family === family && f.at >= trial.startedAt).sort((a,b)=>a.at-b.at)[0];
    const a = first('old'), b = first('new');
    if (a && b) rows.push({ id: trial.id, scenario: trial.scenario, oldFirstAt: a.at, newFirstAt: b.at,
        oldSeconds: (a.at-trial.startedAt)/1000, newSeconds: (b.at-trial.startedAt)/1000,
        newMinusOldSeconds: (b.at-a.at)/1000 });
}
const output = { generatedAt: new Date().toISOString(), part,
    explanation: 'Same recordings and same detected trials. Negative paired differences mean NEW flags earlier. This avoids changing the detected subset when comparing timing.',
    commonDetected: rows.length, old: stats.distribution(rows.map(r=>r.oldSeconds)),
    new: stats.distribution(rows.map(r=>r.newSeconds)), newMinusOld: stats.distribution(rows.map(r=>r.newMinusOldSeconds)), rows };
fs.writeFileSync(path.join(base,'PAIRED_TIME_AUDIT.json'), JSON.stringify(output,null,2)+'\n');
const text = ['', '## Time on the same detected trials', '', output.explanation, '',
    `Common detected trials: ${output.commonDetected}. OLD ${stats.timeText(output.old)}; NEW ${stats.timeText(output.new)}.`,
    `NEW minus OLD paired time: ${stats.timeText(output.newMinusOld)}. The overall time medians above use each version’s own detected set.`,
    'Every paired time is listed in [PAIRED_TIME_AUDIT.json](PAIRED_TIME_AUDIT.json).', ''];
const file = path.join(base,'REPORT.md');
fs.writeFileSync(file, fs.readFileSync(file,'utf8').split('\n## Time on the same detected trials')[0] + text.join('\n'));
console.log(JSON.stringify({ part, commonDetected: output.commonDetected, old: output.old, new: output.new, difference: output.newMinusOld }));
