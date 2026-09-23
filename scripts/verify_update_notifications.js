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
    if (req.url === '/timeout') return;
    if (req.url === '/available') { held.set(req.url, res); return; }
    if (req.url === '/malformed') { res.end('{broken'); return; }
    res.end(JSON.stringify({ schemaVersion: 1, latestVersion: installed, releasePageUrl: pageUrl }));
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

async function scenario(mode) {
    const fixturePids = new Set();
    const profile = path.join(temporary, mode), application = path.join(profile, 'fixture-app');
    fs.mkdirSync(application, { recursive: true });
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
const updates=require(${JSON.stringify(require.resolve('../src/updates/updateNotifications'))}),create=updates.createUpdateNotifications;
updates.createUpdateNotifications=options=>{const service=create(options),check=service.check;service.check=async()=>{status.checks++;const result=await check();status.result=result;status.settled++;return result;};return service;};
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
        if (mode === 'available') {
            await eventually(() => assert(held.has('/available')), 'Manifest request');
            assert.equal((await status()).settled, 0, 'Launcher must be ready before the held check finishes');
            held.get('/available').end(JSON.stringify({ schemaVersion: 1, latestVersion: latest, releasePageUrl: pageUrl,
                summary: 'An optional Fury release. <b>This remains plain text.</b>' }));
            await page.waitForSelector('.notification-update-action');
            assert.equal((await status()).opens.length, 0);
            assert.equal(await page.$eval('.notification-update-action', e => e.closest('article').getAttribute('role')), 'status');
            assert.equal(await page.$eval('.notification-update-action', e => e.closest('article').querySelector('.notification-title').textContent), `Fury ${latest} is available.`);
            assert.equal(await page.$eval('.notification-update-action', e => e.closest('article').querySelector('.notification-detail b')), null);
            for (const theme of ['graphite', 'light']) {
                await page.evaluate(theme => { window.NesterTheme.apply(theme, false); window.NesterTheme.applyMotion(true, false); }, theme);
                await page.setViewport({ width: theme === 'light' ? 1024 : 1440, height: theme === 'light' ? 680 : 900 });
                await page.focus('.notification-update-action');
                await page.screenshot({ path: path.join(output, `update-${theme}.png`) });
            }
            await page.keyboard.press('Enter');
            await eventually(async () => assert.deepEqual((await status()).opens, [pageUrl]), 'Explicit action opens only fixed destination');
            await page.evaluate(async () => { await Promise.all([ipcRenderer.invoke('updates:check'), ipcRenderer.invoke('updates:check')]); await refresh(); });
            assert.equal(await page.$$eval('.notification-update-action', elements => elements.length), 1);
            await page.$eval('.notification-update-action', e => e.closest('article').querySelector('.notification-close').click());
            await page.waitForFunction('!document.querySelector(".notification-update-action")');
            await page.evaluate(() => ipcRenderer.invoke('updates:check'));
            assert.equal(await page.$('.notification-update-action'), null);
            // Main retains session ownership even if the renderer reloads.
            await page.reload(); await page.waitForFunction('!!furyDesign && !!state?.settings');
            await eventually(async () => assert((await status()).settled >= 5), 'Reload check completed');
            assert.equal(await page.$('.notification-update-action'), null);
        } else {
            await eventually(async () => assert((await status()).settled >= 1), 'Silent check completion');
            assert.equal(await page.$('.notification-update-action'), null);
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
    for (const mode of ['available', 'equal', 'malformed', 'timeout', 'dev-disabled']) await scenario(mode);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, platform: process.platform, architecture: process.arch, packaged: false, results, requests }, null, 2));
    console.log(JSON.stringify({ passed: true, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const child of children) await stopChild(child);
    for (const socket of sockets) socket.destroy();
    server.close();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
