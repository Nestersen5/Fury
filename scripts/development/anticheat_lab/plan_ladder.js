'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
const { ladder } = require('./pilot_legit_ladder');
const pairs = [];
for (const split of ['calibration', 'evaluation']) {
    const rng = new JavaRandom(split === 'calibration' ? 771921 : 837711);
    for (let index = 0; index < 50; index++) {
        const seed = Number(BigInt(rng.nextInt()) & 0x7fffffffn);
        pairs.push([false, true].map(known => {
            const scenario = `legit_ladder_${known ? 'blockchange' : 'preexisting'}`;
            return { id: `${scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`, scenario, split, known, seed, index,
                startY: 64 + index % 3, episodes: 4, climbTicks: 3 + index % 2, phase: index % 3,
                holdMs: [400, 600, 800, 1100, 1500][index % 5], attackEveryTicks: [2, 3, 5][index % 3], pitch: [-30, 0, 30][index % 3],
                conditions: profiles[split][Math.floor(index / 10)] };
        }));
    }
}
const order = new JavaRandom(552211);
for (let i = pairs.length - 1; i > 0; i--) { const j = order.nextInt(i + 1); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
const plan = { schema: 1, name: 'ladder-v1', createdAt: new Date().toISOString(), requestedPerScenario: 100,
    calibrationPerScenario: 50, evaluationPerScenario: 50, setup: { preObserverCommands: ladder },
    workerPolicy: 'Use exactly two workers: worker0 pre-existing ladders only, worker1 later block updates only. This prevents environment knowledge leaking between scenario types.',
    limitations: ['Legal scripted ladder movement/sneak/empty-click inputs, not a human-population false-positive rate.',
        'Expanded regression plan after diagnosis with separate pilots. Evaluation conditions/seeds remain unused for tuning.',
        'Pre-existing ladder blocks are in chunks omitted by compact recordings; sneak metadata supplies a conservative ambiguity guard.'], trials: pairs.flat() };
const file = path.resolve(process.argv[2]); fs.mkdirSync(path.dirname(file), { recursive: true });
const data = JSON.stringify(plan, null, 2) + '\n'; fs.writeFileSync(file, data, { flag: 'wx' });
console.log(JSON.stringify({ file, trials: plan.trials.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }));
