'use strict';

// A nicked enemy is a threat. These tests cover the two ways one used to fall
// out of /scan: their name being mistaken for a Hypixel-generated entity name,
// and the scan's own (uncacheable, easily rate-limited) lookup missing.

const assert = require('assert');
const { isLikelyBot } = require('../../src/denick/botNames.js');
const { createScanRunner } = require('../../src/overlay/scan.js');
const { getFkdrColor, getKdrColor, getWlrColor, getWsColor } = require('../../src/stats/colors.js');
const { formatBedwarsPrestige, formatSkyWarsLevel, getSkyWarsLevelValue } = require('../../src/stats/format.js');

// --- Name-shape heuristic ------------------------------------------------
// Synthetic names that reproduce the name shapes observed in this project's
// recordings/, not the real accounts themselves. The generated ones all mix
// digits into ten lowercase characters; the human ones reproduce every shape
// the old rule swept up with them: ten lowercase letters with no digit, a long
// lowercase name with trailing digits, mixed case, a trailing underscore, a
// capitalised short name, mixed case with digits, a thirteen-letter lowercase
// name, all caps with digits, and an underscore between letters and digits.
const GENERATED_NAMES = [
    '0x20o4ur65', 'xf2l22s65j', '0d9s5zx9qp', '2695ol5dmx', '8c8umd2e68',
    '93kr7vhuj6', 'ppv0dt3pgs', 'y25539kf77', '46ji3u9d4x', '5cq4fostei'
];
const HUMAN_NAMES = [
    'samplename', 'plainhuman', 'samplepotato321', 'DemoPlayer_', 'Fixtura',
    'ItsFixture1', 'theonlysample', 'Fixtured', 'DEMO123', 'Fixtu_69'
];

GENERATED_NAMES.forEach(name => assert.strictEqual(
    isLikelyBot(name), true, `${name} is a Hypixel-generated entity name`
));
HUMAN_NAMES.forEach(name => assert.strictEqual(
    isLikelyBot(name), false, `${name} is a real player name, not a generated one`
));

// The digit is the whole distinction for the ten-character rule: without it,
// every all-lowercase ten-letter username read as generated.
assert.strictEqual(isLikelyBot('samplename'), false, 'ten lowercase letters alone do not make a generated name');
assert.strictEqual(isLikelyBot('samplenam1'), true, 'ten lowercase characters with a digit still do');
// The other two branches are untouched.
assert.strictEqual(isLikelyBot('4realname'), true, 'a lowercase name starting with a digit stays generated');
assert.strictEqual(isLikelyBot('bcdfg'), true, 'a lowercase name with no vowels stays generated');
assert.strictEqual(isLikelyBot(''), true, 'an empty name is never a real player');

// --- /scan threat classification -----------------------------------------
function nickedProfile() {
    return {
        data: {
            player: { displayname: 'x', achievements: { bedwars_level: 0 }, stats: { Bedwars: {} } },
            urchin: null,
            seraph: null,
            isNicked: true
        }
    };
}

function failedProfile() {
    return {
        data: {
            player: { displayname: 'x', achievements: { bedwars_level: 0 }, stats: { Bedwars: {} } },
            urchin: null,
            seraph: null,
            lookupFailed: true,
            lookupErrorType: 'hypixel_rate_limited',
            lookupErrorMessage: 'Hypixel API is rate limited.'
        }
    };
}

function quietProfile(fkdr) {
    return {
        data: {
            player: {
                displayname: 'x',
                achievements: { bedwars_level: 10 },
                stats: { Bedwars: { final_kills_bedwars: fkdr, final_deaths_bedwars: 1, wins_bedwars: 1, losses_bedwars: 1 } }
            },
            urchin: null,
            seraph: null
        }
    };
}

async function runScan({ profiles, detectedNicks = [], scanMode = 'threats', scanChatLayout,
    autoDenickResults = new Map(), getKnownDenick, onLookup, gameMode = 'BEDWARS' }) {
    const lines = [];
    const lobbyMap = new Map([
        ['samplename', { color: '§a', letter: 'G', team: 'Green', uuid: 'u1', inTab: true }],
        ['quietguy', { color: '§a', letter: 'G', team: 'Green', uuid: 'u2', inTab: true }]
    ]);
    const detectedNickedPlayers = new Map(detectedNicks.map(name => [name.toLowerCase(), { name }]));

    const runner = createScanRunner({
        state: {
            scanMode,
            scanChatLayout,
            threatConfig: { minFkdr: 5, minStars: 500, countTags: true, minSkywarsKdr: 5, minSkywarsWlr: 5, minSkywarsLevel: 50 }
        },
        sendChat: (_client, message) => lines.push(typeof message === 'string' ? message : JSON.stringify(message)),
        isSupportedTabStatsMode: (mode) => ['BEDWARS', 'SKYWARS'].includes(mode),
        getPlayerTeam: (map, name) => map.get(name)?.team || null,
        playerLookupKey: (name) => String(name).toLowerCase(),
        getUrchinBatchRaw: async () => new Map(),
        getPlayerDataWithNickDetection: async (name) => { onLookup?.(name); return profiles[name]; },
        isLikelyBot,
        getSkyWarsLevelValue,
        formatSkyWarsLevel,
        inferTeamFromColor: (map, name) => map.get(name)?.team || null,
        getTabNameColor: (info) => info.color || '§7',
        extractDisplayColor: () => null,
        getFkdrColor,
        getKdrColor,
        getWlrColor,
        getWsColor,
        formatBedwarsPrestige,
        getInteractiveTags: () => [],
        setLastScanSummary: () => {},
        setLastScanResults: () => {}
    });

    await runner.performFullScan({ username: 'Me' }, lobbyMap, detectedNickedPlayers, 'Red', {
        gameMode,
        gameActive: true,
        gameRoster: new Set(['samplename', 'quietguy']),
        isOwnPlayer: (name) => name === 'Me',
        getCachedPlayerProfile: async () => null,
        autoDenickResults,
        getKnownDenick
    });

    return lines.join('\n');
}

(async () => {
    // Legacy saved preferences must not restore the removed layout.
    for (const scanChatLayout of [undefined, 'old', 'new']) {
        for (const source of ['skin', 'stats', 'skin_manual', 'saved']) {
            const lookups = [];
            const output = await runScan({
                scanChatLayout,
                profiles: { RealPlayer: quietProfile(7.59), quietguy: quietProfile(1) },
                detectedNicks: ['samplename'],
                autoDenickResults: source === 'saved' ? new Map() : new Map([['samplename', { realName: 'RealPlayer', source }]]),
                getKnownDenick: source === 'saved' ? name => name === 'samplename' ? { realIGN: 'RealPlayer' } : null : undefined,
                onLookup: name => lookups.push(name)
            });
            const row = output.split('\n').find(line => line.startsWith('{') && line.includes('samplename'));
            assert.ok(row.includes('RealPlayer') && row.includes('[NICKED]') && row.includes('FKDR:') && row.includes('7.59') && row.includes('WLR:') && row.includes('WS:'), `${scanChatLayout}/${source}: resolved nicks show real-account stats`);
            assert.ok(lookups.includes('RealPlayer') && !lookups.includes('samplename'), 'Fetch the account, not the nickname');
        }
        for (const profile of [failedProfile(), nickedProfile()]) {
            const output = await runScan({ scanChatLayout,
                profiles: { RealPlayer: profile, quietguy: quietProfile(1) },
                autoDenickResults: new Map([['samplename', { realName: 'RealPlayer' }]]) });
            const row = output.split('\n').find(line => line.startsWith('{') && line.includes('samplename'));
            assert.ok(row.includes('RealPlayer') && !row.includes('FKDR:'), 'Unavailable account stats must not become zero stats');
        }
        const mappings = new Map();
        const output = await runScan({ scanChatLayout,
            profiles: { samplename: nickedProfile(), RealPlayer: quietProfile(9.5), quietguy: quietProfile(1) },
            autoDenickResults: mappings,
            onLookup: name => { if (name === 'samplename') mappings.set(name, { realName: 'RealPlayer', source: 'skin' }); }
        });
        assert.ok(output.includes('RealPlayer') && output.includes('9.50'), 'A denick arriving during the scan fetches the newly resolved account');
        const skyOutput = await runScan({ scanChatLayout, gameMode: 'SKYWARS',
            profiles: { RealPlayer: { data: { player: { stats: { SkyWars: { kills: 30, deaths: 2, wins: 9, losses: 3, win_streak: 4 } } } } }, quietguy: quietProfile(1) },
            autoDenickResults: new Map([['samplename', { realName: 'RealPlayer' }]])
        });
        assert.ok(skyOutput.includes('RealPlayer') && skyOutput.includes('KDR:') && skyOutput.includes('15.00') && skyOutput.includes('3.00'), 'SkyWars resolved nicks show SkyWars stats');
    }

    const profiles = { samplename: quietProfile(7.59), quietguy: quietProfile(5.57) };
    const newOutput = await runScan({ profiles, scanMode: 'all' });
    const legacyOutput = await runScan({ profiles, scanMode: 'all', scanChatLayout: 'old' });
    assert.strictEqual(legacyOutput, newOutput, 'Legacy settings cannot restore the old format');
    assert.ok(newOutput.includes('SCAN COMPLETE §r§7• 2 players'));
    assert.ok(newOutput.includes('§a§lGREEN TEAM§r'), 'New uses full colored team names');
    assert.ok(!newOutput.includes('---'), 'New has no divider lines');
    const playerRows = newOutput.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    assert.strictEqual(playerRows.length, 2, 'One chat component per player');
    for (const row of playerRows) {
        const text = row.extra.map(part => part.text).join('');
        assert.ok(text.includes('§fFKDR:') && text.includes('§fWLR:') && text.includes('§fWS:'));
        assert.ok(!text.includes('\n') && !text.includes('|'), 'New keeps all stats on a single compact row');
        assert.ok(text.includes('§4!!!'), 'Threat markers survive the layout change');
    }
    const newNickedOutput = await runScan({ profiles: { samplename: nickedProfile(), quietguy: failedProfile() }, scanChatLayout: 'new' });
    assert.ok(newNickedOutput.includes('[NICKED]') && newNickedOutput.includes('[FAIL]'), 'New preserves nick and lookup-failure states');

    // The reported bug: a nicked enemy whose name is ten lowercase letters was
    // classified as a generated entity name and dropped from the threat list.
    const nickedOutput = await runScan({
        profiles: { samplename: nickedProfile(), quietguy: quietProfile(1) }
    });
    assert.ok(/\[NICKED\].*samplename/.test(nickedOutput), 'a nicked enemy must be listed as a scan threat');
    assert.ok(!/quietguy/.test(nickedOutput), 'a low-stat enemy is still not a threat');

    // A settled nick stays a nick when the scan's own lookup misses. Their name
    // is never cacheable, so that lookup is the one most likely to be rate
    // limited - it must not quietly demote them.
    const failedOutput = await runScan({
        profiles: { samplename: failedProfile(), quietguy: quietProfile(1) },
        detectedNicks: ['samplename']
    });
    assert.ok(/\[NICKED\].*samplename/.test(failedOutput), 'an already-detected nick survives a failed scan lookup');

    // Without that prior knowledge the same failure is reported honestly.
    const unknownFailure = await runScan({
        profiles: { samplename: failedProfile(), quietguy: quietProfile(1) }
    });
    assert.ok(/\[FAIL\].*samplename/.test(unknownFailure), 'an unknown player whose lookup fails is reported as a failure');

    console.log('Scan threat tests passed.');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
