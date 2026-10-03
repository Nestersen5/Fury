'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
const trials = [];
for (const split of ['calibration', 'evaluation']) {
    const rng = new JavaRandom(split === 'calibration' ? 6918421 : 71718421);
    for (let index = 0; index < 50; index++) trials.push({
        id: `legit_blockhit_defensive_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`,
        scenario: 'legit_blockhit_defensive', split, index, seed: Number(BigInt(rng.nextInt()) & 0x7fffffffn),
        mode: 'legit', durationMs: 12000, defensiveHoldMs: [200, 250, 450, 750, 950][index % 5],
        defensiveReleaseMs: [50, 100, 150][Math.floor(index / 5) % 3],
        conditions: index >= 45 ? { actor: {}, observer: {}, server: { minimumMs: split === 'calibration' ? 100 : 110, jitterMs: 0 } }
            : profiles[split][Math.floor(index / 10)]
    });
}
const rng = new JavaRandom(62168421);
for (let i = trials.length - 1; i > 0; i--) { const j = rng.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
const plan = { schema: 1, name: 'defensive-blockhit-v1', requestedPerScenario: 100, calibrationPerScenario: 50,
    evaluationPerScenario: 50, createdAt: new Date().toISOString(),
    purpose: 'Test legal long blocks with release before attack/re-block, including server-tick aliasing and client/observer stalls.',
    limitations: ['Scripted legitimate key inputs, not a human-population false-positive estimate.',
        'All attacks pass through the ordinary vanilla sampled-input model; no packet buffer or cheat controller enabled.'], trials };
const file = path.resolve(process.argv[2]), bytes = JSON.stringify(plan, null, 2) + '\n';
fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
console.log(JSON.stringify({ file, trials: trials.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
