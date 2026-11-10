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

    // The simplified page keeps the main form visible and optional controls reachable.
    assert(await page.$eval('#key-hypixel', el => el.checkVisibility()));
    assert(!await page.$eval('#key-urchin', el => el.checkVisibility()));
    assert(!await page.$eval('#key-aurora', el => el.checkVisibility()));
    assert(!await page.$eval('#api-kill-switch-enabled', el => el.checkVisibility()));
    assert.strictEqual((await readText('[data-api-status="hypixel"]')).trim(), 'No key added');
    assert(!await page.$eval('[data-api-card="hypixel"]>.api-key-card-body>.api-key-result', el => el.checkVisibility()));
    await page.focus('[data-api-card="urchin"]>summary');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#key-urchin', { visible: true });
    await page.focus('[data-api-card="urchin"]>summary');
    await page.keyboard.press('Space');
    assert(!await page.$eval('#key-urchin', el => el.checkVisibility()));
    await page.focus('.da-api-advanced>summary');
    await page.keyboard.press('Enter');
    assert(await page.$eval('#api-kill-switch-enabled', el => el.checkVisibility()));
    assert(await page.$eval('.da-api-paused', el => el.checkVisibility()), 'Active API pause must remain visible in the Advanced summary');
    await page.focus('#api-kill-switch-enabled');
    await page.keyboard.press('Space');
    await page.waitForFunction('state.settings.features.apiKillSwitchEnabled===false && !featureSaveInFlight');
    assert(!await page.$eval('.da-api-paused', el => el.checkVisibility()));
    await page.focus('#api-kill-switch-enabled');
    await page.keyboard.press('Space');
    await page.waitForFunction('state.settings.features.apiKillSwitchEnabled===true && !featureSaveInFlight');
    await page.$eval('.da-api-advanced', el => { el.open = false; });
    await page.evaluate("openGlobalSearchEntry({page:'settings',category:'api',control:document.getElementById('key-urchin-admin')})");
    await page.waitForSelector('#key-urchin-admin', { visible: true });
    assert(await page.$eval('.da-api-advanced', el => el.open));
    await page.$eval('.da-api-advanced', el => { el.open = false; });

    await click('[data-key-toggle="hypixel"]');
    assert.strictEqual(await page.$eval('#key-hypixel', el => el.type), 'text');
    assert.strictEqual(await page.$eval('[data-key-toggle="hypixel"]', el => el.getAttribute('aria-label')), 'Hide Hypixel API key');
    await page.focus('[data-key-toggle="hypixel"]');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.$eval('#key-hypixel', el => el.type), 'password');
    assert.strictEqual(await page.$eval('[data-key-toggle="hypixel"]', el => el.getAttribute('aria-pressed')), 'false');
    await click('[data-api-test="hypixel"]');
    await page.waitForFunction('!document.querySelector("[data-api-test=hypixel]").disabled');
    assert.strictEqual((await readText('[data-api-detail="hypixel"]')).trim(), 'Enter a key before testing.');
    assert(await page.$eval('[data-api-detail="hypixel"]', el => el.checkVisibility()));

    // Drive the real test-button handler with deterministic provider replies.
    await page.evaluate(() => {
        window.realApiTestInvoke = ipcRenderer.invoke;
        ipcRenderer.invoke = async (channel, ...args) => channel === 'api-key:test'
            ? window.apiTestReply : window.realApiTestInvoke(channel, ...args);
    });
    try {
        for (const [reply, label] of [
            [{ ok: false, state: 'invalid key', detail: 'The provider rejected this API key.' }, 'Invalid key'],
            [{ ok: false, state: 'unreachable', detail: 'Could not reach the provider.' }, 'Couldn’t connect'],
            [{ ok: true, state: 'rate limited', detail: 'Try again later.' }, 'Try again later'],
            [{ ok: true, state: 'available', detail: 'Hypixel accepted this API key.' }, 'Working']
        ]) {
            await page.evaluate(reply => { window.apiTestReply = reply; }, reply);
            await click('[data-api-test="hypixel"]');
            await page.waitForFunction('!document.querySelector("[data-api-test=hypixel]").disabled');
            assert.strictEqual((await readText('[data-api-status="hypixel"]')).trim(), label);
            assert(await page.$eval('[data-api-detail="hypixel"]', el => el.checkVisibility()));
        }
    } finally {
        await page.evaluate('ipcRenderer.invoke=window.realApiTestInvoke; renderApiKeyCardStatus("hypixel",{state:"missing key"})');
    }
    console.log('PASS Focused API layout, optional/advanced keyboard disclosures, nested search, Show/Hide and key test feedback');

    // Copy uses the existing clipboard path without exposing or changing keys.
    assert.strictEqual(await page.$$eval('[data-key-replace]', els => els.length), 0);
    await page.evaluate(() => {
        window.originalKeyClipboardWrite = clipboard.writeText;
        clipboard.writeText = value => { window.copiedApiKey = value; };
    });
    try {
        for (const [provider, id] of [['hypixel', 'key-hypixel'], ['urchin', 'key-urchin'], ['urchinadmin', 'key-urchin-admin'], ['aurora', 'key-aurora']]) {
            await page.evaluate((provider, id) => {
                const card = document.querySelector(`[data-api-card="${provider}"]`);
                for (let ancestor = card; ancestor; ancestor = ancestor.parentElement) if (ancestor.matches('details')) ancestor.open = true;
                card.querySelector('.da-key-details').open = true;
                const input = document.getElementById(id);
                input.value = `fixture-${provider}`;
                input.type = 'password';
            }, provider, id);
            const selector = `[data-key-copy="${provider}"]`;
            assert(await page.$eval(selector, el => el.checkVisibility()));
            await page.focus(selector);
            await page.keyboard.press('Enter');
            await page.waitForFunction('document.querySelector(".fury-notification-success .notification-title")?.textContent === "API key copied to clipboard"');
            assert.strictEqual(await page.evaluate('window.copiedApiKey'), `fixture-${provider}`);
            assert.strictEqual(await page.$eval(`#${id}`, el => el.type), 'password');
            assert.strictEqual(await page.$eval(`#${id}`, el => el.value), `fixture-${provider}`);
        }
        await page.screenshot({ path: path.join(output, 'api-key-copy-notification.png') });
        await page.evaluate(() => {
            document.getElementById('key-aurora').value = '';
            document.querySelector('[data-key-copy="aurora"]').click();
        });
        await page.waitForFunction('document.querySelector(".fury-notification-warning .notification-title")?.textContent === "No API key to copy"');
        assert.strictEqual(await page.evaluate('window.copiedApiKey'), 'fixture-aurora');
        await page.evaluate(() => {
            clipboard.writeText = () => { throw new Error('Fixture clipboard failure'); };
            document.getElementById('key-aurora').value = 'fixture-aurora';
            document.querySelector('[data-key-copy="aurora"]').click();
        });
        await page.waitForFunction('document.querySelector(".fury-notification-error .notification-title")?.textContent === "Could not copy API key. Try again."');
    } finally {
        await page.evaluate(() => {
            clipboard.writeText = window.originalKeyClipboardWrite;
            for (const id of ['key-hypixel', 'key-urchin', 'key-urchin-admin', 'key-aurora']) document.getElementById(id).value = '';
            window.FuryNotifications.dismissAll();
        });
    }
    console.log('PASS All four API key Copy buttons, keyboard activation, masked values, success, empty and clipboard failure notifications');

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
        const savedAt = Date.now() - hours * HOUR;
        const raw = fs.readFileSync(keyFile, 'utf8').replace(/^Hypixel API key saved at:.*$/m,
            `Hypixel API key saved at: ${savedAt}`);
        fs.writeFileSync(keyFile, raw);
        await page.waitForFunction('!refreshInFlight');
        await page.evaluate('refresh()');
        await page.waitForFunction(savedAt => state.settings.keyMeta.hypixelSavedAt === savedAt, {}, savedAt);
    }
    await ageKey(45.5);
    assert((await readText('#hypixel-key-reminder-status')).includes('within 3 hours'));
    await ageKey(47.5);
    assert((await readText('#hypixel-key-reminder-status')).includes('less than 1 hour'));
    assert((await readText('#hypixel-key-reminder-summary')).includes('less than 1 hour'));
    await page.$eval('[data-api-card="hypixel"] .da-key-details', el => { el.open = false; });
    assert(await page.$eval('#hypixel-key-reminder-summary', el => el.checkVisibility()), 'Expiry warning must remain visible when Key details is collapsed');
    await page.$eval('[data-api-card="hypixel"] .da-key-details', el => { el.open = true; });
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

    // All supported themes and both launcher sizes must keep fields and actions usable.
    await page.evaluate(() => {
        document.querySelector('.da-api-advanced').open = false;
        document.querySelectorAll('.da-key-details,details[data-api-card]').forEach(el => { el.open = false; });
    });
    for (const theme of ['graphite','midnight','forest','light','obsidian','frost']) {
        await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
        for (const [width,height] of [[1440,900],[1024,680]]) {
            await page.setViewport({width,height,deviceScaleFactor:1});
            await page.$eval('main', el => { el.scrollTop = 0; });
            assert(await page.$eval('.da-api-page', el => el.scrollWidth <= el.clientWidth + 2));
            for (const provider of ['hypixel','urchin','aurora']) {
                if (provider !== 'hypixel') await page.$eval(`[data-api-card="${provider}"]`, el => { el.open = true; });
                assert(await page.$eval(`[data-api-card="${provider}"]`, el => el.scrollWidth <= el.clientWidth + 2));
                assert(await page.$eval(`[data-api-test="${provider}"]`, el => el.checkVisibility()));
                if (provider !== 'hypixel') await page.$eval(`[data-api-card="${provider}"]`, el => { el.open = false; });
            }
            await page.screenshot({path:path.join(output,`api-focused-${theme}-${width}.png`)});
            await page.evaluate(() => {
                document.querySelector('.da-api-advanced').open = true;
                document.querySelector('[data-api-card="urchinadmin"]').open = true;
            });
            assert(await page.$eval('[data-api-card="urchinadmin"]', el => el.scrollWidth <= el.clientWidth + 2));
            assert(await page.$eval('#key-urchin-admin', el => el.checkVisibility()));
            if (theme === 'graphite' && width === 1024) {
                await page.$eval('#key-urchin-admin', el => el.scrollIntoView({block:'center'}));
                await page.screenshot({path:path.join(output,'api-advanced-1024.png')});
            }
            await page.$eval('.da-api-advanced', el => { el.open = false; });
        }
    }
    for (const [accent,color] of [['custom','#0022cc'],['sun','#f3c64e'],['custom','#767676'],['custom','#747474'],['custom','#ffffff'],['custom','#000000']]) {
        await page.evaluate(({accent,color}) => NesterTheme.applyAccent(accent,false,color), {accent,color});
        const colors = await page.$eval('[data-api-test="hypixel"]', el => ({foreground:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
        const luminance = value => value.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
        const values=[luminance(colors.foreground),luminance(colors.background)].sort((a,b)=>a-b);
        assert((values[1]+.05)/(values[0]+.05)>=4.5,`Test key contrast must remain readable for ${accent}/${color}`);
    }
    await page.evaluate('NesterTheme.apply("graphite",false);NesterTheme.applyAccent("custom",false,"#0022cc")');
    console.log('PASS Six themes at normal/minimum sizes and readable key-test text with dark/light/custom accents');
    console.log('PASS Key entry, phase changes, keyboard snooze, persisted metadata, dashboard and stale-key protection');
};
