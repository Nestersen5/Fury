'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDailyRewards, actionsMatch, findSharedLink } = require('../../src/rewards/dailyRewards');
const { parsePage, pageUrl, claimUrl, cookieHeader, createTransport } = require('../../src/rewards/page');
const { normalizeSettings } = require('../../src/rewards/settings');
const { createAutoPick, choose } = require('../../src/rewards/autoPick');
const text = require('../../src/rewards/text');
const { extractText } = require('../../features/minecraft_chat');

const ID = '1234abcd', OTHER = 'abcd1234', TOKEN = 'Synthetic_csrf_token';
const CARDS = [
    { reward: 'coins', gameType: 'TNTGAMES', rarity: 'COMMON', amount: 4000 },
    { reward: 'coins', gameType: 'DUELS', rarity: 'COMMON', amount: 3000 },
    { reward: 'dust', rarity: 'EPIC', amount: 40 }
];
function html(id = ID, extra = {}, cards = CARDS) {
    const data = { id, rewards: cards, skippable: true, activeAd: 2,
        dailyStreak: { score: 3, highScore: 19, keeps: true }, ...extra };
    return `window.securityToken = "${TOKEN}"; window.appData = '${JSON.stringify(data).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';`;
}
const packet = (root, position = 0) => ({ message: JSON.stringify(root), position });
const ownLine = (id = ID, url = pageUrl(id)) => packet({ text: '\nClick the link to visit our website and claim your reward: ',
    extra: [{ text: pageUrl(id) + '\n', clickEvent: { action: 'open_url', value: url } }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(options = {}) {
    let config = normalizeSettings(options.settings), time = 1000, current = true, paused = false, window = null;
    const messages = [], gets = [], posts = [], upstream = [], client = [];
    const monitor = { getWindow: () => window, setHold() {}, observeClientPacket() { window = null; } };
    const controller = createDailyRewards({ menuMonitor: monitor,
        sendChat: line => messages.push(line), sendUpstream: (name, data) => upstream.push({ name, data }),
        sendClient: (name, data) => client.push({ name, data }),
        getSettings: () => config, saveSettings: value => { config = value; },
        isCurrent: () => current, isApiPaused: () => paused, now: () => time,
        ...(options.autoPick ? { autoPick: options.autoPick } : {}),
        transport: {
            get: async (url, opts) => { gets.push({ url, opts }); return options.get ? options.get(url, opts)
                : { status: 200, body: html(url.slice(-8)), cookies: ['_csrf=SyntheticCookie; Path=/'] }; },
            post: async (url, opts) => { posts.push({ url, opts }); return options.post ? options.post(url, opts)
                : { status: 200, body: 'reward claimed' }; }
        }
    });
    const server = (name, data) => controller.observeServer(data, { name });
    const open = (title = 'The Delivery Man', id = 7, slots = [[10, { plainName: 'Daily Reward (#12)', plainLore: ['Click here to get the link in chat!'] }]]) => {
        window = { windowId: id, slots: new Map(slots) };
        server('open_window', { windowId: id, windowTitle: JSON.stringify({ text: title }) });
    };
    const click = (id = 7, slot = 10) => controller.observeClient({ windowId: id, slot }, { name: 'window_click' });
    const link = (data = ownLine()) => server('chat', data);
    const shared = (id = OTHER) => controller.rewriteClientbound(packet({ text: `[410✫] [MVP++] Friend: https://hypixel.net/claim-reward/${id}` }));
    return { controller, open, click, link, server, shared, messages, gets, posts, upstream, client,
        command: value => controller.command(value ? value.split(' ') : []),
        lines: () => messages.map(message => typeof message === 'string' ? message : extractText(message)).join('\n'),
        tick: ms => { time += ms; }, leave: () => { current = false; controller.dispose(); },
        pause: () => { paused = true; controller.syncSettings(); }, config: () => config };
}

test('page parser, names, streak, CSRF and cookie protocol match the injectable', () => {
    const page = parsePage(html(), ID);
    assert.equal(page.securityToken, TOKEN); assert.equal(page.activeAd, 2);
    assert.equal(page.streakScore, 3); assert.equal(page.streakHigh, 19);
    assert.equal(text.summary(page.rewards[0]), 'Common TNT Games Tokens x4,000');
    assert.equal(text.summary(page.rewards[2]), 'Epic Mystery Dust x40');
    assert.equal(claimUrl(page, 2), `${pageUrl('1234abcd').slice(0, -8)}claim?option=2&id=${ID}&activeAd=2&_csrf=${TOKEN}&watchedFallback=false&skipped=0`);
    assert.equal(cookieHeader(['_csrf=Ab1; Path=/', 'x=y; HttpOnly', 'invalid cookie', null]), '_csrf=Ab1; x=y');
    const special = parsePage(html(ID, {}, [{ reward: 'housing_package', rarity: 'RARE', package: "specialoccasion_reward_card_skull_pot_o'_gold" }]), ID);
    assert.equal(text.name(special.rewards[0]), "Pot O' Gold");
    assert.equal(text.name({ type: 'add_vanity', key: 'suit_treasure_boots' }), 'Treasure Hunter Boots');
    assert.equal(parsePage(html(ID, { error: 'Expired' }), ID).expired, true);
    for (const bad of [html(OTHER), html(ID, { skippable: 'yes' }), html(ID, { activeAd: 1.5 }), html(ID, {}, []),
        html(ID, {}, [...CARDS, ...CARDS]), html().replace('window.securityToken', 'window.unrelated'),
        html(ID, {}, [{ ...CARDS[0], amount: -1 }]), html(ID, {}, [{ ...CARDS[0], reward: '<script>' }]),
        html(ID, { dailyStreak: { score: '3' } }), 'x'.repeat((1 << 20) + 1)]) assert.throws(() => parsePage(bad, ID));
});

test('transport pins the official HTTPS host, limits responses, never redirects and retains only per-offer cookies', async () => {
    const requests = [], transport = createTransport({ request: async config => {
        requests.push(config); return { status: 200, data: 'ok', headers: { 'set-cookie': ['x=y'] } };
    } });
    await transport.get(pageUrl(ID));
    await transport.post(claimUrl(parsePage(html(), ID), 2), { cookie: 'x=y', referer: pageUrl(ID) });
    assert.equal(requests[0].maxRedirects, 0); assert.equal(requests[0].maxContentLength, 1 << 20);
    assert.equal(requests[1].headers.Cookie, 'x=y'); assert.equal(requests[1].headers.Origin, 'https://rewards.hypixel.net');
    assert.equal(requests[1].data, ''); assert.equal(requests[1].timeout, 15000);
    for (const url of ['http://rewards.hypixel.net/claim-reward/' + ID, 'https://evil.example/claim-reward/' + ID,
        'https://rewards.hypixel.net@evil.example/claim-reward/' + ID]) await assert.rejects(transport.get(url));
    assert.equal(requests.length, 2);
});

test('Delivery Man click loads three chat choices and claims only the clicked card once', async () => {
    const h = harness(); h.open(); h.click(); h.link();
    await h.controller.whenIdle();
    assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 0);
    assert.equal(h.messages.filter(row => row.extra?.some(part => part.text === '[CLAIM]')).length, 3);
    assert(h.lines().includes('Streak §f3')); assert(h.lines().includes('Mystery Dust x40'));
    const third = h.messages.find(row => row.extra?.some(part => part.clickEvent?.value === `/dailyreward claim ${ID} 3`));
    assert(third.extra.some(part => part.text === '[CLAIM]' && part.hoverEvent.value.includes('craft cosmetic items')));
    assert(!JSON.stringify(h.messages).includes(TOKEN)); assert(!JSON.stringify(h.messages).includes('SyntheticCookie'));
    h.command(`claim ${ID} 3`); h.command(`claim ${ID} 1`);
    await h.controller.whenIdle();
    assert.equal(h.posts.length, 1); assert(h.posts[0].url.includes('option=2'));
    assert.equal(h.posts[0].opts.cookie, '_csrf=SyntheticCookie'); assert.equal(h.posts[0].opts.referer, pageUrl(ID));
    assert(h.lines().includes('Claimed §5Epic Mystery Dust x40'));
    h.server('chat', packet({ text: 'You have claimed a [Epic Mystery Dust] reward card!' }));
    h.command('status'); assert(h.lines().includes('Hypixel confirmed [Epic Mystery Dust]'));
    h.command(`claim ${ID} 2`); await h.controller.whenIdle(); assert.equal(h.posts.length, 1);
});

test('own link requires a recent Delivery Man click, exact server line and matching actions', async () => {
    for (const scenario of ['no-click', 'wrong-menu', 'stale', 'wrong-window', 'bad-action', 'player-chat', 'action-bar']) {
        const h = harness(); h.open(scenario === 'wrong-menu' ? 'Other menu' : 'The Delivery Man');
        if (scenario !== 'no-click') h.click(scenario === 'wrong-window' ? 8 : 7);
        if (scenario === 'stale') h.tick(10001);
        if (scenario === 'bad-action') h.link(ownLine(ID, 'https://evil.example/'));
        else if (scenario === 'player-chat') h.link(packet({ text: '[MVP+] Fake: ' + extractText(JSON.parse(ownLine().message)) }));
        else if (scenario === 'action-bar') h.link({ ...ownLine(), position: 2 });
        else h.link();
        await h.controller.whenIdle(); assert.equal(h.gets.length, 0, scenario);
    }
    assert.equal(actionsMatch({ clickEvent: { action: 'run_command', value: '/bad' } }, ID), false);
});

test('only the first recent Daily Reward book is hidden; menu closes in both directions', () => {
    const h = harness(); h.open(); h.click();
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen', data: Buffer.from([0]) }), true);
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), false);
    assert.deepEqual(h.upstream, [{ name: 'close_window', data: { windowId: 7 } }]);
    assert.deepEqual(h.client, h.upstream);
    h.open(); h.click(); h.tick(3001); assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), false);
    h.open(); h.click(7, 11); assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), false);
    h.open(); h.click(); assert.equal(h.server('custom_payload', { channel: 'Other' }), false);
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), true);
});

test('clicking the Daily Reward while Hypixel still shows Loading... hides the book', () => {
    const loading = [[31, { plainName: 'Loading...', plainLore: [] }]];
    const h = harness(); h.open(undefined, 7, loading); h.click(7, 31);
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), true);
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), false);
    h.open('Other menu', 7, loading); h.click(7, 31);
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), false, 'Only the Delivery Man counts');
    h.open(undefined, 7, [[31, { plainName: 'Loading...', plainLore: ['Something else'] }]]); h.click(7, 31);
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), false, 'Only the empty placeholder counts');
    h.open(undefined, 7, loading); h.click(7, 31); h.tick(3001);
    assert.equal(h.server('custom_payload', { channel: 'MC|BOpen' }), false, 'Late books pass through');
});

test('reopening a waiting offer and repeated server links do not fetch again', async () => {
    const h = harness(); h.open(); h.click(); h.link(); await h.controller.whenIdle();
    h.command('open'); h.command(''); h.open(); h.click(); h.link(); await h.controller.whenIdle();
    assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 0);
});

test('ranked shared links preserve original chat and are fetched/claimed only by explicit clicks', async () => {
    const h = harness({ settings: { mode: 'auto' }, autoPick: () => 0 });
    const original = packet({ text: '[VIP] Friend: hypixel.net/claim-reward/' + OTHER, bold: true, extra: [{ text: ' hi' }] });
    const before = JSON.stringify(original), rewritten = h.controller.rewriteClientbound(original);
    assert.equal(JSON.stringify(original), before); assert.notEqual(rewritten, original);
    const root = JSON.parse(rewritten.message), button = root.extra.at(-1);
    assert.equal(button.text, ' [CLAIM REWARD]'); assert.equal(button.bold, false); assert.equal(button.underlined, false);
    assert(button.hoverEvent.value.includes('goes to Friend')); assert.equal(h.gets.length, 0);
    h.command(`open ${OTHER}`); await h.controller.whenIdle();
    assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 0, 'Shared links never auto-claim');
    h.command(`claim ${OTHER} 2`); await h.controller.whenIdle();
    assert.equal(h.posts.length, 1); assert(h.lines().includes('for Friend.'));
});

test('shared-link parser excludes unranked senders, server lines and lookalike hosts', () => {
    for (const line of [`[MVP++] Friend: https://hypixel.net/claim-reward/${OTHER}`, `Party > [VIP] Friend: rewards.hypixel.net/claim-reward/${OTHER}`,
        `Guild > [VIP+] Friend [ABC]: http://www.hypixel.net/claim-reward/${OTHER}`]) assert.equal(findSharedLink(line)?.name, 'Friend');
    for (const line of [`Friend: https://hypixel.net/claim-reward/${OTHER}`, `[FAKE] Friend: hypixel.net/claim-reward/${OTHER}`,
        `[MVP+] Friend: https://evilhypixel.net/claim-reward/${OTHER}`, `[VIP] Friend: https://x.hypixel.net/claim-reward/${OTHER}`,
        `[VIP] Friend: https://hypixel.net.evil.example/claim-reward/${OTHER}`, `[VIP] Friend: hypixel.net/claim-reward/${OTHER}ff`]) assert.equal(findSharedLink(line), null, line);
});

test('unskippable ads, expired/malformed pages and failed requests fall back without posting', async () => {
    for (const response of [{ status: 200, body: html(ID, { skippable: false }) }, { status: 200, body: html(ID, { error: 'Expired' }) },
        { status: 403, body: 'challenge' }, { status: 200, body: '<html>changed page</html>' }]) {
        const h = harness({ get: () => response }); h.open(); h.click(); h.link(); await h.controller.whenIdle();
        h.command(`claim ${ID} 1`); await h.controller.whenIdle();
        assert.equal(h.posts.length, 0); assert(!h.lines().includes('[CLAIM]'));
    }
    const h = harness({ post: () => { throw Error('Synthetic network failure with private URL'); } });
    h.open(); h.click(); h.link(); await h.controller.whenIdle(); h.command(`claim ${ID} 1`); await h.controller.whenIdle();
    assert(h.lines().includes('cannot tell whether it went through')); assert(!h.lines().includes('private URL'));
    h.command(`claim ${ID} 2`); await h.controller.whenIdle(); assert.equal(h.posts.length, 1, 'An ambiguous POST is never retried');
});

test('disconnect, disabling and the API kill switch invalidate pending work and old buttons', async () => {
    for (const boundary of ['leave', 'off', 'pause']) {
        const pending = deferred(), h = harness({ get: () => pending.promise });
        h.open(); h.click(); h.link(); await Promise.resolve();
        if (boundary === 'leave') h.leave(); else if (boundary === 'off') h.command('off'); else h.pause();
        const count = h.messages.length;
        pending.resolve({ status: 200, body: html(), cookies: [] }); await h.controller.whenIdle();
        assert.equal(h.messages.length, count); assert(h.gets[0].opts.signal.aborted);
        h.command(`claim ${ID} 1`); await h.controller.whenIdle(); assert.equal(h.posts.length, 0);
    }
});

test('a rejected claim never reports success or retries, and a late POST cannot notify a new connection', async () => {
    for (const response of [{ status: 403, body: 'rejected' }, { status: 200, body: 'unexpected page' }, { status: 429, body: 'limited' }]) {
        const h = harness({ post: () => response });
        h.open(); h.click(); h.link(); await h.controller.whenIdle();
        h.command(`claim ${ID} 1`); await h.controller.whenIdle();
        assert(h.lines().includes('did not accept the claim'));
        assert(!h.lines().includes('§aClaimed'));
        h.command(`claim ${ID} 2`); await h.controller.whenIdle(); assert.equal(h.posts.length, 1);
    }
    const pending = deferred(), h = harness({ post: () => pending.promise });
    h.open(); h.click(); h.link(); await h.controller.whenIdle();
    h.command(`claim ${ID} 1`); await Promise.resolve();
    h.leave(); const count = h.messages.length;
    pending.resolve({ status: 200, body: 'reward claimed' }); await h.controller.whenIdle();
    assert(h.posts[0].opts.signal.aborted); assert.equal(h.messages.length, count);
});

test('own and shared offers keep separate cookies and serialize their network operations', async () => {
    const pending = deferred();
    const h = harness({ get: url => url.endsWith(ID) ? pending.promise
        : { status: 200, body: html(OTHER), cookies: ['_csrf=OtherCookie'] } });
    h.open(); h.click(); h.link(); h.shared(); h.command(`open ${OTHER}`);
    await Promise.resolve(); assert.equal(h.gets.length, 1, 'Only one HTTP owner runs at a time');
    pending.resolve({ status: 200, body: html(ID), cookies: ['_csrf=OwnCookie'] }); await h.controller.whenIdle();
    assert.equal(h.gets.length, 2);
    h.command(`claim ${ID} 1`); h.command(`claim ${OTHER} 2`); await h.controller.whenIdle();
    assert.deepEqual(h.posts.map(row => row.opts.cookie), ['_csrf=OwnCookie', '_csrf=OtherCookie']);
});

test('turning off shared links cancels only shared work and settings persist through the host', async () => {
    const h = harness(); h.open(); h.click(); h.link(); await h.controller.whenIdle(); h.shared();
    h.command('others off'); assert.equal(h.config().others, false);
    h.command(`open ${OTHER}`); await h.controller.whenIdle(); assert.equal(h.gets.length, 1);
    h.command(`claim ${ID} 1`); await h.controller.whenIdle(); assert.equal(h.posts.length, 1);
    h.command('mode auto'); assert.equal(h.config().mode, 'auto');
    h.command('mode invalid'); assert.equal(h.config().mode, 'auto');
    assert.deepEqual(normalizeSettings({ enabled: 'false', mode: 'invalid' }), { enabled: true, others: true, mode: 'manual' });
});

test('optional auto mode claims a unique choice, but falls back to manual on unknown cards', async () => {
    for (const choice of [1, -1]) {
        const h = harness({ settings: { mode: 'auto' }, autoPick: () => choice });
        h.open(); h.click(); h.link(); await h.controller.whenIdle();
        assert.equal(h.posts.length, choice === 1 ? 1 : 0);
        if (choice === -1) assert(h.lines().includes('no clear winner'));
    }
    assert.equal(choose([{ type: 'housing_package', rarity: 'LEGENDARY', amount: -1 }]), -1);
    const model = require('../../assets/rewards/auto-pick-model.json'), pick = createAutoPick(model);
    assert.deepEqual(pick.predict(['exp20000', 'classic100', 'dust120']), { mode: 'auto', reason: 'unique', best: ['exp20000'] });
    assert.equal(pick.id({ type: 'coins', gameType: 'TNTGAMES', amount: 4000 }), 'tnt4000');
    assert.equal(pick.id({ type: 'coins', gameType: 'SKYWARS', amount: 5000 }), 'swt5000');
    assert.equal(pick.id({ type: 'coins', gameType: 'SKYWARS', amount: 1234 }), null);
});

test('help and tab completion expose the reward controls without replacing /daily stats', () => {
    const { createProxyTabCompleter } = require('../../features/command_completion');
    const complete = createProxyTabCompleter({});
    assert(complete('/dailyreward ').includes('open'));
    assert.deepEqual(complete('/dailyreward mode '), ['manual', 'auto']);
    assert.deepEqual(complete('/dailyreward others '), ['on', 'off']);
    assert(require('../../features/help_command').HELP_SECTIONS.some(section => section.entries.some(row => row.label === '/dailyreward')));
});

test('reward settings survive unrelated saves and a fresh config load in isolated storage', () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const { spawnSync } = require('node:child_process');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-reward-settings-'));
    try {
        const configPath = require.resolve('../../app_config');
        const script = `const assert=require('node:assert/strict'),config=require(${JSON.stringify(configPath)});
            assert.deepEqual(config.loadFeatureSettings().dailyReward,{enabled:true,others:true,mode:'manual'});
            config.saveFeatureSettings({dailyReward:{enabled:false,others:false,mode:'auto'}});
            config.saveFeatureSettings({queueTimePartyChatEnabled:false});
            assert.deepEqual(config.loadFeatureSettings().dailyReward,{enabled:false,others:false,mode:'auto'});`;
        const result = spawnSync(process.execPath, ['-e', script], {
            env: { ...process.env, FURY_DATA_DIR: directory }, encoding: 'utf8', windowsHide: true
        });
        assert.equal(result.status, 0, result.stderr);
    } finally {
        // This test owns only this newly-created flat directory.
        for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
        fs.rmdirSync(directory);
    }
});
