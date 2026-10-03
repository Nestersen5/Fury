'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab } = require('./lab');
const { blinkPilot } = require('./pilot_blink');
async function main() {
    const [directory, planFile] = process.argv.slice(2);
    const plan = JSON.parse(fs.readFileSync(planFile));
    const ids = ['legit_jumpcombat_c028', 'legit_jumpcombat_c022', 'blink_movement_outgoing_manual_c003'];
    const lab = new Lab(directory), results = [];
    try {
        await lab.start();
        for (const [index, id] of ids.entries()) {
            const original = plan.trials.find(s => s.id === id); assert.strictEqual(original.split, 'calibration');
            const spec = { ...original, campaign: true, id: `grounded_blink_probe_${index}` }; delete spec.split;
            const result = await blinkPilot(lab, spec, index);
            assert(Object.values(result.validity).every(Boolean));
            result.kind = 'Fresh live verification pilot, excluded from campaign counts'; result.referenceCalibrationId = id;
            fs.writeFileSync(path.join(directory, `${spec.id}.ground-truth.json`), JSON.stringify(result, null, 2)+'\n', {flag:'wx'});
            results.push({ id, validity: result.validity, actorId: result.actorId, observerSwings: result.observerSwings });
        }
        assert.deepStrictEqual(lab.errors, []);
        fs.writeFileSync(path.join(directory, 'pilot-result.json'), JSON.stringify(results, null, 2)+'\n', {flag:'wx'});
        console.log(JSON.stringify(results));
    } finally { await lab.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
