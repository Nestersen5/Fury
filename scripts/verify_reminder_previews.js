'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

module.exports = async function ({ page, output, profile }) {
    const open = () => page.evaluate("activatePage('reminders')");
    const settle = async () => {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async () => { await ordinarySaveChain; await refresh(); });
    };
    // Compare every rendered character to the packet the production sender
    // would deliver, including prefix recoloring and bold/color reset boundaries.
    const verify = async () => {
        const results = await page.evaluate(() => {
            const mc = require('./features/minecraft_chat');
            const dust = require('./features/ender_dust_reminder');
            const george = require('./features/gambler_george_reminder');
            const palette = Object.fromEntries(mc.MINECRAFT_LEGACY_PALETTE.map(c => [c.name, c.hex]));
            const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
            const input = document.getElementById('ender-dust-reminder-threshold');
            const amount = state.reminders?.enderDust?.enderDust ?? Math.min(300, Math.max(1, Math.round(Number(input.value) || 250)));
            return [
                ['.da-dust-preview', dust.enderDustReminderMessage(amount, state.reminders?.enderDust?.capacity || 300)],
                ['.da-george-preview', george.GAMBLER_GEORGE_REMINDER_MESSAGE]
            ].map(([selector, message]) => {
                let packet;
                mc.sendChat({ write: (name, value) => { packet = JSON.parse(value.message); } }, message);
                const expected = packet.extra.flatMap(s => [...s.text].map(text => ({ text, color: rgb(palette[s.color] || '#ffffff'), bold: Boolean(s.bold) })));
                const node = document.querySelector(selector);
                const actual = [...node.children].flatMap(s => {
                    const style = getComputedStyle(s);
                    return [...s.textContent].map(text => ({ text, color: style.color, bold: Number(style.fontWeight) >= 700 }));
                });
                return { selector, expected, actual, label: node.getAttribute('aria-label'), fits: node.scrollWidth <= node.clientWidth, shadow: getComputedStyle(node).textShadow };
            });
        });
        for (const row of results) {
            assert.deepStrictEqual(row.actual, row.expected, row.selector + ': exact chat text, colors and bold');
            assert(row.label.endsWith('reminder preview'));
            assert(row.fits, row.selector + ': no horizontal overflow');
            assert.notStrictEqual(row.shadow, 'none');
        }
    };
    await open(); await settle(); await verify();
    assert((await page.$eval('.da-dust-preview', el => el.textContent)).includes('280'));
    assert((await page.$eval('.da-george-preview', el => el.textContent)).includes('Your 2-win bet is complete.'));
    await page.evaluate(() => {
        furyDesign.openManager();
        const row = [...document.querySelectorAll('.fury-account-row')].find(r => r.querySelector('strong')?.textContent === 'SecondAccount');
        [...row.querySelectorAll('button')].find(b => b.textContent === 'Select').click();
    });
    await page.waitForFunction('state.reminders?.enderDust?.enderDust===45');
    await page.evaluate("document.querySelector('.fury-account-manager').close()");
    await verify();
    assert((await page.$eval('.da-dust-preview', el => el.textContent)).includes('45'));
    // Saved zero is real data. Missing readings use the target as an example.
    for (const amount of [0, null, 220, 300]) {
        await page.evaluate(amount => { state = { ...state, reminders: { ...state.reminders, enderDust: { ...state.reminders.enderDust, enderDust: amount } } }; designA.update(state); }, amount);
        await verify();
    }
    for (const theme of ['graphite', 'obsidian', 'midnight', 'forest', 'frost', 'light']) {
        await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
        assert.strictEqual(await page.evaluate('document.documentElement.dataset.theme'), theme);
        for (const width of [1440, 1040]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await verify();
        }
    }
    await page.evaluate(() => {
        state = { ...state, reminders: { ...state.reminders, enderDust: { ...state.reminders.enderDust, enderDust: null } } };
        designA.update(state);
        const input = document.getElementById('ender-dust-reminder-threshold');
        input.value = '275'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await verify();
    assert((await page.$eval('.da-dust-preview', el => el.textContent)).includes('275'));
    for (const color of ['#ffaa00', '#55ffff', '#aa0000', '#16b8c8', '#e5b35d']) {
        await page.evaluate(color => NesterTheme.applyAccent('custom', false, color), color);
        assert(await page.evaluate(color => {
            const mc = require('./features/minecraft_chat');
            return mc.getChatPrefixAccent().name === mc.closestLegacyChatColor(color).name;
        }, color), 'preview follows the selected Minecraft accent');
        await verify();
    }
    // Existing controls must keep their actual persistence and keyboard owners.
    for (const id of ['ender-dust-reminder-enabled', 'gambler-george-reminder-enabled']) {
        const before = await page.$eval('#' + id, el => el.checked);
        await page.focus('#' + id); await page.keyboard.press('Space'); await settle();
        assert.strictEqual(await page.$eval('#' + id, el => el.checked), !before);
        const key = id === 'ender-dust-reminder-enabled' ? 'enderDustReminderEnabled' : 'gamblerGeorgeReminderEnabled';
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json')))[key], !before);
        await verify();
    }
    await page.$eval('#ender-dust-reminder-threshold', el => { el.value = '260'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'))).enderDustReminderThreshold, 260);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof designA !== "undefined" && state?.viewedAccount');
    await open(); await verify();
    assert.strictEqual(await page.$eval('#ender-dust-reminder-threshold', el => el.value), '260');
    const unchanged = await page.evaluate(() => {
        const observer = new MutationObserver(() => {});
        for (const node of document.querySelectorAll('.da-chat-preview')) observer.observe(node, { childList: true, subtree: true, attributes: true });
        for (let i = 0; i < 100; i++) designA.update(state);
        const count = observer.takeRecords().length; observer.disconnect(); return count;
    });
    assert.strictEqual(unchanged, 0, 'unchanged refreshes do not rebuild the previews');
    for (const theme of ['graphite', 'light']) {
        await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
        for (const width of [1440, 1040]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await verify();
            await page.screenshot({ path: path.join(output, `reminders-${theme}-${width}.png`) });
        }
    }
    console.log('PASS reminder previews match production chat packets, accents, account readings, themes, wrapping, keyboard controls, persistence, reload and unchanged refreshes');
};
