'use strict';
// Labels and effect boundaries come from frozen ground truth, never from flags.
// Detectors receive only original Fury observer records, with original times.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { resolveTarget } = require('../../../src/recorder/recordingAnalysis');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function evaluate(evidenceFile, detectorDirectory, split, output, passes = 1) {
    assert(['calibration', 'evaluation'].includes(split), 'Explicit split required');
    assert(Number.isInteger(passes) && passes >= 1 && passes <= 8);
    const evidenceBytes = fs.readFileSync(evidenceFile), evidence = JSON.parse(evidenceBytes);
    assert(evidence.complete || (split === 'calibration' && evidence.scope === 'partial-calibration'),
        'Validate complete evidence; only explicit partial calibration snapshots may be scored early');
    const detectorDir = path.resolve(detectorDirectory);
    const { createScaffoldDetector } = require(path.join(detectorDir, 'scaffoldDetector.js'));
    const { createAutoblockDetector } = require(path.join(detectorDir, 'autoblockDetector.js'));
    const { createStasisDetector } = require(path.join(detectorDir, 'stasisDetector.js'));
    const rows = [];
    for (const trial of evidence.rows.filter(row => row.split === split)) {
        const bytes = fs.readFileSync(path.join(trial.directory, trial.recorderFile));
        assert.strictEqual(sha(bytes), trial.recorderSha256);
        const records = bytes.toString().trim().split('\n').map(JSON.parse), header = records.find(r => r.k === 'header');
        assert.strictEqual(header.source, 'live');
        const target = resolveTarget(records, { player: header.player });
        assert(target.ids.size > 0, 'Labeled actor must resolve from observer records');
        const cpuMs = [], heapDeltaBytes = []; let targetFlags;
        for (let pass = 0; pass < passes; pass++) {
            const flags = [], capture = cheat => flag => flags.push({ ...flag, cheat });
            const detectors = [createScaffoldDetector({ onFlag: capture('Scaffold'), requireCleanPlayback: () => false }),
                createAutoblockDetector({ onFlag: capture('Autoblock') }), createStasisDetector({ onFlag: capture('Stasis') })];
            const heap = process.memoryUsage().heapUsed, start = performance.now();
            for (const record of records) for (const detector of detectors) detector.observeRecord(record);
            cpuMs.push(performance.now() - start); heapDeltaBytes.push(process.memoryUsage().heapUsed - heap);
            const observed = flags.filter(flag => target.ids.has(Number(flag.entityId))).map(flag => ({ cheat: flag.cheat,
                tier: flag.tier, at: flag.at, timeToFlagMs: flag.at - trial.startedAt }));
            if (pass === 0) targetFlags = observed; else assert.deepStrictEqual(observed, targetFlags, 'Replay verdict must be deterministic');
        }
        rows.push({ id: trial.id, scenario: trial.scenario, split, legitimate: trial.scenario.startsWith('legit_'),
            effectExpected: trial.effectExpected, records: records.length, targetFlags, cpuMs, heapDeltaBytes,
            recorderSha256: trial.recorderSha256, groundTruthSha256: trial.groundTruthSha256 });
    }
    const groups = {};
    for (const row of rows) {
        const group = groups[row.scenario] ||= { total: 0, flaggedAny: 0, possible: 0, confirmed: 0, flaggedByFamily: {},
            effectExpected: 0, effectExpectedFlagged: 0, noEffectExpected: 0, noEffectFlagged: 0, firstFlagMs: [] };
        group.total++; if (row.targetFlags.length) group.flaggedAny++;
        for (const family of new Set(row.targetFlags.map(flag => flag.cheat))) group.flaggedByFamily[family] = (group.flaggedByFamily[family] || 0) + 1;
        if (row.targetFlags.some(flag => flag.tier === 'possible')) group.possible++;
        if (row.targetFlags.some(flag => flag.tier === 'confirmed')) group.confirmed++;
        if (row.effectExpected === true) { group.effectExpected++; if (row.targetFlags.length) group.effectExpectedFlagged++; }
        if (row.effectExpected === false) { group.noEffectExpected++; if (row.targetFlags.length) group.noEffectFlagged++; }
        if (row.targetFlags.length) group.firstFlagMs.push(Math.min(...row.targetFlags.map(flag => flag.timeToFlagMs)));
    }
    const result = { schema: 1, createdAt: new Date().toISOString(), evidenceFile: path.resolve(evidenceFile), evidenceSha256: sha(evidenceBytes),
        detectorDir, split, provisional: !evidence.complete, passes, node: process.version,
        sourceHashes: Object.fromEntries(fs.readdirSync(detectorDir).filter(file => file.endsWith('.js')).sort().map(file => [file, sha(fs.readFileSync(path.join(detectorDir, file)))])),
        limits: ['Target-only observer record replay. No server/client ground truth enters detector inputs.',
            'Single-pass CPU samples are exploratory and include warm-up; matched final cost measurement must run after live labs stop.',
            'Replay cost excludes parsing, network, IPC, and renderer. Heap deltas include GC noise, not peak memory.',
            'Scripted legitimate rates are per-trial fixture rates, not human-population false-positive estimates.',
            'FlaggedAny includes cross-family flags; per-family counts and effect/no-effect boundaries are separate.'], groups, rows };
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, split, groups }, null, 2)); return result;
}
if (require.main === module) evaluate(...process.argv.slice(2, 6), Number(process.argv[6] || 1));
module.exports = { evaluate };
