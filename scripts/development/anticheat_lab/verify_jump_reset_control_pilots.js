'use strict';
// The corrected control pilots must pass the same observer/input/launch/HUD
// checks as full trials before the capture queue may start full Jump Reset play.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module'), crypto = require('crypto');
const file = path.join(__dirname, 'jump_reset_analysis.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
source = source.slice(0, source.indexOf("if (action === 'prepare-search')")) + '\nmodule.exports = { validate };\n';
function replace(before, after) { assert.strictEqual(source.split(before).length, 2, before); source = source.replace(before, after); }
replace("const planFile = path.join(base, 'FULL_PLAN.json'), plan = read(planFile);",
    "const planFile = path.join(base, 'PILOT_PLAN.json'), plan = read(planFile);\n    plan.trials = plan.trials.filter(s => ['L13','L14','L15'].includes(s.scenarioId));");
source = source.replaceAll('FULL_HUD_REVIEW.json', 'PILOT_HUD_REVIEW.json');
replace("fs.readdirSync(base).filter(n => /^full-\\d+$/.test(n)).sort()", "fs.readdirSync(base).filter(n => /^pilot-\\d+$/.test(n)).sort()");
replace('JSON.stringify(truth.scenario) === JSON.stringify(spec) && !truth.pilot,',
    'JSON.stringify(truth.scenario) === JSON.stringify(spec) && truth.pilot === true,');
replace("write('FULL_EVIDENCE.json', evidence);", "write('CONTROL_PILOT_EVIDENCE.json', evidence);");
const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
const evidence = compiled.exports.validate();
assert(evidence.complete && evidence.valid === 3, 'Corrected control pilots require independent HUD and observer evidence');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/jump-reset');
const manifest = { validatedAt: new Date().toISOString(), protocol: 'actor-view-controls-v2',
    controls: evidence.rows.map(r => ({ id: r.id, trialDirectory: r.trialDirectory, groundTruthSha256: r.groundTruthSha256,
        observerSha256: r.observerSha256, recorderSha256: r.recorderSha256 })),
    evidenceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(base, 'CONTROL_PILOT_EVIDENCE.json'))).digest('hex'),
    checked: ['all modules OFF in manually inspected HUD', 'independent input schedule', 'focused successful injected inputs',
        'loopback isolated client launch', '12+ observed hurts', 'movement/swings', 'tick/relay logs', '22+ seconds active'],
    excludedFromFullResults: true };
if (!process.argv.includes('--check-only'))
    fs.writeFileSync(path.join(base, 'CONTROL_PROTOCOL_PILOTS_VALIDATED.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...manifest, captureGateReleased: !process.argv.includes('--check-only') }));
