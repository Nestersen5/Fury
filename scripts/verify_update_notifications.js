'use strict';
// Real Electron/Main/renderer, isolated profile and static loopback manifest.
// No real browser opening, authentication or download is allowed by this fixture.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, assertRunning, eventually, uiTestArguments } = require('./smoke_packaged_app');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'update-notifications');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-update-ui-'));
const installed = require('../package.json').version;
const parts = require('../src/updates/updateNotifications').stableVersion(installed);
assert(parts, 'Stable Fury version required by this fixture');
const latest = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
const pageUrl = require('../src/updates/releaseConfig').downloadPageUrl;
const children = [], sockets = new Set(), requests = [], held = new Map(), results = [];

function waitForExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => finish(new Error(`Graceful fixture exit timed out after ${timeoutMs}ms`)), timeoutMs);
        const onExit = () => finish();
        const onError = error => finish(error);
        function finish(error) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            child.off('exit', onExit);
            child.off('error', onError);
            error ? reject(error) : resolve();
        }
        child.once('exit', onExit);
        child.once('error', onError);
        if (child.exitCode !== null || child.signalCode !== null) finish();
    });
}

function forceFixtureTree(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    try { process.kill(pid, 0); } catch { return; }
    try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else process.kill(pid, 'SIGKILL');
    } catch { /* The fixture may have exited while cleanup was checking it. */ }
}
const server = http.createServer((req, res) => {
    requests.push({ path: req.url, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/release-notes.json') {
        res.end(JSON.stringify({ schemaVersion: 1, releases: [{ version: latest,
            features: Array.from({ length: 24 }, (_, i) => i === 0 ? 'Fixture new feature.' : `Fixture new feature ${i + 1}.`), improvements: ['Fixture improvement.'], fixes: ['Fixture bug fix.'] }] })); return;
    }
    if (req.url === '/timeout') return;
    if (req.url === '/available') { held.set(req.url, res); return; }
    if (req.url === '/malformed') { res.end('{broken'); return; }
    if (req.url === '/installer') { res.end(JSON.stringify({ schemaVersion: 1, latestVersion: latest, releasePageUrl: pageUrl })); return; }
    res.end(JSON.stringify({ schemaVersion: 1, latestVersion: installed, releasePageUrl: pageUrl }));
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

async function scenario(mode) {
    const fixturePids = new Set();
    const profile = path.join(temporary, mode), application = path.join(profile, 'fixture-app');
    fs.mkdirSync(application, { recursive: true });
    fs.mkdirSync(path.join(profile, 'launcher_data'), { recursive: true });
    fs.writeFileSync(path.join(profile, 'launcher_data', 'release-notifications.json'), JSON.stringify({
        lastVersion: mode.startsWith('welcome') ? '1.1.0' : installed, seen: mode.startsWith('welcome') ? [] : [installed]
    }));
    fs.writeFileSync(path.join(profile, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true }));
    const [debug, cosmetic, blocked] = await unusedPorts(3);
    const env = cleanEnvironment(profile, root, cosmetic, blocked); env.NODE_BINARY = process.execPath;
    if (mode !== 'dev-disabled') {
        env.FURY_UPDATE_TEST_MODE = '1';
        env.FURY_UPDATE_TEST_URL = `http://127.0.0.1:${server.address().port}/${mode}`;
    }
    fs.writeFileSync(path.join(application, 'package.json'), JSON.stringify({ name: 'fury-update-fixture', version: installed, main: 'main.cjs' }));
    fs.writeFileSync(path.join(application, 'main.cjs'), `
const fs=require('fs'),{app,ipcMain,shell,session}=require('electron');
const status={checks:0,settled:0,opens:[],downloads:0,pids:[]};
shell.openExternal=async url=>{if(url!==${JSON.stringify(pageUrl)})throw Error('External navigation blocked');status.opens.push(url);};
require(${JSON.stringify(require.resolve('prismarine-auth'))}).Authflow.prototype.getMinecraftJavaToken=async()=>{throw Error('Real authentication blocked');};
const cp=require('child_process'),spawn=cp.spawn;cp.spawn=(...args)=>{const child=spawn(...args);if(child.pid)status.pids.push(child.pid);return child;};
app.whenReady().then(()=>session.defaultSession.on('will-download',event=>{status.downloads++;event.preventDefault();}));
const updates=require(${JSON.stringify(require.resolve('../src/updates/releaseExperience'))}),create=updates.createReleaseExperience;
updates.createReleaseExperience=options=>{const service=create(options),check=service.check;service.check=async()=>{status.checks++;const result=await check();status.result=result;status.settled++;return result;};return service;};
${mode === 'welcome-design' ? `
let rejectMarker=false;ipcMain.handle('fixture:reject-next-marker',()=>{rejectMarker=true;return true;});
const baseCreate=updates.createReleaseExperience;updates.createReleaseExperience=options=>{const service=baseCreate(options),seen=service.markSeen;service.markSeen=payload=>{if(rejectMarker&&payload.settings?.length){rejectMarker=false;throw Error('Synthetic marker failure');}return seen(payload);};return service;};
` : ''}
${mode === 'installer' ? `
const installer=require(${JSON.stringify(require.resolve('../src/updates/windowsInstallerUpdates'))}),createInstaller=installer.createInstallerUpdates;
let pendingDownload;status.installerDownloads=0;status.installs=0;
installer.createInstallerUpdates=options=>createInstaller({...options,canInstall:async()=>true,detectInstallation:async()=>({directory:'C:\\\\Synthetic Fury'}),
 read:async url=>url.pathname==='/latest.json'?{schemaVersion:1,latestVersion:${JSON.stringify(latest)},releasePageUrl:${JSON.stringify(pageUrl)}}:
 {schemaVersion:1,version:${JSON.stringify(latest)},filename:'Fury-Setup-'+${JSON.stringify(latest)}+'-win-x64.exe',bytes:100000000,sha256:'a'.repeat(64),sha512:Buffer.alloc(64).toString('base64'),releasedAt:'2026-11-01T12:00:00Z'},
 verify:async()=>{},requestInstall:async()=>{status.installs++;},
 createUpdater:(metadata,callbacks)=>({download:()=>{status.installerDownloads++;callbacks.onProgress({percent:42,transferred:42000000});return new Promise((resolve,reject)=>{pendingDownload={resolve,reject};});},cancel:()=>pendingDownload?.reject(Error('cancelled')),dispose:()=>{},install:()=>{throw Error('Real installation blocked');}})});
ipcMain.handle('fixture:update-action',(event,action)=>{if(action==='complete')pendingDownload.resolve('synthetic-installer.exe');else pendingDownload.reject(Error('synthetic failure'));return true;});
` : ''}
ipcMain.handle('fixture:update-status',()=>({...status,installedVersion:app.getVersion()}));
require(${JSON.stringify(path.join(root, 'launcher.js'))});
`);
    const start = performance.now();
    const child = startChild(require('electron'), [application, ...uiTestArguments(), `--remote-debugging-port=${debug}`,
        '--remote-debugging-address=127.0.0.1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
        `--proxy-server=${env.HTTPS_PROXY}`], env, 'Update notification fixture');
    children.push(child); let browser, page, passed = false;
    try {
        browser = await eventually(async () => { assertRunning(child); return puppeteer.connect({ browserURL: `http://127.0.0.1:${debug}`, defaultViewport: null }); }, 'Electron renderer');
        page = await eventually(async () => { const page = (await browser.pages()).find(p => p.url().endsWith('/launcher.html')); assert(page); return page; }, 'Launcher');
        await page.bringToFront();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.waitForFunction('!!furyDesign && !!state?.settings');
        const readyMs = performance.now() - start;
        const status = async () => {
            const result = await page.evaluate(() => require('electron').ipcRenderer.invoke('fixture:update-status'));
            for (const pid of result.pids) fixturePids.add(pid);
            return result;
        };
        assert.equal((await status()).installedVersion, installed);
        if (mode === 'installer') {
            await page.waitForSelector('.fury-release-reopen.fury-update-available');
            assert.equal((await status()).installerDownloads, 0, 'Checking does not download');
            await page.hover('.fury-release-reopen');
            await page.waitForFunction('!document.querySelector(".fury-update-preview").hidden && document.querySelectorAll(".fury-update-notes li").length===26');
            const footer = await page.$eval('.fury-update-preview .fury-release-actions', el => el.getBoundingClientRect().top);
            assert(await page.$eval('.fury-update-notes', el => el.scrollHeight > el.clientHeight));
            await page.$eval('.fury-update-notes', el => { el.scrollTop=el.scrollHeight; });
            assert.equal(await page.$eval('.fury-update-preview .fury-release-actions', el => el.getBoundingClientRect().top), footer);
            await page.screenshot({path:path.join(output,'installer-long-notes.png')});
            await page.click('.fury-update-preview .primary');
            await page.waitForFunction('document.querySelector(".fury-update-status").textContent.includes("42%")');
            await page.click('.fury-update-preview .primary');
            await page.waitForFunction('document.querySelector(".fury-update-status").textContent.includes("ready to download")');
            await page.click('.fury-update-preview .primary');
            await eventually(async()=>assert.equal((await status()).installerDownloads,2),'Second download');
            await page.evaluate(()=>require('electron').ipcRenderer.invoke('fixture:update-action','fail'));
            await page.waitForFunction('document.querySelector(".fury-update-status").textContent.includes("Could not")');
            await page.click('.fury-update-preview .primary');
            await eventually(async()=>assert.equal((await status()).installerDownloads,3),'Retry');
            await page.evaluate(()=>require('electron').ipcRenderer.invoke('fixture:update-action','complete'));
            await page.waitForFunction('document.querySelector(".fury-update-status").textContent.includes("ready to install")');
            assert(await page.$eval('.fury-update-detail',el=>el.textContent.includes('disconnects Minecraft')));
            await page.keyboard.press('Escape');
            await page.focus('.fury-release-reopen'); await page.keyboard.press('Enter');
            await page.waitForFunction('!document.querySelector(".fury-update-preview").hidden');
            for(const theme of ['graphite','light']) {
                await page.evaluate(theme=>{window.NesterTheme.apply(theme,false);window.NesterTheme.applySidebar('collapsed',false);},theme);
                await page.setViewport({width:1024,height:680});
                await page.hover('.fury-release-reopen');
                await page.screenshot({path:path.join(output,`installer-${theme}-collapsed.png`)});
                assert(await page.$eval('.fury-update-preview',el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
            }
            await page.click('.fury-update-preview .primary');
            await eventually(async()=>assert.equal((await status()).installs,1),'Explicit install request');
            assert.deepEqual((await status()).opens,[]);
        } else if (mode === 'available') {
            await eventually(() => assert(held.has('/available')), 'Manifest request');
            assert.equal((await status()).settled, 0, 'Launcher must be ready before the held check finishes');
            held.get('/available').end(JSON.stringify({ schemaVersion: 1, latestVersion: latest, releasePageUrl: pageUrl,
                summary: 'An optional Fury release. <b>This remains plain text.</b>' }));
            await page.waitForSelector('.da-update-notice .fury-release-card-head>.fury-release-link');
            assert.equal((await status()).opens.length, 0);
            assert.equal(await page.$eval('.da-update-notice', e => e.getAttribute('role')), 'status');
            assert.equal(await page.$eval('.da-update-notice .fury-release-card-head>strong', e => e.textContent), 'A Fury update is available');
            assert.equal(await page.$('.da-update-notice b'), null);
            for (const theme of ['graphite', 'light']) {
                await page.evaluate(theme => { window.NesterTheme.apply(theme, false); window.NesterTheme.applyMotion(true, false); }, theme);
                await page.setViewport({ width: theme === 'light' ? 1024 : 1440, height: theme === 'light' ? 680 : 900 });
                await page.focus('.da-update-notice .fury-release-card-head>.fury-release-link');
                await page.screenshot({ path: path.join(output, `update-${theme}.png`) });
            }
            await page.keyboard.press('Enter');
            await page.waitForSelector('.fury-release-dialog[open]');
            assert.equal((await status()).opens.length, 0, 'Changelog does not open browser');
            await page.waitForFunction('document.querySelector(".fury-release-content").textContent.includes("Fixture new feature.")');
            await page.screenshot({ path: path.join(output, 'changelog-light.png') });
            await page.click('.fury-release-dialog .primary');
            await eventually(async () => assert.deepEqual((await status()).opens, [pageUrl]), 'Explicit action opens only fixed destination');
            await page.evaluate(async () => { await Promise.all([ipcRenderer.invoke('updates:check'), ipcRenderer.invoke('updates:check')]); await refresh(); });
            await page.waitForFunction('!document.querySelector(".da-update-notice")');
            await page.evaluate(() => ipcRenderer.invoke('updates:check'));
            assert.equal(await page.$('.da-update-notice'), null);
            // Main retains session ownership even if the renderer reloads.
            await page.reload(); await page.waitForFunction('!!furyDesign && !!state?.settings');
            await eventually(async () => assert((await status()).settled >= 5), 'Reload check completed');
            assert.equal(await page.$('.da-update-notice'), null);
        } else if (mode === 'welcome-design') {
            await require('./verify_release_discovery')({page,output,profile});
        } else if (mode.startsWith('welcome')) {
            await page.waitForSelector('.da-update-notice .fury-release-card-head>.fury-release-link');
            assert.equal(await page.$eval('.da-update-notice .fury-release-card-head>strong', e => e.textContent), `What’s new in Fury ${installed}`);
            await page.evaluate(() => { document.documentElement.dataset.sidebar = 'collapsed'; });
            assert.equal(await page.$eval('.fury-release-reopen span', el => getComputedStyle(el).display), 'none');
            assert.equal(await page.$eval('.fury-release-reopen svg', el => el.getBoundingClientRect().width), 20);
            await page.screenshot({ path: path.join(output, 'welcome-collapsed.png') });
            if (mode === 'welcome-dismiss') await page.click('.da-update-notice [aria-label="Dismiss update notice"]');
            else {
                await page.click('.da-update-notice .fury-release-card-head>.fury-release-link');
                await page.waitForSelector('.fury-release-dialog[open]');
                assert.equal(await page.$eval('.fury-release-dialog .primary', el => el.hidden), true);
                assert.equal(await page.$$eval('.fury-release-content h3', els => els.map(el => el.querySelector('span:not(.fury-change-icon)').textContent).join(',')), 'New features,Improvements,Bug fixes');
                await page.screenshot({ path: path.join(output, 'welcome-changelog.png') });
                await page.keyboard.press('Escape');
            }
            await page.waitForFunction('!document.querySelector(".da-update-notice")');
            const saved = JSON.parse(fs.readFileSync(path.join(profile, 'launcher_data', 'release-notifications.json')));
            assert(saved.seen.includes(installed));
            await page.click('.fury-release-reopen');
            await page.waitForSelector('.fury-release-dialog[open]');
            await page.keyboard.press('Escape');
            assert.deepEqual((await status()).opens, []);
        } else {
            await eventually(async () => assert((await status()).settled >= 1), 'Silent check completion');
            assert.equal(await page.$('.da-update-notice'), null);
            assert.deepEqual((await status()).opens, []);
        }
        const final = await status(); assert.equal(final.downloads, 0); assert.equal(final.installedVersion, installed);
        assert.deepEqual(errors, []);
        const count = requests.filter(request => request.path === '/' + mode).length;
        assert.equal(count, mode === 'dev-disabled' ? 0 : 1);
        const quitStart = performance.now();
        // Closing destroys the renderer, so the IPC evaluation may never return.
        // Observe the actual Electron exit instead of waiting on that evaluation.
        page.evaluate(() => ipcRenderer.invoke('window:control', 'close')).catch(() => {});
        await waitForExit(child, 7000);
        assert.equal(child.exitCode, 0, child.output);
        if (mode === 'welcome-design') assert(JSON.parse(fs.readFileSync(path.join(profile, 'launcher_data', 'release-notifications.json'))).readVersions.includes('1.1.1'), 'Shutdown drains the queued release marker');
        for (const pid of final.pids) assert.throws(() => process.kill(pid, 0));
        results.push({ mode, readyMs: Math.round(readyMs), quitMs: Math.round(performance.now() - quitStart), requests: count, downloads: final.downloads, passed: true });
        passed = true;
    } catch (error) {
        if (page) {
            console.error('Fixture check state:', await page.evaluate(() => require('electron').ipcRenderer.invoke('fixture:update-status')).catch(() => null));
            console.error('Fixture renderer state:', await page.evaluate(() => ({
                ready: document.readyState, hidden: document.hidden, design: Boolean(furyDesign), state: Boolean(state),
                appPath: require('electron').remote?.app?.getAppPath?.(), status: document.querySelector('#save-status')?.textContent
            })).catch(error => ({ error: error.message })));
            await page.screenshot({ path: path.join(output, mode + '-failure.png') }).catch(() => {});
        }
        throw error;
    } finally {
        browser?.disconnect();
        if (!passed) forceFixtureTree(child.pid);
        await stopChild(child);
        for (const pid of fixturePids) forceFixtureTree(pid);
        fs.writeFileSync(path.join(output, mode + '.log'), child.output);
    }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const mode of process.argv.includes('--design-only') ? ['welcome-design'] : process.argv.includes('--installer-only') ? ['installer'] : ['welcome-design', 'available', 'welcome', 'welcome-dismiss', 'equal', 'malformed', 'timeout', 'dev-disabled', 'installer']) await scenario(mode);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, platform: process.platform, architecture: process.arch, packaged: false, results, requests }, null, 2));
    console.log(JSON.stringify({ passed: true, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const child of children) await stopChild(child);
    for (const socket of sockets) socket.destroy();
    server.close();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
