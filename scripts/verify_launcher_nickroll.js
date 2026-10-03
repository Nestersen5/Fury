'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, assertRunning, eventually, uiTestArguments } = require('./smoke_packaged_app');
const target = require('./launcher_verification_target').verificationTarget('launcher-nickroll');

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-nickroll-check-'));
    const [debugPort, cosmeticPort, blockedPort] = await unusedPorts(3);
    const env = cleanEnvironment(profile, target.resources, cosmeticPort, blockedPort);
    if (!target.packaged) env.NODE_BINARY = process.execPath;
    const child = startChild(target.executable, [
        ...target.args, ...uiTestArguments(),
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1',
        `--proxy-server=${env.HTTPS_PROXY}`
    ], env, 'Nick Reroller launcher verification');
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
        await page.click('[data-page-tab="nickroll"]');
        await page.waitForFunction(() => !document.querySelector('#nickroll-controls').disabled);
        assert.equal(await page.$eval('[name="ogEnabled"]', el => el.checked), true);
        const before = await page.evaluate(() => state.settings.features.anticheatEnabled);
        const rankTrigger = '#nickroll-rank + .stat-select-trigger';
        for (const id of ['nickroll-rank', 'nickroll-skinMode']) {
            assert.equal(await page.$eval(`#${id}`, el => getComputedStyle(el).display), 'none', 'Native selects must not duplicate styled controls');
            assert.equal(await page.$$eval(`#${id} + .stat-select-trigger`, els => els.length), 1);
        }
        await page.click('#nickroll-skinMode + .stat-select-trigger');
        await page.click('[data-stat-select-for="nickroll-skinMode"] [data-value="actual"]');
        assert.equal(await page.$eval('[name="skinMode"]', el => el.value), 'actual');
        assert.equal(await page.$eval('#nickroll-skinMode + .stat-select-trigger .stat-select-value', el => el.textContent), 'Your current skin');
        await page.click(rankTrigger);
        const rankMenu = '[data-stat-select-for="nickroll-rank"]';
        assert.equal(await page.$eval(`${rankMenu} [data-value="VIP_PLUS"] .nickroll-rank-plus`, el => getComputedStyle(el).color), 'rgb(255, 85, 85)');
        assert.equal(await page.$eval(`${rankMenu} [data-value="MVP_PLUS"] .nickroll-rank-plus`, el => getComputedStyle(el).color), 'rgb(255, 85, 85)');
        await page.click(`${rankMenu} [data-value="VIP_PLUS"]`);
        assert.equal(await page.$eval(`${rankTrigger} .nickroll-rank-plus`, el => getComputedStyle(el).color), 'rgb(255, 85, 85)');
        assert.equal(await page.$eval('[name="rank"]', el => el.value), 'VIP_PLUS');
        await page.click('[name="enableRules"]');
        await page.select('[name="rank"]', 'VIP');
        assert.equal(await page.$eval('[name="rank"]', el => getComputedStyle(el).color), 'rgb(85, 255, 85)');
        await page.select('[name="rank"]', 'MVP');
        assert.equal(await page.$eval('[name="rank"]', el => getComputedStyle(el).color), 'rgb(85, 255, 255)');
        await page.select('[name="skinMode"]', 'previous');
        assert.equal(await page.$('[name="skinPreset"]'), null);
        assert.equal(await page.$('[name="adaptive"]'), null);
        assert.equal(await page.$('[name="delay"]'), null);
        const rejected = await page.evaluate(async () => {
            try { await ipcRenderer.invoke('settings:save-features', { features: { nickRoll: { min: 15, max: 4 } } }); return false; }
            catch { return true; }
        });
        assert(rejected, 'Main must reject invalid settings independently of the form');
        await page.evaluate(() => {
            const form = document.getElementById('nickroll-form');
            form.elements.ogEnabled.checked = false;
            form.elements.prefix.value = 'cat';
            form.elements.words.value = 'moon, SUN';
            form.elements.wordGroups.value = 'fresh head';
            form.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => document.getElementById('nickroll-save-status').textContent.startsWith('Saved.'));
        const saved = JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'), 'utf8'));
        assert.equal(saved.nickRoll.ogEnabled, false);
        assert.equal(saved.nickRoll.prefix, 'cat');
        assert.equal(saved.nickRoll.skin, 'previous');
        assert.equal(saved.nickRoll.adaptive, true);
        assert.deepEqual(saved.nickRoll.words, ['moon', 'sun']);
        assert.deepEqual(saved.nickRoll.wordGroups, [['fresh', 'head']]);
        assert.equal(saved.anticheatEnabled, before);
        await page.evaluate(() => {
            const form = document.getElementById('nickroll-form');
            form.elements.enableLength.checked = true;
            form.elements.enableLength.dispatchEvent(new Event('change', { bubbles: true }));
            form.elements.min.value = '12';
            form.elements.max.value = '4';
            form.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => document.getElementById('nickroll-save-status').textContent.includes('Could not save'));
        assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'), 'utf8')).nickRoll.min, 3);
        assert.equal(await page.$eval('[name="min"]', el => el.value), '12', 'Keep invalid drafts visible');
        assert.equal(await page.$('#nickroll-discard'), null);
        assert.equal(await page.$('#nickroll-form button[type="submit"]'), null);
        await page.evaluate(() => {
            const form = document.getElementById('nickroll-form');
            form.elements.min.value = '3'; form.elements.max.value = '16';
            form.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => document.getElementById('nickroll-save-status').textContent.startsWith('Saved.'));

        await page.reload();
        await page.waitForFunction('state?.settings && typeof activatePage === "function"');
        await page.click('[data-page-tab="nickroll"]');
        await page.waitForFunction(() => !document.querySelector('#nickroll-controls').disabled);
        assert.equal(await page.$eval('[name="ogEnabled"]', el => el.checked), false);
        assert.equal(await page.$eval('[name="prefix"]', el => el.value), 'cat');
        await page.screenshot({ path: path.join(profile, 'nickroll.png') });
        console.log('Screenshot: ' + path.join(profile, 'nickroll.png'));
        await page.setViewport({ width: 1000, height: 760 });
        assert(await page.$eval('#nickroll-form', el => el.getBoundingClientRect().right <= innerWidth));
        await page.$eval('#nickroll-save-status', el => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: path.join(profile, 'nickroll-bottom.png') });
        assert.deepEqual(errors, []);
        console.log('PASS nickrolling navigation, autosave, invalid drafts, reload and layout.');
    } finally {
        if (browser) await browser.disconnect();
        await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
