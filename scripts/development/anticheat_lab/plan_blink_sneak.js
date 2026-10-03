'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
const trials = [];
for (const [s, scenario] of ['blink_sneaking_movement', 'legit_jumpcombat_sneaking'].entries()) {
    for (const split of ['calibration', 'evaluation']) {
        const rng = new JavaRandom(6689421 + s * 1231 + (split === 'evaluation' ? 991891 : 0));
        for (let index = 0; index < 50; index++) trials.push({
            id: `${scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`,
            scenario, split, index, seed: Number(BigInt(rng.nextInt()) & 0x7fffffffn),
            enabled: s === 0, sneak: true, type: 'movement', direction: 'outgoing', autoSend: false, threshold: 50,
            episodes: 3, freezeAfterTicks: [1, 3, 5, 8, 12][index % 5], holdMs: [350, 600, 1000, 1500, 2200][Math.floor(index / 5) % 5],
            releaseMs: [400, 650, 900][index % 3], attackEveryTicks: [2, 3, 5][index % 3],
            conditions: profiles[split][Math.floor(index / 10)]
        });
    }
}
const rng = new JavaRandom(76819421);
for (let i = trials.length - 1; i > 0; i--) { const j = rng.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
const plan = { schema: 1, name: 'blink-sneak-v1', requestedPerScenario: 100, calibrationPerScenario: 50,
    evaluationPerScenario: 50, createdAt: new Date().toISOString(),
    purpose: 'Measure the explicit sneaking-Stasis detection tradeoff required to avoid indistinguishable preexisting-ladder false positives.',
    limitations: ['Independent Blink implementation only, not verified original Stasis identity.',
        'Scripted legal controls are not a representative human population. Other Blink type/direction/auto combinations are covered by the separate primary plan.'], trials };
const file = path.resolve(process.argv[2]), bytes = JSON.stringify(plan, null, 2) + '\n';
fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
console.log(JSON.stringify({ file, trials: trials.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
