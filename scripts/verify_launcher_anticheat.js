'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, assertRunning, eventually, uiTestArguments } = require('./smoke_packaged_app');
const target = require('./launcher_verification_target').verificationTarget('launcher-anticheat');

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-anticheat-check-'));
    const [debugPort, cosmeticPort, blockedPort] = await unusedPorts(3);
    const env = cleanEnvironment(profile, target.resources, cosmeticPort, blockedPort);
    if (!target.packaged) env.NODE_BINARY = process.execPath;
    const child = startChild(target.executable, [
        ...target.args, ...uiTestArguments(),
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1',
        `--proxy-server=${env.HTTPS_PROXY}`
    ], env, 'AntiCheat launcher verification');
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
        page.on('pageerror', error => errors.push(error.message));
        await page.waitForFunction('state?.settings && typeof activatePage === "function"');
        await page.evaluate(() => activatePage('anticheat'));
        assert.equal(await page.$eval('[data-page="anticheat"]', element => element.classList.contains('active')), true);
        assert.equal(await page.$eval('#anticheat-enabled', element => element.checked), true);
        assert.equal(await page.$eval('#anticheat-autoblock-enabled', element => element.checked), false);
        assert.equal(await page.$eval('#anticheat-stasis-enabled', element => element.checked), false);
        assert.equal(await page.$eval('#anticheat-team-alerts-enabled', element => element.checked), false);
        assert.equal(await page.$eval('#anticheat-detectors input', element => element.disabled), false);
        assert.equal(await page.$eval('#anticheat-checks-heading', element => element.textContent), 'Detection checks');
        assert.equal(await page.$eval('.anticheat-recommendation', element => element.textContent), 'Recommended');
        const layout = await page.evaluate(() => {
            const master = document.querySelector('.anticheat-master-row');
            const group = document.getElementById('anticheat-detectors');
            const masterRect = master.getBoundingClientRect();
            const groupRect = group.getBoundingClientRect();
            return {
                masterLeft: masterRect.left, masterBottom: masterRect.bottom,
                groupLeft: groupRect.left, groupTop: groupRect.top,
                headingLeft: document.getElementById('anticheat-checks-heading').getBoundingClientRect().left,
                childLeft: document.querySelector('#anticheat-detectors .feature-card h3').getBoundingClientRect().left,
                groupBorder: getComputedStyle(group).borderLeftWidth,
                masterBackground: getComputedStyle(master).backgroundColor,
                groupBackground: getComputedStyle(group).backgroundColor,
                titleColor: getComputedStyle(document.querySelector('.anticheat-recommendation').closest('h3')).color,
                noteColor: getComputedStyle(document.querySelector('.anticheat-recommendation')).color
            };
        });
        assert(Math.abs(layout.masterLeft - layout.headingLeft) <= 1, 'Master row and section headings should align');
        assert(layout.groupTop >= layout.masterBottom + 8, 'Checks should be a separate panel below AntiCheat');
        assert(Math.abs(layout.childLeft - layout.headingLeft) <= 1, 'Detector rows and section headings should align');
        assert.equal(layout.groupBorder, '1px', 'Checks should use a boxed panel, not a vertical rail');
        const rows = await page.$$eval('[data-page="anticheat"] .feature-card', elements => elements.map(element => ({
            left: element.querySelector('h3').getBoundingClientRect().left,
            right: element.querySelector('.switch').getBoundingClientRect().right,
            description: Boolean(element.querySelector('small')?.textContent.trim())
        })));
        assert(rows.every(row => Math.abs(row.left - rows[0].left) <= 1 && Math.abs(row.right - rows[0].right) <= 1 && row.description), 'All settings should have aligned labels, controls, and descriptions');
        assert.notEqual(layout.noteColor, layout.titleColor, 'Recommendation should be visually quieter');
        await page.screenshot({ path: path.join(target.output, 'anticheat.png') });
        const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
        const lightSurfaces = await page.evaluate(() => ({
            master: getComputedStyle(document.querySelector('.anticheat-master-row')).backgroundColor,
            checks: getComputedStyle(document.getElementById('anticheat-detectors')).backgroundColor
        }));
        assert.notEqual(lightSurfaces.master, lightSurfaces.checks, 'Checks should remain distinct in the light theme');
        await page.screenshot({ path: path.join(target.output, 'anticheat-light.png') });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, originalTheme);

        await page.$eval('#anticheat-enabled', input => input.closest('label').click());
        assert.equal(await page.$eval('#anticheat-detectors', element => element.classList.contains('is-disabled')), true);
        assert.equal(await page.$eval('#anticheat-detectors input', element => element.disabled), true);
        await page.$eval('#anticheat-scaffold-enabled', input => input.click());
        assert.equal(await page.$eval('#anticheat-scaffold-enabled', element => element.checked), true);
        try {
            await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight', { timeout: 10000 });
        } catch (error) {
            console.error('First save state:', await page.evaluate(() => ({
                featureSaveTimer: Boolean(featureSaveTimer), featureSaveInFlight, featureSaveQueued,
                settingsSaveState: settingsSaveStates.get('features'),
                lastStatus: document.getElementById('save-status').textContent
            })));
            console.error('Page errors:', errors);
            throw error;
        }
        await page.evaluate(() => window.FuryNotifications.dismissAll());
        await page.screenshot({ path: path.join(target.output, 'anticheat-off.png') });
        await page.$eval('#anticheat-enabled', input => input.closest('label').click());
        assert.equal(await page.$eval('#anticheat-detectors input', element => element.disabled), false);
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');

        await page.evaluate(() => {
            for (const id of ['anticheat-scaffold-enabled', 'anticheat-possible-alerts-enabled', 'anticheat-enabled']) {
                const input = document.getElementById(id);
                input.checked = false;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const team = document.getElementById('anticheat-team-alerts-enabled');
            team.checked = true;
            team.dispatchEvent(new Event('change', { bubbles: true }));
        });
        try {
            await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight', { timeout: 10000 });
        } catch (error) {
            console.error('Save state:', await page.evaluate(() => ({
                featureSaveTimer: Boolean(featureSaveTimer), featureSaveInFlight, featureSaveQueued,
                settingsSaveState: settingsSaveStates.get('features'),
                lastStatus: document.getElementById('save-status').textContent
            })));
            console.error('Page errors:', errors);
            throw error;
        }
        await page.evaluate(async () => { await refresh(); });
        const saved = JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'), 'utf8'));
        assert.equal(saved.anticheatEnabled, false);
        assert.equal(saved.anticheatScaffoldEnabled, false);
        assert.equal(saved.anticheatPossibleAlertsEnabled, false);
        assert.equal(saved.anticheatTeamAlertsEnabled, true);
        assert.equal(saved.anticheatAutoblockEnabled, false);
        assert.equal(saved.anticheatStasisEnabled, false);
        await page.setViewport({ width: 1000, height: 760 });
        const narrow = await page.evaluate(() => {
            const master = document.querySelector('.anticheat-master-row').getBoundingClientRect();
            const group = document.getElementById('anticheat-detectors').getBoundingClientRect();
            const masterSwitch = document.querySelector('.anticheat-master-row .switch').getBoundingClientRect();
            const groupSwitches = [...document.querySelectorAll('#anticheat-detectors .switch')];
            return { panelRight: Math.max(master.right, group.right), viewportRight: window.innerWidth,
                switchesInside: masterSwitch.right <= master.right && groupSwitches.every(element => element.getBoundingClientRect().right <= group.right) };
        });
        assert(narrow.panelRight <= narrow.viewportRight && narrow.switchesInside, 'Grouped checks should fit the narrower launcher');
        assert.deepEqual(errors, []);
        target.record();
        console.log('PASS grouped AntiCheat checks, disabled detectors, recommendation styling, autosave, and stored settings.');
    } finally {
        if (browser) await browser.disconnect();
        await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
