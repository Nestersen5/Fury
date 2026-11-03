'use strict';

// Live /share sends individual results before their team/scan completes,
// preserves chat pacing and filters, and deduplicates later team callbacks.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { createRequire } = require('module');
const { fixture } = require('./test_hypixel_api_coordinator');
const { createShareTagsBroadcaster } = require('../../src/overlay/shareTags.js');
const { createScanRunner } = require('../../src/overlay/scan.js');

const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

function makeBroadcaster(state, messages) {
    return createShareTagsBroadcaster({
        state,
        sendChat() {},
        getHypixelClient: () => ({ write: (_name, { message }) => messages.push(message) }),
        getLocalUsername: () => '',
        saveFeatureConfig() {},
        getPartyStatus: () => true,
        getPresentAtGameStart: () => true
    });
}

function baseState(overrides = {}) {
    return {
        shareTagsGroupByTeam: true,
        shareTagsFancy: false,
        shareTagsColorLocal: false,
        shareTagsIncludeTagged: true,
        shareTagsIncludeNicks: true,
        shareTagsIncludeThreats: true,
        shareTagsDestination: 'party',
        ...overrides
    };
}

const threat = (name, team, fkdr) => ({ name, team, gameMode: 'BEDWARS', isThreat: true, fkdr, sortValue: fkdr });

// Extract the player names from the sent "/pc [TEAM] Name: FKDR: x" lines.
function namesFrom(messages) {
    return messages
        .filter(m => !/\+\d+ more/.test(m))
        .map(m => (m.match(/\]\s+([A-Za-z0-9_]+)/) || [])[1])
        .filter(Boolean);
}

(async () => {
    // --- grouped: completion order, FKDR-sorted within a team ---
    {
        const messages = [];
        const b = makeBroadcaster(baseState({ shareTagsGroupByTeam: true }), messages);
        const stream = b.createStream({}, { gameMode: 'BEDWARS', includeSet: ['threats'], isStillActive: () => true });
        stream.onTeam('BLUE', [threat('C', 'BLUE', 3)]);          // BLUE completes first
        stream.onTeam('RED', [threat('A', 'RED', 5), threat('B', 'RED', 8)]); // RED second
        await stream.end();
        assert.deepStrictEqual(namesFrom(messages), ['C', 'B', 'A'],
            'grouped: BLUE first, then RED sorted by FKDR desc (B=8 before A=5)');
    }

    // Live rows use arrival order regardless of the legacy grouping setting.
    for (const shareTagsGroupByTeam of [true, false]) {
        const messages = [];
        const b = makeBroadcaster(baseState({ shareTagsGroupByTeam }), messages);
        const stream = b.createStream({}, { gameMode: 'BEDWARS', includeSet: ['threats'], isStillActive: () => true });
        stream.onRow(threat('A', 'RED', 5));
        await flush();
        assert.deepStrictEqual(namesFrom(messages), ['A'], 'First row sends before any team callback or end()');
        stream.onRow(threat('C', 'BLUE', 3));
        stream.onRow(threat('B', 'RED', 8));
        stream.onTeam('BLUE', [threat('C', 'BLUE', 3)]);
        stream.onTeam('RED', [threat('A', 'RED', 5), threat('B', 'RED', 8)]);
        await stream.end();
        assert.deepStrictEqual(namesFrom(messages), ['A', 'C', 'B'], 'Team completion cannot reorder or resend live rows');
    }

    // --- dedup: the same player pushed twice is sent once ---
    {
        const messages = [];
        const b = makeBroadcaster(baseState({ shareTagsGroupByTeam: false }), messages);
        const stream = b.createStream({}, { gameMode: 'BEDWARS', includeSet: ['threats'], isStillActive: () => true });
        const row = threat('Dup', 'RED', 4);
        stream.onRow(row);
        stream.onRow({ ...row, name: 'dup' });
        stream.onTeam('RED', [row]);
        stream.onTeam('RED', [row]);
        await stream.end();
        assert.deepStrictEqual(namesFrom(messages), ['Dup'], 'dedup: duplicate row sent once');
    }

    // A failed lookup neither sends a fake zero nor consumes the player's
    // dedup slot; a successful result arriving later may still be shared.
    for (const gameMode of ['BEDWARS', 'SKYWARS']) {
        const messages = [];
        const b = makeBroadcaster(baseState(), messages);
        const stream = b.createStream({}, { gameMode, includeSet: ['threats'] });
        const failed = { ...threat('RetryPlayer', 'GREEN', 0), gameMode, kdr: 0, lookupFailed: true };
        stream.onRow(failed);
        assert.deepStrictEqual(messages, [], 'Failed lookups never enter the outgoing queue');
        stream.onRow({ ...failed, lookupFailed: false, fkdr: 5, kdr: 5 });
        await stream.end();
        assert.equal(messages.length, 1, 'A later successful threat is shared once');
        assert(messages[0].includes('RetryPlayer') && messages[0].includes('5.00'));
        assert(!messages[0].includes('0.00'));
    }

    for (const gameMode of ['BEDWARS', 'SKYWARS']) await scanStreamsBeforeCompletion(gameMode);
    await scanStreamsBeforeCompletion('BEDWARS', true);
    await monthlyPreferenceStreams();
    console.log('test_share_stream.js passed');
})().catch(err => { console.error(err); process.exit(1); });

async function monthlyPreferenceStreams() {
    const { clock } = fixture(), filename = require.resolve('../../src/overlay/shareTags.js'), module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: createRequire(filename), module, exports: module.exports, console, setTimeout: clock.setTimeout }, { filename });
    const messages = [], state = baseState({ shareTagsMonthlyFkdr: false });
    let lookups = 0, finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const b = module.exports.createShareTagsBroadcaster({ state, sendChat() {}, getLocalUsername: () => 'Self', getHypixelClient: () => ({}),
        getPartyStatus: () => true, getPresentAtGameStart: () => true,
        fetchMonthlySession: () => { lookups++; return pending; },
        sendHypixelCommand: async message => { messages.push({ message, at: clock.now }); return { sent: true }; }
    });
    const stream = b.createStream({}, { gameMode: 'BEDWARS' });
    stream.onRow({ ...threat('First', 'RED', 5), monthlyFkdr: 9 });
    stream.onRow(threat('Second', 'BLUE', 6));
    const done = stream.end();
    await clock.until(1000); await done;
    assert.equal(lookups, 0, 'automatic stream does not start a monthly lookup when disabled');
    assert.equal(messages.length, 2, 'both ready rows send without waiting for monthly stats');
    assert(messages.every(row => !row.message.includes('MFKDR')));
    assert(messages[1].at - messages[0].at >= 400, 'turning off monthly stats preserves chat pacing');
    b.setMonthlyFkdr(true);
    const waiting = b.createStream({}, { gameMode: 'BEDWARS' });
    waiting.onRow(threat('Third', 'GREEN', 7));
    await flush();
    assert.equal(lookups, 1, 'enabled stream requests monthly data');
    b.setMonthlyFkdr(false);
    finish({ delta: { stats: { Bedwars: { final_kills_bedwars: 12, final_deaths_bedwars: 2 } } } });
    const ended = waiting.end();
    await clock.until(2000); await ended;
    assert.equal(messages.length, 3);
    assert(!messages[2].message.includes('MFKDR'), 'a reply already in flight also respects turning the display off');
}

async function scanStreamsBeforeCompletion(gameMode, summary = false) {
    // Run the real scan and broadcaster together. One unfinished player holds
    // the whole BLUE team open; virtual time checks actual send timing.
    const { clock } = fixture();
    const filename = require.resolve('../../src/overlay/shareTags.js');
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        require: createRequire(filename), module, exports: module.exports,
        console, setTimeout: clock.setTimeout
    }, { filename });
    const messages = [], localLines = [];
    const broadcaster = module.exports.createShareTagsBroadcaster({
        state: baseState({ shareTagsTeamSummary: summary }), sendChat() {}, getLocalUsername: () => 'Self',
        getHypixelClient: () => ({}),
        sendHypixelCommand: async (message, options) => {
            messages.push({ message, at: clock.now, options });
            return { sent: true };
        },
        getPartyStatus: () => true, getPresentAtGameStart: () => true
    });
    let releaseSlow, snapshot;
    const slow = new Promise(resolve => { releaseSlow = resolve; });
    const names = ['SlowPlayer', 'ThreatPlayer', 'TaggedPlayer', 'NickedPlayer'];
    const profile = name => ({ data: {
        isNicked: name === 'NickedPlayer',
        player: { achievements: { bedwars_level: 1 }, stats: {
            Bedwars: { final_kills_bedwars: name === 'ThreatPlayer' ? 10 : 1, final_deaths_bedwars: 1 },
            SkyWars: { kills: name === 'ThreatPlayer' ? 10 : 1, deaths: 1 }
        } },
        urchin: { ok: true, tag: name === 'TaggedPlayer' ? 'SNIPER' : '' }
    } });
    const runner = createScanRunner({
        state: { scanMode: 'all', threatConfig: { minFkdr: 5, minStars: 500, countTags: true,
            minSkywarsKdr: 5, minSkywarsWlr: 5, minSkywarsLevel: 50 } },
        sendChat: (_client, line) => localLines.push(line),
        isSupportedTabStatsMode: mode => ['BEDWARS', 'SKYWARS'].includes(mode),
        getPlayerTeam: (map, name) => map.get(name)?.team,
        playerLookupKey: name => name.toLowerCase(),
        getPlayerDataWithNickDetection: async name => name === 'SlowPlayer' ? slow : profile(name),
        isLikelyBot: () => false, getSkyWarsLevelValue: () => 1, formatSkyWarsLevel: () => '1',
        inferTeamFromColor: (map, name) => map.get(name)?.team,
        getTabNameColor: () => '\u00a79', extractDisplayColor: () => null,
        getInteractiveTags: () => [], setLastScanSummary() {},
        setLastScanResults: value => { snapshot = value; }
    });
    const stream = broadcaster.createStream({}, { gameMode });
    const lobby = new Map(names.map(name => [name, { team: summary && ['ThreatPlayer', 'TaggedPlayer'].includes(name) ? 'RED' : 'BLUE', inTab: true }]));
    const done = runner.performFullScan({ username: 'Self' }, lobby, new Map(), summary ? 'GREEN' : 'RED', {
        gameActive: true, gameMode, gameRoster: new Set(names), shareStream: stream
    });
    await clock.until(1000);
    if (summary) {
        assert.deepStrictEqual(messages.map(row => row.message), ['/pc Red team has 1 sniper, 10 FKDR'], 'a completed team sends while another team still has an unfinished player');
    } else {
        assert.deepStrictEqual(namesFrom(messages.map(row => row.message)),
            ['ThreatPlayer', 'TaggedPlayer', 'NickedPlayer'], `${gameMode}: all categories send while a teammate is still loading`);
    }
    assert.equal(snapshot, undefined, 'Final scan snapshot is still pending');
    assert.equal(localLines.length, 0, 'Local scan output still waits for all players');
    assert(messages.every(row => row.message.startsWith('/pc ') && row.options.priority === 90));
    for (let i = 1; i < messages.length; i++) {
        assert(messages[i].at - messages[i - 1].at >= 400, 'Early sends retain the chat safety gap');
    }
    releaseSlow(profile('SlowPlayer'));
    await done;
    const ended = stream.end();
    await clock.until(2000);
    await ended;
    assert.equal(snapshot.results.length, 4);
    assert.equal(messages.length, summary ? 2 : 3, 'Completing the scan/team sends no duplicates');
    if (summary) assert.strictEqual(messages[1].message, '/pc Blue team has 1 nicked');
}
