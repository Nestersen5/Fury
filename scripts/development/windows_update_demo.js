'use strict';
// Explicit local developer exercise. These generated installers and bootstrap
// never enter the normal payload or the public release/publishing workflow.
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');
const { spawnSync } = require('child_process');
const { unusedPorts } = require('../smoke_packaged_app');
const root = path.resolve(__dirname, '../..');
const directory = path.join(root, 'output', 'developer-updater-demo');
const configFile = path.join(directory, 'demo.json');
const pkg = require('../../package.json');

function readConfig() {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.equal(config.directory, directory);
    assert.equal(config.dataDirectory, root);
    assert.equal(config.private, true);
    assert(/^[a-f0-9-]{36}$/.test(config.id));
    assert.equal(config.installed, path.join(directory, 'Installed Fury'));
    const url = new URL(config.base);
    assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.protocol, 'http:');
    return config;
}
function run(executable, args, options = {}) {
    const result = spawnSync(executable, args, { cwd: root, windowsHide: true, encoding: 'utf8',
        timeout: 600000, maxBuffer: 4 * 1024 ** 2, ...options });
    assert(!result.error && result.status === 0, `${path.basename(executable)} failed: ${result.error?.message || result.stderr?.slice(-1500) || result.status}`);
    return result;
}
function writeLaunchers(config) {
    const literal = value => "'" + value.replace(/'/g, "''") + "'";
    const shortcut = path.join(process.env.USERPROFILE, 'Desktop/Fury (Development).lnk');
    const launch = `$ErrorActionPreference = 'Stop'
$taskFeedUrl = ${literal(config.base + '/developer-status.json')}
$taskFeedReady = $false
try { $taskStatus = Invoke-RestMethod -Uri $taskFeedUrl -TimeoutSec 2; $taskFeedReady = $taskStatus.id -eq ${literal(config.id)} } catch {}
if (-not $taskFeedReady) {
    Start-Process -FilePath ${literal(process.execPath)} -ArgumentList @(${literal('"' + __filename + '"')}, 'serve') -WorkingDirectory ${literal(root)} -WindowStyle Hidden -RedirectStandardOutput ${literal(path.join(directory, 'feed.log'))} -RedirectStandardError ${literal(path.join(directory, 'feed-error.log'))}
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        try { $taskStatus = Invoke-RestMethod -Uri $taskFeedUrl -TimeoutSec 1; if ($taskStatus.id -eq ${literal(config.id)}) { $taskFeedReady = $true; break } } catch {}
        Start-Sleep -Milliseconds 200
    }
}
if (-not $taskFeedReady) { throw 'The private developer update feed could not start.' }
$env:FURY_DATA_DIR = ${literal(config.dataDirectory)}
Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath ${literal(path.join(config.installed, 'Fury.exe'))} -WorkingDirectory ${literal(root)} -WindowStyle Hidden
`;
    const restore = `$ErrorActionPreference = 'Stop'
$taskInstalledExe = ${literal(path.join(config.installed, 'Fury.exe'))}
$taskMains = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $taskInstalledExe -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'proxy.js|cosmetic_search_api.js' })
foreach ($taskMain in $taskMains) {
    $taskProcess = Get-Process -Id $taskMain.ProcessId -ErrorAction SilentlyContinue
    if ($taskProcess) {
        $taskProcessHandle = $taskProcess.Handle
        if (-not $taskProcess.CloseMainWindow()) { throw 'Close the developer test window before restoring the source launcher.' }
        if (-not $taskProcess.WaitForExit(30000)) { throw 'Fury is still saving. Restore stopped without forcing it closed.' }
        if ($taskProcess.ExitCode -ne 0) { throw 'Fury did not close cleanly. Restore stopped before opening another copy.' }
    }
}
try { Invoke-RestMethod -Uri ${literal(config.base + '/developer-stop')} -Method Post -TimeoutSec 2 | Out-Null } catch {}
Copy-Item -LiteralPath ${literal(path.join(directory, 'original-development.lnk'))} -Destination ${literal(shortcut)} -Force
Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath ${literal(shortcut)} -WindowStyle Normal
`;
    fs.writeFileSync(path.join(directory, 'launch.ps1'), launch);
    fs.writeFileSync(path.join(directory, 'restore.ps1'), restore);
}
async function prepare() {
    assert.equal(process.platform, 'win32');
    const previous = process.argv.includes('--rebuild') ? readConfig() : null;
    assert(previous || !fs.existsSync(configFile), 'This demo is already prepared; use --rebuild only while it is closed.');
    const input = path.resolve(process.argv.slice(3).find(argument => !argument.startsWith('--'))
        || path.join(root, 'output/windows-updater/package/win-unpacked'));
    assert(fs.existsSync(path.join(input, 'Fury.exe')), 'Pass a fresh Windows win-unpacked directory.');
    fs.mkdirSync(directory, { recursive: true });
    const [unusedPort] = await unusedPorts(1), port = previous ? Number(new URL(previous.base).port) : unusedPort;
    const id = previous?.id || crypto.randomUUID();
    const version = pkg.version + '+developer.updater.1';
    const parts = pkg.version.split('.').map(Number);
    const updatedVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}+developer.updater.2`;
    const config = { schemaVersion: 1, id, directory, dataDirectory: root, version, updatedVersion,
        installed: path.join(directory, 'Installed Fury'), base: `http://127.0.0.1:${port}`,
        source: path.join(directory, 'unpacked/resources/app'), private: true };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    const unpacked = path.join(directory, 'unpacked'), source = config.source;
    fs.cpSync(input, unpacked, { recursive: true });
    // Only authoritative, allowlisted source/assets: never copy the real profile.
    const explicit = new Set(pkg.build.files.filter(file => !file.includes('*') && !file.startsWith('!')));
    function refresh(relative) {
        for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
            const file = relative ? relative + '/' + entry.name : entry.name;
            if (entry.isDirectory() && (relative || ['src', 'features', 'assets'].includes(entry.name))) refresh(file);
            else if (entry.isFile() && (file.endsWith('.js') || file.startsWith('assets/') || explicit.has(file))) {
                fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
                fs.copyFileSync(path.join(root, file), path.join(source, file));
            }
        }
    }
    refresh('');
    assert(!fs.existsSync(path.join(source, 'auth_tokens')));
    assert(!fs.existsSync(path.join(source, 'src/cosmetics/effect_library.json')));
    const bootstrap = path.join(source, 'src/storage/windowsMigrationBootstrap.js');
    fs.writeFileSync(bootstrap, fs.readFileSync(bootstrap, 'utf8').replace('83c18ff3-c735-53cd-906d-72fdc8bf6063', id));
    fs.writeFileSync(path.join(unpacked, 'resources/app-update.yml'),
        `provider: generic\nurl: https://downloads.furyproxy.online/releases/\nupdaterCacheDirName: fury-developer-updater-${id}\n`);
    fs.writeFileSync(path.join(source, 'developer-channel.json'), JSON.stringify(config));
    fs.mkdirSync(path.join(directory, 'status'), { recursive: true });
    fs.writeFileSync(path.join(source, 'developer-main.cjs'), `
const {app,ipcMain}=require('electron'),fs=require('fs'),path=require('path');
const channel=require('./developer-channel.json');
app.setPath('appData',path.join(channel.directory,'Roaming'));
process.env.FURY_DATA_DIR=process.env.FURY_DATA_DIR||channel.dataDirectory;
if(process.argv.includes('--fury-preserve-storage')) require('./launcher.js');
else {
 let ownedWindow=false,installing=false,lastStatus;
 const report=(kind,fields={})=>{const file=path.join(channel.directory,'status',process.pid+'-'+kind+'.json');
   fs.writeFileSync(file+'.tmp',JSON.stringify({id:channel.id,kind,pid:process.pid,version:app.getVersion(),...fields}));fs.renameSync(file+'.tmp',file);};
 app.on('browser-window-created',(_event,window)=>{ownedWindow=true;window.webContents.once('did-finish-load',()=>{window.show();window.focus();});});
 const {ElectronAppAdapter}=require('electron-updater/out/ElectronAppAdapter');
 Object.defineProperty(ElectronAppAdapter.prototype,'baseCachePath',{get:()=>path.join(channel.directory,'cache')});
 const notifications=require('./src/updates/updateNotifications'),read=notifications.readManifest;
 const localRead=(url,options)=>read(new URL(url.pathname,channel.base),options);
 const createNotifications=notifications.createUpdateNotifications;
 notifications.createUpdateNotifications=options=>createNotifications({...options,read:localRead});
 const experience=require('./src/updates/releaseExperience'),createExperience=experience.createReleaseExperience;
 experience.createReleaseExperience=options=>createExperience({...options,read:localRead,
   statePath:path.join(require('./src/storage/runtimePaths').getDataDir(),'launcher_data','developer-update-demo.json')});
 require('./src/updates/windowsUpdateMetadata').releaseUrl=(version,filename='windows-update.json')=>channel.base+'/releases/'+version+'/'+filename;
 const installer=require('./src/updates/windowsInstallerUpdates'),createInstaller=installer.createInstallerUpdates;
 installer.createInstallerUpdates=options=>createInstaller({...options,read:localRead,onChange:state=>{
   options.onChange(state);installing=state.status==='installing';
   if(lastStatus!==state.status){lastStatus=state.status;report('update',{status:state.status});}
 }});
 ipcMain.on('developer-demo:ui',(event,fields)=>{
   if(event.senderFrame!==event.sender.mainFrame)return;
   report('ready',{potato:fields?.potato===true,sameProfile:path.resolve(require('./src/storage/runtimePaths').getDataDir())===path.resolve(channel.dataDirectory)});
 });
 app.on('will-quit',()=>{if(ownedWindow)report('quit',{installing});});
 require('./launcher.js');
}
`);
    const html = path.join(source, 'launcher.html');
    fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('</body>', "<script>require('./developer-ui.cjs').mount(document);</script>\n</body>"));
    fs.writeFileSync(path.join(directory, 'installer.nsh'), `
!ifdef BUILD_UNINSTALLER
!macro customCheckAppRunning
 ; Never stop other Fury installations from this private developer uninstaller.
!macroend
!endif
!include "${path.join(root, 'build/installer.nsh')}"
!macro customInit
 StrCpy $0 "$INSTDIR" ${directory.length}
 StrCmp $0 "${directory}" +3
 SetErrorLevel 71
 Quit
!macroend
`);
    function build(buildVersion, potato) {
        const packageFile = path.join(source, 'package.json'), metadata = JSON.parse(fs.readFileSync(packageFile));
        Object.assign(metadata, { name: 'fury-developer-updater-' + id, version: buildVersion, main: 'developer-main.cjs' });
        fs.writeFileSync(packageFile, JSON.stringify(metadata));
        fs.writeFileSync(path.join(source, 'developer-ui.cjs'), `
exports.mount=document=>{
 const header=document.querySelector('.header-actions');
 const badge=document.createElement('span');badge.dataset.developerUpdateTest='badge';badge.style.setProperty('display','inline-flex','important');badge.style.whiteSpace='nowrap';badge.className='note';badge.textContent='Dev test ${potato ? 2 : 1}';badge.title='Private local updater test';header.prepend(badge);
 ${potato ? `const button=document.createElement('button');button.dataset.developerUpdateTest='potato';button.style.setProperty('display','inline-flex','important');button.style.webkitAppRegion='no-drag';button.id='developer-potato-check';button.type='button';button.textContent='Potato check';button.addEventListener('click',()=>window.FuryNotifications.show({title:'Potato check',detail:'Your proxy is officially potato powered.',kind:'info'}));header.prepend(button);` : ''}
 require('electron').ipcRenderer.send('developer-demo:ui',{potato:!!document.getElementById('developer-potato-check')});
};
`);
        const filename = `Fury-Setup-${buildVersion}-win-x64.exe`;
        const buildConfig = { ...pkg.build, appId: 'com.fury.developer-updater.' + id, npmRebuild: false, compression: 'store',
            extraMetadata: { name: metadata.name, version: buildVersion, main: metadata.main },
            directories: { output: path.join(directory, buildVersion), buildResources: path.join(directory, 'build-resources') },
            nsis: { ...pkg.build.nsis, guid: id, include: path.join(directory, 'installer.nsh'), artifactName: filename,
                differentialPackage: false, shortcutName: 'Fury Developer Update Test ' + id,
                uninstallDisplayName: 'Fury Developer Update Test ' + id,
                createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false } };
        delete buildConfig.mac;
        fs.mkdirSync(buildConfig.directories.buildResources, { recursive: true });
        const file = path.join(directory, buildVersion + '.json'); fs.writeFileSync(file, JSON.stringify(buildConfig));
        console.log('Building private developer test ' + (potato ? '2 (Potato check)' : '1 (no Potato check)'));
        const result = run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never', '--prepackaged', unpacked, '--config', file]);
        fs.writeFileSync(path.join(directory, 'build-' + (potato ? 2 : 1) + '.log'), result.stdout + result.stderr);
        return path.join(buildConfig.directories.output, filename);
    }
    config.firstInstaller = build(version, false);
    config.updateInstaller = build(updatedVersion, true);
    const sha256 = crypto.createHash('sha256'), sha512 = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(config.updateInstaller)) { sha256.update(chunk); sha512.update(chunk); }
    config.metadata = { schemaVersion: 1, version: updatedVersion, filename: path.basename(config.updateInstaller),
        bytes: fs.statSync(config.updateInstaller).size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64'),
        releasedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    writeLaunchers(config);
    console.log('Private installers ready. No public release was changed.');
}
async function serve() {
    const config = readConfig(); assert(config.metadata);
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, config.base).pathname;
        response.setHeader('Cache-Control', 'no-store');
        if (pathname === '/releases/' + config.updatedVersion + '/' + config.metadata.filename) {
            response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': config.metadata.bytes });
            fs.createReadStream(config.updateInstaller).pipe(response); return;
        }
        response.setHeader('Content-Type', 'application/json');
        if (pathname === '/developer-status.json') response.end(JSON.stringify({ id: config.id, pid: process.pid }));
        else if (pathname === '/developer-stop' && request.method === 'POST') { response.end('{}'); close(); }
        else if (pathname === '/latest.json') response.end(JSON.stringify({ schemaVersion: 1, latestVersion: config.updatedVersion, releasePageUrl: 'https://furyproxy.online/' }));
        else if (pathname === '/release-notes.json') response.end(JSON.stringify({ schemaVersion: 1, releases: [{ version: config.updatedVersion,
            features: ['Click Potato check in the top bar for an extremely important potato status.'], improvements: [], fixes: [] }] }));
        else if (pathname === '/releases/' + config.updatedVersion + '/windows-update.json') response.end(JSON.stringify(config.metadata));
        else { response.statusCode = 404; response.end('{}'); }
    });
    let watcher, exitTimer;
    const statusDirectory = path.join(directory, 'status');
    const processedQuits = new Map(fs.readdirSync(statusDirectory).filter(name => name.endsWith('-quit.json'))
        .map(name => [name, fs.statSync(path.join(statusDirectory, name)).mtimeMs]));
    function close() { clearTimeout(exitTimer); watcher?.close(); server.close(); }
    server.on('error', error => { console.error(error.message); watcher?.close(); process.exitCode = 1; });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(new URL(config.base).port), '127.0.0.1', resolve); });
    watcher = fs.watch(statusDirectory, () => {
        // Windows can coalesce rename notifications or report the temporary
        // filename. Read committed quit records once after the event batch.
        clearTimeout(exitTimer);
        exitTimer = setTimeout(() => {
            for (const name of fs.readdirSync(statusDirectory).filter(name => name.endsWith('-quit.json'))) {
                try {
                    const file = path.join(statusDirectory, name), modified = fs.statSync(file).mtimeMs;
                    if (processedQuits.get(name) === modified) continue;
                    const event = JSON.parse(fs.readFileSync(file)); processedQuits.set(name, modified);
                    if (event.id === config.id && !event.installing) { close(); return; }
                } catch { /* A later filesystem event can retry an incomplete record. */ }
            }
        }, 30);
    });
    console.log('Private developer feed ready on loopback.');
}
if (require.main === module) {
    const action = process.argv[2];
    (action === 'prepare' ? prepare() : action === 'serve' ? serve()
        : action === 'write-launchers' ? Promise.resolve().then(() => writeLaunchers(readConfig()))
            : Promise.reject(Error('Use prepare [win-unpacked], serve or write-launchers')))
        .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
module.exports = { readConfig };
