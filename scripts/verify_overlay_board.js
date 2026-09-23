'use strict';
// Renders the Team Lobby overlay board in the real launcher with a recorded
// BedWars lobby and checks layout at both supported window sizes.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), puppeteer = require('puppeteer');
const { cleanEnvironment, unusedPorts, startChild, stopChild, assertRunning, eventually, uiTestArguments } = require('./smoke_packaged_app');
const target = require('./launcher_verification_target').verificationTarget('overlay-board');

// Stats recorded from Hypixel, Urchin, Seraph and Aurora for a real lobby (Sep 2026).
const LOBBY = {
    Red: [['Nestersen', 1919, 11.21, 4.07, 134], ['tortugos', 474, 35.36, 14.43, 81], ['dusttn', 425, 8.08, 2.64, 147], ['Gamerrbot', 1408, 16.02, 5.13, 240]],
    Blue: [['Sugarcane_TW', 1067, 15.37, 5.46, 134], ['Manhal_IQ_', 4294, 21.49, 5.97, 118], ['nalini25', 880, 4.77, 1.67, 226], ['FrawgTheDawg', 591, 3.61, 2.00, 39]],
    Green: [['_iMan', 1118, 7.30, 3.01, 118], ['fyechris', 954, 13.39, 5.06, 78], ['AuroraXI', 1041, 2.67, 1.05, 52], ['YesMayo', 2265, 15.60, 4.83, 56]],
    Yellow: [['Karreuche', 763, 12.23, 3.78, 129], ['jeffreydunphy', 470, 15.83, 4.31, 134], ['AriaBlueberry', 673, 4.02, 1.82, 97], ['R_stars_S', 1212, 6.94, 1.96, 123]]
};
const TAGS = {
    fyechris: [{ source: 'Seraph', title: 'Seraph Blacklist', value: 'Closet Cheater', reasons: 'Legacy - Closet Cheating: legit scaff' }, { source: 'Urchin', title: 'Urchin Report', value: 'Replays Needed' }],
    R_stars_S: [{ source: 'Urchin', title: 'Urchin Report', value: 'Replays Needed' }]
};

function row([name, stars, fkdr, wlr, ping], team) {
    return { name, mode: 'BEDWARS', team: { name: team, colorName: team.toLowerCase() }, ping, tags: TAGS[name] || [], stats: { stars, fkdr, wlr, ws: null } };
}
const fours = Object.entries(LOBBY).flatMap(([team, players]) => players.map(player => row(player, team)));
const doublesTeams = ['Red', 'Blue', 'Green', 'Yellow', 'Aqua', 'White', 'Pink', 'Gray'];
const doubles = fours.map((player, index) => ({ ...player, team: { name: doublesTeams[Math.floor(index / 2)], colorName: doublesTeams[Math.floor(index / 2)].toLowerCase() } }));
const live = players => ({ connected: true, account: 'Nestersen', myTeam: 'Red', gameActive: true, currentGamemode: 'BEDWARS', gameSessionId: `board-${players.length}-${players[2].team.name}`, overlayPlayers: players });

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-overlay-board-'));
    const output = target.output;
    const [debugPort, cosmeticPort, blockedPort, healthPort] = await unusedPorts(4), env = cleanEnvironment(profile, target.resources, cosmeticPort, blockedPort);
    // Point the launcher at an idle health port so a Fury proxy already running here cannot feed it live games.
    fs.writeFileSync(path.join(profile, 'server_config.json'), JSON.stringify({ healthPort }));
    if (!target.packaged) env.NODE_BINARY = process.execPath;
    const child = startChild(target.executable, [...target.args, ...uiTestArguments(), `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--proxy-server=${env.HTTPS_PROXY}`], env, 'Overlay board verification');
    let browser;
    try {
        browser = await eventually(async () => { assertRunning(child); return puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null }); }, 'Connecting launcher');
        const page = await eventually(async () => { const p = (await browser.pages()).find(p => p.url().endsWith('/launcher.html')); assert(p); return p; }, 'Opening launcher');
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.waitForFunction('typeof furyDesign !== "undefined" && furyDesign && typeof renderOverlay === "function"');
        // Freeze launcher polling so a proxy already running on this machine cannot replace the fixture lobby.
        await page.evaluate(() => { refresh = async () => {}; clearTimeout(refreshTimer); document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); });
        await page.evaluate(() => document.querySelectorAll('.fury-onboarding, [data-onboarding]').forEach(element => element.remove()));

        const show = async (players, view = 'teams') => {
            await page.evaluate((data, selectedView) => {
                clearTimeout(refreshTimer);
                activatePage('overlay');
                clearTimeout(refreshTimer);
                overlayState.orders.BEDWARS = ['fkdr', 'wlr', 'ws', 'ping'];
                overlayState.view = selectedView;
                overlayState.modePreference = 'AUTO';
                overlayTableSignature = '';
                // Other launcher actions (view toggle, filters) re-render from state, so keep the fixture there too.
                state = { ...(state || {}), proxyHealth: { ...(state?.proxyHealth || {}), liveGame: data } };
                renderOverlay(data);
            }, live(players), view);
            await new Promise(resolve => setTimeout(resolve, 250));
            return page.evaluate(() => {
                const shell = document.querySelector('#overlay-table');
                const clipped = selector => [...shell.querySelectorAll(selector)].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim());
                return {
                    rows: shell.querySelectorAll('.fury-board-row[data-player]').length,
                    cards: [...shell.querySelectorAll('.fury-board-card')].map(card => card.dataset.group),
                    mine: [...shell.querySelectorAll('.fury-board-card.is-mine')].map(card => card.dataset.group),
                    clippedNames: clipped('.fury-board-player'),
                    clippedLabels: clipped('.fury-board-labels > span'),
                    font: getComputedStyle(shell.querySelector('.fury-board-player') || shell).fontFamily,
                    summary: document.querySelector('#overlay-summary').textContent,
                    sideways: shell.scrollWidth > shell.clientWidth + 1,
                    pageOverflow: document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1,
                    rowHeight: getComputedStyle(shell.querySelector('.fury-board')).getPropertyValue('--board-row-height')
                };
            });
        };

        for (const [width, height] of [[1440, 900], [1024, 680]]) {
            await page.setViewport({ width, height });
            const four = await show(fours);
            await page.screenshot({ path: path.join(output, `fours-${width}.png`) });
            assert.strictEqual(four.rows, 16, JSON.stringify(four));
            assert.deepStrictEqual(four.cards, ['Red', 'Blue', 'Green', 'Yellow']);
            assert.deepStrictEqual(four.mine, ['Red']);
            assert.deepStrictEqual(four.clippedNames, [], JSON.stringify(four));
            assert.deepStrictEqual(four.clippedLabels, []);
            assert(/Minecraft/.test(four.font), four.font);
            assert.strictEqual(four.summary, 'Live · BedWars · 4 teams of 4 · 16 players');
            assert(!four.sideways && !four.pageOverflow, JSON.stringify(four));

            const two = await show(doubles);
            await page.screenshot({ path: path.join(output, `doubles-${width}.png`) });
            assert.strictEqual(two.cards.length, 8);
            assert.strictEqual(two.summary, 'Live · BedWars · 8 teams of 2 · 16 players');
            assert.deepStrictEqual(two.clippedNames, [], JSON.stringify(two));
            assert(!two.sideways && !two.pageOverflow, JSON.stringify(two));
        }

        await page.setViewport({ width: 1440, height: 900 });
        const list = await show(fours, 'list');
        assert.deepStrictEqual(list.cards, ['Players']);
        assert.strictEqual(await page.$eval('[data-overlay-view="list"]', e => e.classList.contains('active')), true);
        await page.screenshot({ path: path.join(output, 'list-1440.png') });

        await page.click('[data-overlay-view="teams"]');
        assert.strictEqual(await page.$$eval('#overlay-table .fury-board-card', cards => cards.length), 4, 'Teams toggle restores team cards');
        assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY)).view), 'teams');

        await page.type('.fury-overlay-filter', 'tortu');
        assert.deepStrictEqual(await page.$$eval('#overlay-table .fury-board-row[data-player]:not(.fury-filtered)', rows => rows.map(row => row.dataset.player)), ['tortugos']);
        assert.deepStrictEqual(await page.$$eval('#overlay-table .fury-board-card:not(.fury-filtered)', cards => cards.map(card => card.dataset.group)), ['Red']);
        await page.$eval('.fury-overlay-filter', input => { input.value = ''; input.dispatchEvent(new Event('input')); });

        await page.evaluate(() => { const empty = { connected: true, gameActive: false, currentGamemode: '', overlayPlayers: [] }; state = { ...state, proxyHealth: { ...state.proxyHealth, liveGame: empty } }; overlayTableSignature = ''; renderOverlay(empty); });
        assert(await page.$eval('#overlay-table .fury-board-empty', e => e.checkVisibility()));
        await page.screenshot({ path: path.join(output, 'empty-1440.png') });

        assert.deepStrictEqual(errors, []);
        console.log('PASS Team Lobby board: fours and doubles at 1440×900 and 1024×680, list toggle persistence, player filter, empty state');
        target.record();
    } finally {
        if (browser) await browser.disconnect();
        await stopChild(child);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
