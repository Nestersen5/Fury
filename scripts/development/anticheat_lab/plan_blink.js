'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
const variants = [];
for (const type of ['movement', 'all']) for (const direction of ['outgoing', 'both']) for (const autoSend of [false, true])
    variants.push({ scenario: `blink_${type}_${direction}_${autoSend ? 'auto' : 'manual'}`, type, direction, autoSend, enabled: true });
variants.push({ scenario: 'legit_jumpcombat', type: 'all', direction: 'outgoing', autoSend: false, enabled: false });
const trials = [];
for (const [v, variant] of variants.entries()) for (const split of ['calibration', 'evaluation']) {
    const rng = new JavaRandom(443223 + v * 773 + (split === 'evaluation' ? 93871 : 0));
    for (let index = 0; index < 50; index++) trials.push({
        id: `${variant.scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`, ...variant,
        split, index, seed: Number(BigInt(rng.nextInt()) & 0x7fffffffn), threshold: [0, 1, 20, 50, 100][index % 5],
        freezeAfterTicks: [1, 3, 5, 8, 12][Math.floor(index / 5) % 5], holdMs: [350, 600, 1000, 1500, 2200][index % 5],
        episodes: 3, releaseMs: [400, 650, 900][index % 3], attackEveryTicks: [2, 3, 4, 5, 6][index % 5],
        conditions: profiles[split][Math.floor(index / 10)]
    });
}
const order = new JavaRandom(928421);
for (let i = trials.length - 1; i > 0; i--) { const j = order.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
const plan = { schema: 1, name: 'blink-v1', createdAt: new Date().toISOString(), requestedPerScenario: 100,
    calibrationPerScenario: 50, evaluationPerScenario: 50,
    limitations: ['No module named Stasis was found. Blink is an explicitly identified source candidate, not verified name equivalence.',
        'Threshold one, short holds and grounded entry can produce no observer-visible freeze; preserve these boundaries.',
        'Scripted ordinary crosshair tracking/attack inputs and jumps are shared fixture controls.',
        'All-packet buffering may be observationally indistinguishable from legitimate transport stalls.',
        'No original native packet dispatcher executed. Local decoded callbacks implement ordered queues.'], trials };
const file = path.resolve(process.argv[2]); fs.mkdirSync(path.dirname(file), { recursive: true });
const data = JSON.stringify(plan, null, 2) + '\n'; fs.writeFileSync(file, data, { flag: 'wx' });
console.log(JSON.stringify({ file, trials: trials.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }));
