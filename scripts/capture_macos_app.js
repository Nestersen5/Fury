'use strict';

// Capture the actual packaged app on a Mac runner. No mock data or image generation.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');
const {
    packagePaths, cleanEnvironment, getJson, unusedPorts,
    startChild, stopChild, assertRunning, eventually, connectDevtools, uiTestArguments
} = require('./smoke_packaged_app.js');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    assert.strictEqual(process.platform, 'darwin', 'Screenshots must be captured on macOS');
    assert(process.argv[2] && process.argv[3], 'Usage: node scripts/capture_macos_app.js <Fury.app> <output directory>');
    const { executable, resources, appRoot } = packagePaths(process.argv[2]);
    const output = path.resolve(process.argv[3]);
    fs.mkdirSync(output, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-mac-screenshot-'));
    const [directPort, failoverPort, healthPort, cosmeticPort, debugPort, blockedPort] = await unusedPorts(7);
    const env = cleanEnvironment(temporary, resources, cosmeticPort, blockedPort);
    fs.writeFileSync(path.join(temporary, 'server_config.json'), JSON.stringify({
        proxyDirectPort: directPort, proxyFailoverPort: failoverPort, healthPort,
        proxyDirectHost: '127.0.0.1', proxyFailoverHost: '127.0.0.1'
    }));
    fs.writeFileSync(path.join(temporary, 'features_config.json'), JSON.stringify({ apiKillSwitchEnabled: true }));
    const appRequire = createRequire(path.join(appRoot, 'package.json'));
    const errors = [];
    const connections = [];
    const captures = [];
    let mainPage;
    const launcher = startChild(executable, [
        ...uiTestArguments(),
        `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1',
        `--proxy-server=${env.HTTPS_PROXY}`
    ], env, 'Mac screenshot app');

    async function page(filename, overlay = false) {
        const target = await eventually(async () => {
            assertRunning(launcher);
            const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
            const found = targets.find(item => item.type === 'page'
                && new URL(item.url).pathname.endsWith(`/${filename}`)
                && new URL(item.url).searchParams.has('overlayWindow') === overlay);
            assert(found, `Waiting for ${filename}`);
            return found;
        }, `Opening ${filename}`);
        const connection = await connectDevtools(appRequire, target, errors);
        connections.push(connection);
        await eventually(async () => {
            assert.strictEqual(await connection.evaluate('document.readyState'), 'complete');
            assert(await connection.evaluate('Boolean(document.body && document.body.children.length)'));
        }, `Rendering ${filename}`);
        await connection.evaluate('document.fonts.ready.then(() => true)');
        return connection;
    }

    async function screenshot(connection, name, description) {
        await connection.call('Page.bringToFront');
        await delay(1200);
        const shot = await connection.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        fs.writeFileSync(path.join(output, name), Buffer.from(shot.data, 'base64'));
        captures.push({ file: name, description, method: 'Actual macOS Electron renderer capture' });
        console.log(`Captured ${name}`);
    }

    function desktop(name, description) {
        try {
            execFileSync('/usr/sbin/screencapture', ['-x', '-t', 'png', path.join(output, name)], { timeout: 20000 });
            captures.push({ file: name, description, method: 'macOS screencapture desktop capture' });
            console.log(`Captured ${name}`);
        } catch (error) {
            console.log(`Desktop capture unavailable: ${error.message}`);
        }
    }

    async function navigate(pageName, subpage) {
        const nav = `.nav-tab[data-page-tab="${pageName}"]`;
        await mainPage.evaluate(`(() => { const button = document.querySelector(${JSON.stringify(nav)}); if (!button) throw new Error('Missing navigation button'); button.click(); })()`);
        await eventually(async () => {
            assert(await mainPage.evaluate(`document.querySelector('[data-page="${pageName}"]').classList.contains('active')`));
        }, `Navigating to ${pageName}`);
        if (subpage) {
            const selector = `[data-settings-subpage-button="${subpage}"]`;
            await mainPage.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        }
    }

    async function captureSections(name, description) {
        await mainPage.evaluate("document.activeElement?.blur();document.querySelectorAll('.notification-close').forEach(button=>button.click());document.querySelector('main').scrollTop=0");
        await delay(400);
        const size = await mainPage.evaluate("({height:document.querySelector('main').clientHeight,total:document.querySelector('main').scrollHeight})");
        const end = Math.max(0, size.total - size.height);
        const positions = [0];
        for (let top = Math.max(200, size.height - 100); top < end; top += Math.max(200, size.height - 100)) positions.push(top);
        if (end > 0) positions.push(end);
        for (const [index, top] of positions.entries()) {
            await mainPage.evaluate(`document.querySelector('main').scrollTop=${top}`);
            await screenshot(mainPage, `${name}-${String(index + 1).padStart(2, '0')}.png`, `${description} (section ${index + 1}/${positions.length})`);
        }
    }

    try {
        mainPage = await page('launcher.html');
        await mainPage.evaluate("require('electron').ipcRenderer.invoke('service:start', 'proxy')");
        await eventually(async () => {
            const health = await getJson(`http://127.0.0.1:${healthPort}/health`);
            assert.strictEqual(health.ok, true);
        }, 'Starting actual proxy services');
        await delay(3000);
        await navigate('dashboard');
        await screenshot(mainPage, '01-launcher-home.png', 'Launcher home with the actual proxy running; no Minecraft account connected');
        desktop('02-macos-desktop-home.png', 'macOS desktop with the running Fury launcher');

        const menus = await mainPage.evaluate("[...document.querySelectorAll('.nav-tab[data-page-tab]')].filter(el=>el.checkVisibility()).map(el=>({key:el.dataset.pageTab,title:el.title||el.textContent.trim()}))");
        const settings = await mainPage.evaluate("[...document.querySelectorAll('[data-settings-subpage-button]')].map(el=>({key:el.dataset.settingsSubpageButton,title:el.querySelector('strong')?.textContent||el.textContent.trim()}))");
        for (const menu of menus) {
            await navigate(menu.key);
            if (menu.key === 'settings') {
                for (const category of settings) {
                    await navigate('settings', category.key);
                    if (category.key === 'display') {
                        for (const tab of ['tablist', 'nametags', 'colors']) {
                            await mainPage.evaluate(`furyDesign.showIngame('${tab}')`);
                            await captureSections(`menu-settings-${tab}`, `In-game appearance: ${tab}`);
                        }
                    } else await captureSections(`menu-settings-${category.key}`, `Settings: ${category.title}`);
                }
            } else await captureSections(`menu-${menu.key}`, menu.title);
        }

        await navigate('overlay');
        await screenshot(mainPage, '06-player-board.png', 'Player board with no Minecraft session connected');
        desktop('07-macos-desktop-board.png', 'macOS desktop showing the launcher player board');

        await navigate('dashboard');
        await mainPage.evaluate("furyDesign.openManager()");
        await screenshot(mainPage, '08-accounts.png', 'Account manager on a fresh installation');
        desktop('09-macos-desktop-accounts.png', 'macOS desktop with the Fury account manager');

        assert.deepStrictEqual(errors, [], 'Unexpected renderer errors during capture');
        const state = await mainPage.evaluate("require('electron').ipcRenderer.invoke('state:get', {activePage:'dashboard'})");
        const metadata = {
            capturedAt: new Date().toISOString(),
            os: execFileSync('/usr/bin/sw_vers', [], { encoding: 'utf8' }).trim(),
            architecture: process.arch,
            graphics: uiTestArguments().length ? 'SwiftShader (CI virtual GPU)' : 'default',
            appVersion: appRequire('./package.json').version,
            sourceBuildRun: process.env.FURY_SOURCE_BUILD_RUN || (process.env.GITHUB_RUN_ID
                ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null),
            sourceCommit: process.env.GITHUB_SHA || null,
            menus, settings,
            connectedAccount: state.proxyHealth?.connectedAccount || null,
            conditions: 'Actual packaged app. Fresh profile, no account, no fake statistics. Local proxy running with isolated test ports and external API traffic disabled.',
            captures
        };
        fs.writeFileSync(path.join(output, 'capture-info.json'), JSON.stringify(metadata, null, 2));
    } finally {
        if (mainPage) {
            try { await mainPage.evaluate("require('electron').ipcRenderer.invoke('service:stop', 'proxy')"); } catch {}
            try { await mainPage.evaluate("require('electron').ipcRenderer.invoke('service:stop', 'cosmeticSearch')"); } catch {}
        }
        connections.forEach(connection => connection.close());
        await stopChild(launcher);
        fs.writeFileSync(path.join(output, 'launcher.log'), launcher.output);
        assert.strictEqual(path.dirname(temporary), path.resolve(os.tmpdir()));
        assert(path.basename(temporary).startsWith('fury-mac-screenshot-'));
        fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
