'use strict';
// Quick read-only check of offline versus live callbacks on one completed full trial.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const [run, id] = process.argv.slice(2);
const runDir = path.resolve(run);
const truth = JSON.parse(fs.readFileSync(path.join(runDir, id, 'attempt-001/ground-truth.json')));
const recording = fs.readFileSync(path.join(runDir, truth.recorderFile), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const trace = fs.readFileSync(path.join(runDir, 'fury-profile/lab-detector-trace.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const old = path.join(root, 'output/anticheat-lab/autoblock-v2/baseline-detectors');
for (const [name, dir] of [['OLD', old], ['NEW', path.join(root, 'src/detect')]]) {
    const flags = [];
    const detector = require(path.join(dir, 'autoblockDetector.js')).createAutoblockDetector({ onFlag: flag => flags.push(flag) });
    for (const record of recording) detector.observeRecord(record);
    console.log(JSON.stringify({ variant: name, id, flags: flags.filter(flag => flag.entityId === truth.actorId) }));
}
const start = recording[0].t, end = recording.at(-1).t;
console.log(JSON.stringify({ variant: 'LIVE', id, flags: trace.filter(row => row.kind === 'flag' &&
    row.family === 'Autoblock' && row.flag.entityId === truth.actorId && row.observedAt >= start && row.observedAt <= end).map(row => row.flag) }));
