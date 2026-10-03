'use strict';
// Preregistered negative boundary controls for movement-clock aliasing. All
// modules OFF; basic scripted inputs, not claims about average human behavior.
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('assert');
const sourceFile = path.join(__dirname, 'mod_real_autoblock_corrections.js');
const pilot = process.argv.includes('--pilot');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
source = require('./mod_real_combat_context_adapter')(source);
function replaceOnce(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Movement stress anchor changed: ' + before.slice(0, 50));
    source = source.replace(before, after);
}
replaceOnce("const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');",
    `const outputRoot = path.join(root, 'output/anticheat-lab/mod-real/improvements/movement-stress${pilot ? '/pilots' : ''}');`);
replaceOnce("const gameDir = path.join(outputRoot, 'client-game');",
    "const gameDir = path.join(root, 'output/anticheat-lab/mod-real/client-game/movement-stress');");
replaceOnce("path.join(outputRoot, 'mod-build-before.json')", "path.join(root, 'output/anticheat-lab/mod-real/mod-build-before.json')");
replaceOnce('const campaignSeed = 29092026;', 'const campaignSeed = 30192926;');
if (pilot) replaceOnce('scenarioId: spec.scenarioId, pilot: false, seed, scenario: spec,',
    'scenarioId: spec.scenarioId, pilot: true, seed, scenario: spec,');
const countsStart = source.indexOf('const counts = {'), countsEnd = source.indexOf('\nfunction checkHashes()', countsStart);
assert(countsStart > 0 && countsEnd > countsStart);
source = source.slice(0, countsStart) + 'const counts = { autoblock: { L6: 40 } };\n' + source.slice(countsEnd);
replaceOnce('trials.push({ id, scenarioId, number, part, enabled, settings, seed, transport,',
    `const nominalTickMs = [50, 100, 120][Math.floor((number - 1) / 2) % 3];
            transport.actor = { latencyMs: 30, jitterMs: 4 };
            transport.observer = { latencyMs: 10, jitterMs: 2 };
            transport.server = { minimumMs: nominalTickMs === 50 ? 0 : nominalTickMs, jitterMs: 0 };
            trials.push({ id, scenarioId, number, part, enabled, settings, seed, transport,
                split: ${pilot ? "'pilot'" : "number <= 20 ? 'calibration' : 'evaluation'"}, nominalTickMs, speedII: number % 2 === 1,`);
replaceOnce('        await lab.start();', "        await lab.start();\n        await lab.commands(['fill -16 63 -16 15 63 15 stone']);");
replaceOnce('        await setupTrial(lab, spec);',
    "        await setupTrial(lab, spec);\n        if (spec.speedII) await lab.commands(['effect LabActor 1 9999 1 true']);");
replaceOnce('        harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:',
    `        adapterSha256: sha(fs.readFileSync(${JSON.stringify(__filename)})), combatAdapterSha256: sha(fs.readFileSync(${JSON.stringify(path.join(__dirname, 'mod_real_combat_context_adapter.js'))})), harnessSha256: sha(fs.readFileSync(__filename)), inputDriverSha256:`);
const playStart = source.indexOf('async function combatPlay('), playEnd = source.indexOf('\nasync function scaffoldPlay(', playStart);
assert(playStart > 0 && playEnd > playStart);
source = source.slice(0, playStart) + `async function combatPlay(lab, driver, spec, rand, truth) {
    truth.inputProtocol = 'legal rapid block taps and sprint, optional Speed II';
    truth.stressCondition = { nominalTickMs: spec.nominalTickMs, speedII: spec.speedII,
        cycleMs: [110,130], blockHoldMs: [45,65], manualAttackHoldMs: [30,40],
        modulesEnabled: [], keyboard: ['W','CTRL'], squareTurnEveryMs: 1800 };
    await driver.mouseTap('left', 90); await delay(250); await driver.mouseTap('left', 90);
    const end = Date.now() + 31000;
    let nextCycle = Date.now(), nextTurn = Date.now() + 1800, cycles = 0;
    await driver.action('key', { vk: controls.W, down: true });
    await driver.action('key', { vk: controls.CTRL, down: true });
    try {
        while (Date.now() < end) {
            await delay(Math.max(0, nextCycle - Date.now()));
            nextCycle += 110 + Math.floor(rand()*21);
            await driver.action('mouse', { button: 'right', down: true });
            await delay(45 + Math.floor(rand()*21));
            await driver.action('mouse', { button: 'right', down: false });
            await driver.action('mouse', { button: 'left', down: true });
            await delay(30 + Math.floor(rand()*11));
            await driver.action('mouse', { button: 'left', down: false });
            if (Date.now() >= nextTurn) {
                await driver.action('move', { dx: 600, dy: 0 }); nextTurn += 1800;
            }
            cycles++;
        }
    } finally {
        for (const button of ['right','left']) await driver.action('mouse', { button, down: false });
        for (const vk of [controls.W, controls.CTRL]) await driver.action('key', { vk, down: false });
    }
    truth.injectedAttackClicks = cycles + 2;
}
` + source.slice(playEnd);
replaceOnce('    const plan = frozenPlan(part);', `    assert.strictEqual(part, 'autoblock');
    const plan = frozenPlan(part);
    const protocolFile = path.join(outputRoot, 'PROTOCOL.json');
    if (!fs.existsSync(protocolFile)) fs.writeFileSync(protocolFile, JSON.stringify({
        createdAt: new Date().toISOString(), frozenBeforeCaptures: true, modules: 'all OFF',
        hypothesis: 'Slow metadata sampling may hide rapid legal releases while the player can sprint between blocks.',
        conditions: ['normal / 100 / 120 ms ticks', 'Speed II on / off', 'seeded 110–130 ms input cycles'],
        caution: 'Scripted boundary controls, not extra human-population evidence.'
    }, null, 2), { flag: 'wx' });`);
replaceOnce('    const selected = plan.trials.filter(spec => force ? spec.id === force :',
    "    const requestedSplit = args.find(arg => arg.startsWith('--split='))?.split('=')[1];\n    const selected = plan.trials.filter(spec => !requestedSplit || spec.split === requestedSplit).filter(spec => force ? spec.id === force :");
source = source.replace('if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });',
    'module.exports = { main, frozenPlan };');
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, sourceFile);
if (process.argv.includes('--plan-only')) {
    const plan = compiled.exports.frozenPlan('autoblock');
    console.log(JSON.stringify({ planned: plan.trials.length, pilot, calibration: pilot ? 0 : 20, evaluation: pilot ? 0 : 20 }));
} else compiled.exports.main().catch(error => { console.error(error); process.exitCode = 1; });
