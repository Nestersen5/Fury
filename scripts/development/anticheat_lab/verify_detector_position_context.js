'use strict';
// Meaningful activation/ordering checks and real-recording observer ablation.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { createDetectorPositionContext } = require('./detector_position_context_candidate');
const read = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
let traversals = 0, records = [], t = 100;
const context = createDetectorPositionContext({ now: () => t,
    detector: { observeRecord: r => records.push(r) },
    forEachEntity: each => { traversals++; each({ name: 'Actor', x: 2, y: 64, z: 3 }, 7);
        each({ x: NaN, y: 64, z: 0 }, 8); each({ x: 0, y: 64, z: 0 }, '9'); } });
context.sync(false); assert.strictEqual(traversals, 0);
context.sync(true); assert.strictEqual(records.length, 1);
assert.deepStrictEqual(records[0], { k: 'snap', t: 100, id: 7, name: 'Actor', x: 2, y: 64, z: 3 });
context.sync(true); assert.strictEqual(traversals, 1, 'No repeated tracker traversal on steady packets');
context.sync(false); assert.strictEqual(traversals, 1, 'Disabled checks do no position work');
t = 200; context.sync(true); assert.strictEqual(records.at(-1).t, 200);
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real/scaffold');
const { createScaffoldDetector } = require(path.join(root, 'src/detect/scaffoldDetector'));
const audit = read(path.join(base, 'LIVE_REPLAY_AUDIT.json')), results = [];
for (const row of audit.divergences) {
    const directory = path.join(base, row.run), truth = read(path.join(directory, row.id, row.attempt, 'ground-truth.json'));
    const input = lines(path.join(directory, truth.recorderFile)), snapshots = input.filter(r => r.k === 'snap');
    const flags = [], detector = createScaffoldDetector({ onFlag: f => flags.push(f) });
    const replayContext = createDetectorPositionContext({ detector, now: () => input[0].t,
        forEachEntity: each => snapshots.forEach(r => each(r, r.id)) });
    replayContext.sync(true);
    for (const r of input) if (r.k !== 'snap') detector.observeRecord(r);
    const actorFlags = flags.filter(f => f.entityId === truth.actorId);
    assert.deepStrictEqual(actorFlags, row.offline.filter(f => f.family === 'Scaffold').map(({ family, ...f }) => f));
    results.push({ id: row.id, originalLiveFlags: row.live.length, observerSeededReplayFlags: actorFlags.length,
        exactlyReproducesOriginalCompactScaffoldReplay: true });
}
const output = { generatedAt: new Date().toISOString(), passed: true, results,
    interpretation: 'Observer position context ablation, not a new live trial or improved detector accuracy result.',
    checks: ['one traversal per activation', 'disabled no-op', 'finite observer position only',
        'explicit block-coordinate snapshot', 'no repeated steady-packet allocation', 'real-recording callback reproduction'] };
fs.writeFileSync(path.join(base, 'POSITION_CONTEXT_CANDIDATE_CHECK.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
