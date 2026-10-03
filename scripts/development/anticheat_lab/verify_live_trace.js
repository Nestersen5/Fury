'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [runArg, output] = process.argv.slice(2), run = path.resolve(runArg);
assert(fs.existsSync(path.join(run, 'errors.json')), 'Owned lab must be closed before verifying its trace');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(run, 'errors.json'))), []);
const traceBytes = fs.readFileSync(path.join(run, 'fury-profile/lab-detector-trace.jsonl'));
const trace = traceBytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse);
const manifest = JSON.parse(fs.readFileSync(path.join(run, 'production-source.json')));
for (const [file, hash] of Object.entries(manifest.hashes)) assert.strictEqual(sha(fs.readFileSync(path.join(run, 'production-source', file))), hash);
const detectorDir = path.join(run, 'production-source/src/detect');
const factories = {
    Autoblock: require(path.join(detectorDir, 'autoblockDetector.js')).createAutoblockDetector,
    Stasis: require(path.join(detectorDir, 'stasisDetector.js')).createStasisDetector
};
const detectors = new Map(), replayed = [], live = [];
const normalize = (family, flag) => ({ family, entityId: flag.entityId, tier: flag.tier, at: flag.at, evidence: flag.evidence });
let inputs = 0, resets = 0;
for (const event of trace) {
    if (!factories[event.family]) continue;
    if (event.kind === 'create') detectors.set(event.id, factories[event.family]({ onFlag: flag => replayed.push(normalize(event.family, flag)) }));
    else if (event.kind === 'record') { detectors.get(event.id).observeRecord(event.record); inputs++; }
    else if (event.kind === 'clear') { detectors.get(event.id).clear(); resets++; }
    else if (event.kind === 'flag') live.push(normalize(event.family, event.flag));
}
assert.deepStrictEqual(replayed, live, 'Continuous actual Fury inputs and resets must reproduce its live combat verdicts');
const cases = fs.readdirSync(run).filter(f => f.endsWith('.ground-truth.json')).sort().map(file => {
    const bytes = fs.readFileSync(path.join(run, file)), truth = JSON.parse(bytes);
    assert(!truth.spec?.split, 'This verifier is for explicit pilots, not opening held-out campaign verdicts');
    return { file, sha256: sha(bytes), mode: truth.mode ?? truth.spec?.mode, actorId: truth.actorId,
        enabledModules: truth.enabledModules, startedAt: truth.startedAt, endedAt: truth.endedAt,
        liveFlags: live.filter(flag => flag.entityId === truth.actorId).map(flag => ({ ...flag,
            timeToFlagMs: flag.at - truth.startedAt })) };
});
const report = { createdAt: new Date().toISOString(), run, traceSha256: sha(traceBytes), sourceHashes: manifest.hashes,
    inputs, resets, liveCombatFlags: live.length, continuousReplayMatches: true, cases,
    limitations: ['Optional observer-side instrumentation wraps actual detector callbacks without changing inputs or decisions.',
        'Continuous replay includes prior clock/context history; individual campaign-clip scoring starts from the context present in that clip.',
        'Scaffold callbacks are recorded but not replayed by this compact combat-input verifier.'] };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, inputs, resets, liveCombatFlags: live.length, continuousReplayMatches: true,
    cases: cases.map(c => ({ file: c.file, mode: c.mode, flags: c.liveFlags.map(f => ({ family: f.family, tier: f.tier, timeToFlagMs: f.timeToFlagMs })) })) }, null, 2));
