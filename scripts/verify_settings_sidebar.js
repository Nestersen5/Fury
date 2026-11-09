'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, assertRunning, eventually, uiTestArguments } = require('./smoke_packaged_app');

const target = require('./launcher_verification_target').verificationTarget('settings-sidebar');
(async () => {
    const root = path.resolve(__dirname, '..');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-sidebar-check-'));
    const [debugPort, cosmeticPort, blockedPort] = await unusedPorts(3);
    const env = cleanEnvironment(profile, target.resources, cosmeticPort, blockedPort);
    if (!target.packaged) env.NODE_BINARY = process.execPath;
    const child = startChild(target.executable, [...target.args, ...uiTestArguments(), `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--proxy-server=${env.HTTPS_PROXY}`], env, 'Settings sidebar verification');
    let browser;
    try {
        browser = await eventually(async () => {
            assertRunning(child);
            return puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null });
        }, 'Connecting launcher');
        const page = await eventually(async () => {
            const result = (await browser.pages()).find(p => p.url().endsWith('/launcher.html'));
            assert(result);
            return result;
        }, 'Opening launcher');
        await page.waitForFunction('typeof furyDesign !== "undefined" && furyDesign');
        for (const width of [1440, 1024]) {
            await page.setViewport({ width, height: width === 1440 ? 900 : 680 });
            for (const preference of ['expanded', 'collapsed']) {
                await page.evaluate(value => { activatePage('dashboard'); window.NesterTheme.applySidebar(value); }, preference);
                await page.locator('[data-page-tab="settings"]').click();
                await page.waitForFunction('document.documentElement.dataset.sidebar === "collapsed"');
                const result = await page.evaluate(() => ({
                    saved: localStorage.getItem('fury-sidebar-v1'),
                    labelsHidden: [...document.querySelectorAll('.nav-tabs .fury-nav-label')].every(e => !e.checkVisibility()),
                    accessible: [...document.querySelectorAll('.nav-tab')].every(e => e.title && e.getAttribute('aria-label')),
                    railWidth: document.querySelector('.app-rail').getBoundingClientRect().width,
                    categories: document.querySelectorAll('.ds-settings-items button').length,
                    settingsVisible: document.querySelector('.ds-settings-nav').checkVisibility(),
                    labelsFit: [...document.querySelectorAll('.ds-settings-items button')].every(e=>e.textContent.trim()&&e.scrollWidth<=e.clientWidth+1)
                }));
                assert.strictEqual(result.saved, preference);
                assert(result.labelsHidden && result.accessible,JSON.stringify(result));
                assert(result.railWidth>=200&&result.settingsVisible&&result.labelsFit);
                assert.strictEqual(result.categories, 12);
                await page.locator('[data-ds-category="sessions"]').click();
                assert(await page.$eval('[data-settings-subpage="sessions"]', e => e.classList.contains('active')));
                await page.locator('.ds-back').click();
                assert.strictEqual(await page.evaluate('document.documentElement.dataset.sidebar'), preference);
            }
        }
        await page.evaluate(() => {
            activatePage('settings');
            window.NesterTheme.applySidebar('expanded');
        });
        assert.strictEqual(await page.evaluate('document.documentElement.dataset.sidebar'), 'collapsed');
        await page.evaluate("activatePage('dashboard')");
        assert.strictEqual(await page.evaluate('document.documentElement.dataset.sidebar'), 'expanded');
        console.log('PASS Dedicated settings navigation, readable categories, accessible icons, saved sidebar preferences and Back restoration at both viewport sizes');
        target.record();
    } finally {
        if (browser) await browser.disconnect();
        await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
