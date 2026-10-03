'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createJumpResetFeatures } = require('./jump_reset_observer_features');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/jump-reset');
assert(!fs.readdirSync(base).some(name => /^full-\d+$/.test(name)), 'Define the trajectory protocol before full Jump Reset captures');
const movement = [
    { k: 'snap', t: 1000, id: 7, x: 0, y: 64, z: 0, g: true },
    { k: 'st', t: 1010, id: 7, s: 2 },
    ...[8,16,16,-16,-16,-8].map((dy, index) => ({ k: 'mv', t: 1040 + 50 * index,
        id: 7, dx: 0, dy, dz: 0, g: index === 5 }))
];
function extract(velocity) {
    const opportunities = [], features = createJumpResetFeatures({ onOpportunity: row => opportunities.push(row) });
    for (const record of [...movement, ...(velocity ? [velocity] : [])].sort((a,b) => a.t-b.t)) features.observeRecord(record);
    assert.strictEqual(opportunities.length, 1); assert.strictEqual(opportunities[0].reason, 'landed');
    assert.strictEqual(opportunities[0].observedRise, 1.25); assert.strictEqual(opportunities[0].landingHeightChange, 0);
    assert.strictEqual(opportunities[0].velocitySource, 'damage proxy; velocity unknown');
    return opportunities;
}
const reference = extract(null);
for (const velocity of [
    { k: 'vel', t: 1020, id: 7 },
    { k: 'vel', t: 1020, id: 7, vx: 800, vy: 3200, vz: 0 },
    { k: 'vel', t: 1020, id: 7, velocity: { x: 800, y: 3200, z: 0 } }
]) assert.deepStrictEqual(extract(velocity), reference, 'Uniform live/offline damage-only opportunity extraction');
const hashes = Object.fromEntries(['jump_reset_observer_features.js','jump_reset_candidate.js'].map(name => [name,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex')]));
const result = { createdAt: new Date().toISOString(), decidedBeforeFullCaptures: true, passed: true,
    protocol: 'damage-motion-only-v1', sourceHashes: hashes,
    reason: 'Existing shared live conversion omits velocity components; recorder components are also absent for nested protocol data. Unknown velocity records previously canceled otherwise valid pending motion. Ignore all velocity records uniformly instead of granting offline-only information.',
    detectorThresholdsAndCalibrationSearchUnchanged: true, knownVelocityUsedByDecision: false,
    checks: ['missing, flat and nested velocity shapes yield identical damage-motion opportunities',
        'unknown velocity cannot cancel pending damage motion', 'no private actor velocity or input consumed'],
    limitation: 'This is a repeated jump-shaped damage response, not a measured knockback reduction or proof of automated input.',
    syntheticCheckOnlyNotAccuracyData: true };
fs.writeFileSync(path.join(base, 'TRAJECTORY_PROTOCOL_ADDENDUM.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
