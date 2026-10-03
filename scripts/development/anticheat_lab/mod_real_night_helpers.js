'use strict';
// Reuse the inspected real-client launcher and focus driver without editing the
// original measurement runner. Adapt only the isolated JumpReset key/settings.
const fs = require('fs'), path = require('path'), Module = require('module');
const sourceFile = path.join(__dirname, 'mod_real_full.js');
let source = fs.readFileSync(sourceFile, 'utf8');
function replaceOnce(from, to) {
    if (source.split(from).length !== 2) throw new Error('Launcher adaptation anchor changed: ' + from);
    source = source.replace(from, to);
}
replaceOnce('SilentAura: 38, Sprint: 49, Scaffold: 50 }', 'SilentAura: 38, Sprint: 49, Scaffold: 50, JumpReset: 24 }');
replaceOnce('SilentAura: 0x4c, Sprint: 0x4e, Scaffold: 0x4d }', 'SilentAura: 0x4c, Sprint: 0x4e, Scaffold: 0x4d, JumpReset: 0x4f }');
replaceOnce("Sprint: { 'Cancel Invis': false },", "Sprint: { 'Cancel Invis': false },\n        JumpReset: { Chance: 40, Accuracy: { low: 40, high: 60 }, 'Only when targeting': false, 'Water check': false },");
replaceOnce("        await driver.action('focus');\n        await delay(1500);", `        await driver.action('focus');
        for (const vk of [controls.W, controls.A, controls.S, controls.D, controls.SPACE, controls.SHIFT, controls.CTRL])
            await driver.action('key', { vk, down: false });
        for (const button of ['left','right']) await driver.action('mouse', { button, down: false });
        await delay(1500);`);
source += '\nmodule.exports = { checkHashes, launchClient, stopClient, Driver, controls, keybinds, vk, rng, writeClientSettings, Lab, delay, root, gameDir };\n';
const owning = new Module(sourceFile, module);
owning.filename = sourceFile;
owning.paths = Module._nodeModulePaths(__dirname);
owning._compile(source, sourceFile);
module.exports = owning.exports;
