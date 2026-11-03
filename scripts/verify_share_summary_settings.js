'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

module.exports = async function ({ page, output, profile }) {
    const id = '#share-tags-team-summary';
    const open = () => page.evaluate("activatePage('settings');activateSettingsSubpage('scan',false)");
    const settle = async () => {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async () => { await ordinarySaveChain; await refresh(); });
    };
    const preview = () => page.$eval('#party-chat-preview-lines', el => el.textContent);
    const verify = async enabled => {
        assert.strictEqual(await page.$eval(id, el => el.checked), enabled);
        assert.strictEqual(await page.evaluate('collectFeatureSettings().features.shareTagsTeamSummary'), enabled);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'))).shareTagsTeamSummary, enabled);
        assert.strictEqual((await preview()).includes('Red team has'), enabled);
        assert.strictEqual(await page.$eval('#share-individual-options', el => el.hidden), enabled);
        assert.strictEqual(await page.$('#share-team-options'), null, 'no repeated team-summary description');
        assert.ok(await page.$eval('#share-tags-color-local', el => Boolean(el.closest('.fury-share-common'))), 'recoloring is a shared setting');
    };
    await open();
    assert.strictEqual(await page.$eval(id, el => el.checked), true, 'team summaries are the built-in default');
    assert.strictEqual(await page.$eval(id, el => el.getAttribute('aria-label')), 'Use team summaries');
    assert.deepStrictEqual(await page.$$eval('.fury-share-method-selector .fury-binary-off,.fury-share-method-selector .fury-binary-on', nodes => nodes.map(el => el.textContent)), ['Individual players', 'Team summaries']);
    assert.strictEqual(await page.$eval('#share-tags-monthly-fkdr', el => Boolean(el.closest('#share-individual-options'))), true);
    assert.strictEqual(await page.$eval('#share-tags-fancy', el => Boolean(el.closest('#share-individual-options'))), true);
    await page.locator('.fury-binary-choice:has(#share-tags-team-summary) .fury-binary-off').click();
    await settle(); await verify(false);
    await page.locator('.fury-binary-choice:has(#share-tags-team-summary) .fury-binary-on').click();
    await settle(); await verify(true);
    assert(!(await preview()).includes('FKDR'), 'the existing disabled threat filter is respected');
    await page.$eval('#share-tags-include-threats', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    assert((await preview()).includes('2 cheaters (Scaffold, Auto Block), 1 nicked, 8 FKDR'));
    assert(!(await preview()).includes('MFKDR'));
    const summaryText = await preview();
    assert.strictEqual(await page.$$eval('#party-chat-preview-lines .party-message.is-recolored', nodes => nodes.length), 3);
    assert.ok(await page.$$eval('#party-chat-preview-lines .party-message span', nodes => nodes.some(node => node.textContent === 'Red team' && getComputedStyle(node).color === 'rgb(255, 85, 85)')), 'preview colors the complete team name');
    assert.ok(await page.$$eval('#party-chat-preview-lines .party-message', nodes => nodes.every(node => [...node.querySelectorAll('span')].slice(1).every(span => getComputedStyle(span).color === 'rgb(255, 255, 255)'))), 'everything after the team name stays white');
    await page.locator('.fury-binary-choice:has(#share-tags-color-local) .fury-binary-off').click();
    await settle();
    assert.strictEqual(await preview(), summaryText, 'colors never alter the message wording');
    assert.strictEqual(await page.$$eval('#party-chat-preview-lines .party-message.is-recolored', nodes => nodes.length), 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'))).shareTagsColorLocal, false);
    // Individual formatting choices stay saved while that method is inactive.
    for (const control of ['#share-tags-fancy', '#share-tags-color-local']) {
        await page.$eval(control, el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await settle(); await verify(true);
    }
    await page.$eval('#share-tags-include-nicks', el => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    assert(!(await preview()).includes('nicked'), 'preview follows the selected filters');
    await page.$eval('#share-tags-include-nicks', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof furyDesign !== "undefined" && state?.viewedAccount');
    await open(); await verify(true);
    await page.$eval(id, el => el.focus()); await page.keyboard.press('Space');
    await settle(); await verify(false);
    assert((await preview()).includes('RushGod'), 'turning summaries off restores individual messages');
    assert.strictEqual(await page.$eval('#share-tags-fancy', el => el.checked), true);
    assert.strictEqual(await page.$eval('#share-tags-color-local', el => el.checked), true, 'the same recoloring choice applies to individual players');
    assert.ok(await page.$$eval('#party-chat-preview-lines .party-message.is-recolored', nodes => nodes.length > 0));
    await page.$eval(id, el => el.focus()); await page.keyboard.press('Space');
    await settle(); await verify(true);
    for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
        for (const width of [1440, 1040]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            for (const enabled of [false, true]) {
                await page.$eval(id, (el, checked) => { el.checked = checked; el.dispatchEvent(new Event('change', { bubbles: true })); }, enabled);
                await settle(); await verify(enabled);
                await page.$eval('.share-option-row:has(#share-tags-team-summary)', el => el.scrollIntoView({ block: 'center' }));
                assert(await page.$eval('.share-settings-module', el => el.scrollWidth <= el.clientWidth), 'share settings fit the page');
                assert(await page.$eval('.fury-share-method-selector .fury-binary-choice', el => el.scrollWidth <= el.clientWidth), 'both method names fit');
                assert(await page.$eval('.fury-share-method-selector >div:first-child', el => el.clientWidth > 200 && el.offsetHeight < 120), 'method description wraps into readable lines');
                await page.screenshot({ path: path.join(output, `share-${enabled ? 'summary' : 'individual'}-${theme}-${width}.png`) });
            }
        }
    }
    console.log('PASS Share methods: separate options, shared recoloring, actual team colors, pointer/keyboard, persistence, reload, filters, retained individual formatting and both methods in responsive themes');
};
