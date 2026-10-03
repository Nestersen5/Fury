'use strict';

// Offline replay cost and labeled-target correctness, not live forwarding latency.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadRecording, resolveTarget } = require('../../../src/recorder/recordingAnalysis');
const root = path.resolve(__dirname, '../../..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const percentile = (values, fraction) => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? null;

function evaluate({ detectorDir, recordingDir, output }) {
    detectorDir = path.resolve(detectorDir);
    recordingDir = path.resolve(recordingDir);
    const { createScaffoldDetector } = require(path.join(detectorDir, 'scaffoldDetector.js'));
    const { createAutoblockDetector } = require(path.join(detectorDir, 'autoblockDetector.js'));
    const { createStasisDetector } = require(path.join(detectorDir, 'stasisDetector.js'));
    const rows = [];
    for (const file of fs.readdirSync(recordingDir).filter(n => n.endsWith('.jsonl')).sort()) {
        const full = path.join(recordingDir, file);
        const records = loadRecording(full);
        const header = records.find(r => r.k === 'header') || {};
        const label = String(header.label || 'unknown');
        const target = resolveTarget(records, { player: header.player });
        const truth = label.startsWith('legit') || label === 'fidelitytest' ? 'legitimate'
            : /^scaffold(?:_|$)/.test(label) ? 'scaffold' : 'unknown';
        const samples = [], memoryDeltas = [];
        let referenceFlags;
        for (let pass = 0; pass < 8; pass++) {
            const flags = [];
            const scaffold = createScaffoldDetector({ onFlag: flag => flags.push({ ...flag, cheat: 'Scaffold' }),
                requireCleanPlayback: () => header.source === 'replay' });
            const detectors = [scaffold, createAutoblockDetector({ onFlag: flag => flags.push(flag) })];
            if (header.source === 'live') detectors.push(createStasisDetector({ onFlag: flag => flags.push(flag) }));
            const before = process.memoryUsage().heapUsed;
            const start = performance.now();
            for (const record of records) for (const detector of detectors) detector.observeRecord(record);
            const elapsed = performance.now() - start;
            const heapDelta = process.memoryUsage().heapUsed - before;
            const targetFlags = flags.filter(flag => target.ids.has(Number(flag.entityId)))
                .map(flag => ({ cheat: flag.cheat, tier: flag.tier, at: flag.at ?? flag.t ?? null }));
            if (pass === 0) referenceFlags = targetFlags;
            else {
                if (JSON.stringify(referenceFlags) !== JSON.stringify(targetFlags)) throw new Error('Nondeterministic replay verdict');
                samples.push(elapsed); memoryDeltas.push(heapDelta);
            }
        }
        rows.push({ file, sha256: hash(full), label, source: header.source || 'unknown', truth,
            targetResolved: target.ids.size > 0, records: records.length, targetFlags: referenceFlags,
            replayMs: samples, medianReplayMs: percentile(samples, 0.5), p95ReplayMs: percentile(samples, 0.95),
            heapDeltaBytes: memoryDeltas });
    }
    const eligible = rows.filter(r => r.targetResolved);
    const legitimate = eligible.filter(r => r.truth === 'legitimate');
    const scaffold = eligible.filter(r => r.truth === 'scaffold');
    const flaggedLegit = legitimate.filter(r => r.targetFlags.length).length;
    const detectedScaffold = scaffold.filter(r => r.targetFlags.some(f => f.cheat === 'Scaffold')).length;
    const result = { createdAt: new Date().toISOString(), node: process.version, detectorDir, recordingDir,
        sourceHashes: Object.fromEntries(fs.readdirSync(detectorDir).filter(n => n.endsWith('.js')).sort().map(n => [n, hash(path.join(detectorDir, n))])),
        method: 'One warm-up, seven timed sequential replays per file; real timestamp values retained; target-only labels; production replay gate; Stasis live only.',
        limits: ['CPU replay timing excludes file loading, network, Main/renderer, IPC, and live scheduling.',
            'Heap deltas include GC noise and are not peak memory measurements.',
            'Historical recordings may share players/sessions and were already used by the existing detector; they are not a fresh held-out evaluation set.',
            'Unknown labels and unresolved targets are excluded from rate denominators. No cheat-family inference from flags.'],
        summary: { files: rows.length, unresolvedTargets: rows.filter(r => !r.targetResolved).length,
            legitimateFiles: legitimate.length, flaggedLegitimateFiles: flaggedLegit,
            falsePositiveFileRate: legitimate.length ? flaggedLegit / legitimate.length : null,
            scaffoldFiles: scaffold.length, detectedScaffoldFiles: detectedScaffold,
            scaffoldDetectionFileRate: scaffold.length ? detectedScaffold / scaffold.length : null,
            totalRecords: rows.reduce((n, r) => n + r.records, 0),
            summedMedianReplayMs: rows.reduce((n, r) => n + r.medianReplayMs, 0) }, rows };
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ output: path.resolve(output), ...result.summary }, null, 2));
    return result;
}

if (require.main === module) evaluate({
    detectorDir: process.argv[2] || path.join(root, 'output/anticheat-lab/baseline/detectors'),
    recordingDir: process.argv[3] || path.join(root, 'output/anticheat-lab/baseline/recordings'),
    output: process.argv[4] || path.join(root, 'output/anticheat-lab/baseline/corpus-evaluation.json')
});
module.exports = { evaluate };
