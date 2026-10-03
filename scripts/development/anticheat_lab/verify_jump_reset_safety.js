'use strict';
// Safety checks and ablations of real pilot recordings, not extra real trials.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { createJumpResetDetector: createPrototype } = require('./jump_reset_candidate');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/jump-reset');
const useFrozen = process.argv.includes('--frozen');
const frozen = useFrozen ? JSON.parse(fs.readFileSync(path.join(base, 'FROZEN_CANDIDATE.json'))) : null;
const createJumpResetDetector = dependencies => createPrototype({ ...dependencies, thresholds: frozen?.thresholds });
const plan = JSON.parse(fs.readFileSync(path.join(base, 'PILOT_PLAN.json'))), datasets = [];
const cheatOnly = process.argv.includes('--cheat-only');
for (const spec of plan.trials.filter(s => !cheatOnly || s.effectExpected)) {
    let found = false;
    for (const runName of fs.readdirSync(base).filter(n => /^pilot-\d+$/.test(n)).sort()) {
        const directory = path.join(base, runName, spec.id); if (!fs.existsSync(directory)) continue;
        for (const attempt of fs.readdirSync(directory).sort()) {
            const truthFile = path.join(directory, attempt, 'ground-truth.json'); if (!fs.existsSync(truthFile)) continue;
            const truth = JSON.parse(fs.readFileSync(truthFile)); if (!truth.automatedValid) continue;
            if (['L13','L14','L15'].includes(spec.scenarioId) && truth.inputProtocol !== 'actor-view-controls-v2') continue;
            const records = fs.readFileSync(path.join(base, runName, truth.recorderFile), 'utf8')
                .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
            datasets.push({ id: spec.id, actorId: truth.actorId, records }); found = true; break;
        }
        if (found) break;
    }
}
assert.strictEqual(datasets.length, cheatOnly ? 4 : 8);
function replay(dataset, enabled = true, clocks = true) {
    const flags = [], detector = createJumpResetDetector({ isEnabled: () => enabled, onFlag: f => flags.push(f) });
    for (const record of dataset.records) if (clocks || record.k !== 'time') detector.observeRecord(record);
    return { detector, flags: flags.filter(f => f.entityId === dataset.actorId) };
}
let flagged = 0;
for (const dataset of datasets) {
    const a = replay(dataset), b = replay(dataset);
    assert.deepStrictEqual(a.flags, b.flags, 'Cold replays must be deterministic');
    assert(a.flags.every(f => f.tier === 'possible' && f.experimental && f.evidence.every(e => !e.hard)),
        'Jump timing cannot produce a confirmed verdict');
    assert(a.flags.length <= 1, 'At most one pattern alert per entity before clearing');
    assert.strictEqual(replay(dataset, false).flags.length, 0, 'Disabled detection must not flag');
    assert.strictEqual(replay(dataset, true, false).flags.length, 0, 'Unknown clock must not flag');
    const firstAt = dataset.records.find(r => Number.isFinite(r.t)).t;
    for (const scale of [0.5, 3]) {
        const distorted = { ...dataset, records: dataset.records.map(r => Number.isFinite(r.t)
            ? { ...r, t: firstAt + (r.t - firstAt) * scale } : r) };
        assert.strictEqual(replay(distorted).flags.length, 0, 'Out-of-range server clock must not flag');
    }
    const failedCallback = createJumpResetDetector({ onFlag: () => { throw new Error('Injected callback failure'); } });
    for (const record of dataset.records) assert.doesNotThrow(() => failedCallback.observeRecord(record),
        'A callback failure must not break packet handling');
    for (const record of [null, {}, { k:'destroy', ids: 4 }, { k:'time', t: 'bad', age: null }])
        assert.doesNotThrow(() => failedCallback.observeRecord(record), 'Malformed optional data must remain non-invasive');
    const count = a.flags.length; flagged += count;
    a.detector.clear(); assert.strictEqual(a.detector.getStatus().length, 0);
    const again = replay(dataset);
    again.detector.observeRecord({ k: 'destroy', t: dataset.records.at(-1).t + 1, ids: [dataset.actorId] });
    assert(!again.detector.getStatus().some(s => s.name === `entity #${dataset.actorId}`), 'Destroyed actors must release state');
}
const output = { generatedAt: new Date().toISOString(), recordings: datasets.length, prototypeFlaggedPilots: flagged,
    frozenThresholds: useFrozen, thresholds: frozen?.thresholds || null,
    cohort: cheatOnly ? 'four original cheat pilot fixtures; technical checks only' : 'all eight pilot fixtures, corrected legal controls',
    excludedFromFullResults: true, checks: ['deterministic replay', 'possible-only', 'one alert per actor',
        'disabled gate', 'unknown-clock gate', 'out-of-range clock gate', 'clear state', 'destroy state', 'callback failure isolation', 'malformed record isolation'], passed: true };
fs.writeFileSync(path.join(base, useFrozen ? 'FROZEN_SAFETY_CHECK.json' : cheatOnly ? 'PROTOTYPE_CHEAT_FIXTURE_CHECK.json' : 'PROTOTYPE_SAFETY_CHECK.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
