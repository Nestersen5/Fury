'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

module.exports = async function ({ page, output, profile }) {
    const id = '#share-tags-monthly-fkdr';
    const open = () => page.evaluate("activatePage('settings');activateSettingsSubpage('scan',false)");
    const settle = async () => {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async () => { await ordinarySaveChain; await refresh(); });
    };
    const verify = async enabled => {
        assert.strictEqual(await page.$eval(id, el => el.checked), enabled);
        assert.strictEqual(await page.evaluate('collectFeatureSettings().features.shareTagsMonthlyFkdr'), enabled);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'))).shareTagsMonthlyFkdr, enabled);
        assert.strictEqual((await page.$eval('#party-chat-preview-lines', el => el.textContent)).includes('MFKDR'), enabled);
    };
    await open();
    await page.locator('.fury-binary-choice:has(#share-tags-team-summary) .fury-binary-off').click();
    await settle();
    assert.strictEqual(await page.$eval(id, el => el.checked), true, 'existing users retain monthly FKDR by default');
    assert.strictEqual(await page.$eval(id, el => document.getElementById(el.getAttribute('aria-labelledby')).textContent), 'Monthly FKDR', 'the toggle has its visible accessible label');
    assert((await page.$eval('.share-option-row:has(#share-tags-monthly-fkdr)', el => el.textContent)).includes('May slightly delay sharing.'));
    await page.locator('.fury-binary-choice:has(#share-tags-monthly-fkdr) .fury-binary-off').click();
    await settle(); await verify(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof furyDesign !== "undefined" && state?.viewedAccount');
    await open(); await verify(false);
    await page.$eval(id, el => el.focus());
    await page.keyboard.press('Space');
    await settle(); await verify(true);
    // Both compact/detailed previews follow the monthly preference.
    for (const fancy of [true, false]) {
        await page.$eval('#share-tags-fancy', (el, checked) => { el.checked = checked; el.dispatchEvent(new Event('change', { bubbles: true })); }, fancy);
        await settle(); await verify(true);
    }
    for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
        for (const width of [1440, 1040]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await page.$eval('.share-option-row:has(#share-tags-monthly-fkdr)', el => el.scrollIntoView({ block: 'center' }));
            assert(await page.$eval('.share-settings-module', el => el.scrollWidth <= el.clientWidth), 'share settings fit the page');
            await page.screenshot({ path: path.join(output, `share-monthly-${theme}-${width}.png`) });
        }
    }
    console.log('PASS Share monthly FKDR: default, saved on/off, reload, keyboard, delay note, compact/detailed previews and responsive themes');
};
