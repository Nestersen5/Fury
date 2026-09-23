'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');
const migration = require('../../src/storage/windowsMigration');
const { INSTALL_GUID } = require('../../src/storage/windowsMigrationBootstrap');
const { UUID } = require('builder-util-runtime');
const pkg = require('../../package.json');
assert.strictEqual(INSTALL_GUID, pkg.build.nsis.guid || UUID.v5(pkg.build.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')));
const templateRoot = path.join(REPOSITORY_ROOT, 'node_modules/app-builder-lib/templates/nsis');
const template = fs.readFileSync(path.join(templateRoot, 'installer.nsi'), 'utf8');
assert.ok(template.indexOf('!insertmacro customHeader') < template.indexOf('Section "install"'));
const section = fs.readFileSync(path.join(templateRoot, 'installSection.nsh'), 'utf8');
assert.ok(section.indexOf('!insertmacro uninstallOldVersion') < section.indexOf('!insertmacro customInstall'));
const include = fs.readFileSync(path.join(REPOSITORY_ROOT, pkg.build.nsis.include), 'utf8');
assert.ok(include.includes('Section "-Preserve Fury user data"'));
assert.ok(include.includes('SetErrorLevel 70'));
assert.ok(include.includes('SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0)'), 'an empty RunAsNode variable still enables Node mode');
assert.ok(!include.includes('customUnInstall') && !pkg.build.nsis.deleteAppDataOnUninstall);
assert.ok(pkg.build.files.includes('src/storage/windowsMigrationGuard.ps1'));
console.log('PASS locked NSIS hook order, registry identity, packaged helper and uninstall defaults');

// Exercise platform/override gates without launching Electron or discovering a
// single real installation. The injected maintenance function fails if touched.
const bootstrapFile = path.join(REPOSITORY_ROOT, 'src/storage/windowsMigrationBootstrap.js');
for (const scenario of [{ platform: 'darwin', packaged: true }, { platform: 'win32', packaged: false },
    { platform: 'win32', packaged: true, override: path.join(os.tmpdir(), 'explicit-fury-fixture') }]) {
    const sandboxModule = { exports: {} };
    const fakeRequire = name => name === './windowsMigration' ? { needsMaintenance() { throw Error('UNEXPECTED_DISCOVERY'); } } : require(name);
    const source = fs.readFileSync(bootstrapFile, 'utf8');
    vm.runInNewContext(`(function(require,module,__dirname,process){${source}\n})`, {})
        (fakeRequire, sandboxModule, path.dirname(bootstrapFile), { platform: scenario.platform, argv: [], env: { FURY_DATA_DIR: scenario.override || '' } });
    assert.strictEqual(sandboxModule.exports.run({ app: { isPackaged: scenario.packaged, getPath: () => path.join(os.tmpdir(), 'fake-roaming') }, projectRoot: REPOSITORY_ROOT }), true);
}
console.log('PASS macOS, development and explicit override bypass Windows migration discovery');

if (process.platform === 'win32') {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-migration-native-tests-'));
    try {
        const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
        const result = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            path.join(REPOSITORY_ROOT, 'scripts/test_windows_migration_acl.ps1'), '-Sandbox', sandbox, '-Repository', REPOSITORY_ROOT,
            '-NodeExecutable', process.execPath, '-WorkerExecutable', require('electron'), '-LauncherPid', String(process.pid)],
        { encoding: 'utf8', timeout: 120000, windowsHide: true });
        console.log(result.trim());
        const oldInstallation = path.join(sandbox, 'Chromium old install');
        const options = { installations: [oldInstallation], destination: path.join(sandbox, 'Chromium Roaming/Fury'),
            control: path.join(sandbox, 'Chromium Roaming/.Fury-migration-v1'), owner: 'synthetic-owner', quiescent: true };
        const oldHtml = path.join(oldInstallation, 'resources/app/launcher.html');
        const newHtml = path.join(sandbox, 'Chromium new install/resources/app/launcher.html');
        for (const html of [oldHtml, newHtml]) {
            fs.mkdirSync(path.dirname(html), { recursive: true });
            fs.writeFileSync(html, '<!doctype html><title>Synthetic storage verification</title>');
        }
        const electronEnv = { ...process.env }; delete electronEnv.ELECTRON_RUN_AS_NODE; delete electronEnv.FURY_DATA_DIR;
        function electron(mode, profile, html) {
            const output = path.join(sandbox, mode + '-electron.json');
            execFileSync(require('electron'), [path.join(REPOSITORY_ROOT, 'scripts/test_windows_migration_electron.js'),
                mode, sandbox, profile, html, output], { env: electronEnv, windowsHide: true, timeout: 30000, stdio: 'pipe' });
            return JSON.parse(fs.readFileSync(output, 'utf8'));
        }
        const before = electron('write', path.join(path.dirname(oldHtml), 'launcher_data'), oldHtml);
        migration.activate(options, migration.preserve(options, migration.plan(options)));
        const after = electron('read', path.join(options.destination, 'launcher_data'), newHtml);
        assert.deepStrictEqual(after.state, before.state);
        assert.deepStrictEqual(after.state, { theme: 'graphite', sidebar: 'collapsed' });
        assert.ok(before.cookiePreserved && after.cookiePreserved && after.userDataMatches && after.sessionDataMatches);
        console.log(`PASS Electron ${after.electron}: localStorage, cookie and sessionData survive relocation and maintenance profile initialization`);
    } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
} else console.log('SKIP Windows ACL and process integration (Windows required)');
