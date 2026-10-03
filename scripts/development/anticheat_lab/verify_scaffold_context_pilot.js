'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { analysis } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real/context-pilots/scaffold');
const read = f => JSON.parse(fs.readFileSync(f));
const lines = f => fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const reviews = read(path.join(base, 'FULL_HUD_REVIEW.json')), results = [];
for (const [key, review] of Object.entries(reviews)) {
    assert.strictEqual(review.status, 'confirmed');
    const directory = path.join(base, key), truth = read(path.join(directory, 'ground-truth.json'));
    assert(truth.pilot && truth.automatedValid);
    assert.strictEqual(truth.positionContext.protocol, 'enabled-position-v1');
    assert.strictEqual(truth.positionContext.observerTeleport.data.entityId, truth.actorId);
    assert(truth.positionContext.observerTeleport.t < truth.toggles[0].t);
    assert(truth.observerEvidence.acceptedPlacements >= 12);
    const run = path.resolve(directory, '../..');
    const replay = analysis.replayTrial({ directory: run, recorderFile: truth.recorderFile, actorId: truth.actorId }, analysis.detectorDirs.NEW);
    const trace = lines(path.join(run, 'fury-profile/lab-detector-trace.jsonl'));
    const live = trace.filter(e => e.kind === 'flag' && e.flag.entityId === truth.actorId &&
        e.observedAt >= replay.recordingStartAt && e.observedAt <= replay.recordingEndAt).map(e => ({ family: e.family, ...e.flag }));
    const normalize = list => list.map(f => ({ family: f.family, tier: f.tier, at: f.at,
        evidence: f.evidence, weight: f.weight, strikes: f.strikes }));
    assert.deepStrictEqual(normalize(live), normalize(replay.flags), 'Corrected context must reproduce exact live callbacks');
    const input = lines(path.join(directory, 'input.jsonl'));
    assert(input.every(i => i.ok), 'No lost-focus/input failure');
    const launch = read(path.join(directory, 'client-launch.json'));
    assert.strictEqual(launch.target.host, '127.0.0.1');
    results.push({ id: truth.id, key, acceptedPlacements: truth.observerEvidence.acceptedPlacements,
        movements: truth.observerEvidence.actorPacketCounts, observerTeleport: truth.positionContext.observerTeleport,
        liveCallbacks: live, offlineCallbacks: replay.flags, exactMatch: true, excludedFromFullResults: true });
}
assert(results.length >= 1);
const out = { generatedAt: new Date().toISOString(), passed: true, results };
fs.writeFileSync(path.join(base, 'CONTEXT_PILOT_CHECK.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({ id: r.id, placements: r.acceptedPlacements,
    liveFlags: r.liveCallbacks.length, replayFlags: r.offlineCallbacks.length, exactMatch: r.exactMatch }))));
