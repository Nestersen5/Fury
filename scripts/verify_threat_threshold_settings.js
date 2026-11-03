'use strict';
const assert = require('assert'), path = require('path');

module.exports = async function ({ page, output }) {
    const settle = async () => {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async () => { await ordinarySaveChain; await refresh(); });
    };
    const cases = [
        { page: 'gameplay', toggle: '#auto-dodge-stat-threats', group: 'dodge', inputs: '#auto-dodge-min-fkdr,#auto-dodge-min-stars' },
        { page: 'scan', toggle: '#share-tags-include-threats', group: 'share', inputs: '#min-fkdr,#min-stars,#min-sw-kdr,#min-sw-wlr,#min-sw-level' }
    ];
    for (const test of cases) {
        const open = () => page.evaluate(category => { activatePage('settings'); activateSettingsSubpage(category, false); }, test.page);
        const values = () => page.$$eval(test.inputs, nodes => nodes.map(node => node.value));
        const verify = async enabled => {
            assert.strictEqual(await page.$eval(test.toggle, input => input.checked), enabled);
            const groups = await page.$$eval(`[data-stat-threat-threshold="${test.group}"]`, nodes => nodes.map(node => ({ hidden: node.hidden, display: getComputedStyle(node).display })));
            assert.strictEqual(groups.length, test.group === 'dodge' ? 3 : 1);
            assert.ok(groups.every(group => group.hidden === !enabled && (group.display !== 'none') === enabled));
            assert.strictEqual(await page.$$eval(test.inputs, nodes => nodes.every(node => node.getClientRects().length > 0)), enabled, 'hidden fields are removed from the visible layout');
            if (test.group === 'dodge') assert.ok(await page.$eval('#auto-dodge-leave-mode', node => node.closest('.stat-select-shell').getClientRects().length > 0), 'leave timing stays available');
        };
        await open();
        if (test.group === 'share') {
            await page.locator('[data-scan-mode="all"]').click();
            await settle();
        }
        const original = await values();
        await verify(false);
        await page.locator(`label:has(${test.toggle})`).click();
        await verify(true); // Visibility updates synchronously, before autosave.
        await settle(); await verify(true);
        assert.deepStrictEqual(await values(), original);
        await page.$eval(test.toggle, node => node.focus()); await page.keyboard.press('Space');
        await verify(false); await settle();
        assert.deepStrictEqual(await values(), original, 'hiding never resets the saved limits');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction('typeof furyDesign !== "undefined" && state?.viewedAccount');
        await open(); await verify(false);
        assert.deepStrictEqual(await values(), original, 'limits survive save and full reload while hidden');
        for (const theme of ['dark', 'light']) {
            await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
            for (const width of [1440, 1040]) {
                await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
                for (const enabled of [true, false]) {
                    await page.locator(`label:has(${test.toggle})`).click();
                    await settle(); await verify(enabled);
                    assert.deepStrictEqual(await values(), original);
                    await page.$eval(test.toggle, node => node.closest('label').scrollIntoView({ block: 'center' }));
                    assert.ok(await page.$eval(`[data-settings-subpage="${test.page}"]`, pane => pane.scrollWidth <= pane.clientWidth), 'controls fit the page');
                    await page.screenshot({ path: path.join(output, `thresholds-${test.group}-${enabled ? 'on' : 'off'}-${theme}-${width}.png`) });
                }
            }
        }
    }
    // Scanning needs the limits if either consumer is enabled. Check every
    // mode with Share's Stat threats both off and on, including full reloads.
    const openScan = () => page.evaluate(() => { activatePage('settings'); activateSettingsSubpage('scan', false); });
    await openScan();
    const original = await page.$$eval('.share-threshold-panel input', nodes => nodes.map(node => node.value));
    for (const shareThreats of [false, true]) {
        if (await page.$eval('#share-tags-include-threats', node => node.checked) !== shareThreats) {
            await page.locator('label:has(#share-tags-include-threats)').click();
            await settle();
        }
        for (const mode of ['all', 'off', 'threats']) {
            const visible = shareThreats || mode === 'threats';
            const verify = async () => {
                assert.strictEqual(await page.evaluate('ids.scanMode.value'), mode);
                assert.strictEqual(await page.$eval('#share-tags-include-threats', node => node.checked), shareThreats);
                assert.strictEqual(await page.$eval('.share-threshold-panel', node => !node.hidden && getComputedStyle(node).display !== 'none'), visible, `${mode}, Share threats ${shareThreats}`);
                assert.deepStrictEqual(await page.$$eval('.share-threshold-panel input', nodes => nodes.map(node => node.value)), original);
            };
            await page.locator(`[data-scan-mode="${mode}"]`).click();
            await verify();
            await settle(); await verify();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction('typeof furyDesign !== "undefined" && state?.viewedAccount');
            await openScan(); await verify();
        }
    }
    console.log('PASS Stat-threat thresholds: Auto Dodge dependency; all six Scan Mode/Share combinations; immediate updates, saved limits, reload, leave timing and responsive themes');
};
