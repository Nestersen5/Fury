'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { analysis } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'output/anticheat-lab/mod-real');
const part = process.argv[2]; assert(['autoblock', 'scaffold'].includes(part)); analysis.checkHashes();
const base = part === 'scaffold' ? path.join(output, part) : output;
const result = JSON.parse(fs.readFileSync(path.join(base, 'FULL_RESULTS.json')));
const evidence = JSON.parse(fs.readFileSync(path.join(base, 'FULL_EVIDENCE.json'))); assert(evidence.complete);
const destination = path.join(output, 'overnight', `measurement-${part}`); assert(!fs.existsSync(destination), 'Measurement already frozen');
const perfFile = path.join(output, 'overnight', `${part}-original-performance.json`);
const performance = JSON.parse(fs.readFileSync(perfFile)), [old, current] = performance.measurements;
const report = path.join(base, 'REPORT.md');
fs.appendFileSync(report, ['','## Performance on these recordings','',
    `${performance.datasets.length} recordings, ${performance.totalRecords.toLocaleString('en-US')} pre-parsed observer records. Three warm-ups and nine alternating measured passes; explicit GC outside timing.`,
    `OLD median ${old.medianWallMs.toFixed(2)} ms; NEW median ${current.medianWallMs.toFixed(2)} ms for the entire corpus (${performance.medianWallRatio.toFixed(3)}x). CPU medians ${old.medianCpuMs.toFixed(2)} / ${current.medianCpuMs.toFixed(2)} ms.`,
    'This measures detector processing only, not game responsiveness, TCP forwarding, IPC or rendering. Heap deltas contain GC noise and are not peak memory.',
    `Raw samples and source hashes: [performance JSON](${part === 'scaffold' ? '../' : ''}overnight/${part}-original-performance.json).`,
    ''].join('\n'));
fs.mkdirSync(destination);
const names = [`FULL_PLAN_${part}.json`, 'FULL_EVIDENCE.json', 'FULL_REPLAY_DETAILS.json', 'FULL_RESULTS.json', 'REPORT.md',
    'LIVE_TIMESTAMP_AUDIT.json', 'FULL_HUD_REVIEW.json', 'FULL_PROTOCOL_ADDENDUM.json', 'FULL_REPLAY_EXCLUSIONS.json',
    'FULL_EXCLUSIONS.json', 'ARENA_PROTOCOL_ADDENDUM.json', 'DEFAULT_RANGE_ADDENDUM.json',
    'CONTEXT_PROTOCOL_ADDENDUM.json', 'LIVE_CONTEXT_DIAGNOSTIC.json', 'POSITION_CONTEXT_CANDIDATE_CHECK.json',
    'CALLBACK_DIFFERENCE_AUDIT.json', 'CAREFUL_CONTROL_ADDENDUM.json', 'LAUNCH_QUALITY_AUDIT.json', 'RULE_AND_MODE_RESULTS.json', 'PAIRED_TIME_AUDIT.json', 'PROTOCOL_AND_INVALID_AUDIT.json'];
const files = {};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const name of names) if (fs.existsSync(path.join(base, name))) {
    fs.copyFileSync(path.join(base, name), path.join(destination, name), fs.constants.COPYFILE_EXCL); files[name] = hash(path.join(destination, name));
}
fs.copyFileSync(perfFile, path.join(destination, 'performance.json'), fs.constants.COPYFILE_EXCL); files['performance.json'] = hash(perfFile);
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ frozenAt: new Date().toISOString(), part,
    purpose: 'Pinned original measurement before improvement experiments. No trial selected by a detector verdict.',
    files, trials: result.trials.length,
    sourceHashes: JSON.parse(fs.readFileSync(path.join(output, 'overnight/start-manifest.json'))).sourceHashes }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ part, frozen: destination, trials: evidence.rows.length }));
