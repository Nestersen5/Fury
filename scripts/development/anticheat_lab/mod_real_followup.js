'use strict';
// Independent fresh seeds/conditions for calibration and evaluation. Reuses the
// audited input routines in copied runners without modifying those runners.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const part = process.argv[2];
assert(['autoblock', 'scaffold'].includes(part));
const sourceFile = path.join(__dirname, part === 'scaffold' ? 'mod_real_scaffold_full.js' : 'mod_real_autoblock_corrections.js');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
if (part === 'scaffold') {
    source = require('./mod_real_scaffold_arena_adapter')(source);
    source = require('./mod_real_scaffold_context_adapter')(source);
    source = require('./adapt_scaffold_careful_input')(source);
}
else source = require('./mod_real_combat_context_adapter')(source);
function replaceOnce(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Follow-up adaptation anchor changed: ' + before.slice(0, 60));
    source = source.replace(before, after);
}
if (part === 'scaffold') replaceOnce('await delay(35 + Math.floor(rand()*10));',
    'await delay(80 + Math.floor(rand()*50));');
replaceOnce("const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');",
    "const outputRoot = path.join(root, 'output/anticheat-lab/mod-real/improvements/fresh');");
replaceOnce("const gameDir = path.join(outputRoot, 'client-game');",
    "const gameDir = path.join(root, 'output/anticheat-lab/mod-real/client-game/followup');");
// Hash validation still refers to the original mod-build manifest.
replaceOnce("path.join(outputRoot, 'mod-build-before.json')",
    "path.join(root, 'output/anticheat-lab/mod-real/mod-build-before.json')");
replaceOnce('const campaignSeed = 29092026;', 'const campaignSeed = 30092926;');
const start = source.indexOf('const counts = {'), end = source.indexOf('\nfunction checkHashes()', start);
assert(start > 0 && end > start);
source = source.slice(0, start) + `const counts = {
    autoblock: { C1: 4, C2: 4, C3: 4, C4: 4, C5: 4, C6: 4, L1: 4, L2: 4, L3: 4, L4: 4, L5: 4, L6: 4 },
    scaffold: { S1: 4, S2: 4, S3: 4, S4: 4, S5: 4, L7: 4, L8: 4, L9: 4, L10: 4, L11: 4 }
};
` + source.slice(end);
replaceOnce("const slow = scenarioId === 'L6' || number % 5 === 0;",
    "const slow = scenarioId === 'L6' || number % 2 === 0;");
replaceOnce('trials.push({ id, scenarioId, number, part, enabled, settings, seed, transport,',
    "trials.push({ id, scenarioId, number, part, enabled, settings, seed, transport, split: number <= 2 ? 'calibration' : 'evaluation',");
replaceOnce('        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:',
    `        adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})), carefulInputSha256: ${part === 'scaffold' ? `sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'adapt_scaffold_careful_input.js'))}))` : 'null'}, contextAdapterSha256: ${part === 'scaffold' ? `sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'mod_real_scaffold_context_adapter.js'))}))` : 'null'}, protocolAdapterSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, part === 'scaffold' ? 'mod_real_scaffold_arena_adapter.js' : 'mod_real_combat_context_adapter.js'))})), harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:`);
replaceOnce('    const plan = frozenPlan(part);', `    const plan = frozenPlan(part);
    if (part === 'scaffold') for (const spec of plan.trials) if (['S1','S2'].includes(spec.scenarioId))
        spec.settings.Scaffold['Sneak delay'].high = Math.min(200, spec.settings.Scaffold['Sneak delay'].high);`);
replaceOnce('    const selected = plan.trials.filter(spec => force ? spec.id === force :',
    "    const requestedSplit = args.find(arg => arg.startsWith('--split='))?.split('=')[1];\n    assert(!requestedSplit || ['calibration','evaluation'].includes(requestedSplit));\n    const selected = plan.trials.filter(spec => !requestedSplit || spec.split === requestedSplit).filter(spec => force ? spec.id === force :");
source = source.replace("if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });",
    'module.exports = { main, frozenPlan };');
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, sourceFile);
if (process.argv.includes('--plan-only')) {
    const plan = compiled.exports.frozenPlan(part);
    console.log(JSON.stringify({ part, planned: plan.trials.length,
        calibration: plan.trials.filter(t => t.split === 'calibration').length,
        evaluation: plan.trials.filter(t => t.split === 'evaluation').length }));
} else compiled.exports.main().catch(error => { console.error(error); process.exitCode = 1; });
