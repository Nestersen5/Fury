const assert = require('assert');
const {
    SEND_INTERVAL_MS,
    createShareTagsBroadcaster,
    detectedCheats,
    formatLine,
    labelForTagText,
    monthlyFkdrFromSessionData,
    normalizeIncludeName
} = require('../../src/overlay/shareTags.js');

assert.strictEqual(SEND_INTERVAL_MS, 400, 'Share party messages should use the global 400 ms command safety gap');
assert.strictEqual(normalizeIncludeName('tag'), 'tagged');
assert.strictEqual(normalizeIncludeName('tags'), 'tagged');
assert.strictEqual(normalizeIncludeName('nick'), 'nicks');
assert.strictEqual(normalizeIncludeName('threat'), 'threats');
assert.strictEqual(normalizeIncludeName('all'), 'all');
assert.strictEqual(labelForTagText('legit'), 'Legit Sniper');
assert.strictEqual(labelForTagText('Closet'), 'Closet Cheater');
assert.strictEqual(labelForTagText('\uE000\uE001'), 'Blatant Cheater', 'legacy tag glyph payloads should become full labels');
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: {
            rawTags: [{
                tooltip: 'Blatant (Added by Tester 2026-01-01) - scaffold, autoblock, lagrange, blink, auto clicker'
            }]
        }
    }),
    ['Scaffold', 'Auto Block', 'Lag Range', 'Blink', 'Auto Clicker']
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Closet Cheating: legitscaff, visuals, more' }] }
    }),
    ['Scaffold', 'Visuals'],
    'legitscaff (no space) must still be detected as Scaffold'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - legit scaf' }] }
    }),
    ['Scaffold'],
    'legit scaf (with space, single f) must be detected as Scaffold'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - doubleshifting' }] }
    }),
    ['Scaffold (Doubleshifting)'],
    'doubleshifting alone must show as Scaffold (Doubleshifting)'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - scaffold, double shift' }] }
    }),
    ['Scaffold (Doubleshifting)'],
    'scaffold + doubleshifting must fold into a single Scaffold (Doubleshifting) label'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - auto-block' }] }
    }),
    ['Auto Block'],
    '"auto-block" should be recognized as the same cheat as "auto block"'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - auto-blocking' }] }
    }),
    ['Auto Block'],
    '"auto-blocking" should be recognized as the same cheat as "auto block"'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: {
            rawTags: [{
                tooltip: 'Blatant (Added by Tester 2026-01-01) - esp, xray, fullbright'
            }]
        }
    }),
    ['Visuals']
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: {
            rawTags: [{
                tooltip: 'Blatant (Added by Tester 2026-01-01) - fastplace, safewalk, velocity'
            }]
        }
    }),
    ['Fast Place', 'Safewalk', 'Velocity']
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - velo' }] }
    }),
    ['Velocity'],
    '"velo" should be recognized as the same cheat as "velocity"'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - nuking' }] }
    }),
    ['Nuking']
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - nuke' }] }
    }),
    ['Nuking'],
    '"nuke" should be recognized as the same cheat as "nuking"'
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - piercing' }] }
    }),
    ['Piercing']
);
assert.deepStrictEqual(
    detectedCheats({
        uTag: 'Blatant',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - pierce' }] }
    }),
    ['Piercing'],
    '"pierce" should be recognized as the same cheat as "piercing"'
);
assert.strictEqual(
    monthlyFkdrFromSessionData({ delta: { stats: { Bedwars: { final_kills_bedwars: 9, final_deaths_bedwars: 3 } } } }),
    3,
    'monthly FKDR should come from monthly session BedWars final kills/deaths'
);

const taggedRow = {
    name: 'QuasiDig2073',
    team: 'RED',
    stars: 460,
    fkdr: 2.3,
    sortValue: 2.3,
    uTag: 'Blatant',
    urchinRaw: {
        rawTags: [{
            tooltip: 'Blatant (Added by Tester 2026-01-01) - scaffold, autoblock, lagrange, blink'
        }]
    }
};
assert.strictEqual(
    formatLine(taggedRow, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 - Blatant Cheater (Scaffold, Auto Block, Lag Range, Blink)'
);

assert.strictEqual(
    formatLine({ ...taggedRow, monthlyFkdr: 4.2 }, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 MFKDR: 4.20 - Blatant Cheater (Scaffold, Auto Block, Lag Range, Blink)'
);

assert.strictEqual(
    formatLine({ ...taggedRow, urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01)' }] } }, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 - Blatant Cheater'
);

// Caution tags carry a short snippet of the reason text.
const cautionRow = {
    ...taggedRow,
    uTag: 'Caution',
    urchinRaw: {
        rawTags: [{
            tooltip: 'Caution (Added by Tester 2026-01-01) - closes games when losing\nTHIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!'
        }]
    }
};
assert.strictEqual(
    formatLine(cautionRow, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 - Caution (closes games when losing)'
);

// Long caution reasons truncate to the first 7 words.
assert.strictEqual(
    formatLine({
        ...cautionRow,
        urchinRaw: {
            rawTags: [{
                tooltip: 'Caution (Added by Tester 2026-01-01) - suspicious aim snapping and odd bridging in several recent games\nTHIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!'
            }]
        }
    }, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 - Caution (suspicious aim snapping and odd bridging in...)'
);

// Caution reasons naming known cheats keep the cheat labels instead.
assert.strictEqual(
    formatLine({
        ...cautionRow,
        urchinRaw: {
            rawTags: [{
                tooltip: 'Caution (Added by Tester 2026-01-01) - possible autoclicker\nTHIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!'
            }]
        }
    }, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 - Caution (Auto Clicker)'
);

// A caution tag with no reason text falls back to the bare label.
assert.strictEqual(
    formatLine({
        ...cautionRow,
        urchinRaw: {
            rawTags: [{
                tooltip: 'Caution (Added by Tester 2026-01-01)\nTHIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!'
            }]
        }
    }, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 - Caution'
);

// The line budget leaves room for the "/pc " prefix so the full command
// never exceeds the 240-char chat cap.
{
    const longLine = formatLine({
        ...cautionRow,
        name: 'QuasiDig2073_WithAVeryLongName',
        urchinRaw: {
            rawTags: [{
                tooltip: `Caution (Added by Tester 2026-01-01) - ${'verylongword '.repeat(30)}\nTHIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!`
            }]
        }
    }, 'BEDWARS', new Set(['tagged']));
    assert.ok(`/pc ${longLine}`.length <= 240, `full command must fit in 240 chars, got ${`/pc ${longLine}`.length}`);
}

assert.strictEqual(
    formatLine({
        ...taggedRow,
        uTag: 'Blatant',
        sTag: 'Closet',
        urchinRaw: { rawTags: [{ tooltip: 'Blatant - scaffold' }] },
        seraphRaw: { report_type: 'Closet', tooltip: 'Closet - autoblock, blink' }
    }, 'BEDWARS', new Set(['tagged'])),
    '[RED] QuasiDig2073: FKDR: 2.30 - Blatant Cheater (Scaffold)'
);

assert.strictEqual(
    formatLine({ name: 'QuasiDig2073', team: 'RED', isNicked: true }, 'BEDWARS', new Set(['nicks'])),
    '[RED] QuasiDig2073 [NICK]'
);

assert.strictEqual(
    formatLine({ name: 'NickMask', denickedAs: 'RealPlayer', team: 'RED', stars: 460, fkdr: 2.3, isNicked: true }, 'BEDWARS', new Set(['nicks'])),
    '[RED] NickMask -> RealPlayer [NICK] FKDR: 2.30'
);

assert.strictEqual(
    formatLine({ name: 'QuasiDig2073', team: 'RED', stars: 460, fkdr: 2.3, isThreat: true }, 'BEDWARS', new Set(['threats'])),
    '[RED] QuasiDig2073: FKDR: 2.30'
);

assert.strictEqual(
    formatLine({ name: 'NickMask', denickedAs: 'RealPlayer', team: 'RED', stars: 460, fkdr: 2.3, isNicked: true, isThreat: true }, 'BEDWARS', new Set(['threats'])),
    '[RED] NickMask -> RealPlayer: FKDR: 2.30'
);

// Fancy style (launcher setting): star level + checkmark + pipe separators.
assert.strictEqual(
    formatLine(taggedRow, 'BEDWARS', new Set(['tagged']), true),
    '[RED] [460✫] QuasiDig2073 ✔ | FKDR 2.30 | Blatant Cheater (Scaffold, Auto Block, Lag Range, Blink)'
);

assert.strictEqual(
    formatLine({ ...taggedRow, monthlyFkdr: 4.2 }, 'BEDWARS', new Set(['tagged']), true),
    '[RED] [460✫] QuasiDig2073 ✔ | FKDR 2.30 | MFKDR: 4.20 | Blatant Cheater (Scaffold, Auto Block, Lag Range, Blink)'
);

assert.strictEqual(
    formatLine({ name: 'QuasiDig2073', team: 'RED', stars: 460, fkdr: 2.3, isThreat: true }, 'BEDWARS', new Set(['threats']), true),
    '[RED] [460✫] QuasiDig2073 ✔ | FKDR 2.30'
);

const state = {
    shareTagsAuto: false,
    shareTagsIncludeTagged: true,
    shareTagsIncludeNicks: true,
    shareTagsIncludeThreats: true,
    lastScanResults: {
        at: Date.now(),
        gameMode: 'BEDWARS',
        results: [taggedRow]
    }
};

const sentChat = [];
const partyChat = [];
let saveCount = 0;
const broadcaster = createShareTagsBroadcaster({
    state,
    sendChat: (client, message) => sentChat.push(message),
    getHypixelClient: () => ({ write: (name, packet) => partyChat.push({ name, packet }) }),
    getLocalUsername: () => 'Nestersen',
    saveFeatureConfig: () => { saveCount += 1; }
});

assert.strictEqual(broadcaster.setIncludeFlag('threat', true), true);
assert.strictEqual(state.shareTagsIncludeThreats, true);
broadcaster.setIncludeSet(['all']);
assert.strictEqual(state.shareTagsIncludeTagged, true);
assert.strictEqual(state.shareTagsIncludeNicks, true);
assert.strictEqual(state.shareTagsIncludeThreats, true);
broadcaster.setIncludeSet(['threat']);
assert.strictEqual(state.shareTagsIncludeTagged, false);
assert.strictEqual(state.shareTagsIncludeNicks, false);
assert.strictEqual(state.shareTagsIncludeThreats, true);
    broadcaster.setAuto(true);
    assert.strictEqual(state.shareTagsAuto, true);
    broadcaster.setFancy(true);
    assert.strictEqual(state.shareTagsFancy, true);
    broadcaster.setFancy(false);
    assert.strictEqual(state.shareTagsFancy, false);
    assert(saveCount >= 6, 'Share setting changes should persist through saveFeatureConfig');

(async () => {
    const result = await broadcaster.broadcast({}, { source: 'manual', includeSet: ['tag'] });
    assert.strictEqual(result.sent, 1);
    assert.strictEqual(partyChat.length, 1);
    assert.strictEqual(partyChat[0].packet.message, '/pc [RED] QuasiDig2073: FKDR: 2.30 - Blatant Cheater (Scaffold, Auto Block, Lag Range, Blink)');
    assert(sentChat.some(message => String(message).includes('Broadcasting')));

    const monthlyPartyChat = [];
    let monthlyFetches = 0;
    state.lastScanResults = { at: Date.now(), gameMode: 'BEDWARS', results: [taggedRow] };
    const monthlyBroadcaster = createShareTagsBroadcaster({
        state,
        sendChat: () => {},
        getHypixelClient: () => ({ write: (name, packet) => monthlyPartyChat.push({ name, packet }) }),
        getLocalUsername: () => 'Nestersen',
        saveFeatureConfig: () => {},
        fetchMonthlySession: async (player) => {
            monthlyFetches += 1;
            assert.strictEqual(player, 'QuasiDig2073');
            return { delta: { stats: { Bedwars: { final_kills_bedwars: 10, final_deaths_bedwars: 4 } } } };
        }
    });
    const monthlyShare = await monthlyBroadcaster.broadcast({}, { source: 'manual', includeSet: ['tag'] });
    assert.strictEqual(monthlyShare.sent, 1);
    assert.strictEqual(monthlyFetches, 1, 'monthly FKDR should fetch once for the sent BedWars line');
    assert.strictEqual(monthlyPartyChat[0].packet.message, '/pc [RED] QuasiDig2073: FKDR: 2.30 MFKDR: 2.50 - Blatant Cheater (Scaffold, Auto Block, Lag Range, Blink)');

    const liveDenickPartyChat = [];
    let liveDenickFetches = 0;
    const liveDenickState = {
        shareTagsAuto: false,
        shareTagsFancy: false,
        shareTagsDestination: 'party',
        shareTagsIncludeTagged: true,
        shareTagsIncludeNicks: true,
        shareTagsIncludeThreats: true,
        lastScanResults: {
            at: Date.now(),
            gameMode: 'BEDWARS',
            results: [{ name: 'NickMask', team: 'RED', isNicked: true }]
        }
    };
    const liveDenickBroadcaster = createShareTagsBroadcaster({
        state: liveDenickState,
        sendChat: () => {},
        getHypixelClient: () => ({ write: (name, packet) => liveDenickPartyChat.push({ name, packet }) }),
        getLocalUsername: () => 'Nestersen',
        saveFeatureConfig: () => {},
        getDenickResult: (player) => player === 'NickMask' ? { nick: 'NickMask', realName: 'RealPlayer' } : null,
        fetchPlayerProfile: async (player) => {
            liveDenickFetches += 1;
            assert.strictEqual(player, 'RealPlayer');
            return {
                data: {
                    player: {
                        achievements: { bedwars_level: 460 },
                        stats: {
                            Bedwars: {
                                final_kills_bedwars: 23,
                                final_deaths_bedwars: 10,
                                wins_bedwars: 50,
                                losses_bedwars: 25,
                                winstreak: 3
                            }
                        }
                    }
                }
            };
        }
    });
    const liveDenickShare = await liveDenickBroadcaster.broadcast({}, { source: 'manual', includeSet: ['nick'] });
    assert.strictEqual(liveDenickShare.sent, 1);
    assert.strictEqual(liveDenickFetches, 1, 'known denicks should fetch real-player stats when the scan row lacks them');
    assert.strictEqual(liveDenickPartyChat[0].packet.message, '/pc [RED] NickMask -> RealPlayer [NICK] FKDR: 2.30');

    state.lastScanResults = { at: Date.now(), gameMode: 'BEDWARS', results: [] };
    const empty = await broadcaster.broadcast({}, { source: 'manual', includeSet: ['all'] });
    assert.strictEqual(empty.reason, 'empty-scan');
    assert.strictEqual(partyChat.length, 1, 'Empty scans should not reuse stale party-chat lines');

    // Party gate: /pc broadcasts are skipped when confidently NOT in a party,
    // sent when in a party or when the tracker is uncertain (null), and
    // /share dest all is unaffected.
    let partyStatus = false;
    const gatedChat = [];
    const gatedLocal = [];
    const gatedState = {
        shareTagsAuto: false,
        shareTagsFancy: false,
        shareTagsDestination: 'party',
        shareTagsIncludeTagged: true,
        shareTagsIncludeNicks: true,
        shareTagsIncludeThreats: true,
        lastScanResults: { at: Date.now(), gameMode: 'BEDWARS', results: [taggedRow] }
    };
    const gated = createShareTagsBroadcaster({
        state: gatedState,
        sendChat: (client, message) => gatedLocal.push(message),
        getHypixelClient: () => ({ write: (name, packet) => gatedChat.push(packet.message) }),
        getLocalUsername: () => 'Nestersen',
        saveFeatureConfig: () => {},
        getPartyStatus: () => partyStatus
    });

    const solo = await gated.broadcast({}, { source: 'manual', includeSet: ['tag'] });
    assert.strictEqual(solo.reason, 'not-in-party', 'confidently solo should skip the broadcast');
    assert.strictEqual(gatedChat.length, 0, 'no /pc lines when not in a party');
    assert(gatedLocal.some(message => String(message).includes('not in a party')), 'manual /share should explain why nothing was sent');

    partyStatus = null; // tracker uncertain -> send anyway
    gatedState.lastScanResults = { at: Date.now(), gameMode: 'BEDWARS', results: [taggedRow] };
    const uncertain = await gated.broadcast({}, { source: 'manual', includeSet: ['tag'] });
    assert.strictEqual(uncertain.sent, 1, 'uncertain party state must not block broadcasts');

    partyStatus = true;
    gatedState.lastScanResults = { at: Date.now(), gameMode: 'BEDWARS', results: [taggedRow] };
    const inParty = await gated.broadcast({}, { source: 'manual', includeSet: ['tag'] });
    assert.strictEqual(inParty.sent, 1, 'in a party should broadcast normally');

    partyStatus = false;
    gatedState.shareTagsDestination = 'all';
    gatedState.lastScanResults = { at: Date.now(), gameMode: 'BEDWARS', results: [taggedRow] };
    const allChat = await gated.broadcast({}, { source: 'manual', includeSet: ['tag'] });
    assert.strictEqual(allChat.sent, 1, '/share dest all is not gated by party membership');
    assert(gatedChat[gatedChat.length - 1].startsWith('/ac '), 'all destination should use /ac');

    // --- Party members are never broadcast --------------------------------
    // A party can be split across opposing teams in BedWars and Duels, so the
    // filter keys off party membership alone and never off the team.
    const partyRows = [
        { ...taggedRow, name: 'QuasiDig2073', team: 'RED' },
        // A teammate on the enemy team, tagged exactly like a stranger.
        { ...taggedRow, name: 'PartyBuddy', team: 'BLUE' },
        // The same, but nicked: the board shows the nick while party tracking
        // only ever knows the real IGN behind it.
        { ...taggedRow, name: 'SneakyNick', team: 'BLUE' },
        // And one whose denick is only known to the live lookup, because
        // eligibility runs before the rows are enriched.
        { ...taggedRow, name: 'LiveNick', team: 'GREEN' }
    ];
    partyRows[2].denickResult = { nick: 'SneakyNick', realName: 'PartyMate' };

    const partyFilterChat = [];
    const partyFilterState = {
        shareTagsIncludeTagged: true,
        shareTagsIncludeNicks: true,
        shareTagsIncludeThreats: true,
        shareTagsDestination: 'party',
        lastScanResults: { at: Date.now(), gameMode: 'BEDWARS', results: partyRows }
    };
    const partyRoster = new Set(['partybuddy', 'partymate', 'livereal']);
    const partyFiltered = createShareTagsBroadcaster({
        state: partyFilterState,
        sendChat: () => {},
        getHypixelClient: () => ({ write: (name, packet) => partyFilterChat.push(packet.message) }),
        getLocalUsername: () => 'Nestersen',
        saveFeatureConfig: () => {},
        isPartyMember: (name) => partyRoster.has(String(name || '').toLowerCase()),
        getDenickResult: (player) => player === 'LiveNick'
            ? { nick: 'LiveNick', realName: 'LiveReal' }
            : null
    });

    const filtered = await partyFiltered.broadcast({}, { source: 'manual', includeSet: ['tag'] });
    assert.strictEqual(filtered.sent, 1, 'only the non-party player may be broadcast');
    assert.strictEqual(partyFilterChat.length, 1);
    assert(partyFilterChat[0].includes('QuasiDig2073'));
    for (const hidden of ['PartyBuddy', 'SneakyNick', 'LiveNick', 'PartyMate', 'LiveReal']) {
        assert(!partyFilterChat.some(line => line.includes(hidden)),
            `${hidden} is in our party and must never be broadcast`);
    }

    console.log('ShareTags tests passed.');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
