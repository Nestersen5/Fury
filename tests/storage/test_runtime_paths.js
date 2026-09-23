'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const runtimeModule = path.join(REPOSITORY_ROOT, 'src', 'storage', 'runtimePaths.js');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-runtime-paths-'));
const cleanEnvironment = { ...process.env };
delete cleanEnvironment.FURY_DATA_DIR;

function runIsolated(source, environment = cleanEnvironment) {
    return execFileSync(process.execPath, ['-e', source], {
        cwd: temporaryDirectory,
        env: environment,
        encoding: 'utf8'
    }).trim();
}

try {
    const development = JSON.parse(runIsolated(`
        const runtime = require(${JSON.stringify(runtimeModule)});
        const config = require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'app_config.js'))});
        const effects = require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'src/cosmetics/effectLibrary.js'))});
        console.log(JSON.stringify({ root: runtime.getDataDir(), keys: config.paths.keys,
            effects: effects.DEFAULT_FILE }));
    `));
    assert.strictEqual(development.root, REPOSITORY_ROOT, 'development paths must not depend on cwd');
    assert.strictEqual(development.keys, path.join(REPOSITORY_ROOT, 'statmod_key.txt'));
    assert.strictEqual(development.effects, path.join(REPOSITORY_ROOT, 'src/cosmetics/effect_library.json'));

    const appDataDirectory = path.join(temporaryDirectory, 'Application Support', 'Fury');
    const explicitDirectory = path.join(temporaryDirectory, 'Portable Fury Data');
    const initialized = runIsolated(`
        const runtime = require(${JSON.stringify(runtimeModule)});
        console.log(runtime.initializeDataDir(${JSON.stringify(appDataDirectory)}));
    `);
    assert.strictEqual(initialized, appDataDirectory);
    assert.ok(fs.statSync(appDataDirectory).isDirectory());

    const persisted = JSON.parse(runIsolated(`
        (async () => {
            const fs = require('fs');
            const { execFileSync } = require('child_process');
            const runtime = require(${JSON.stringify(runtimeModule)});
            runtime.initializeDataDir(${JSON.stringify(appDataDirectory)});
            const config = require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'app_config.js'))});
            config.saveKeys({ hypixel: 'test-only-key' });
            config.saveFeatureSettings({ autoDodgeEnabled: false });
            config.saveScanSettings({ minStars: 321 });
            config.saveChatTriggerSettings(['portable test']);
            config.saveServerSettings({ proxyDirectPort: 25571 });
            const { createEffectLibrary, DEFAULT_FILE: effectFile } = require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'src/cosmetics/effectLibrary.js'))});
            const library = createEffectLibrary();
            library.setSetting('notify', false);
            await library.saveNow();
            library.dispose();
            require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'logger.js'))}).writeDebugToFile();
            const childCode = 'console.log(require(' + JSON.stringify(${JSON.stringify(runtimeModule)}) + ').getDataDir())';
            const childRoot = execFileSync(process.execPath, ['-e', childCode], {
                cwd: ${JSON.stringify(os.tmpdir())}, encoding: 'utf8'
            }).trim();
            console.log(JSON.stringify({
                root: runtime.getDataDir(), childRoot, settings: config.loadAllSettings(),
                effects: JSON.parse(fs.readFileSync(effectFile, 'utf8')),
                debugExists: fs.existsSync(runtime.dataPath('statmod_debug.log'))
            }));
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `, { ...cleanEnvironment, FURY_DATA_DIR: explicitDirectory }));
    assert.strictEqual(persisted.root, explicitDirectory, 'explicit portable directory must override packaged default');
    assert.strictEqual(persisted.childRoot, explicitDirectory, 'child services must inherit the data directory');
    assert.strictEqual(persisted.settings.keys.hypixel, 'test-only-key');
    assert.strictEqual(persisted.settings.features.autoDodgeEnabled, false);
    assert.strictEqual(persisted.settings.scan.minStars, 321);
    assert.deepStrictEqual(persisted.settings.chatTriggers.triggers, ['portable test']);
    assert.strictEqual(persisted.settings.server.proxyDirectPort, 25571);
    assert.strictEqual(persisted.effects.settings.notify, false);
    assert.strictEqual(persisted.debugExists, true);
    assert.deepStrictEqual(fs.readdirSync(appDataDirectory), [], 'an override must leave the packaged default untouched');

    const invalidResult = runIsolated(`
        const assert = require('assert');
        const runtime = require(${JSON.stringify(runtimeModule)});
        assert.throws(() => runtime.initializeDataDir(), /must be an absolute/);
        console.log('rejected');
    `, { ...cleanEnvironment, FURY_DATA_DIR: 'relative-data' });
    assert.strictEqual(invalidResult, 'rejected', 'relative overrides must not redirect writes based on cwd');

    console.log('Runtime data path tests passed.');
} finally {
    // This path comes directly from mkdtempSync, never from a caller or env var.
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
