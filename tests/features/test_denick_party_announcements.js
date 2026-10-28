'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { createPartyTracker } = require('../../src/net/session/partyTracking');
const { getBedwarsScanStats, formatBedwarsScanLine } = require('../../src/stats/scanLine');

// Exercise the production announcement path without starting the proxy or
// sending commands to Hypixel.
const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
const start = source.indexOf('        async function announceSuccessfulDenick(');
const end = source.indexOf('        function queueAutoSkinDenick(', start);
assert(start >= 0 && end > start, 'production announcement functions must be present');

function harness({ broadcast = true, local = true, mode = 'BEDWARS', lookup } = {}) {
    const commands = [], messages = [], dashboards = [], cosmetics = [];
    const announced = new Set();
    const partyTracker = createPartyTracker({
        stripFormatting: value => value,
        getSelfName: () => 'Self',
        requestPartyListCommand: () => {},
        sendChat: () => {}
    });
    partyTracker.handleChatLine("You have joined Leader's party!");
    partyTracker.handleChatLine('Friend joined the party.');
    const context = {
        partyTracker, denickPartyAnnounceEnabled: broadcast,
        denickChatAnnouncementsEnabled: local, currentGamemode: mode,
        client: {}, BEDWARS_MODE_DEFS: [{}],
        shouldSuppressDenickAnnouncement: () => false,
        hasAnnouncedDenick: name => announced.has(name),
        markDenickAnnounced: name => announced.add(name),
        sendChat: (_, message) => messages.push(message),
        getBedwarsScanStats, formatBedwarsScanLine,
        getPlayerData: lookup || (async () => ({ data: { player: {} }, fromCache: false })),
        rememberPlayerActiveCosmetics: name => cosmetics.push(name),
        renderBedwarsStats: () => dashboards.push('BEDWARS'),
        renderSkyWarsDashboard: () => dashboards.push('SKYWARS'),
        numberOr: (value, fallback) => Number(value) || fallback,
        ratioValue: (a, b) => (Number(a) || 0) / (Number(b) || 1),
        sendHypixelCommand: (command, options) => commands.push({ command, options })
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    return { context, partyTracker, commands, messages, dashboards, cosmetics, announced };
}

async function run() {
    for (const method of ['skin', 'stats']) {
        for (const realName of ['fRiEnD', 'LEADER', 'Self']) {
            const h = harness();
            await h.context.announceSuccessfulDenick('HiddenNick', { realName, source: method });
            assert.strictEqual(h.commands.length, 0, `${method}: party members must not be broadcast`);
            assert(h.messages.some(message => message.includes(realName)), 'local result remains visible');
            assert.deepStrictEqual(h.dashboards, method === 'stats' ? [] : ['BEDWARS'], 'stats denicks use one compact line; skin denicks keep their dashboard');
            if (method === 'stats') {
                assert.strictEqual(h.messages.length, 1);
                assert(h.messages[0].includes('FKDR:') && h.messages[0].includes('WLR:') && h.messages[0].includes('WS:'));
            }
            assert.deepStrictEqual(h.cosmetics, ['HiddenNick', realName], 'cosmetics still update');
            assert(h.announced.has('HiddenNick'), 'local announcement deduplication remains intact');
        }

        const enemy = harness();
        await enemy.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy', source: method });
        assert.strictEqual(enemy.commands.length, 1, `${method}: non-party matches still broadcast`);
        assert(enemy.commands[0].command.startsWith('/pc [Denick] Enemy is nicked as HiddenNick | '));
        assert.strictEqual(enemy.commands[0].options.dedupeKey, 'denick-party:HiddenNick:Enemy');
        await enemy.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy', source: method });
        assert.strictEqual(enemy.commands.length, 1, 'duplicate results must not broadcast again');
    }

    const moderator = harness();
    moderator.partyTracker.handleChatLine('Leader has promoted Friend to Party Moderator');
    await moderator.context.announceSuccessfulDenick('HiddenNick', { realName: 'Friend' });
    assert.strictEqual(moderator.commands.length, 0, 'moderators are also party members');

    let resolveLookup;
    const joining = harness({ lookup: () => new Promise(resolve => { resolveLookup = resolve; }) });
    const pending = joining.context.announceSuccessfulDenick('HiddenNick', { realName: 'NewFriend' });
    joining.partyTracker.handleChatLine('NewFriend joined the party.');
    resolveLookup({ data: { player: {} } });
    await pending;
    assert.strictEqual(joining.commands.length, 0, 'check current membership after the async lookup');

    const leaving = harness();
    leaving.partyTracker.handleChatLine('Friend has left the party.');
    await leaving.context.announceSuccessfulDenick('HiddenNick', { realName: 'Friend' });
    assert.strictEqual(leaving.commands.length, 1, 'former members are eligible again');

    for (const options of [{ broadcast: false }, { mode: 'SKYWARS' }]) {
        const h = harness(options);
        await h.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy' });
        assert.strictEqual(h.commands.length, 0, 'existing broadcast gates are preserved');
    }
    const solo = harness();
    solo.partyTracker.handleChatLine('You left the party.');
    await solo.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy' });
    assert.strictEqual(solo.commands.length, 0, 'no party means no party broadcast');

    const quiet = harness({ local: false });
    await quiet.context.announceSuccessfulDenick('HiddenNick', { realName: 'Friend' });
    await quiet.context.announceSuccessfulDenick('OtherNick', { realName: 'Enemy' });
    assert.strictEqual(quiet.messages.length, 0);
    assert.strictEqual(quiet.dashboards.length, 0);
    assert.strictEqual(quiet.commands.length, 1, 'party broadcast remains independent of local notices');

    const saved = harness();
    saved.context.announceKnownPregameDenickToParty('HiddenNick', 'FRIEND');
    saved.context.announceKnownPregameDenickToParty('OtherNick', 'Enemy');
    assert.strictEqual(saved.commands.length, 1, 'saved denicks retain the same party protection');

    const unavailable = harness({ lookup: async () => ({ error: true }) });
    await unavailable.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy', source: 'stats' });
    assert.strictEqual(unavailable.messages.length, 1);
    assert(unavailable.messages[0].includes('(Enemy)') && unavailable.messages[0].includes('Stats unavailable'));
    assert.strictEqual(unavailable.commands.length, 0);

    let current = true, finish;
    const stale = harness({ lookup: () => new Promise(resolve => { finish = resolve; }) });
    const announcing = stale.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy', source: 'stats' }, { isCurrent: () => current });
    current = false;
    finish({ data: { player: {} } });
    await announcing;
    assert.strictEqual(stale.messages.length, 0, 'stale stats announcements must stay silent');
    assert.strictEqual(stale.commands.length, 0);
    console.log('Denick party announcement tests passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
