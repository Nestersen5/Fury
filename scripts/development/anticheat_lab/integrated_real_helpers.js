'use strict';
// Post-measurement integration probes reuse the immutable Forge launcher.
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('assert');
const sourceFile = path.join(__dirname, 'mod_real_scaffold_full.js');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
source = require('./mod_real_scaffold_arena_adapter')(source);
function once(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Integration anchor: ' + before);
    source = source.replace(before, after);
}
once("require('./lab')", "require('./integrated_lab')");
once("const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');",
    "const outputRoot = path.join(root, 'output/anticheat-lab/mod-real/integration');");
once("const gameDir = path.join(outputRoot, 'client-game');",
    "const gameDir = path.join(root, 'output/anticheat-lab/mod-real/client-game/integration');");
const start = source.indexOf('function checkHashes() {'), end = source.indexOf('\nfunction writeClientSettings', start);
assert(start > 0 && end > start);
source = source.slice(0, start) + `function checkHashes() {
    const base = path.join(root, 'output/anticheat-lab/mod-real');
    const applied = JSON.parse(fs.readFileSync(path.join(base, 'improvements/prepared-production/APPLIED.json')));
    for (const [relative, entry] of Object.entries(applied.files))
        assert.strictEqual(sha(fs.readFileSync(path.join(root, relative))), entry.afterSha256, relative);
    const before = JSON.parse(fs.readFileSync(path.join(base, 'mod-build-before.json')));
    for (const [relative, hash] of Object.entries(before.classFiles))
        assert.strictEqual(sha(fs.readFileSync(path.join(modRoot, 'build/classes/java/main', relative))), hash, relative);
    assert.strictEqual(sha(fs.readFileSync(path.join(modRoot, 'build/libs/ClientEnhancer-1.0.0.jar'))), before.jarSha256);
}
` + source.slice(end);
once('SilentAura: 38, Sprint: 49, Scaffold: 50 }', 'SilentAura: 38, Sprint: 49, Scaffold: 50, JumpReset: 24 }');
once('SilentAura: 0x4c, Sprint: 0x4e, Scaffold: 0x4d }', 'SilentAura: 0x4c, Sprint: 0x4e, Scaffold: 0x4d, JumpReset: 0x4f }');
once("Sprint: { 'Cancel Invis': false },", "Sprint: { 'Cancel Invis': false },\n        JumpReset: { Chance: 40, Accuracy: { low: 40, high: 60 }, 'Only when targeting': false, 'Water check': false },");
once("        await driver.action('focus');\n        await delay(1500);", `        await driver.action('focus');
        for (const vk of [controls.W, controls.A, controls.S, controls.D, controls.SPACE, controls.SHIFT, controls.CTRL])
            await driver.action('key', { vk, down: false });
        for (const button of ['left', 'right']) await driver.action('mouse', { button, down: false });
        await delay(1500);`);
// Keep the original disabled arena setup: no enabled teleport workaround.
once('    const actorId = lab.opponent.players.LabActor?.entity?.id;', `    const actorUuid = lab.opponent.players.LabActor?.uuid;
    const spawn = actorUuid ? lab.rawPackets.filter(p => p.name === 'named_entity_spawn' &&
        String(p.data.playerUUID || p.data.UUID || p.data.uuid).toLowerCase() === String(actorUuid).toLowerCase()).at(-1) : null;
    const actorId = lab.opponent.players.LabActor?.entity?.id ?? spawn?.data.entityId;
    truth.observerFollowingActorId = actorId;`);
source += '\nmodule.exports = { checkHashes, launchClient, stopClient, Driver, controls, keybinds, vk, rng, writeClientSettings, Lab, delay, root, gameDir, fullTrial };\n';
const compiled = new Module(sourceFile, module);
compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname);
compiled._compile(source, sourceFile);
module.exports = compiled.exports;
