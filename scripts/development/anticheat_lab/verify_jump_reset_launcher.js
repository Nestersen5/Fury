'use strict';
// Reuse the current actual-Electron verification harness. All profiles, server
// addresses and screenshots are isolated in mod-real; no normal profile writes.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const root = path.resolve(__dirname, '../../..');
const file = path.join(root, 'scripts/verify_launcher_anticheat.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
function once(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Launcher verifier anchor changed: ' + before.slice(0, 100));
    source = source.replace(before, after);
}
once("    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-anticheat-check-'));", `    const profileRoot = path.join(rootDirectory(), 'output/anticheat-lab/mod-real/improvements/launcher-verification');
    fs.mkdirSync(profileRoot, { recursive: true });
    const profile = fs.mkdtempSync(path.join(profileRoot, 'profile-'));
    fs.writeFileSync(path.join(profile, 'server_config.json'), JSON.stringify({
        proxyDirectHost: '127.0.0.1', proxyDirectPort: 9,
        proxyFailoverHost: '127.0.0.1', proxyFailoverPort: 9,
        proxyCustomHost: '127.0.0.1', proxyCustomPort: 0
    }));`);
once("const target = require('./launcher_verification_target').verificationTarget('launcher-anticheat');", `const rootDirectory = () => ${JSON.stringify(root)};
const target = require('./launcher_verification_target').verificationTarget('launcher-anticheat');
assert(!target.packaged, 'Verify authoritative development source');
assert(target.output.startsWith(path.join(rootDirectory(), 'output/anticheat-lab/mod-real')), 'Output must stay isolated');`);
once("        assert.equal(await page.$eval('#anticheat-team-alerts-enabled', element => element.checked), false);", `        assert.equal(await page.$eval('#anticheat-team-alerts-enabled', element => element.checked), false);
        assert.equal(await page.$eval('#anticheat-jump-reset-enabled', element => element.checked), false);
        assert.equal(await page.$$eval('#anticheat-detectors input', elements => elements.length), 4);
        assert.equal(await page.$eval('#anticheat-jump-reset-enabled', input => input.getAttribute('aria-label')), 'Jump Reset detection');
        assert.equal(await page.$eval('#anticheat-jump-reset-enabled', input => input.closest('.feature-card').querySelector('small').textContent), 'Possible alerts only. Manual jumps can look the same.');`);
once("        assert.equal(await page.$eval('.anticheat-recommendation', element => element.textContent), '(Recommended to be turned on)');", "        assert.equal(await page.$eval('#anticheat-possible-alerts-enabled', input => input.closest('.feature-card').querySelector('.anticheat-recommendation').textContent), '(Recommended to be turned on)');");
once("        assert.equal(await page.$eval('#anticheat-detectors input', element => element.disabled), true);", "        assert.equal(await page.$$eval('#anticheat-detectors input', elements => elements.every(element => element.disabled)), true);\n        assert.equal(await page.$eval('#anticheat-jump-reset-enabled', input => input.checked), false);");
once("        assert.equal(await page.$eval('#anticheat-detectors input', element => element.disabled), false);\n        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');", `        assert.equal(await page.$$eval('#anticheat-detectors input', elements => elements.every(element => !element.disabled)), true);
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
        // Exercise the real native checkbox through keyboard focus and Space.
        await page.focus('#anticheat-jump-reset-enabled');
        await page.keyboard.press('Space');
        assert.equal(await page.$eval('#anticheat-jump-reset-enabled', input => input.checked), true);
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');`);
once('        assert.equal(saved.anticheatStasisEnabled, true);', `        assert.equal(saved.anticheatStasisEnabled, true);
        assert.equal(saved.anticheatJumpResetEnabled, true);
        await page.reload();
        await page.waitForFunction('state?.settings && typeof activatePage === "function"');
        await page.evaluate(() => activatePage('anticheat'));
        assert.equal(await page.$eval('#anticheat-jump-reset-enabled', input => input.checked), true);
        assert.equal(await page.$eval('#anticheat-jump-reset-enabled', input => input.disabled), true);
        assert.equal(await page.$eval('#anticheat-enabled', input => input.checked), false);`);
once("        console.log('PASS grouped AntiCheat checks, disabled detectors, recommendation styling, autosave, and stored settings.');", `        fs.writeFileSync(path.join(target.output, 'jump-reset-launcher-check.json'), JSON.stringify({
            passed: true, profile, checks: ['four grouped checks', 'Jump Reset default OFF', 'experimental/manual timing copy',
                'all checks disabled under master OFF', 'keyboard Space toggle', 'autosave', 'reload persistence',
                'dark and light themes', 'narrow viewport', 'no page errors'], normalProfileModified: false
        }, null, 2) + '\\n');
        console.log('PASS Jump Reset launcher controls, default OFF, keyboard, master disabling, persistence and rendered themes.');`);
const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
compiled._compile(source, file);
