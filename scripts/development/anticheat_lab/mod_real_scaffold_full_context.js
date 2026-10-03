'use strict';
// Correct the original study's observer position context, retaining every
// superseded recording. Same frozen scenario IDs/seeds/settings and detectors.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const sourceFile = path.join(__dirname, 'mod_real_scaffold_full.js');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
source = require('./mod_real_scaffold_arena_adapter')(source);
source = require('./mod_real_scaffold_context_adapter')(source);
const pilot = process.argv.includes('--context-pilot');
if (pilot) {
    source = source.replace("const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');",
        "const outputRoot = path.join(root, 'output/anticheat-lab/mod-real/context-pilots');");
    source = source.replace("path.join(outputRoot, 'mod-build-before.json')",
        "path.join(root, 'output/anticheat-lab/mod-real/mod-build-before.json')");
    source = source.replace('scenarioId: spec.scenarioId, pilot: false, seed, scenario: spec,',
        'scenarioId: spec.scenarioId, pilot: true, seed, scenario: spec,');
}
const anchor = '        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:';
assert.strictEqual(source.split(anchor).length, 2);
source = source.replace(anchor, `        adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})),
        arenaAdapterSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'mod_real_scaffold_arena_adapter.js'))})),
        contextAdapterSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'mod_real_scaffold_context_adapter.js'))})),
        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:`);
source = source.replace('        for (const spec of selected) {',
    "        for (const spec of selected) {\n            if (fs.existsSync(path.join(outputRoot, 'overnight/STOP_AFTER_TRIAL'))) break;");
source = source.replace('                if (result.automatedValid) break;',
    "                if (result.automatedValid || fs.existsSync(path.join(outputRoot, 'overnight/STOP_AFTER_TRIAL'))) break;");
const cli = 'if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });';
assert(source.includes(cli)); source = source.replace(cli, 'module.exports = { main, frozenPlan };');
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, sourceFile);
if (process.argv.includes('--plan-only')) console.log(JSON.stringify({
    planned: compiled.exports.frozenPlan('scaffold').trials.length, positionContext: 'enabled-position-v1' }));
else compiled.exports.main().catch(error => { console.error(error); process.exitCode = 1; });
