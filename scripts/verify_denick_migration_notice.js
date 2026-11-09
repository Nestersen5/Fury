'use strict';

// Runs inside verify_launcher_redesign's isolated production Main/renderer.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
module.exports = async function verify({ page, output }) {
    const checks = [], record = name => { checks.push(name); console.log('PASS ' + name); };
    const visible = () => page.$eval('.fury-nick-migration-notice', el => el.checkVisibility());
    await page.evaluate(async () => { activatePage('denicks'); activateDenickSubpage('history'); await refresh(); clearTimeout(refreshTimer); });
    assert(await visible());
    assert.match(await page.$eval('.fury-nick-migration-notice', el => el.textContent), /Start the proxy/);
    assert(await page.$eval('.fury-nick-migration-notice', el => el.getAttribute('role') === 'status' && el.getAttribute('aria-atomic') === 'true'));
    record('Stopped proxy explains pending saved nicks through the existing status announcement');

    const messages = { updating: /Updating your saved nicks/, paused: /API requests are off/,
        retrying: /retry in the background/, restart: /Restart Fury/, unavailable: /waiting for the proxy/ };
    for (const [phase, pattern] of Object.entries(messages)) {
        await page.evaluate(phase => furyDesign.update({ ...state,
            proxyHealth: { denickMigration: { state: phase, pendingCount: 2 } } }), phase);
        assert(await visible());
        assert.match(await page.$eval('.fury-nick-migration-notice', el => el.textContent), pattern);
        assert.match(await page.$eval('.fury-nick-migration-notice', el => el.textContent), /scan stats.*You can keep playing/);
        record(phase + ' uses truthful wording without changing history');
    }
    await page.evaluate(() => furyDesign.update({ ...state, proxyHealth: { denickMigration: { state: 'updating', pendingCount: 2 } } }));
    for (const theme of ['graphite', 'midnight', 'forest', 'light', 'obsidian', 'frost']) {
        await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
        for (const [width, height] of [[1440, 900], [1024, 680]]) {
            await page.setViewport({ width, height });
            const metrics = await page.$eval('.fury-nick-migration-notice', el => {
                const main = document.querySelector('main'), bounds = el.getBoundingClientRect(), style = getComputedStyle(el);
                return { visible: el.checkVisibility(), overflow: el.scrollWidth - el.clientWidth,
                    mainOverflow: main.scrollWidth - main.clientWidth, width: bounds.width, right: bounds.right,
                    fontSize: parseFloat(style.fontSize), color: style.color, background: style.backgroundColor };
            });
            assert(metrics.visible && metrics.width > 0 && metrics.right <= width && metrics.overflow <= 1 && metrics.mainOverflow <= 2);
            assert(metrics.fontSize >= 12 && metrics.color !== metrics.background);
            await page.screenshot({ path: path.join(output, `nick-migration-${theme}-${width}.png`) });
            record(`${theme} ${width}: readable notice, wrapping and no horizontal overflow`);
        }
    }
    await page.evaluate(() => {
        window.migrationNoticeNodes = { row: document.querySelector('.fury-nick-row'), history: state.denickHistory };
        furyDesign.update({ ...state, proxyHealth: { denickMigration: { state: 'complete', pendingCount: 0 } } });
    });
    assert.equal(await visible(), false);
    assert(await page.evaluate(() => migrationNoticeNodes.row === document.querySelector('.fury-nick-row') && migrationNoticeNodes.history === state.denickHistory));
    record('Completion hides the notice without rebuilding rows or replacing history');
    const mutations = await page.evaluate(async () => {
        let changes = 0;
        const observer = new MutationObserver(records => changes += records.length);
        observer.observe(document.querySelector('.fury-nick-migration-notice'), { attributes: true, childList: true, subtree: true });
        for (let i = 0; i < 20; i++) furyDesign.update({ ...state, proxyHealth: { denickMigration: { state: 'complete', pendingCount: 0 } } });
        await new Promise(resolve => setTimeout(resolve, 0)); observer.disconnect(); return changes;
    });
    assert.equal(mutations, 0); record('Unchanged status produces no notice mutations');
    await page.evaluate(() => furyDesign.update({ ...state, proxyHealth: null,
        denickHistory: { players: [{ realIGN: 'VerifiedPlayer', realUuid: 'a'.repeat(32) }, { realIGN: 'MissingPlayer', identityState: 'missing' }] } }));
    assert.equal(await visible(), false); record('Verified and confirmed missing accounts do not trigger a notice');
    await page.evaluate(async () => { await startProxy(); clearTimeout(refreshTimer); });
    await page.waitForFunction(async () => { await refresh(); clearTimeout(refreshTimer); return state.proxyHealth?.denickMigration?.state === 'paused'; });
    assert.match(await page.$eval('.fury-nick-migration-notice', el => el.textContent), /API requests are off/);
    assert(await visible()); record('Real Main/proxy health round trip reports paused migration on the Nicks page');
    const normal = await page.evaluate(() => ipcRenderer.invoke('state:get', { activePage: 'dashboard' }));
    assert(normal.proxyHealth && !Object.hasOwn(normal.proxyHealth, 'denickMigration'));
    record('Other pages do not request migration status');
    await page.evaluate(() => activateDenickSubpage('lookup'));
    assert(await visible()); record('The notice stays visible on Lookup');
    await page.evaluate(async () => { await stopProxy(); activateDenickSubpage('history'); await refresh(); clearTimeout(refreshTimer); });
    assert.match(await page.$eval('.fury-nick-migration-notice', el => el.textContent), /Start the proxy/);
    record('Stopping the proxy replaces the active message with the stopped explanation');
    fs.writeFileSync(path.join(output, 'nick-migration-verification.json'), JSON.stringify({ checks, unchangedMutations: mutations }, null, 2));
};
