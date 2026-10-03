'use strict';
// Run after owned live labs stop. Parsing/ground-truth resolution is outside
// timing; both versions consume exactly the same immutable observer records.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [baselineDir, candidateDir, output, ...inputs] = process.argv.slice(2);
const rawCombat = inputs.includes('--raw-combat');
assert(global.gc, 'Run node --expose-gc compare_performance.js BASELINE CANDIDATE OUTPUT EVIDENCE... [--corpus=DIR]');
assert(inputs.length);
const sources = [], datasets = [];
for (const input of inputs) {
    if (input === '--raw-combat') continue;
    if (input.startsWith('--corpus=')) {
        assert(!rawCombat, 'Historical compact recordings have no corresponding raw packet capture');
        const directory = path.resolve(input.slice(9));
        for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.jsonl')).sort()) {
            const bytes = fs.readFileSync(path.join(directory, file));
            datasets.push({ id: file, source: 'historical', sha256: sha(bytes), records: bytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse) });
        }
        sources.push({ directory }); continue;
    }
    const bytes = fs.readFileSync(input), evidence = JSON.parse(bytes); assert(evidence.complete);
    sources.push({ evidence: path.resolve(input), sha256: sha(bytes) });
    for (const row of evidence.rows) {
        const raw = fs.readFileSync(path.join(row.directory, rawCombat ? `${row.id}.observer-packets.jsonl` : row.recorderFile));
        assert.strictEqual(sha(raw), rawCombat ? row.observerSha256 : row.recorderSha256);
        datasets.push({ id: row.id, source: row.scenario, sha256: sha(raw), records: raw.toString().trim().split('\n').filter(Boolean).map(JSON.parse) });
    }
}
const variants = [baselineDir, candidateDir].map(directory => {
    directory = path.resolve(directory);
    return { directory, packetToRecord: require(path.join(directory, 'detectorShared.js')).packetToRecord, factories: {
        Scaffold: require(path.join(directory, 'scaffoldDetector.js')).createScaffoldDetector,
        Autoblock: require(path.join(directory, 'autoblockDetector.js')).createAutoblockDetector,
        Stasis: require(path.join(directory, 'stasisDetector.js')).createStasisDetector
    }, sourceHashes: Object.fromEntries(fs.readdirSync(directory).filter(f => f.endsWith('.js')).sort()
        .map(f => [f, sha(fs.readFileSync(path.join(directory, f)))])) };
});
function replay(variant) {
    let emittedFlags = 0, consumedRecords = 0;
    const start = performance.now(), cpuStart = process.cpuUsage(), heapStart = process.memoryUsage().heapUsed;
    for (const dataset of datasets) {
        if (rawCombat) {
            const detectors = [variant.factories.Autoblock({ onFlag: () => emittedFlags++ }),
                variant.factories.Stasis({ onFlag: () => emittedFlags++ })];
            for (const packet of dataset.records) {
                const record = variant.packetToRecord(packet.name, packet.data, packet.t);
                if (record) for (const detector of detectors) detector.observeRecord(record);
                consumedRecords++;
            }
            continue;
        }
        const header = dataset.records.find(r => r.k === 'header');
        const replaySource = header?.source === 'replay';
        const detectors = [variant.factories.Scaffold({ onFlag: () => emittedFlags++, requireCleanPlayback: () => replaySource }),
            variant.factories.Autoblock({ onFlag: () => emittedFlags++ })];
        if (header?.source === 'live') detectors.push(variant.factories.Stasis({ onFlag: () => emittedFlags++ }));
        for (const record of dataset.records) { for (const detector of detectors) detector.observeRecord(record); consumedRecords++; }
    }
    const cpu = process.cpuUsage(cpuStart);
    return { wallMs: performance.now() - start, cpuMs: (cpu.user + cpu.system) / 1000,
        heapDeltaBytes: process.memoryUsage().heapUsed - heapStart, consumedRecords, emittedFlags };
}
for (let warm = 0; warm < 3; warm++) for (const variant of variants) { global.gc(); replay(variant); }
const samples = variants.map(() => []);
for (let pass = 0; pass < 9; pass++) {
    for (const index of pass % 2 ? [1, 0] : [0, 1]) { global.gc(); samples[index].push(replay(variants[index])); }
}
const percentile = (values, p) => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const measurements = variants.map((variant, i) => ({ directory: variant.directory, sourceHashes: variant.sourceHashes,
    samples: samples[i], medianWallMs: percentile(samples[i].map(s => s.wallMs), 0.5),
    medianCpuMs: percentile(samples[i].map(s => s.cpuMs), 0.5), p95WallMs: percentile(samples[i].map(s => s.wallMs), 0.95) }));
const result = { schema: 1, createdAt: new Date().toISOString(), node: process.version, sources,
    mode: rawCombat ? 'selected raw observer packets: conversion plus combat detectors' : 'compact observer records: all three detectors',
    datasets: datasets.map(({ records, ...rest }) => ({ ...rest, records: records.length })),
    totalRecords: datasets.reduce((n, d) => n + d.records.length, 0), measurements,
    medianWallRatio: measurements[1].medianWallMs / measurements[0].medianWallMs,
    method: 'Three warm-ups per version, nine measured corpus passes, alternating order, explicit GC outside timing, same pre-parsed records.',
    limits: ['Observer-record processing only; excludes live TCP forwarding, parsing, IPC, rendering and fixture ground truth.',
        'Raw-combat mode includes shared packet conversion and both combat detectors, but not Scaffold or uncaptured packet types.',
        'Heap deltas include allocation/GC noise and are not peak memory. Host scheduling can affect wall time.',
        'Historical replay/live guards are retained. Flag counts here include all entities and are not accuracy metrics.'] };
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, datasets: datasets.length, records: result.totalRecords,
    baselineMedianMs: measurements[0].medianWallMs, candidateMedianMs: measurements[1].medianWallMs, ratio: result.medianWallRatio }));
