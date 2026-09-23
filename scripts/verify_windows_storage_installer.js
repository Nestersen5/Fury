'use strict';

// Builds and executes REAL NSIS installers with a separate registry GUID and a
// verification-only Electron entry point that redirects appData to mkdtemp.
// Never install the production-identity executable against a developer profile.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const repository = path.resolve(__dirname, '..');
const prepackaged = process.argv[2];
if (process.platform !== 'win32' || !prepackaged || !fs.existsSync(path.join(prepackaged, 'Fury.exe'))) {
    throw Error('Usage: node scripts/verify_windows_storage_installer.js <fresh win-unpacked directory> (Windows only)');
}
const sandbox = process.argv[3] ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), 'fury-nsis-storage-tests-'));
assert.strictEqual(path.dirname(sandbox), path.resolve(os.tmpdir()));
assert.ok(path.basename(sandbox).startsWith('fury-nsis-storage-tests-'));
assert.ok(!fs.lstatSync(sandbox).isSymbolicLink());
const previousConfig = path.join(sandbox, 'legacy.json');
const guid = fs.existsSync(previousConfig) ? JSON.parse(fs.readFileSync(previousConfig, 'utf8')).nsis.guid : crypto.randomUUID();
const roaming = path.join(sandbox, 'Synthetic Roaming');
const canonical = path.join(roaming, 'Fury');
const legacy = path.join(sandbox, 'Custom Old Fury With Spaces');
const installed = path.join(sandbox, 'Changed Installation With Spaces');
const timeline = path.join(sandbox, 'old-uninstaller-sequence.txt');
const fixtureApp = path.join(sandbox, 'fixture-unpacked');
const fixtureSource = path.join(fixtureApp, 'resources/app');
const outcomes = [];
const timings = {};
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.FURY_DATA_DIR;
function execute(executable, args, timeout = 600000) {
    // NSIS /D= and _?= must be last and unquoted, even with spaces. These
    // arguments contain only script-owned mkdtemp paths, never user input.
    const result = spawnSync(executable, args, { env, windowsHide: true, windowsVerbatimArguments: true,
        encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw Error(`Verification process failed (${result.status ?? result.error?.code}): ${path.basename(executable)}`);
    return result;
}
function put(root, relative, contents) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents);
}
function result(name) { outcomes.push(name); console.log('PASS ' + name); }
function uninstall(directory) {
    assert.ok(directory.startsWith(sandbox + path.sep));
    // Emulate NSIS's normal temporary uninstaller copy. _?= lets the controller
    // wait synchronously without pinning the EXE inside the directory removed.
    const executable = path.join(sandbox, 'uninstall-fixture-' + Date.now() + '.exe');
    fs.copyFileSync(path.join(directory, 'Uninstall Fury.exe'), executable);
    execute(executable, ['/S', '/currentuser', '_?=' + directory]);
}
console.log('Synthetic native verification directory: ' + sandbox);
// A repeat uses only a validated synthetic sandbox. Its previous fixture data
// is disposable; production AppData and registry identities are never used.
if (fs.existsSync(roaming)) fs.rmSync(roaming, { recursive: true, force: true });
if (fs.existsSync(timeline)) fs.unlinkSync(timeline);
fs.mkdirSync(roaming);
fs.cpSync(prepackaged, fixtureApp, { recursive: true });
// Refresh the implementation under test; the prepackaged runtime supplies the
// existing production dependencies without dependency installation/rebuilding.
for (const file of fs.readdirSync(path.join(repository, 'src/storage'))) {
    fs.copyFileSync(path.join(repository, 'src/storage', file), path.join(fixtureSource, 'src/storage', file));
}
fs.copyFileSync(path.join(repository, 'launcher.js'), path.join(fixtureSource, 'launcher.js'));
const bootstrap = path.join(fixtureSource, 'src/storage/windowsMigrationBootstrap.js');
fs.writeFileSync(bootstrap, fs.readFileSync(bootstrap, 'utf8').replace('83c18ff3-c735-53cd-906d-72fdc8bf6063', guid));
const fixturePackage = JSON.parse(fs.readFileSync(path.join(fixtureSource, 'package.json'), 'utf8'));
fixturePackage.main = 'storage-verification-entry.js';
fs.writeFileSync(path.join(fixtureSource, 'package.json'), JSON.stringify(fixturePackage));
put(fixtureSource, 'storage-verification-entry.js', `
const {app,dialog}=require('electron'),fs=require('fs'),path=require('path');
app.setPath('appData',${JSON.stringify(roaming)});
if(process.argv.includes('--fury-preserve-storage')) { require('./launcher.js'); }
else {
 app.setName('Fury');
 if(require('./src/storage/windowsMigrationBootstrap').run({app,dialog,projectRoot:__dirname})) {
  const runtime=require('./src/storage/runtimePaths');
  runtime.initializeDataDir(runtime.defaultDataDir({isPackaged:app.isPackaged,platform:process.platform,appData:app.getPath('appData')}));
  app.setPath('userData',runtime.dataPath('launcher_data'));
  const settings=require('./app_config').loadAllSettings();
  fs.writeFileSync(${JSON.stringify(path.join(sandbox, 'runtime-result.json'))},JSON.stringify({root:runtime.getDataDir(),userData:app.getPath('userData'),scan:settings.scan,
   session:JSON.parse(fs.readFileSync(runtime.dataPath('session_data.json'),'utf8'))}));
  app.exit(0);
 }
}
`);
const legacyInclude = path.join(sandbox, 'legacy-instrumentation.nsh');
// The only legacy customization records entry into the old uninstaller. Its
// actual remove-files implementation remains the locked builder's template.
fs.writeFileSync(legacyInclude, `!macro customUnInstall
 FileOpen $0 "${timeline}" w
 FileWrite $0 "OLD_UNINSTALL_ENTERED$\\r$\\n"
 IfFileExists "${canonical}\\session_data.json" 0 +2
 FileWrite $0 "CANONICAL_ALREADY_PRESENT$\\r$\\n"
 FileClose $0
!macroend
`);
const pkg = require('../package.json');
function build(which, include) {
    const output = path.join(sandbox, which);
    const guardedInclude = path.join(sandbox, which + '-guarded.nsh');
    // Independently fail closed if a fixture ever resolves an unexpected install
    // directory. This is test containment, not part of the production hook.
    fs.writeFileSync(guardedInclude, `!include "${include}"
!macro customInit
 StrCpy $0 "$INSTDIR" ${sandbox.length}
 StrCmp $0 "${sandbox}" +3
 SetErrorLevel 71
 Quit
!macroend
`);
    const config = {
        ...pkg.build, appId: 'com.fury.storage-verification.' + guid,
        directories: { output, buildResources: path.join(sandbox, 'build-resources') },
        npmRebuild: false, compression: 'normal', artifactName: which + '.exe',
        // The NSIS target's own artifactName wins over the top-level one, so the
        // synthetic name has to be set here too or the build lands on the real
        // release filename and this harness cannot find it.
        nsis: { ...pkg.build.nsis, artifactName: which + '.exe', guid, include: guardedInclude, createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false }
    };
    delete config.mac;
    fs.mkdirSync(config.directories.buildResources, { recursive: true });
    const configFile = path.join(sandbox, which + '.json'); fs.writeFileSync(configFile, JSON.stringify(config));
    const result = spawnSync(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', 'nsis', '--x64',
        '--prepackaged', fixtureApp, '--config', configFile], { cwd: repository, env, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 ** 2 });
    fs.writeFileSync(path.join(sandbox, which + '-build.log'), (result.stdout || '') + (result.stderr || ''));
    if (result.error || result.status !== 0) throw Error(which + ' build failed; inspect its synthetic build log');
    return path.join(output, which + '.exe');
}
let installedPath;
try {
    const oldSetup = fs.existsSync(path.join(sandbox, 'legacy/legacy.exe'))
        ? path.join(sandbox, 'legacy/legacy.exe') : build('legacy', legacyInclude);
    const newSetup = build('migration', path.join(repository, 'build/installer.nsh'));
    result('both real NSIS installers compiled with isolated identity');
    execute(oldSetup, ['/S', '/currentuser', '/D=' + legacy]); installedPath = legacy;
    const oldSource = path.join(legacy, 'resources/app');
    put(oldSource, 'session_data.json', '{"fixture":"legacy-survived"}');
    put(oldSource, 'scan_config.json', '{"minStars":321}');
    put(oldSource, 'auth_tokens/synthetic/token.json', '{"fixture":"NOT-A-REAL-TOKEN"}');
    put(oldSource, 'launcher_data/removed-accounts.json', '["removed-synthetic-account"]');
    put(oldSource, 'launcher_data/auth-staging/incomplete/token.json', '{"fixture":"DO-NOT-PROMOTE"}');
    put(oldSource, 'launcher_data/Local Storage/leveldb/LOCK', 'TRANSIENT');
    put(oldSource, 'legacy-only-application-marker.txt', 'MUST DISAPPEAR WITH OLD APP');
    const gateRequest = path.join(sandbox, 'failure-gate.json');
    const gateScript = path.join(sandbox, 'failure-gate.ps1');
    fs.writeFileSync(gateRequest, JSON.stringify({ sandbox, newSetup, installed, legacy, timeline }));
    fs.writeFileSync(gateScript, `param([string]$RequestFile)
$ErrorActionPreference='Stop'
$r=Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$target=Join-Path $r.legacy 'resources/app/session_data.json'
if(-not ([IO.Path]::GetFullPath($target)).StartsWith($r.sandbox + '\\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture target'}
$original=Get-Acl -LiteralPath $target;$acl=Get-Acl -LiteralPath $target
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'ReadData','Deny'))
try {
 Set-Acl -LiteralPath $target -AclObject $acl
 $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$r.newSetup
 $start.Arguments='/S /currentuser /D=' + $r.installed
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $child=[Diagnostics.Process]::Start($start)
 if(-not $child.WaitForExit(600000)){$child.Kill();throw 'Fixture installer timeout'}
 $code=$child.ExitCode;$child.Dispose()
 if($code -ne 70){throw 'Installer did not fail closed'}
 if(Test-Path -LiteralPath $r.timeline){throw 'Old uninstaller ran after failed preservation'}
 if(-not (Test-Path -LiteralPath (Join-Path $r.legacy 'Fury.exe'))){throw 'Old executable was removed'}
 if(-not (Test-Path -LiteralPath $target)){throw 'Legacy file was removed'}
} finally {Set-Acl -LiteralPath $target -AclObject $original}
`);
    const failedGate = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', gateScript, '-RequestFile', gateRequest],
        { env, windowsHide: true, encoding: 'utf8', timeout: 620000 });
    fs.writeFileSync(path.join(sandbox, 'failure-gate.log'), (failedGate.stdout || '') + (failedGate.stderr || ''));
    assert.strictEqual(failedGate.status, 0, 'native preservation failure must block the old uninstaller (see synthetic failure-gate.log)');
    result('native unreadable-data failure blocks old uninstaller and retains legacy app/data');
    const upgradeStart = performance.now();
    execute(newSetup, ['/S', '/currentuser', '/D=' + installed]); installedPath = installed;
    timings.upgradeMs = performance.now() - upgradeStart;
    assert.ok(fs.readFileSync(timeline, 'utf8').includes('CANONICAL_ALREADY_PRESENT'));
    assert.ok(!fs.existsSync(path.join(oldSource, 'session_data.json')));
    assert.ok(fs.existsSync(path.join(installed, 'Fury.exe')));
    assert.strictEqual(fs.readFileSync(path.join(canonical, 'auth_tokens/synthetic/token.json'), 'utf8'), '{"fixture":"NOT-A-REAL-TOKEN"}');
    assert.ok(!fs.existsSync(path.join(canonical, 'launcher_data/auth-staging')));
    assert.ok(!fs.existsSync(path.join(canonical, 'launcher_data/Local Storage/leveldb/LOCK')));
    result('changed-directory upgrade preserves before old uninstaller and removes old application');
    const probeStart = performance.now();
    execute(path.join(installed, 'Fury.exe'), []);
    timings.electronStorageProbeAfterMigrationMs = performance.now() - probeStart;
    const read = JSON.parse(fs.readFileSync(path.join(sandbox, 'runtime-result.json'), 'utf8'));
    assert.strictEqual(read.root, canonical); assert.strictEqual(read.userData, path.join(canonical, 'launcher_data'));
    assert.strictEqual(read.scan.minStars, 321); assert.strictEqual(read.session.fixture, 'legacy-survived');
    result('new Electron runtime and production settings loader read migrated data');
    fs.unlinkSync(path.join(canonical, 'auth_tokens/synthetic/token.json'));
    const before = require('../src/storage/windowsMigration').inventory(canonical);
    execute(newSetup, ['/S', '/currentuser', '/D=' + installed]);
    assert.deepStrictEqual(require('../src/storage/windowsMigration').inventory(canonical), before);
    result('native reinstall preserves canonical data and account deletion');
    uninstall(installed);
    installedPath = null;
    assert.deepStrictEqual(require('../src/storage/windowsMigration').inventory(canonical), before);
    assert.ok(!fs.existsSync(path.join(installed, 'Fury.exe')));
    assert.ok(!fs.existsSync(installed), 'normal uninstall must remove the complete application directory');
    result('native normal uninstall removes app while preserving canonical data');
    fs.writeFileSync(path.join(sandbox, 'results.json'), JSON.stringify({ outcomes, timings, guid, sandbox }, null, 2));
    console.log(JSON.stringify({ timings }));
} finally {
    if (installedPath && fs.existsSync(path.join(installedPath, 'Uninstall Fury.exe'))) {
        // Only this script's isolated GUID and validated mkdtemp child are removed.
        assert.ok(installedPath.startsWith(sandbox + path.sep));
        try { uninstall(installedPath); } catch { console.log('Synthetic installation retained for inspection: ' + installedPath); }
    }
}
