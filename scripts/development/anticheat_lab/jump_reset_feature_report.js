'use strict';
const fs = require('fs'), path = require('path');
const { createJumpResetFeatures } = require('./jump_reset_observer_features');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/jump-reset');
const args = process.argv.slice(2), pilot = args.includes('--pilot');
const plan = JSON.parse(fs.readFileSync(path.join(base, pilot ? 'PILOT_PLAN.json' : 'FULL_PLAN.json')));
const split = args.find(a => a.startsWith('--split='))?.split('=')[1];
const result = [];
for (const spec of plan.trials.filter(s => !split || s.split === split)) {
    for (const runName of fs.readdirSync(base).filter(n => n.startsWith(pilot ? 'pilot-' : 'full-')).sort()) {
        const directory = path.join(base, runName, spec.id); if (!fs.existsSync(directory)) continue;
        let selected = false;
        for (const attempt of fs.readdirSync(directory).sort()) {
            const truthFile = path.join(directory, attempt, 'ground-truth.json'); if (!fs.existsSync(truthFile)) continue;
            const truth = JSON.parse(fs.readFileSync(truthFile));
            if (pilot && ['L13', 'L14', 'L15'].includes(spec.scenarioId) && truth.inputProtocol !== 'actor-view-controls-v2') continue;
            if (!truth.automatedValid && !(pilot && args.includes('--include-invalid'))) continue;
            const records = fs.readFileSync(path.join(base, runName, truth.recorderFile), 'utf8')
                .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
            const opportunities = [];
            const extractor = createJumpResetFeatures({ onOpportunity: event => {
                if (event.entityId === truth.actorId && event.velocityAt >= truth.controlStartAt &&
                    event.velocityAt <= truth.activeEndAt) opportunities.push(event);
            } });
            for (const record of records) extractor.observeRecord(record);
            extractor.flush(records.at(-1).t);
            const clean = opportunities.filter(e => e.reason === 'landed' && e.damaged && e.samples >= 4 &&
                e.maxStep <= 2 && Math.abs(e.landingHeightChange) <= 1 / 32);
            result.push({ id: spec.id, scenarioId: spec.scenarioId, split: spec.split, effectExpected: spec.effectExpected,
                directory: path.join(directory, attempt), automatedValid: truth.automatedValid, opportunities, clean,
                excess: clean.map(e => Number(e.apexExcess.toFixed(5))) });
            selected = true; break;
        }
        if (selected) break;
    }
}
const output = path.join(base, `features-${pilot ? 'pilot' : split || 'all'}-${Date.now()}.json`);
fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), rows: result }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, rows: result.length, byScenario: Object.fromEntries(plan.trials.map(s => s.scenarioId)
    .filter((s, i, a) => a.indexOf(s) === i).map(s => [s, result.filter(r => r.scenarioId === s).map(r =>
        ({ id: r.id, opportunities: r.opportunities.length, clean: r.clean.length, excess: r.excess }))])) }, null, 2));
