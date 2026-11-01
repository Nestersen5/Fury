'use strict';
// Real installed Electron -> electron-updater download -> clean Main shutdown
// -> NSIS upgrade -> reopened launcher. A random registry identity, synthetic
// appData, isolated updater cache and fixture-only loopback transport are used.
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), http = require('http');
const { spawnSync, spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, eventually } = require('./smoke_packaged_app');
const root = path.resolve(__dirname, '..'), input = path.resolve(process.argv[2] || '');
assert(process.platform === 'win32' && fs.existsSync(path.join(input, 'Fury.exe')), 'Pass a fresh Windows win-unpacked directory.');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-updater-native-'));
const output = path.join(root, 'output', 'windows-updater'); fs.mkdirSync(output, { recursive: true });
const guid = crypto.randomUUID(), roaming = path.join(sandbox, 'Roaming'), data = path.join(roaming, 'Fury');
const installed = path.join(sandbox, 'Installed Fury With Spaces'), fixture = path.join(sandbox, 'fixture-unpacked');
const source = path.join(fixture, 'resources', 'app'), pkg = require('../package.json');
const oldVersion = pkg.version, parts = oldVersion.split('.').map(Number), newVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
const outcomes = [], requests = []; let server, browser, child, newPid, setup, lastPage, installerMetadata;
function contained(directory) { assert(path.resolve(directory).startsWith(sandbox + path.sep)); }
function run(executable, args, options = {}) {
    const result = spawnSync(executable, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 ** 2, ...options });
    if (result.error || result.status !== 0) throw Error(`${path.basename(executable)} failed (${result.status ?? result.error?.message}): ${(result.stderr || '').slice(-1200)}`);
    return result;
}
function pass(text) { outcomes.push(text); console.log('PASS ' + text); }
function build(version, filename) {
    const packageFile = path.join(source, 'package.json'), metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    Object.assign(metadata, { name: 'fury-update-fixture-' + guid, version, main: 'update-fixture.cjs' });
    fs.writeFileSync(packageFile, JSON.stringify(metadata));
    const config = { ...pkg.build, appId: 'com.fury.update-fixture.' + guid, npmRebuild: false, compression: 'store',
        extraMetadata: { name: metadata.name, version, main: metadata.main },
        directories: { output: path.join(sandbox, version), buildResources: path.join(sandbox, 'build-resources') },
        nsis: { ...pkg.build.nsis, guid, include: path.join(sandbox, 'guarded.nsh'), artifactName: filename,
            shortcutName: 'Fury Update Verification ' + guid, uninstallDisplayName: 'Fury Update Verification ' + guid,
            createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false } };
    delete config.mac;
    fs.mkdirSync(config.directories.buildResources, { recursive: true });
    const configFile = path.join(sandbox, version + '.json'); fs.writeFileSync(configFile, JSON.stringify(config));
    const result = run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never', '--prepackaged', fixture, '--config', configFile]);
    fs.writeFileSync(path.join(output, `native-build-${version}.log`), result.stdout + result.stderr);
    return path.join(config.directories.output, filename);
}
function launchInstaller(file, args, env) {
    // NSIS requires the final /D= argument unquoted even with spaces. Every
    // argument here is generated from this script's validated sandbox paths.
    return new Promise((resolve, reject) => {
        const process = spawn(file, args, { env, windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' });
        process.once('error', reject); process.once('exit', code => code === 0 ? resolve() : reject(Error('Fixture installer exited ' + code)));
    });
}
(async () => {
    const [debug, updatedDebug, cosmetic, blocked, direct, failover, health] = await unusedPorts(7);
    fs.cpSync(input, fixture, { recursive: true });
    // --prepackaged skips the packager hook that normally writes this resource.
    // Match production's updater config, with a fixture-only cache identity.
    fs.writeFileSync(path.join(fixture, 'resources', 'app-update.yml'),
        `provider: generic\nurl: https://downloads.furyproxy.online/releases/\nupdaterCacheDirName: fury-update-fixture-${guid}\n`);
    // Refresh production source without touching the supplied packaged runtime.
    for (const file of ['launcher.js', 'launcher.html']) fs.copyFileSync(path.join(root, file), path.join(source, file));
    const explicitFiles = new Set(pkg.build.files.filter(file => file.startsWith('src/') && !file.includes('*')));
    function refreshSource(relative) {
        for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
            const file = relative + '/' + entry.name;
            if (entry.isDirectory()) refreshSource(file);
            else if (entry.isFile() && (file.endsWith('.js') || explicitFiles.has(file))) {
                fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
                fs.copyFileSync(path.join(root, file), path.join(source, file));
            }
        }
    }
    refreshSource('src');
    assert(!fs.existsSync(path.join(source, 'src/cosmetics/effect_library.json')), 'Mutable data must not enter the fixture payload');
    const bootstrap = path.join(source, 'src/storage/windowsMigrationBootstrap.js');
    fs.writeFileSync(bootstrap, fs.readFileSync(bootstrap, 'utf8').replace('83c18ff3-c735-53cd-906d-72fdc8bf6063', guid));
    // Production conservatively refuses installation while ANY Fury.exe runs.
    // The real user may keep Fury running during this verification. Scope only
    // this copied fixture's Fury process check to its random temporary tree;
    // keep selected-installation Node/Electron checks and all file/owner guards.
    const guard = path.join(source, 'src/storage/windowsMigrationGuard.ps1');
    const processScope = sandbox.replace(/'/g, "''") + path.sep;
    const originalCheck = "if ($candidate.Name -ieq 'Fury.exe') { throw 'WRITERS_ACTIVE' }";
    const scopedCheck = `if ($candidate.Name -ieq 'Fury.exe') {
            if (-not $candidate.ExecutablePath) { throw 'WRITERS_UNVERIFIABLE' }
            if ($candidate.ExecutablePath.StartsWith('${processScope}', [StringComparison]::OrdinalIgnoreCase)) { throw 'WRITERS_ACTIVE' }
        }`;
    const guardSource = fs.readFileSync(guard, 'utf8'); assert(guardSource.includes(originalCheck));
    fs.writeFileSync(guard, guardSource.replace(originalCheck, scopedCheck));
    fs.writeFileSync(path.join(sandbox, 'guarded.nsh'), `
!ifdef BUILD_UNINSTALLER
!macro customCheckAppRunning
 ; The controller closes only fixture-owned PIDs. Never scan/kill by app name.
!macroend
!endif
!include "${path.join(root, 'build/installer.nsh')}"
!macro customInit
 StrCpy $0 "$INSTDIR" ${sandbox.length}
 StrCmp $0 "${sandbox}" +3
 SetErrorLevel 71
 Quit
!macroend
`);
    server = http.createServer((request, response) => {
        requests.push(request.url);
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname.endsWith('.exe')) {
            response.writeHead(200, { 'Content-Length': fs.statSync(setup).size, 'Content-Type': 'application/octet-stream' });
            fs.createReadStream(setup).pipe(response); return;
        }
        response.setHeader('Content-Type', 'application/json');
        if (pathname.endsWith('/windows-update.json')) {
            response.end(JSON.stringify(installerMetadata));
        } else if (pathname === '/release-notes.json') response.end(JSON.stringify({ schemaVersion: 1, releases: [{ version: newVersion, features: ['Synthetic installer verification.'], improvements: [], fixes: [] }] }));
        else response.end(JSON.stringify({ schemaVersion: 1, latestVersion: newVersion, releasePageUrl: 'https://furyproxy.online/' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    fs.writeFileSync(path.join(source, 'update-fixture.cjs'), `
const {app,ipcMain,shell}=require('electron'),fs=require('fs'),path=require('path');
app.setPath('appData',${JSON.stringify(roaming)});
process.env.FURY_DATA_DIR=${JSON.stringify(data)};
process.env.FURY_RESOURCES_PATH=__dirname;
process.env.STATMOD_AUTO_START_PROXY='0';
process.env.COSMETIC_SEARCH_PORT=${JSON.stringify(String(cosmetic))};
// The installer preservation helper must run before test app initialization.
if(process.argv.includes('--fury-preserve-storage')) { require('./launcher.js'); }
else {
 // The replacement must not reuse a Chromium debug socket still closing from
 // the previous process. These ports exist only in this isolated test build.
 app.commandLine.appendSwitch('remote-debugging-port',app.getVersion()===${JSON.stringify(oldVersion)}?${JSON.stringify(String(debug))}:${JSON.stringify(String(updatedDebug))});
 app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
 app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
 app.commandLine.appendSwitch('disable-renderer-backgrounding');
 app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',()=>window.show()));
 const {ElectronAppAdapter}=require('electron-updater/out/ElectronAppAdapter');
 Object.defineProperty(ElectronAppAdapter.prototype,'baseCachePath',{get:()=>${JSON.stringify(path.join(sandbox, 'cache'))}});
 const notifications=require('./src/updates/updateNotifications'),read=notifications.readManifest;
 const localRead=(url,options)=>read(new URL(url.pathname,${JSON.stringify(base)}),options);
 const create=notifications.createUpdateNotifications;
 notifications.createUpdateNotifications=options=>create({...options,read:localRead});
 const experience=require('./src/updates/releaseExperience'),createExperience=experience.createReleaseExperience;
 experience.createReleaseExperience=options=>createExperience({...options,read:localRead});
 const metadata=require('./src/updates/windowsUpdateMetadata');
 metadata.releaseUrl=(version,filename='windows-update.json')=>${JSON.stringify(base)}+'/releases/'+version+'/'+filename;
 const installer=require('./src/updates/windowsInstallerUpdates'),createInstaller=installer.createInstallerUpdates;
 installer.createInstallerUpdates=options=>createInstaller({...options,read:localRead,canInstall:async()=>true});
 shell.openExternal=async()=>{throw Error('External navigation blocked in native fixture');};
 require('prismarine-auth').Authflow.prototype.getMinecraftJavaToken=async()=>{throw Error('Real Microsoft authentication blocked');};
 ipcMain.handle('fixture:version',()=>({version:app.getVersion(),pid:process.pid,
   cachedLogin:require('./src/accounts/connectionAuth').hasSavedLogin(path.join(${JSON.stringify(data)},'auth_tokens'),'Fixture')}));
 app.whenReady().then(()=>fs.writeFileSync(${JSON.stringify(path.join(sandbox, 'started-'))}+app.getVersion()+'.json',JSON.stringify({pid:process.pid,version:app.getVersion()})));
 require('./launcher.js');
}
`);
    console.log('Native updater sandbox: ' + sandbox);
    const oldSetup = build(oldVersion, 'old.exe');
    setup = build(newVersion, `Fury-Setup-${newVersion}-win-x64.exe`);
    const sha256 = crypto.createHash('sha256'), sha512 = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(setup)) { sha256.update(chunk); sha512.update(chunk); }
    installerMetadata = { schemaVersion: 1, version: newVersion, filename: path.basename(setup), bytes: fs.statSync(setup).size,
        sha256: sha256.digest('hex'), sha512: sha512.digest('base64'), releasedAt: '2026-11-01T12:00:00Z' };
    pass('two fixture installers compiled with isolated registry identity');
    const env = cleanEnvironment(data, source, cosmetic, blocked); delete env.FURY_DATA_DIR; delete env.ELECTRON_RUN_AS_NODE;
    contained(installed);
    await launchInstaller(oldSetup, ['/S', '/currentuser', '/D=' + installed], env);
    const preserved = {
        'scan_config.json': JSON.stringify({ minStars: 321 }),
        'auth_tokens/Fixture/fixture_mca-cache.json': JSON.stringify({ mca: { access_token: 'SYNTHETIC-NOT-A-REAL-TOKEN' }, profile: { id: 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa', name: 'Fixture' } }),
        'session_data.json': JSON.stringify({ sessions: [], fixture: 'saved-history' }),
        'recordings/synthetic-recording.mcpr': 'synthetic recording sentinel'
    };
    for (const [file, body] of Object.entries(preserved)) { const target = path.join(data, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body); }
    fs.writeFileSync(path.join(data, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true }));
    fs.writeFileSync(path.join(data, 'server_config.json'), JSON.stringify({ proxyCustomPort: 0, proxyDirectPort: direct, proxyFailoverPort: failover, healthPort: health }));
    child = startChild(path.join(installed, 'Fury.exe'), [], env, 'Installed updater fixture');
    async function connect(version = oldVersion) {
        const port = version === oldVersion ? debug : updatedDebug;
        browser = await eventually(() => puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }), 'Installed Electron debugger', 60000);
        return eventually(async () => {
            const page = (await browser.pages()).find(page => page.url().endsWith('/launcher.html')); assert(page);
            lastPage = page; await page.bringToFront();
            // Windows may initially report the silent installer's child as
            // hidden. Refresh once explicitly instead of waiting on Fury's
            // intentionally visibility-gated background refresh timer.
            await page.evaluate(() => refresh());
            await page.waitForFunction('!!furyDesign && !!state?.settings'); return page;
        }, 'Installed launcher', 60000);
    }
    let page = await connect();
    const invoke = (channel, ...args) => page.evaluate((channel, args) => require('electron').ipcRenderer.invoke(channel, ...args), channel, args);
    const before = await invoke('fixture:version'); assert.equal(before.version, oldVersion); assert(before.cachedLogin);
    await page.evaluate(() => { window.NesterTheme.apply('forest', true); window.NesterTheme.applySidebar('collapsed', true); });
    await page.waitForSelector('.fury-release-reopen.fury-update-available');
    assert(!requests.some(url => url.endsWith('.exe')), 'Startup must not download');
    await page.hover('.fury-release-reopen');
    await page.click('.fury-release-reopen');
    await page.waitForFunction('!document.querySelector(".fury-update-preview").hidden');
    await page.click('.fury-update-preview .primary');
    await page.waitForFunction('document.querySelector(".fury-update-status").textContent.includes("ready to install")', { timeout: 60000 });
    assert(requests.some(url => url.endsWith('.exe'))); pass('actual electron-updater downloaded and verified the installer from the loopback fixture');
    await invoke('service:start', 'proxy');
    await eventually(async () => { const response = await fetch(`http://127.0.0.1:${health}/health`); assert(response.ok); }, 'Synthetic proxy running');
    // The separate Electron UI suite covers the restart button. Drive the
    // same guarded IPC here so proxy startup cannot move a hover-only target
    // before this native shutdown/installation verification begins.
    await invoke('updates:install').catch(error => {
        if (!/Target closed|Session closed|Execution context was destroyed/.test(error.message)) throw error;
    });
    await eventually(() => assert.notEqual(child.exitCode, null), 'Old launcher exits', 30000);
    assert.equal(child.exitCode, 0, child.output); browser.disconnect(); browser = null;
    pass('update used the clean launcher and proxy shutdown path');
    await eventually(() => assert(fs.existsSync(path.join(sandbox, `started-${newVersion}.json`))), 'Updated launcher reopens', 600000);
    newPid = JSON.parse(fs.readFileSync(path.join(sandbox, `started-${newVersion}.json`))).pid;
    page = await connect(newVersion); const after = await invoke('fixture:version');
    assert.equal(after.version, newVersion); assert(after.cachedLogin);
    for (const [file, body] of Object.entries(preserved)) assert.equal(fs.readFileSync(path.join(data, file), 'utf8'), body, file + ' changed');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'forest');
    assert.equal(await page.evaluate(() => localStorage.getItem('fury-sidebar-v1')), 'collapsed');
    assert.equal((await invoke('updates:state')).status, 'idle');
    pass('settings, cached sign-in, saved history, recordings and Chromium preferences survived the real NSIS upgrade');
    await page.screenshot({ path: path.join(output, 'native-updated-launcher.png') });
    page.evaluate(() => require('electron').ipcRenderer.invoke('window:control', 'close')).catch(() => {});
    await eventually(() => assert.throws(() => process.kill(newPid, 0)), 'Updated launcher closes'); newPid = null;
    fs.writeFileSync(path.join(output, 'native-upgrade.json'), JSON.stringify({ passed: true, sandbox, guid, oldVersion, newVersion,
        guardScope: 'fixture tree only; production global writer guard unchanged', outcomes, requests }, null, 2));
})().catch(async error => {
    console.error(error);
    if (lastPage) await lastPage.screenshot({ path: path.join(output, 'native-upgrade-failure.png') }).catch(() => {});
    if (child) fs.writeFileSync(path.join(output, 'native-child.log'), child.output || '');
    process.exitCode = 1;
}).finally(async () => {
    browser?.disconnect(); await stopChild(child);
    if (newPid) { try { process.kill(newPid); } catch {} }
    if (server) await new Promise(resolve => server.close(resolve));
    const uninstaller = path.join(installed, 'Uninstall Fury.exe');
    if (fs.existsSync(uninstaller)) {
        contained(installed); const copy = path.join(sandbox, 'uninstall.exe'); fs.copyFileSync(uninstaller, copy);
        try { run(copy, ['/S', '/currentuser', '_?=' + installed], { windowsVerbatimArguments: true }); }
        catch { console.error('Fixture installation retained for inspection: ' + installed); }
    }
});
