'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
const trials = [], scenarios = ['fastplace_all', 'fastplace_blocks', 'fastplace_projectiles', 'legit_heldplace', 'legit_manualplace'];
for (const [s, scenario] of scenarios.entries()) for (const split of ['calibration', 'evaluation']) {
    const rng = new JavaRandom(192554 + s * 3389 + (split === 'evaluation' ? 64421 : 0));
    for (let index = 0; index < 50; index++) trials.push({
        id: `${scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`,
        scenario, split, seed: Number(BigInt(rng.nextInt()) & 0x7fffffffn), index,
        durationMs: [4000, 5000, 6000][index % 3], enabled: scenario.startsWith('fastplace'),
        mode: scenario.startsWith('fastplace') ? scenario.slice(10) : 'all', delay: index % 5,
        kind: Math.floor(index / 5) % 2 ? 'projectile' : 'block',
        manualCps: scenario === 'legit_manualplace' ? [4, 8, 12, 16, 20][index % 5] : 0,
        noInput: index === 49, releaseWindow: index % 7 === 0, useClaimed: index === 17,
        conditions: profiles[split][Math.floor(index / 10)]
    });
}
const order = new JavaRandom(889412);
for (let i = trials.length - 1; i > 0; i--) { const j = order.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
const plan = { schema: 1, name: 'fastplace-v1', createdAt: new Date().toISOString(), requestedPerScenario: 100,
    calibrationPerScenario: 50, evaluationPerScenario: 50,
    limitations: ['Full stone placement and snowball use only; other shapes/items are unsupported.',
        'Aim and ordinary hotbar selection are common scripted fixture inputs, not additional cheat modules.',
        'Manual clicking controls show vanilla permitted high-rate use; they do not model a human population.',
        'No-input, delay-four, wrong-filter and claimed-use cases have no expected FastPlace acceleration.',
        'Object spawns are present in raw observer capture; current Fury compact recordings omit them.'], trials };
const file = path.resolve(process.argv[2]); fs.mkdirSync(path.dirname(file), { recursive: true });
const data = JSON.stringify(plan, null, 2) + '\n'; fs.writeFileSync(file, data, { flag: 'wx' });
console.log(JSON.stringify({ file, trials: trials.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }));
