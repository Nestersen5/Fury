'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

module.exports = async function ({ page, output, profile }) {
    await page.evaluate("activatePage('settings');activateSettingsSubpage('denick',false)");
    const keys = ['autoSaveTeammateNicknames', 'autoSaveSharedNicknamesEnabled'];
    for (const id of ['#auto-save-teammate-nicknames', '#auto-save-shared-nicknames-enabled']) {
        assert.strictEqual(await page.$(id), null, `${id} has no launcher switch`);
    }
    const loaded = await page.evaluate('state.settings.features');
    keys.forEach(key => assert.strictEqual(loaded[key], true, `${key} ignores legacy off preferences`));
    const collected = await page.evaluate('collectFeatureSettings()');
    keys.forEach(key => assert(!(key in collected.features), `${key} is not user toggleable`));
    const shareId = '#share-own-nickname-enabled';
    assert.strictEqual(await page.$eval(shareId, el => el.checked), false);
    for (const enabled of [true, false]) {
        await page.locator(`label:has(${shareId}) [data-checked="${enabled}"]`).click();
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'))).shareOwnNicknameEnabled, enabled);
    }
    const id = '#auto-skin-denick-enabled';
    const before = await page.$eval(id, el => el.checked);
    await page.$eval(id, el => el.focus());
    await page.keyboard.press('Space');
    await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight');
    assert.strictEqual(await page.$eval(id, el => el.checked), !before);
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json')));
    keys.forEach(key => assert.strictEqual(saved[key], true, `${key} persists enabled on settings save`));
    for (const width of [1440, 1100]) {
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        assert(await page.$eval('.fury-nickname-settings', el => el.scrollWidth <= el.clientWidth));
        await page.screenshot({ path: path.join(output, `teammate-nick-settings-${width}.png`) });
    }
    console.log('PASS nickname features: sharing switch, automatic saving, settings persistence and layout');
};
