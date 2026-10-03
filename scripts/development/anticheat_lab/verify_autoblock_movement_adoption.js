'use strict';
// Offline adoption checks. Never launches a lab or consumes unfinished evaluation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stats, analysis } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'output/anticheat-lab/mod-real');
const baseline = path.join(output, 'overnight/baseline-source/src/detect');
const frozen = path.join(output, 'improvements/selected-candidate');
const [directoryArg, resultArg] = process.argv.slice(2);
assert(directoryArg && resultArg, 'Usage: node verify_autoblock_movement_adoption.js DETECTOR_DIR OUTPUT_JSON');
const directory = path.resolve(directoryArg), resultFile = path.resolve(resultArg);
assert(resultFile.startsWith(output + path.sep), 'Only write mod-real outputs');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const sourceNames = ['autoblockDetector.js', 'scaffoldDetector.js', 'detectorShared.js', 'stasisDetector.js'];
const manifest = read(path.join(output, 'overnight/start-manifest.json'));
const decision = read(path.join(output, 'improvements/fresh/FROZEN_DECISION.json'));
for (const name of sourceNames) {
    assert.strictEqual(sha(path.join(baseline, name)), manifest.sourceHashes['src/detect/' + name]);
    assert.strictEqual(sha(path.join(frozen, name)), decision.sourceHashes[name]);
    if (name !== 'autoblockDetector.js') assert.strictEqual(sha(path.join(directory, name)), sha(path.join(baseline, name)));
}
// Production may change explanatory comments, but must retain the frozen code.
const body = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').slice(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').indexOf("const { binomialTail }"));
assert.strictEqual(body(path.join(directory, sourceNames[0])), body(path.join(frozen, sourceNames[0])));

const create = require(path.join(directory, 'autoblockDetector.js')).createAutoblockDetector;
function records({ tickMs = 100, speed = 5.625, swings = false, noClock = false, damage = false, teleports = false } = {}) {
    const result = [{ k: 'eq', t: 0, id: 1, slot: 0, item: 276 },
        { k: 'meta', t: 100, id: 1, m: [{ key: 0, value: 16 }] }];
    if (!noClock) for (let t = 0, age = 1000; t <= 20000; t += 20 * tickMs, age += 20) result.push({ k: 'time', t, age });
    for (let t = 150; t <= 20000; t += 50) {
        result.push({ k: 'mv', t, id: 1, dx: speed * 32 * 0.05, dz: 0 });
        if (swings && t % 150 === 0) result.push({ k: 'anim', t, id: 1, a: 0 });
        if (damage && t % 700 === 150) result.push({ k: 'st', t, id: 1, s: 2 });
        if (teleports && t % 1000 === 150) result.push({ k: 'tp', t, id: 1, x: 0, y: 64 * 32, z: 0 });
    }
    return result.sort((a, b) => a.t - b.t);
}
function run(events, detector) {
    const flags = [], d = detector || create({ onFlag: f => flags.push(f) });
    events.forEach(r => d.observeRecord(r));
    return { flags, d };
}
const safeguards = [];
function check(name, events, expectMovement = false) {
    const { flags } = run(events);
    if (expectMovement) {
        assert.deepStrictEqual(flags.map(f => f.tier), ['possible', 'confirmed'], name);
        assert(flags.every(f => f.evidence.every(e => e.group === 'Movement')), name + ': slow clock must not certify swings');
    } else assert.strictEqual(flags.length, 0, name);
    safeguards.push({ name, passed: true, flags });
}
for (const tickMs of [100, 120, 125]) {
    check(`Steady ${tickMs} ms ticks certify fast movement, never swing evidence`, records({ tickMs, swings: true }), true);
    check(`Steady ${tickMs} ms ticks ignore vanilla Speed II block walking`, records({ tickMs, speed: 1.25, swings: true }));
}
check('Unknown clock cannot certify movement or swings', records({ noClock: true, swings: true }));
for (const tickMs of [20, 39, 126, 150]) check(`Out-of-range ${tickMs} ms clock cannot certify evidence`, records({ tickMs, swings: true }));
check('Slow clock retains repeated damage grace', records({ damage: true }));
check('Slow clock retains teleport exclusion', records({ teleports: true }));
const interrupted = records({ noClock: true, swings: true }).filter(r => r.t < 6000);
interrupted.push({ k: 'time', t: 0, age: 1000 }, { k: 'time', t: 1000, age: 1020 },
    { k: 'time', t: 2000, age: 1040 }, { k: 'time', t: 6000, age: 1060 });
for (const t of [6020, 6040, 6060]) interrupted.push({ k: 'time', t, age: 1080 + (t - 6020) });
// Avoid enough strict swings to flag before the interrupted interval.
check('A stalled interval followed by burst delivery discards pending movement', interrupted.filter(r => r.k !== 'anim').sort((a, b) => a.t - b.t));
for (const age of [undefined, 1.5, -100, 1040]) {
    const events = interrupted.filter(r => r.k !== 'anim' && r.t <= 6000 && !(r.k === 'time' && r.t === 6000));
    events.push({ k: 'time', t: 6000, age });
    check(`Invalid or non-advancing final world age ${String(age)} discards pending evidence`, events.sort((a, b) => a.t - b.t));
}
{
    const flags = [], d = create({ onFlag: f => flags.push(f) });
    records().forEach(r => d.observeRecord(r));
    assert(flags.length); d.clear(); flags.length = 0;
    assert.deepStrictEqual(d.getStatus(), []);
    records({ noClock: true, swings: true }).forEach(r => d.observeRecord(r));
    assert.strictEqual(flags.length, 0, 'Clear resets both clock certification counters');
    safeguards.push({ name: 'Clear resets both clock counters and evidence', passed: true });
}

const cohorts = {}, performanceEvidence = { complete: true, rows: [] };
for (const [name, evidenceRelative, cachedRelative] of [
    ['original', 'overnight/measurement-autoblock/FULL_EVIDENCE.json', 'improvements/ORIGINAL_DIAGNOSTICS.json'],
    ['freshCalibration', 'improvements/fresh/FULL_EVIDENCE.json', 'improvements/fresh/CALIBRATION_RESULTS.json'],
    ['stressCalibration', 'improvements/movement-stress/FULL_EVIDENCE.json', 'improvements/movement-stress/CALIBRATION_RESULTS.json']
]) {
    const file = path.join(output, evidenceRelative), evidence = read(file), cached = read(path.join(output, cachedRelative));
    if (name === 'original') assert.strictEqual(sha(file), read(path.join(path.dirname(file), 'manifest.json')).files['FULL_EVIDENCE.json']);
    const rows = name === 'original' ? evidence.rows : evidence.rows.filter(r => r.split === 'calibration');
    assert.strictEqual(rows.length, { original: 110, freshCalibration: 24, stressCalibration: 20 }[name]);
    // Verify byte identity against validated observer evidence, without detector input ground truth.
    rows.forEach(row => assert.strictEqual(sha(path.join(row.directory, row.recorderFile)), row.recorderSha256));
    performanceEvidence.rows.push(...rows);
    const details = {}, summaries = {};
    for (const [variant, source] of Object.entries({ BASELINE: baseline, CANDIDATE: directory })) {
        details[variant] = rows.map(row => ({ id: row.id, scenario: row.scenario, effectExpected: row.effectExpected, ...analysis.replayTrial(row, source) }));
        summaries[variant] = stats.variantStats(rows, details[variant], 'Autoblock');
        const expectedDetails = name === 'original' ? cached.parts.autoblock.details[variant] : cached.details[variant];
        assert.deepStrictEqual(details[variant], expectedDetails, 'Replay must reproduce previously measured callbacks: ' + name + '/' + variant);
    }
    assert.strictEqual(summaries.CANDIDATE.falseAnyDetector.k, 0, name + ': no false flags');
    const differences = [];
    for (const row of rows) {
        const a = details.BASELINE.find(d => d.id === row.id), b = details.CANDIDATE.find(d => d.id === row.id);
        const eligible = f => !row.effectExpected || f.at >= row.startedAt;
        const verdict = d => d.flags.some(f => f.family === 'Autoblock' && eligible(f));
        assert(!verdict(a) || verdict(b), row.id + ': cannot lose a detection');
        assert.deepStrictEqual(a.flags.filter(f => f.family !== 'Autoblock'), b.flags.filter(f => f.family !== 'Autoblock'), 'Unchanged cross-family callbacks');
        if (verdict(a) !== verdict(b)) differences.push({ id: row.id, scenario: row.scenario, baseline: verdict(a), candidate: verdict(b), baselineFlags: a.flags, candidateFlags: b.flags });
    }
    cohorts[name] = { evidenceSha256: sha(file), summaries, differences, details };
}
const result = { createdAt: new Date().toISOString(), detectorDirectory: directory,
    baselineMeaning: 'Previously implemented NEW detector, not archived OLD',
    sourceHashes: Object.fromEntries(sourceNames.map(n => [n, sha(path.join(directory, n))])),
    baselineHashes: Object.fromEntries(sourceNames.map(n => [n, sha(path.join(baseline, n))])),
    frozenCandidateHashes: decision.sourceHashes, safeguards, cohorts,
    limitations: ['Original data is exploratory; fresh and stress data are calibration, not independent held-out evaluation.',
        'No additional gameplay captured. All clocks and speed/timing guards retain the frozen candidate values.',
        'A scripted Forge port on one loopback vanilla server is not actual Vape or human Hypixel play. Zero observed false flags does not establish zero population false positives.'] };
fs.mkdirSync(path.dirname(resultFile), { recursive: true });
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(resultFile.replace(/\.json$/, '-performance-evidence.json'), JSON.stringify(performanceEvidence) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ resultFile, safeguards: safeguards.length, cohorts: Object.fromEntries(Object.entries(cohorts).map(([name, c]) => [name,
    { baseline: c.summaries.BASELINE.targetAny, candidate: c.summaries.CANDIDATE.targetAny, falseFlags: c.summaries.CANDIDATE.falseAnyDetector,
        changed: c.differences.map(d => d.id) }])) }));
