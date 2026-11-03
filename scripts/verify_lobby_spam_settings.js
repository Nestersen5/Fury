'use strict';

const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
const { eventually } = require('./smoke_packaged_app');

module.exports = async function ({ page, output, profile }) {
    const port = JSON.parse(fs.readFileSync(path.join(profile, 'server_config.json'))).healthPort;
    let connected = false, revision = 0, sessionId = 'fixture-connection-one', players = [], fail = false, held = null;
    const requests = [];
    const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const reply = data => res.end(JSON.stringify(data));
        if (req.url.startsWith('/health')) return reply({ ok: true, connectionReady: connected,
            connectedAccount: connected ? 'Nestersen' : null, connectedUuid: connected ? 'a'.repeat(32) : null,
            lobbySpam: connected ? { sessionId, revision, mutedCount: players.length } : null,
            liveGame: { connected, overlayPlayers: [], detectedNickedPlayers: [], denickedPlayers: [], pendingAutoDenicks: [] },
            features: JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json'))) });
        if (req.url === '/settings-changed') return reply({ ok: true, applied: true });
        if (req.url !== '/lobby-spam') { res.statusCode = 404; return reply({ ok: false }); }
        let body = ''; for await (const chunk of req) body += chunk;
        const request = JSON.parse(body); requests.push(request);
        if (request.sessionId !== sessionId || request.account.uuid !== 'a'.repeat(32)) { res.statusCode = 409; return reply({ ok: false, error: 'Connection changed.' }); }
        if (fail) { res.statusCode = 503; return reply({ ok: false, error: 'Fixture connection unavailable.' }); }
        if (request.action === 'unmute') { players = players.filter(name => name !== request.name); revision++; }
        if (request.action === 'clear') { players = []; revision++; }
        const result = { ok: true, sessionId, revision, mutedCount: players.length, players: [...players] };
        if (held) { const release = held; held = null; release(() => reply(result)); }
        else reply(result);
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const open = () => page.evaluate("activatePage('settings');activateSettingsSubpage('overlay',false)");
    const refresh = () => page.evaluate('refresh()');
    const settle = async () => {
        await page.waitForFunction('!featureSaveTimer && !featureSaveInFlight && !settingsSaveInFlight && !refreshInFlight');
        await page.evaluate(async () => { await ordinarySaveChain; await refresh(); });
    };
    const read = () => JSON.parse(fs.readFileSync(path.join(profile, 'features_config.json')));
    const listText = () => page.$eval('#lobby-spam-dialog', el => el.textContent);
    const waitText = text => page.waitForFunction(text => document.querySelector('#lobby-spam-dialog')?.textContent.includes(text), {}, text);
    const openManage = async () => {
        assert.strictEqual(await page.$eval('#lobby-spam-manage', el => el.disabled), false);
        await page.$eval('#lobby-spam-manage', el => el.scrollIntoView({ block: 'center' }));
        await page.locator('#lobby-spam-manage').click();
        assert.strictEqual(await page.$eval('#lobby-spam-dialog', el => el.open), true);
    };
    try {
        await open(); await refresh();
        assert.strictEqual(await page.$eval('#lobby-spam-enabled', el => el.checked), false);
        assert.strictEqual(await page.$eval('#lobby-spam-sensitivity', el => el.value), 'balanced');
        assert.strictEqual(await page.$eval('#lobby-spam-manage', el => el.disabled), true);
        await page.locator('.switch:has(#lobby-spam-enabled)').click(); await settle();
        assert.strictEqual(read().lobbySpamEnabled, true);
        const trigger = '.stat-select-shell:has(#lobby-spam-sensitivity) .stat-select-trigger';
        assert.strictEqual(await page.$eval(trigger, el => el.getAttribute('aria-label')), 'Lobby spam sensitivity');
        await page.focus(trigger); await page.keyboard.press('Enter'); await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await settle();
        assert.strictEqual(read().lobbySpamSensitivity, 'low');
        await page.focus(trigger); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
        assert.strictEqual(await page.$eval(trigger, el => el.getAttribute('aria-expanded')), 'false');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction('typeof furyDesign !== "undefined" && state?.viewedAccount'); await open();
        assert.strictEqual(await page.$eval('#lobby-spam-enabled', el => el.checked), true);
        assert.strictEqual(await page.$eval('#lobby-spam-sensitivity', el => el.value), 'low');
        await page.$eval('#lobby-spam-enabled', el => el.focus()); await page.keyboard.press('Space'); await settle();
        assert.strictEqual(read().lobbySpamEnabled, false);
        for (const value of ['high', 'balanced']) {
            await page.$eval('#lobby-spam-sensitivity', (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
            await settle(); assert.strictEqual(read().lobbySpamSensitivity, value);
        }
        connected = true; await refresh();
        console.log('PASS lobby spam settings persistence and keyboard controls');
        await openManage(); await waitText('No muted players.');
        assert.strictEqual(requests.at(-1).account.uuid, 'a'.repeat(32));
        const before = requests.length; await refresh(); await refresh();
        assert.strictEqual(requests.length, before, 'unchanged summaries do not fetch the mute list again');
        console.log('PASS lobby spam empty list and unchanged-summary request suppression');
        players = ['Spammer', 'OtherSpammer']; revision++; await refresh(); await waitText('2 muted players.');
        await page.screenshot({ path: path.join(output, 'lobby-spam-muted-players.png') });
        await page.locator('#lobby-spam-dialog button[aria-label="Unmute Spammer"]').click(); await waitText('1 muted player.');
        assert.deepStrictEqual(players, ['OtherSpammer']); assert(!(await listText()).includes('Unmute Spammer'));
        assert.strictEqual(await page.evaluate('document.activeElement.getAttribute("aria-label")'), 'Unmute OtherSpammer');
        await page.evaluate(() => [...document.querySelectorAll('#lobby-spam-dialog button')].find(el => el.textContent === 'Unmute all').click());
        await waitText('No muted players.'); assert.deepStrictEqual(players, []);
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.evaluate('document.activeElement.id'), 'lobby-spam-manage');
        const closedRequests = requests.length; players = ['Spammer']; revision++; await refresh();
        assert.strictEqual(requests.length, closedRequests, 'closed dialog does not load names');
        console.log('PASS lobby spam unmute/clear and closed-dialog request suppression');
        fail = true; await openManage(); await waitText('Fixture connection unavailable.');
        fail = false;
        await page.evaluate(() => [...document.querySelectorAll('#lobby-spam-dialog button')].find(el => el.textContent === 'Refresh list').click());
        await waitText('1 muted player.');
        // An outstanding list response from the old connection must not render.
        let release; held = callback => { release = callback; };
        players = ['OldConnection']; revision++; await refresh();
        await page.waitForFunction('document.querySelector("#lobby-spam-dialog").textContent.includes("Loading muted players")');
        connected = false; await refresh();
        assert((await listText()).includes('Connect the selected account'));
        await eventually(() => assert(release), 'Pending old-connection list request', 5000);
        release(); await refresh(); assert(!(await listText()).includes('OldConnection'));
        connected = true; sessionId = 'fixture-connection-two'; players = []; revision = 0; await refresh(); await waitText('No muted players.');
        await page.keyboard.press('Escape');
        // Selected-account mismatch keeps controls unavailable.
        await page.evaluate(async () => { await require('electron').ipcRenderer.invoke('account:select', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'); await refresh(); });
        assert.strictEqual(await page.$eval('#lobby-spam-manage', el => el.disabled), true);
        for (const theme of ['dark', 'light']) {
            await page.evaluate(theme => NesterTheme.apply(theme, false), theme);
            for (const width of [1440, 1040]) {
                await page.setViewport({ width, height: 900, deviceScaleFactor: 1 }); await open();
                await page.$eval('.lobby-spam-settings', el => el.scrollIntoView({ block: 'center' }));
                assert(await page.$eval('.lobby-spam-settings', el => el.scrollWidth <= el.clientWidth), 'settings panel fits');
                await page.screenshot({ path: path.join(output, `lobby-spam-${theme}-${width}.png`) });
            }
        }
        console.log('PASS lobby spam launcher: defaults, autosave/reload, keyboard, sensitivity, list/unmute/clear, live revisions, no hidden work, errors/retry, stale connections, account isolation and responsive themes.');
    } catch(error) {
        console.error('Lobby spam UI fixture:', { requests, connected, sessionId, revision,
            renderer: await page.evaluate(() => ({ dialog: document.getElementById('lobby-spam-dialog')?.outerHTML,
                account: state.viewedAccount, health: state.proxyHealth?.lobbySpam, focused: document.activeElement?.tagName,
                manage: document.getElementById('lobby-spam-manage')?.outerHTML })) });
        throw error;
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
};
