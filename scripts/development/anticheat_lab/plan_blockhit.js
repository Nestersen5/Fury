'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
function makePlan() {
    const trials = [], modes = ['manual', 'predict', 'auto', 'auto_paired', 'lag', 'legit'];
    for (const [m, mode] of modes.entries()) for (const split of ['calibration', 'evaluation']) {
        const rng = new JavaRandom(571111 + m * 2111 + (split === 'evaluation' ? 99997 : 0));
        for (let index = 0; index < 50; index++) {
            const scenario = mode === 'legit' ? 'legit_blockhit' : 'blockhit_' + mode;
            trials.push({ id: `${scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`,
                scenario, split, mode, seed: Number(BigInt(rng.nextInt()) & 0x7fffffffn), index,
                durationMs: [6000, 8000, 10000][index % 3], cps: [4, 6, 8, 10, 12][index % 5],
                requireMouse: index % 3 !== 0, physicalUse: index % 7 !== 0,
                chance: [[0, 0], [10, 20], [50, 50], [70, 90], [100, 100]][index % 5],
                lagDelay: [[0, 0], [1, 49], [50, 100], [100, 250], [500, 500]][index % 5],
                targetDistance: index % 11 === 0 ? 0 : index % 3 === 0 ? 3 : 5,
                opponentActive: index % 4 === 2, opponentIntervalMs: [650, 850, 1100][index % 3],
                conditions: profiles[split][Math.floor(index / 10)] });
        }
    }
    const order = new JavaRandom(8821421);
    for (let i = trials.length - 1; i > 0; i--) { const j = order.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
    return { schema: 1, name: 'blockhit-v1', createdAt: new Date().toISOString(), requestedPerScenario: 100,
        calibrationPerScenario: 50, evaluationPerScenario: 50,
        limitations: ['Standalone Auto has no automatic block trigger in the visible Java graph; it is a no-effect scenario.',
            'Auto paired explicitly enables AutoClicker Normal; compare against clicker-only controls separately.',
            'Mouse-held activation starts with the game key cleared, a disclosed native-boundary initial condition.',
            'Target distance uses a center-distance fixture approximation; near-body reach/FOV boundaries require separate tests.',
            'Zero chance, absent activation and zero target-distance are intentional no-effect boundaries; report them separately.',
            'E=0 follows visible initialization; no original native code executed.'], trials };
}
if (require.main === module) {
    const file = path.resolve(process.argv[2]); fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = JSON.stringify(makePlan(), null, 2) + '\n'; fs.writeFileSync(file, data, { flag: 'wx' });
    console.log(JSON.stringify({ file, sha256: crypto.createHash('sha256').update(data).digest('hex'), trials: 600 }));
}
module.exports = { makePlan };
