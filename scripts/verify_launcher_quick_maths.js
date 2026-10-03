'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, assertRunning, eventually, uiTestArguments } = require('./smoke_packaged_app');
const target = require('./launcher_verification_target').verificationTarget('launcher-quick-maths');

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-quick-maths-check-'));
    const [debugPort, cosmeticPort, blockedPort] = await unusedPorts(3);
    const env = cleanEnvironment(profile, target.resources, cosmeticPort, blockedPort);
    if (!target.packaged) env.NODE_BINARY = process.execPath;
    const child = startChild(target.executable, [
        ...target.args, ...uiTestArguments(),
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1',
        `--proxy-server=${env.HTTPS_PROXY}`
    ], env, 'Quick Maths launcher verification');
    let browser;
    try {
        browser = await eventually(async () => {
            assertRunning(child);
            return puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null });
        }, 'Connecting launcher');
        const page = await eventually(async () => {
            const found = (await browser.pages()).find(candidate => candidate.url().endsWith('/launcher.html'));
            assert(found);
            return found;
        }, 'Opening launcher');
        const errors = [];
        page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
        page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
        await page.bringToFront();
        await page.waitForFunction('state?.settings && typeof activatePage === "function"', { polling: 100 });
        await page.evaluate(() => { activatePage('settings'); activateSettingsSubpage('gameplay'); });
        const selector = '#quick-maths-enabled';
        assert.equal(await page.$eval(selector, input => input.checked), false);
        assert.equal(await page.$eval(selector, input => input.getAttribute('aria-label')), 'Auto Quick Maths');
        await page.$eval(selector, input => input.closest('label').click());
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight', { polling: 100 });
        const saved = () => JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'), 'utf8'));
        assert.equal(saved().quickMathsEnabled, true, 'Autosave must persist enablement');
        await page.evaluate(async () => { await refresh(); });
        assert.equal(await page.$eval(selector, input => input.checked), true, 'Refresh must retain enablement');
        for (const theme of ['dark', 'light']) {
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
            await page.$eval(selector, input => input.closest('.fc-module').scrollIntoView({ block: 'center' }));
            await page.screenshot({ path: path.join(target.output, `quick-maths-${theme}.png`) });
        }
        await page.setViewport({ width: 1000, height: 760 });
        const fits = await page.$eval(selector, input => {
            const card = input.closest('.feature-card').getBoundingClientRect();
            const toggle = input.closest('.fury-binary-choice').getBoundingClientRect();
            return card.width > 0 && card.right <= innerWidth && toggle.right <= card.right;
        });
        assert(fits, 'Quick Maths control must fit the narrow layout');
        await page.focus('.fury-binary-choice:has(#quick-maths-enabled) .fury-binary-off');
        await page.keyboard.press('Space');
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight', { polling: 100 });
        assert.equal(saved().quickMathsEnabled, false, 'Keyboard toggle must persist disablement');
        await page.reload();
        await page.waitForFunction('state?.settings && typeof activatePage === "function"');
        assert.equal(await page.$eval(selector, input => input.checked), false, 'Reload must retain disablement');
        assert.deepEqual(errors, []);
        target.record();
        console.log('PASS Quick Maths launcher control, autosave, refresh, reload, themes, narrow layout and keyboard toggle.');
    } finally {
        if (browser) await browser.disconnect();
        await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
