'use strict';

const assert = require('assert');
const { extractFeatures } = require('../../src/recorder/featureExtraction.js');

const ID = 5;
const records = [];
records.push({ k: 'header', t: 0, player: 'Bridger', label: 'legit_bridge_straight', source: 'replay' });
// Player starts at (0, 65, 0).
records.push({ k: 'snap', t: 0, id: ID, name: 'Bridger', x: 0, y: 65, z: 0 });

// Legit straight bridge: 8 blocks over ~2.1s, advancing +1 x per 300ms.
// mv deltas are 1.8 fixed-point (1/32 block), so +1 block = dx 32.
for (let i = 0; i < 8; i++) {
    const t = 1000 + i * 300;
    records.push({ k: 'mv', t, id: ID, dx: 32, dy: 0, dz: 0, g: true });
    records.push({ k: 'blk', t, x: i + 1, y: 64, z: 0, b: 35 });
    records.push({ k: 'anim', t, id: ID, a: 0 });
}

// Anomaly: teleport high up, then clutch-place 8 blocks in ~0.8s while
// free-falling in place - a raw burst FASTER than the bridge, but not
// bridging. tp coords are fixed-point (x32).
records.push({ k: 'tp', t: 10000, id: ID, x: 50 * 32, y: 80 * 32, z: 0, yaw: 0, pitch: 0, g: false });
for (let i = 0; i < 8; i++) {
    const t = 10100 + i * 100;
    records.push({ k: 'mv', t, id: ID, dx: 0, dy: -32, dz: 0, g: false }); // falling 1 block per step
    records.push({ k: 'blk', t, x: 50, y: 78 - i, z: 0, b: 35 });
}

const { scaffold, cps } = extractFeatures(records, new Set([ID]));

// All 16 placements are near the player and get attributed.
assert.strictEqual(scaffold.attributedPlacements, 16);

// The raw max burst is the falling clutch (8 blocks in 0.8s)...
assert.strictEqual(scaffold.rawBest2sPlacements, 8);
// ...but the BRIDGING burst excludes it: best qualifying window is the
// 7 blocks that fit in a 2s window of the actual bridge.
assert.strictEqual(scaffold.best2sPlacements, 7, 'falling clutch must not count as bridging');
assert.strictEqual(scaffold.anomalousBurstExcluded, true);

// Burst speed comes from the bridge window (~3.3 blocks/s), not the fall.
assert.ok(scaffold.burstHorizontalSpeed > 2.5 && scaffold.burstHorizontalSpeed < 4.5,
    `burst speed should reflect the bridge, got ${scaffold.burstHorizontalSpeed}`);

// A tower/wall spam (placements without travel) also must not qualify.
const towerRecords = [
    { k: 'header', t: 0, player: 'Tower', label: 'x', source: 'live' },
    { k: 'snap', t: 0, id: ID, name: 'Tower', x: 0, y: 65, z: 0 }
];
for (let i = 0; i < 6; i++) {
    const t = 1000 + i * 200;
    towerRecords.push({ k: 'mv', t, id: ID, dx: 0, dy: 0, dz: 0, g: true });
    towerRecords.push({ k: 'blk', t, x: 1, y: 64, z: 0, b: 35 });
}
const tower = extractFeatures(towerRecords, new Set([ID])).scaffold;
assert.strictEqual(tower.best2sPlacements, 0, 'stationary wall spam must not count as bridging');
assert.strictEqual(tower.rawBest2sPlacements, 6);

// CPS features still see the bridge swings.
assert.strictEqual(cps.swings, 8);

console.log('Feature extraction tests passed.');
