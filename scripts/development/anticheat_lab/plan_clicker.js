'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JavaRandom } = require('./random');
const { profiles } = require('./plan_timer');
function makePlan() {
    const trials = [], modes = ['normal', 'extra', 'extra+'], cps = [[1, 1], [6, 13], [14, 20], [19, 20], [20, 20]];
    for (const scenario of ['clicker_normal', 'clicker_extra', 'clicker_extraplus', 'legit_clicking']) for (const split of ['calibration', 'evaluation']) {
        const scenarioIndex = ['clicker_normal', 'clicker_extra', 'clicker_extraplus', 'legit_clicking'].indexOf(scenario);
        const rng = new JavaRandom(621119 + scenarioIndex * 1009 + (split === 'evaluation' ? 100003 : 0));
        for (let index = 0; index < 50; index++) {
            const enabled = scenarioIndex < 3;
            trials.push({ id: `${scenario}_${split === 'calibration' ? 'c' : 'e'}${String(index).padStart(3, '0')}`,
                scenario, split, seed: Number(BigInt(rng.nextInt()) & 0x7fffffffn), index,
                durationMs: index === 49 ? 100000 : [6000, 8000, 10000][index % 3],
                enabled, mode: enabled ? modes[scenarioIndex] : null, cps: cps[index % 5],
                jitter: enabled && index % 4 === 1, sensitivity: [0.25, 0.5, 0.75][index % 3],
                holdToClick: index % 7 !== 0, releaseActivation: index % 6 === 2,
                trigger: enabled && index % 5 === 3, targetLoss: index % 5 === 3,
                limitItems: index % 8 === 5,
                conditions: profiles[split][Math.floor(index / 10)] });
        }
    }
    const order = new JavaRandom(8142189);
    for (let i = trials.length - 1; i > 0; i--) { const j = order.nextInt(i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
    return { schema: 1, name: 'clicker-v1', createdAt: new Date().toISOString(), requestedPerScenario: 100,
        calibrationPerScenario: 50, evaluationPerScenario: 50,
        limitations: ['100 varied trials per mode/control, not per Cartesian setting combination.',
            'Long cases exercise fatigue and 30–90 second target drift; short cases cannot establish long-session behavior.',
            'Scripted legitimate input controls are not a representative human sample.',
            'GUI and block breaking are unsupported in this stationary-combat scenario.'], trials };
}
if (require.main === module) {
    const file = path.resolve(process.argv[2]); fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = JSON.stringify(makePlan(), null, 2) + '\n'; fs.writeFileSync(file, data, { flag: 'wx' });
    console.log(JSON.stringify({ file, sha256: crypto.createHash('sha256').update(data).digest('hex'), trials: 400 }));
}
module.exports = { makePlan };
