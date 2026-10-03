'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const root = path.resolve(__dirname, '../../..');
const profiles = {
    calibration: [
        { actor: {}, observer: {}, server: {} },
        { actor: { latencyMs: 40, jitterMs: 10 }, observer: { latencyMs: 20, jitterMs: 5 }, server: {} },
        { actor: { latencyMs: 120, jitterMs: 30 }, observer: { latencyMs: 30, jitterMs: 10 }, server: { minimumMs: 55, jitterMs: 10 } },
        { actor: {}, observer: { latencyMs: 50, jitterMs: 20 }, server: { minimumMs: 75, jitterMs: 20 } },
        { actor: { latencyMs: 30, jitterMs: 15, stallEveryMs: 1700, stallMs: 300 }, observer: {}, server: {} }
    ],
    evaluation: [
        { actor: { latencyMs: 75, jitterMs: 25 }, observer: { latencyMs: 55, jitterMs: 20 }, server: { minimumMs: 60, jitterMs: 18 } },
        { actor: { latencyMs: 180, jitterMs: 60 }, observer: { latencyMs: 100, jitterMs: 40 }, server: { minimumMs: 50, jitterMs: 20 } },
        { actor: { latencyMs: 15, jitterMs: 10, stallEveryMs: 2300, stallMs: 450 }, observer: { latencyMs: 35, jitterMs: 12 }, server: { minimumMs: 65, jitterMs: 15 } },
        { actor: { latencyMs: 10, jitterMs: 8 }, observer: {}, server: { minimumMs: 90, jitterMs: 10 } },
        { actor: {}, observer: { latencyMs: 45, jitterMs: 25, stallEveryMs: 1900, stallMs: 250 }, server: {} }
    ]
};
function makePlan() {
    const trials = [], speeds = [0.1, 0.5, 0.99, 1, 1.01, 1.07, 1.15, 1.5, 1.75, 2];
    const movement = ['walk', 'sprint', 'jump', 'sprint_jump', 'sneak'];
    for (const scenario of ['timer', 'legit_movement']) for (const split of ['calibration', 'evaluation']) {
        const rng = new JavaRandom(scenario === 'timer' ? (split === 'calibration' ? 42101 : 98171) : (split === 'calibration' ? 72111 : 89199));
        for (let index = 0; index < 50; index++) {
            const variant = Math.floor(index / speeds.length);
            const seed = BigInt(rng.nextInt()) & 0x7fffffffn;
            trials.push({ id: `${scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`,
                scenario, split, seed: Number(seed), index, durationMs: [6000, 8000, 10000][index % 3],
                enabled: scenario === 'timer', speed: scenario === 'timer' ? speeds[index % speeds.length] : 1,
                movement: movement[variant], potion: index % 10 === 4 ? { id: 1, amplifier: 0 } : index % 10 === 7 ? { id: 1, amplifier: 3 } : index % 10 === 8 ? { id: 2, amplifier: 0 } : null,
                conditions: profiles[split][variant] });
        }
    }
    // Deterministic execution shuffle avoids grouping all high-speed/tick settings.
    const order = new JavaRandom(189421);
    for (let i = trials.length - 1; i > 0; i--) { const j = order.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
    return { schema: 1, createdAt: new Date().toISOString(), name: 'timer-v1',
        requestedPerScenario: 100, calibrationPerScenario: 50, evaluationPerScenario: 50,
        purpose: 'Frozen before production detector edits; fresh seed and network/tick combinations held out.',
        limitations: ['100 varied trials per scenario, not 100 for every parameter combination.',
            'Scripted legitimate controls establish permitted mechanics, not a human-population false-positive rate.',
            'Speed 1 is an enabled no-op boundary and must be reported separately from observable timer effects.',
            'Monotonic headless tick scheduling; collision physics from pinned trusted prismarine-physics.'], trials };
}
if (require.main === module) {
    const file = path.resolve(process.argv[2] || path.join(root, `output/anticheat-lab/plans/timer-v1-${Date.now()}.json`));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = JSON.stringify(makePlan(), null, 2) + '\n';
    fs.writeFileSync(file, data, { flag: 'wx' });
    console.log(JSON.stringify({ file, sha256: crypto.createHash('sha256').update(data).digest('hex'), trials: 200 }));
}
module.exports = { makePlan, profiles };
