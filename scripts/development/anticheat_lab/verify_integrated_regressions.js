'use strict';
// Existing regression suite plus the new setting, all data isolated in mod-real.
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real/integration');
fs.mkdirSync(base, { recursive: true });
const tests = ['tests/features/test_combat_detectors.js', 'tests/features/test_scaffold_detector.js',
    'tests/features/test_anticheat_lab_observer_regression.js'];
const results = [];
for (const file of tests) {
    const at = Date.now();
    try {
        const output = execFileSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
        results.push({ file, passed: true, elapsedMs: Date.now() - at, output });
    }
    catch (error) { results.push({ file, passed: false, output: String(error.stdout || '') + String(error.stderr || ''), error: error.message }); }
}
const profileRoot = path.join(base, 'config-verification');
fs.mkdirSync(profileRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(profileRoot, 'profile-'));
fs.writeFileSync(path.join(profile, 'server_config.json'), JSON.stringify({ proxyDirectHost: '127.0.0.1', proxyDirectPort: 9,
    proxyFailoverHost: '127.0.0.1', proxyFailoverPort: 9, proxyCustomHost: '127.0.0.1', proxyCustomPort: 0 }));
const file = path.join(root, 'tests/features/test_anticheat_controls.js');
let source = fs.readFileSync(file, 'utf8');
const anchor = "process.env.FURY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-anticheat-config-'));";
assert.strictEqual(source.split(anchor).length, 2);
source = source.replace(anchor, `process.env.FURY_DATA_DIR = ${JSON.stringify(profile)};`);
source += `\nassert.equal(config.loadFeatureSettings().anticheatJumpResetEnabled, false, 'experimental setting default OFF');
assert.equal(loader.parseFeatureConfig().anticheatJumpResetEnabled, false, 'proxy loader default OFF');
config.saveFeatureSettings({ ...config.loadFeatureSettings(), anticheatJumpResetEnabled: true });
assert.equal(config.loadFeatureSettings().anticheatJumpResetEnabled, true, 'persisted opt-in');
assert.equal(loader.parseFeatureConfig().anticheatJumpResetEnabled, true, 'proxy loads opt-in');
config.saveFeatureSettings({ ...config.loadFeatureSettings(), anticheatJumpResetEnabled: false });
assert.equal(loader.parseFeatureConfig().anticheatJumpResetEnabled, false, 'persisted opt-out');\n`;
try {
    const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
    compiled._compile(source, file);
    results.push({ file: 'test_anticheat_controls.js + Jump Reset isolated contract', passed: true, profile });
} catch (error) { results.push({ file: 'isolated setting contract', passed: false, profile, error: error.stack }); }
const result = { capturedAt: new Date().toISOString(), stage: 'integrated', results, passed: results.every(r => r.passed),
    scope: 'Unit, historical fixture and persisted-setting regression checks, not extra accuracy trials. Normal profile unchanged.' };
fs.writeFileSync(path.join(base, 'INTEGRATED_REGRESSION_CHECK.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: result.passed, tests: results.map(r => ({ file: r.file, passed: r.passed })) }));
assert(result.passed, 'Inspect retained regression failures');
