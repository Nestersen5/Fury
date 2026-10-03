'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
const scenarios = ['scaffold_legit', 'scaffold_godbridge_cardinal', 'scaffold_godbridge_turn', 'legit_sneakbridge'], trials = [];
for (const [s, scenario] of scenarios.entries()) for (const split of ['calibration', 'evaluation']) {
    const rng = new JavaRandom(231189 + s * 1441 + (split === 'evaluation' ? 181921 : 0));
    for (let index = 0; index < 50; index++) {
        const delay = [[0, 0], [30, 30], [31, 31], [100, 200], [500, 500]][index % 5];
        const godbridge = scenario.includes('godbridge');
        trials.push({ id: `${scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`,
            scenario, split, seed: Number(BigInt(rng.nextInt()) & 0x7fffffffn), index,
            mode: godbridge ? 'godbridge' : 'legit', enabled: scenario !== 'legit_sneakbridge',
            durationMs: [6000, 7000, 8000][index % 3],
            ...(godbridge ? { initialDirection: [6, 8, 7, 5][index % 4], activationBlocks: 1 + Math.floor(index / 4) % 4,
                turn: scenario.endsWith('_turn') ? (Math.floor(index / 4) % 2 ? 'right' : 'left') : null,
                sensitivity: [0.25, 0.5, 0.75][index % 3], stackCount: 64, secondStackCount: [16, 32, 64][index % 3], renderFrameMs: [4, 8, 16][index % 3] }
                : { minDelay: delay[0], maxDelay: delay[1], requireSneak: index % 3 === 0,
                    physicalSneak: scenario === 'legit_sneakbridge' || index % 3 === 0 }),
            pitchCheck: index % 4 === 0, pitchThreshold: [0, 45, 75][index % 3],
            conditions: profiles[split][Math.floor(index / 10)] });
    }
}
const order = new JavaRandom(783421);
for (let i = trials.length - 1; i > 0; i--) { const j = order.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
const plan = { schema: 1, name: 'scaffold-v1', createdAt: new Date().toISOString(), requestedPerScenario: 100,
    calibrationPerScenario: 50, evaluationPerScenario: 50,
    limitations: ['Telly is excluded pending resolution of falls in corrected real-gameplay fidelity pilots.',
        'Only full stone placement is supported. Blacklist/whitelist non-stone shapes, flying, GUI and ladder activation are not counted here.',
        'Legit and steady-sneak controls use a scripted ordinary aim/held-use fixture on +X routes.',
        'GodBridge manual activation uses ordinary scripted inputs; automatic movement/rotation then follow the independent source model.',
        'Turn trials cover press/release transitions into diagonal routes; inspect recorded direction transitions rather than assume successful turns.',
        'Headless collision integration differs from original vanilla; exact original/native equivalence remains unverified.'], trials };
const file = path.resolve(process.argv[2]); fs.mkdirSync(path.dirname(file), { recursive: true });
const data = JSON.stringify(plan, null, 2) + '\n'; fs.writeFileSync(file, data, { flag: 'wx' });
console.log(JSON.stringify({ file, trials: trials.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }));
