'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { createPartyTracker } = require('../../src/net/session/partyTracking');
const { getBedwarsScanStats, formatBedwarsScanLine, formatSkywarsScanLine, formatDenickAnnouncement, formatAutoDenickMatch } = require('../../src/stats/scanLine');
const { stripAnsi, extractText, sendChat } = require('../../features/minecraft_chat');
const { parseUrchinBatchTags } = require('../../src/stats/urchin');
const { hasTag, formatTagDescriptor, formatLine, MAX_PC_LENGTH } = require('../../src/overlay/shareTags');
const { formatSkyWarsLevel } = require('../../src/stats/format');
const { createOverlayTagBuilder } = require('../../src/overlay/tags');
const { buildOverlayTagComponents } = require('../../src/overlay/chat_overlay_annotation');
const { isUrchinRequestFailed, shortUrchinStatusLabel, urchinStatusMessage } = require('../../src/stats/urchin');
const { buildOverlayTags } = createOverlayTagBuilder({ compactTagName: String });

// Exercise the production announcement path without starting the proxy or
// sending commands to Hypixel.
const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
const start = source.indexOf('        async function announceSuccessfulDenick(');
const end = source.indexOf('        function queueAutoSkinDenick(', start);
assert(start >= 0 && end > start, 'production announcement functions must be present');
const tagStart = source.indexOf('function getInteractiveTags(');
const tagEnd = source.indexOf('// renderSkyWarsDashboard lives', tagStart);
assert(tagStart >= 0 && tagEnd > tagStart);

function harness({ broadcast = true, local = true, mode = 'BEDWARS', lookup } = {}) {
    const commands = [], messages = [], rawMessages = [], dashboards = [], cosmetics = [];
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
        sendChat: (_, message) => { rawMessages.push(message); messages.push(extractText(message)); },
        getBedwarsScanStats, formatDenickAnnouncement, formatAutoDenickMatch,
        hasTag, formatTagDescriptor, MAX_PC_LENGTH,
        buildOverlayTags, buildOverlayTagComponents, isUrchinRequestFailed, shortUrchinStatusLabel, urchinStatusMessage,
        getPlayerData: lookup || (async () => ({ data: { player: {} }, fromCache: false })),
        rememberPlayerActiveCosmetics: name => cosmetics.push(name),
        renderBedwarsStats: () => dashboards.push('BEDWARS'),
        renderSkyWarsDashboard: () => dashboards.push('SKYWARS'),
        numberOr: (value, fallback) => Number(value) || fallback,
        ratioValue: (a, b) => (Number(a) || 0) / (Number(b) || 1),
        sendHypixelCommand: (command, options) => commands.push({ command, options })
    };
    vm.createContext(context);
    vm.runInContext(source.slice(tagStart, tagEnd), context);
    vm.runInContext(source.slice(start, end), context);
    return { context, partyTracker, commands, messages, rawMessages, dashboards, cosmetics, announced };
}

async function run() {
    const player = {
        achievements: { bedwars_level: 44 },
        stats: {
            Bedwars: { final_kills_bedwars: 218, final_deaths_bedwars: 100, wins_bedwars: 41, losses_bedwars: 100, winstreak: 3 },
            SkyWars: { levelFormatted: '§6[12★]', kills: 500, deaths: 100, wins: 20, losses: 10, win_streak: 2 }
        }
    };
    for (const mode of ['BEDWARS', 'SKYWARS']) {
        let lookups = 0;
        const h = harness({ mode, lookup: async () => {
            lookups++;
            return { data: { player, urchin: parseUrchinBatchTags([{ type: 'Sniper', reason: 'scaffold', added_by_username: 'Moderator' }]) } };
        } });
        await h.context.announceSuccessfulDenick('Mason300', { realName: 'NotVectoria', source: 'skin' });
        const row = h.rawMessages[0], identity = '§cMason300 §a(NotVectoria)';
        assert.strictEqual(h.messages.length, 1);
        assert.strictEqual(lookups, 1, 'inline stats reuse the single existing lookup');
        assert.deepStrictEqual(h.dashboards, []);
        assert.strictEqual(row.text, '§b[Denick] ');
        assert.strictEqual(row.extra[0].text, mode === 'SKYWARS'
            ? formatSkywarsScanLine({ skyLevel: formatSkyWarsLevel(player.stats.SkyWars, player), kdr: 5, wlr: 2, ws: 2 }, identity)
            : formatBedwarsScanLine(getBedwarsScanStats(player), identity), 'use the same colored stat line as scan results');
        const plain = stripAnsi(h.messages[0]);
        assert(plain.includes('Mason300 (NotVectoria)'));
        assert(plain.includes(mode === 'SKYWARS' ? 'KDR: 5.00' : 'FKDR: 2.18'));
        assert(plain.includes(mode === 'SKYWARS' ? 'WLR: 2.00' : 'WLR: 0.41'));
        const badge = row.extra.find(part => part.clickEvent);
        assert.strictEqual(badge.clickEvent.value, '/urchin NotVectoria');
        assert(badge.hoverEvent.value.includes('scaffold'));
        const packets = [];
        sendChat({ state: 'play', write: (type, packet) => { if (type === 'chat') packets.push(packet); } }, row);
        assert.strictEqual(packets.length, 1, 'production chat sends one line without a stats card');
        assert(!extractText(JSON.parse(packets[0].message)).includes('\n'));
    }
    for (const lookup of [
        async () => ({ error: true }),
        async () => { throw new Error('Offline fixture'); },
        async () => ({ data: { player: {}, lookupFailed: true } }),
        async () => ({ data: { player: {}, isNicked: true } })
    ]) {
        const h = harness({ lookup });
        await h.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy', source: 'skin' });
        assert.strictEqual(h.messages.length, 1, 'failed stats still show the confirmed identity once');
        assert(stripAnsi(h.messages[0]).includes('[Denick] HiddenNick (Enemy) | Stats unavailable right now.'));
        assert(!/FKDR:|WLR:|WS:/.test(h.messages[0]), 'failed stats must not appear as zeroes');
        assert.deepStrictEqual(h.dashboards, []);
        assert.strictEqual(h.commands.length, 0);
    }
    for (const method of ['skin', 'stats']) {
        const cases = [
            [parseUrchinBatchTags([{ type: 'Closet', reason: 'scaffold' }]), 'Closet Cheater (Scaffold)'],
            [parseUrchinBatchTags([{ type: 'Blatant', reason: 'scaffold, ab, lagrange, blink, velocity, ac' }]), 'Blatant Cheater (Scaffold, Auto Block, Lag Range, Blink, Auto Clicker, Velocity)'],
            [parseUrchinBatchTags([{ type: 'Blatant', reason: 'scaffold, scaffold, double shifting' }]), 'Blatant Cheater (Scaffold (Doubleshifting))'],
            [parseUrchinBatchTags([{ type: 'Caution', reason: 'closes games when losing\nTHIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!' }]), 'Caution (closes games when losing)'],
            [parseUrchinBatchTags([{ type: 'Legit' }]), 'Legit Sniper'],
            [parseUrchinBatchTags([]), ''],
            [undefined, ''],
            [{ ok: false, tag: 'TIMEOUT', rawTags: [] }, ''],
            [{ ...parseUrchinBatchTags([{ type: 'Closet', reason: 'scaffold' }]), ok: false }, '']
        ];
        for (const [urchin, descriptor] of cases) {
            let lookups = 0;
            const h = harness({ lookup: async () => { lookups++; return { data: { player, urchin } }; } });
            await h.context.announceSuccessfulDenick('IcyBiM9', { realName: 'sk8terz', source: method });
            assert.strictEqual(h.commands.length, 1);
            const command = h.commands[0].command;
            assert.strictEqual(command, `/pc [Denick] sk8terz is nicked as IcyBiM9 | 44★ FKDR 2.18 WLR 0.41 WS 3${descriptor ? ` | ${descriptor}` : ''}`, `${method}: tag and cheats in the party line`);
            assert.strictEqual(lookups, 1, 'reuse the announcement profile without extra requests');
            assert(!command.includes('Added by') && !command.includes('\n') && !command.includes('§'), 'party text excludes metadata, newlines and color codes');
            if (descriptor) {
                const share = formatLine({ name: 'sk8terz', team: 'RED', fkdr: 2.18, uTag: urchin.tag, urchinRaw: urchin }, 'BEDWARS', new Set(['tagged']));
                assert(share.endsWith(descriptor), 'denick and /share use the same tag/cheat text');
            }
            assert.strictEqual(h.commands[0].options.priority, 85);
            assert.strictEqual(h.commands[0].options.dedupeMs, 5000);
        }
        const long = harness({ lookup: async () => ({ data: { player, urchin: parseUrchinBatchTags([{ type: 'Z'.repeat(300), reason: 'scaffold' }]) } }) });
        await long.context.announceSuccessfulDenick('IcyBiM9', { realName: 'sk8terz', source: method });
        assert.strictEqual(long.commands[0].command.length, MAX_PC_LENGTH, 'long denick announcements include /pc in the shared chat limit');
        assert(long.commands[0].command.endsWith('...'));

        for (const realName of ['fRiEnD', 'LEADER', 'Self']) {
            const h = harness({ lookup: async () => ({ data: { player, urchin: parseUrchinBatchTags([{ type: 'Closet', reason: 'scaffold' }]) } }) });
            await h.context.announceSuccessfulDenick('HiddenNick', { realName, source: method });
            assert.strictEqual(h.commands.length, 0, `${method}: party members must not be broadcast`);
            assert(h.messages.some(message => message.includes(realName)), 'local result remains visible');
            assert.deepStrictEqual(h.dashboards, [], 'denicks never open a stats card automatically');
            assert.strictEqual(h.messages.length, 1, 'identity and stats share one message');
            if (method === 'stats') {
                assert.strictEqual(h.messages.length, 1);
                assert(h.messages[0].includes('Confirmed match:'));
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
    await unavailable.context.announceSuccessfulDenick('HiddenNick', {
        realName: 'Enemy', source: 'stats', observedFinals: 1000, observedBeds: 500, finals: 990, beds: 525
    });
    assert.strictEqual(unavailable.messages.length, 1);
    assert(unavailable.messages[0].includes('(Enemy)') && unavailable.messages[0].includes('Stats unavailable'));
    assert(stripAnsi(unavailable.messages[0]).includes('Confirmed match:'));
    assert(!/Finals:|Beds:|detected |diff /.test(stripAnsi(unavailable.messages[0])));
    assert(stripAnsi(unavailable.messages[0]).endsWith('| Stats unavailable right now.'));
    assert.strictEqual(unavailable.commands.length, 0);

    const compared = harness({ lookup: async () => ({ data: { player: {
        stats: { Bedwars: { final_kills_bedwars: 9999, beds_broken_bedwars: 9999 } }
    } } }) });
    await compared.context.announceSuccessfulDenick('HiddenNick', {
        realName: 'Enemy', source: 'stats', observedFinals: 1000, observedBeds: 500, finals: 990, beds: 525
    });
    assert.strictEqual(compared.messages.length, 1, 'keep the compact single-line result');
    const confirmation = stripAnsi(compared.messages[0]);
    assert(confirmation.startsWith('[AutoDenick] Confirmed match:'));
    assert(confirmation.includes('FKDR:') && confirmation.includes('WLR:') && confirmation.includes('WS:'));
    assert(!/Finals:|Beds:|detected |diff /.test(confirmation));
    assert(!confirmation.includes('9,999'), 'compare the verified candidate counts, not a later profile refresh');
    assert.strictEqual(compared.commands.length, 1, 'existing party announcements are preserved');

    for (const method of ['skin', 'stats']) {
        let current = true, finish;
        const stale = harness({ lookup: () => new Promise(resolve => { finish = resolve; }) });
        const announcing = stale.context.announceSuccessfulDenick('HiddenNick', { realName: 'Enemy', source: method }, { isCurrent: () => current });
        current = false;
        finish({ data: { player: {} } });
        await announcing;
        assert.strictEqual(stale.messages.length, 0, 'stale denick announcements must stay silent');
        assert.strictEqual(stale.commands.length, 0);
    }
    console.log('Denick party announcement tests passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
