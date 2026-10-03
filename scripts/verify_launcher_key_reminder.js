'use strict';

// Run through verify_launcher_redesign --focus key-reminder, which launches the
// production Electron app with isolated data and blocked external networking.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { HOUR } = require('../src/reminders/hypixelKeyReminder');

module.exports = async function verify({ page, output, profile }) {
    const keyFile = path.join(profile, 'statmod_key.txt');
    const click = selector => page.locator(selector).click();
    const readText = selector => page.$eval(selector, el => el.textContent);
    await page.evaluate("openGlobalSearchEntry({page:'settings',category:'api',element:document.getElementById('key-hypixel')})");
    await page.waitForSelector('#key-hypixel', { visible: true });
    assert(await page.$eval('#hypixel-key-snooze', el => el.disabled));
    assert((await readText('#hypixel-key-reminder-status')).includes('Add a Hypixel'));

    // Exercise the normal auto-save path, not a renderer-only fixture.
    async function enterKey(value) {
        await page.$eval('#key-hypixel', (el, key) => {
            el.value = key;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        await page.waitForFunction('!settingsSaveInFlight');
        await page.evaluate('refresh()');
    }
    await enterKey('launcher-fixture-key');
    assert(fs.readFileSync(keyFile, 'utf8').includes('Hypixel API key: launcher-fixture-key'));
    assert((await readText('#hypixel-key-reminder-status')).includes('3 hours before'));
    const saved = await page.evaluate('state.settings.keyMeta.hypixelSavedAt');
    assert(saved > Date.now() - 30000);
    await enterKey('launcher-fixture-key');
    assert.strictEqual(await page.evaluate('state.settings.keyMeta.hypixelSavedAt'), saved);

    async function ageKey(hours) {
        const raw = fs.readFileSync(keyFile, 'utf8').replace(/^Hypixel API key saved at:.*$/m,
            `Hypixel API key saved at: ${Date.now() - hours * HOUR}`);
        fs.writeFileSync(keyFile, raw);
        await page.evaluate('refresh()');
    }
    await ageKey(45.5);
    assert((await readText('#hypixel-key-reminder-status')).includes('within 3 hours'));
    await ageKey(47.5);
    assert((await readText('#hypixel-key-reminder-status')).includes('less than 1 hour'));
    assert((await readText('#hypixel-key-reminder-summary')).includes('less than 1 hour'));
    await page.$eval('[data-api-card="hypixel"]', el => { el.open = false; });
    assert(await page.$eval('#hypixel-key-reminder-summary', el => el.checkVisibility()), 'Expiry warning must remain visible when the card is collapsed');
    await page.$eval('[data-api-card="hypixel"]', el => { el.open = true; });
    const ageBeforeSnooze = await page.evaluate('state.settings.keyMeta.hypixelSavedAt');
    await page.focus('#hypixel-key-snooze');
    await page.keyboard.press('Enter');
    await page.waitForFunction('document.getElementById("hypixel-key-snooze").textContent === "Snoozed for 24 hours"');
    const snoozed = await page.evaluate('state.settings.keyMeta.hypixelSnoozedUntil');
    assert(Math.abs(snoozed - Date.now() - 24 * HOUR) < 30000);
    assert.strictEqual(await page.evaluate('state.settings.keyMeta.hypixelSavedAt'), ageBeforeSnooze);
    assert(fs.readFileSync(keyFile, 'utf8').includes(`Hypixel reminder snoozed until: ${snoozed}`));
    await ageKey(49);
    assert((await readText('#hypixel-key-reminder-status')).includes('48-hour expiry'));
    assert((await readText('#hypixel-key-reminder-expiry')).includes('snoozed until'));

    for (const [width, height] of [[1440, 900], [1024, 680]]) {
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.$eval('#hypixel-key-reminder', el => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: path.join(output, `hypixel-key-reminder-${width}.png`) });
        assert(await page.$eval('[data-api-card="hypixel"]', el => el.scrollWidth <= el.clientWidth + 2), 'Hypixel card must not overflow');
        assert(await page.$eval('#hypixel-key-snooze', el => el.disabled));
    }

    await page.evaluate(`window.keyDashboardOpen = ''; window.realKeyOpenExternal = shell.openExternal; shell.openExternal = url => {window.keyDashboardOpen=url;return Promise.resolve();};`);
    await click('#hypixel-key-dashboard');
    assert.strictEqual(await page.evaluate('window.keyDashboardOpen'), 'https://developer.hypixel.net/dashboard/');
    await page.evaluate('shell.openExternal = window.realKeyOpenExternal');
    await enterKey('replacement-launcher-fixture');
    assert.strictEqual(await page.evaluate('state.settings.keyMeta.hypixelSnoozedUntil'), 0);
    assert((await readText('#hypixel-key-reminder-status')).includes('3 hours before'));
    assert(!await page.$eval('#hypixel-key-snooze', el => el.disabled));
    const stale = await page.evaluate(`ipcRenderer.invoke('settings:save-hypixel-reminder-snooze','launcher-fixture-key').then(()=>false,()=>true)`);
    assert(stale, 'a stale snooze request must not snooze a replacement key');
    await enterKey('');
    assert((await readText('#hypixel-key-reminder-status')).includes('Add a Hypixel'));
    assert(await page.$eval('#hypixel-key-snooze', el => el.disabled));
    console.log('PASS Key entry, phase changes, keyboard snooze, persisted metadata, dashboard and stale-key protection');
};
