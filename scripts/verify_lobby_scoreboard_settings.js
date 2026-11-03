'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

module.exports = async function ({ page, output, profile }) {
    const open = () => page.evaluate("activatePage('settings');activateSettingsSubpage('display',false);furyDesign.showIngame('scoreboard')");
    const settle = async () => {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async () => { await ordinarySaveChain; await refresh(); });
    };
    const select = async (id, value) => {
        await page.$eval(id, (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
        await settle();
    };
    const fkdr = () => page.$$eval('.ia-lobby-row > span:first-child', rows => rows.find(row => row.textContent.trim().startsWith('FKDR:'))?.textContent.trim());
    await open();
    assert.strictEqual(await page.$eval('#bedwars-lobby-scoreboard-decimals', el => el.value), '4');
    await page.$eval('#bedwars-lobby-scoreboard-enabled', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    const expected = ['FKDR: 3', 'FKDR: 3.2', 'FKDR: 3.21 ▲0.03', 'FKDR: 3.205 ▲0.028', 'FKDR: 3.2051 ▲0.0283'];
    for (let digits = 0; digits <= 4; digits++) {
        await select('#bedwars-lobby-scoreboard-decimals', String(digits));
        assert.strictEqual(await fkdr(), expected[digits]);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'))).bedwarsLobbyScoreboardDecimals, digits);
        assert.strictEqual(await page.evaluate('collectFeatureSettings().features.bedwarsLobbyScoreboardDecimals'), digits);
    }
    // The existing enhanced select must support keyboard selection and Escape.
    const trigger = '.stat-select-shell:has(#bedwars-lobby-scoreboard-decimals) .stat-select-trigger';
    assert.strictEqual(await page.$eval(trigger, el => el.getAttribute('aria-label')), 'Lobby scoreboard FKDR decimal digits');
    await page.focus(trigger);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await settle();
    assert.strictEqual(await fkdr(), expected[0]);
    await page.focus(trigger); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    assert.strictEqual(await page.$eval(trigger, el => el.getAttribute('aria-expanded')), 'false');
    assert.ok(await page.$eval(trigger, el => el === document.activeElement));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof furyDesign !== "undefined" && state?.viewedAccount');
    await open();
    assert.strictEqual(await page.$eval('#bedwars-lobby-scoreboard-decimals', el => el.value), '0', 'zero survives a full renderer reload');
    assert.strictEqual(await fkdr(), expected[0]);
    await select('#bedwars-lobby-scoreboard-decimals', '4');
    for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
        for (const width of [1440, 1040]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            for (const style of ['grey', 'classic', 'gold', 'aqua', 'labels', 'category']) {
                await select('#bedwars-lobby-scoreboard-style', style);
                assert.strictEqual(await fkdr(), expected[4]);
                assert.ok(await page.$eval('.ia-lobby-settings', el => el.scrollWidth <= el.clientWidth), 'settings fit the column');
                assert.strictEqual(await page.$$eval('.ia-lobby-settings > .ia-setting-row p', nodes => nodes.length), 0, 'only titles remain in the settings rows');
            }
            await page.$eval('.ia-lobby-settings', el => el.scrollIntoView({ block: 'start' }));
            await page.screenshot({ path: path.join(output, `lobby-scoreboard-${theme}-${width}.png`) });
        }
    }
    console.log('PASS lobby scoreboard: 0–4 digits, daily change, autosave, reload, keyboard, descriptions, six styles and responsive themes');
};
