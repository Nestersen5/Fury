'use strict';
// Re-run every L10 control with explicit missed clicks. Keep all older captures.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const file = path.join(__dirname, 'mod_real_scaffold_full.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
for (const name of ['mod_real_scaffold_arena_adapter', 'mod_real_scaffold_context_adapter', 'adapt_scaffold_careful_input']) source = require('./' + name)(source);
function replace(before, after) { assert.strictEqual(source.split(before).length, 2, before); source = source.replace(before, after); }
const pilot = process.argv.includes('--careful-pilot');
if (pilot) {
    replace("const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');", "const outputRoot = path.join(root, 'output/anticheat-lab/mod-real/careful-pilots');");
    replace("path.join(outputRoot, 'mod-build-before.json')", "path.join(root, 'output/anticheat-lab/mod-real/mod-build-before.json')");
    replace("const gameDir = path.join(outputRoot, 'client-game');", "const gameDir = path.join(root, 'output/anticheat-lab/mod-real/client-game/careful-pilot');");
    replace('scenarioId: spec.scenarioId, pilot: false, seed, scenario: spec,', 'scenarioId: spec.scenarioId, pilot: true, seed, scenario: spec,');
}
replace('        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:', `        adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})),
        contextAdapterSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'mod_real_scaffold_context_adapter.js'))})),
        carefulInputSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'adapt_scaffold_careful_input.js'))})),
        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:`);
replace("if (fs.existsSync(truthFile) && JSON.parse(fs.readFileSync(truthFile)).automatedValid) completed.add(trialId);", "if (fs.existsSync(truthFile)) { const t = JSON.parse(fs.readFileSync(truthFile)); if (t.automatedValid && t.intentionalAirClicks?.length >= 3) completed.add(trialId); }");
replace('    const selected = plan.trials.filter(spec => force ? spec.id === force :', "    const selected = plan.trials.filter(spec => spec.scenarioId === 'L10').filter(spec => force ? spec.id === force :");
replace('        for (const spec of selected) {', "        for (const spec of selected) {\n            if (fs.existsSync(path.join(root, 'output/anticheat-lab/mod-real/overnight/STOP_AFTER_TRIAL'))) break;");
replace('                if (result.automatedValid) break;', "                if (result.automatedValid || fs.existsSync(path.join(root, 'output/anticheat-lab/mod-real/overnight/STOP_AFTER_TRIAL'))) break;");
replace('if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });', 'module.exports = { main, frozenPlan };');
const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
if (process.argv.includes('--plan-only')) console.log(JSON.stringify({ controls: compiled.exports.frozenPlan('scaffold').trials.filter(t => t.scenarioId === 'L10').map(t => t.id), pilot }));
else compiled.exports.main().catch(error => { console.error(error); process.exitCode = 1; });
