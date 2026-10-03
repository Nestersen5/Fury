'use strict';
// Guard the requested default 100–200 ms range before any full captures. The
// original generic generator permits 240 ms; the stored Scaffold plan already
// used 100–200 ms, so its range-correction map is empty.
// Keep the original plan intact and record the exact, verdict-independent map.
// Restore diagonal/turn courses as well as the straight course, and remove
// floor layers under the air gap so a failed bridge actually falls into void.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const sourceFile = path.join(__dirname, 'mod_real_scaffold_full.js');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
source = require('./mod_real_scaffold_arena_adapter')(source);
function replaceOnce(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Scaffold adaptation anchor changed');
    source = source.replace(before, after);
}
replaceOnce('    const plan = frozenPlan(part);', `    const plan = frozenPlan(part);
    assert.strictEqual(part, 'scaffold');
    const corrections = [];
    for (const spec of plan.trials) if (['S1','S2'].includes(spec.scenarioId)) {
        const before = { ...spec.settings.Scaffold['Sneak delay'] };
        const after = { low: before.low, high: Math.min(200, before.high) };
        spec.settings.Scaffold['Sneak delay'] = after;
        if (before.high !== after.high) corrections.push({ id: spec.id, before, after });
    }
    const addendum = path.join(outputRoot, 'scaffold/DEFAULT_RANGE_ADDENDUM.json');
    if (!fs.existsSync(addendum)) fs.writeFileSync(addendum, JSON.stringify({
        createdAt: new Date().toISOString(), reason: 'Respect requested default 100–200 ms range',
        originalFrozenPlanUnchanged: true, orderAndSeedsUnchanged: true,
        decidedBeforeFullCaptures: true, detectorVerdictsUsed: false, corrections
    }, null, 2), { flag: 'wx' });
    if (args.includes('--plan-only')) { console.log(JSON.stringify({ planned: plan.trials.length, corrections })); return; }`);
replaceOnce('        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:',
    `        adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})), arenaAdapterSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'mod_real_scaffold_arena_adapter.js'))})), harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:`);
source = source.replace('if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });',
    'module.exports = { main };');
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, sourceFile);
compiled.exports.main().catch(error => { console.error(error); process.exitCode = 1; });
