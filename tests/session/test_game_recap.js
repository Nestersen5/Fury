const assert = require('assert');

const { createSessionRender, formatShortDuration } = require('../../src/stats/render/session.js');
const { createRenderHelpers } = require('../../src/stats/renderHelpers.js');
const { createStatsCollector } = require('../../src/stats/collect.js');
const { diffSessionSnapshots, captureSessionSnapshot } = require('../../src/session/sessionSnapshot.js');

const BEDWARS_MODE_DEFS = [
    { id: 'overall', label: 'Overall', short: 'overall', prefix: '' },
    { id: 'solo', label: 'Solo', short: 'solo', prefix: 'eight_one' },
    { id: 'doubles', label: 'Doubles', short: 'doubles', prefix: 'eight_two' }
];
const SKYWARS_MODE_DEFS = [
    { id: 'overall', label: 'Overall', short: 'overall', kind: 'overall' },
    { id: 'solo_insane', label: 'Solo Insane', short: 'solo_insane', kind: 'combo', base: 'solo', variant: 'insane' }
];
const DUELS_MODE_DEFS = [
    { id: 'overall', label: 'Overall', short: 'overall', prefix: '' },
    { id: 'bridge_1v1', label: 'Bridge 1v1', short: 'bridge_1v1', prefix: 'bridge_duel' }
];

const safeStatNumber = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const statValue = (stats = {}, key) => safeStatNumber(stats[key]);

const collectors = createStatsCollector({
    statValue,
    sumStatValues: (stats = {}, keys = []) => keys.reduce((sum, key) => sum + statValue(stats, key), 0),
    ratioValue: (num, den) => num / Math.max(den, 1),
    safeStatNumber,
    bwKey: (mode, stat) => (mode.prefix ? `${mode.prefix}_${stat}_bedwars` : `${stat}_bedwars`),
    getSkyWarsLevelFromXp: () => 0,
    getSkyWarsLevelDelta: () => 0,
    getTopSkyWarsKit: () => null,
    BEDWARS_MODE_DEFS,
    SKYWARS_MODE_DEFS,
    DUELS_MODE_DEFS
});

const helpers = createRenderHelpers({ statValue });
const sessionRenderDeps = {
    collectBedwarsStats: collectors.collectBedwarsStats,
    collectSkyWarsStats: collectors.collectSkyWarsStats,
    collectDuelsStats: collectors.collectDuelsStats,
    BEDWARS_MODE_DEFS,
    SKYWARS_MODE_DEFS,
    DUELS_MODE_DEFS
};

const {
    renderLocalSession,
    renderGameRecap: renderGameRecapActual,
    sessionFooter,
    renderSessionHistory,
    historyHeadline,
    formatSessionStamp
} = createSessionRender({
    helpers,
    deps: sessionRenderDeps
});

// The detailed option retains the extra Yes/No and XP breakdowns covered below.
const renderGameRecap = (client, recap) => renderGameRecapActual(client, recap, { style: 'scoreboard' });

// Captures the visible text, the run_command click targets (mode-nav buttons
// carry their command in clickEvent, not the text), and colours.
//
// sendChat converts §-codes into JSON `color` properties, so asserting on raw
// §a/§c would never match. `colored()` re-inserts them as <green>/<red>
// markers, which is what the "good news is green" assertions read.
function fakeClient() {
    const lines = [];
    const tinted = [];
    const commands = [];
    return {
        lines,
        commands,
        text: () => lines.join('\n'),
        colored: () => tinted.join('\n'),
        clicks: () => commands.join('\n'),
        write: (packet, payload) => {
            if (packet !== 'chat') return;
            const parsed = JSON.parse(payload.message);
            const walk = (node, withColor) => {
                if (typeof node === 'string') return node;
                if (Array.isArray(node)) return node.map(child => walk(child, withColor)).join('');
                if (!node || typeof node !== 'object') return '';
                if (node.clickEvent?.action === 'run_command') commands.push(node.clickEvent.value);
                const tint = withColor && node.color ? `<${node.color}>` : '';
                const body = `${tint}${node.text || ''}`;
                return `${body}${(node.extra || []).map(child => walk(child, withColor)).join('')}`;
            };
            lines.push(walk(parsed, false));
            tinted.push(walk(parsed, true));
        }
    };
}

function makeDelta(stats, { spanMs = 60000, networkExp = 0, achievements = {} } = {}) {
    return {
        spanMs,
        networkExp,
        achievements,
        stats,
        root: { delta: { stats, achievements } }
    };
}

// --- duration formatting ---------------------------------------------------

{
    assert.strictEqual(formatShortDuration(0), '0s');
    assert.strictEqual(formatShortDuration(48_000), '48s');
    assert.strictEqual(formatShortDuration(372_000), '6m 12s');
    assert.strictEqual(formatShortDuration(4_980_000), '1h 23m');
    assert.strictEqual(formatShortDuration(null), '0s', 'null duration degrades to 0s');
}

// --- /session card ---------------------------------------------------------

{
    const client = fakeClient();
    assert.strictEqual(renderLocalSession(client, null), false, 'no delta renders no card');
    assert.ok(client.text().includes('/session refresh'), 'and points at the refresh command');
}

{
    // A BedWars-only session must not print empty SkyWars/Duels blocks.
    const client = fakeClient();
    const delta = makeDelta({
        Bedwars: {
            wins_bedwars: 4,
            losses_bedwars: 2,
            final_kills_bedwars: 20,
            final_deaths_bedwars: 10,
            beds_broken_bedwars: 6,
            beds_lost_bedwars: 3,
            kills_bedwars: 40,
            deaths_bedwars: 30,
            games_played_bedwars: 6,
            Experience: 10000
        },
        SkyWars: {},
        Duels: {}
    }, { spanMs: 4_980_000, networkExp: 12000 });

    assert.strictEqual(renderLocalSession(client, delta, { name: 'Tester', gamesPlayed: 6 }), true);
    const text = client.text();
    assert.ok(text.includes('Tester'), 'header names the player');
    assert.ok(text.includes('1h 23m'), 'header shows session length');
    assert.ok(text.includes('BedWars'), 'BedWars block renders');
    assert.ok(!text.includes('SkyWars'), 'empty SkyWars block is omitted');
    assert.ok(!text.includes('Duels'), 'empty Duels block is omitted');
    assert.ok(text.includes('+4'), 'counts render signed');
    assert.ok(text.includes('2.00'), 'session FKDR of 20/10 renders as 2.00');
    assert.ok(!text.includes('Network XP'), 'session card omits the redundant network XP footer');
}

{
    // Multi-game session shows every game that moved.
    const client = fakeClient();
    const delta = makeDelta({
        Bedwars: { wins_bedwars: 1 },
        SkyWars: { wins: 2, losses: 1, kills: 9, deaths: 4, games: 3 },
        Duels: { wins: 3, losses: 3, kills: 12, deaths: 11 }
    });
    renderLocalSession(client, delta, { name: 'Tester', gamesPlayed: 9 });
    const text = client.text();
    assert.ok(text.includes('BedWars'));
    assert.ok(text.includes('SkyWars'));
    assert.ok(text.includes('Duels'));
}

{
    // A session with a baseline but no movement yet.
    const client = fakeClient();
    const delta = makeDelta({ Bedwars: {}, SkyWars: {}, Duels: {} }, { spanMs: 120000 });
    assert.strictEqual(renderLocalSession(client, delta, { name: 'Tester' }), true);
    assert.ok(client.text().includes('Nothing tracked yet'), 'empty sessions say so explicitly');
}

// --- per-mode session views ------------------------------------------------

{
    // Same delta, three different readings. Overall sums the modes; each mode
    // view reads only its own prefixed keys.
    const delta = makeDelta({
        Bedwars: {
            wins_bedwars: 5,
            losses_bedwars: 5,
            final_kills_bedwars: 30,
            final_deaths_bedwars: 10,
            eight_one_wins_bedwars: 1,
            eight_one_losses_bedwars: 4,
            eight_one_final_kills_bedwars: 6,
            eight_one_final_deaths_bedwars: 6,
            eight_two_wins_bedwars: 4,
            eight_two_losses_bedwars: 1,
            eight_two_final_kills_bedwars: 24,
            eight_two_final_deaths_bedwars: 4
        },
        SkyWars: {},
        Duels: {}
    });

    const overall = collectors.collectBedwarsStats(delta.stats.Bedwars, BEDWARS_MODE_DEFS[0], delta.root);
    const solo = collectors.collectBedwarsStats(delta.stats.Bedwars, BEDWARS_MODE_DEFS[1], delta.root);
    const doubles = collectors.collectBedwarsStats(delta.stats.Bedwars, BEDWARS_MODE_DEFS[2], delta.root);

    assert.strictEqual(overall.fkdr, 3, 'overall session FKDR is 30/10');
    assert.strictEqual(solo.fkdr, 1, 'solo session FKDR is 6/6');
    assert.strictEqual(doubles.fkdr, 6, 'doubles session FKDR is 24/4');
    assert.strictEqual(solo.wlr, 0.25, 'solo session WLR is 1/4');
    assert.strictEqual(doubles.wlr, 4, 'doubles session WLR is 4/1');

    // The focused card must show the mode's numbers, not the overall ones.
    const client = fakeClient();
    renderLocalSession(client, delta, {
        name: 'Tester',
        gamesPlayed: 5,
        focus: { game: 'Bedwars', mode: BEDWARS_MODE_DEFS[2], modes: BEDWARS_MODE_DEFS, commandToken: 'bw' }
    });
    const text = client.text();
    assert.ok(text.includes('Doubles'), 'header names the focused mode');
    assert.ok(text.includes('6.00'), 'shows the doubles FKDR');
    assert.ok(!text.includes('3.00'), 'and not the overall FKDR');
    assert.ok(client.clicks().includes('/session bw solo'), 'mode nav offers a click-through to other modes');
}

{
    // A partial/older host must never take down the proxy merely because it
    // omitted the two clickable-navigation helpers.
    const fallbackRenderer = createSessionRender({
        helpers: { ...helpers, navButton: null, sendStatRow: null },
        deps: sessionRenderDeps
    });
    const client = fakeClient();
    const delta = makeDelta({ Bedwars: { wins_bedwars: 1 }, SkyWars: {}, Duels: {} });
    assert.doesNotThrow(() => fallbackRenderer.renderLocalSession(client, delta, {
        focus: { game: 'Bedwars', mode: BEDWARS_MODE_DEFS[0], modes: BEDWARS_MODE_DEFS, commandToken: 'bw' }
    }), 'focused session rendering must degrade safely when navigation helpers are missing');
    assert.ok(client.clicks().includes('/session bw solo'), 'fallback navigation keeps mode buttons clickable');
}

{
    // Focusing a game with no movement says so instead of rendering nothing.
    const client = fakeClient();
    const delta = makeDelta({ Bedwars: { wins_bedwars: 2 }, SkyWars: {}, Duels: {} });
    assert.strictEqual(renderLocalSession(client, delta, {
        focus: { game: 'SkyWars', mode: SKYWARS_MODE_DEFS[0], modes: SKYWARS_MODE_DEFS, commandToken: 'sw' }
    }), true);
    assert.ok(client.text().includes('No SkyWars games tracked'), 'focused empty game is explicit');
    assert.ok(!client.text().includes('BedWars'), 'and does not leak the other game');
}

{
    // Duels per-mode reads the prefixed keys.
    const delta = makeDelta({
        Bedwars: {},
        SkyWars: {},
        Duels: { wins: 10, losses: 4, bridge_duel_wins: 7, bridge_duel_losses: 1 }
    });
    const bridge = collectors.collectDuelsStats(delta.stats.Duels, DUELS_MODE_DEFS[1]);
    assert.strictEqual(bridge.wins, 7);
    assert.strictEqual(bridge.wlr, 7, 'bridge session WLR is 7/1');

    const client = fakeClient();
    renderLocalSession(client, delta, {
        focus: { game: 'Duels', mode: DUELS_MODE_DEFS[1], modes: DUELS_MODE_DEFS, commandToken: 'duels' }
    });
    assert.ok(client.text().includes('Bridge 1v1'));
    assert.ok(client.text().includes('7.00'));
}

{
    // A single-mode nav renders no buttons (nothing to switch to).
    const client = fakeClient();
    const delta = makeDelta({ Bedwars: { wins_bedwars: 1 }, SkyWars: {}, Duels: {} });
    renderLocalSession(client, delta, {
        focus: { game: 'Bedwars', mode: BEDWARS_MODE_DEFS[0], modes: [BEDWARS_MODE_DEFS[0]], commandToken: 'bw' }
    });
    assert.ok(!client.clicks().includes('/session bw'), 'no nav row for a single mode');
}

{
    // No focus keeps the original all-games overall behaviour.
    const client = fakeClient();
    const delta = makeDelta({
        Bedwars: { wins_bedwars: 1, eight_one_wins_bedwars: 1 },
        SkyWars: { wins: 2, losses: 1, kills: 5, deaths: 3, games: 3 },
        Duels: {}
    });
    renderLocalSession(client, delta, { name: 'Tester', gamesPlayed: 4 });
    const text = client.text();
    assert.ok(text.includes('BedWars') && text.includes('SkyWars'), 'unfocused card shows every active game');
    assert.ok(!client.clicks().includes('/session bw'), 'unfocused card has no mode nav');
}

// --- recap card ------------------------------------------------------------

function makeRecap(overrides = {}) {
    const delta = makeDelta({
        Bedwars: {
            wins_bedwars: 1,
            final_kills_bedwars: 3,
            final_deaths_bedwars: 1,
            beds_broken_bedwars: 1,
            kills_bedwars: 7,
            deaths_bedwars: 2,
            games_played_bedwars: 1
        },
        SkyWars: {},
        Duels: {}
    });
    return {
        game: 'Bedwars',
        mode: 'BEDWARS',
        delta,
        record: { durationMs: 372_000, result: 'win', mode: 'BEDWARS', opponents: [] },
        sessionDelta: makeDelta({
            Bedwars: {
                wins_bedwars: 4,
                losses_bedwars: 2,
                final_kills_bedwars: 20,
                final_deaths_bedwars: 10,
                beds_broken_bedwars: 6
            },
            SkyWars: {},
            Duels: {}
        }),
        ...overrides
    };
}

{
    const client = fakeClient();
    assert.strictEqual(renderGameRecap(client, null), false, 'a null recap renders nothing');
    assert.strictEqual(client.lines.length, 0);
}

{
    const client = fakeClient();
    assert.strictEqual(renderGameRecap(client, makeRecap()), true);
    const text = client.text();
    assert.ok(text.includes('BED WARS RECAP'), 'recap uses the scoreboard header');
    assert.ok(text.includes('BED WARS'), 'card shows the game');
    assert.ok(text.includes('6m 12s'), 'card shows the game duration');
    assert.ok(text.includes('VICTORY'), 'card shows the result badge');
    assert.ok(text.includes('3 FINALS'), 'finals render as a plain count, not a delta');
    assert.ok(text.includes('7 KILLS'));
    assert.ok(text.includes('SESSION'), 'card shows the running session footer');
    assert.ok(text.includes('4W'), 'footer shows session wins');
}

{
    // A single game is not a session: no ratios, no win/loss rows, no
    // "Games: +1", and no signed deltas on the per-game counts.
    const client = fakeClient();
    renderGameRecap(client, makeRecap());
    const text = client.text();
    ['WLR', 'FKDR', 'KDR', 'BBLR'].forEach((ratio) => {
        assert.ok(!text.includes(`${ratio}:`), `recap must not show ${ratio} for one game`);
    });
    assert.ok(!text.includes('Wins:'), 'win/loss is the header badge, not a row');
    assert.ok(!text.includes('Losses:'), 'win/loss is the header badge, not a row');
    assert.ok(!text.includes('Games:'), '"Games: +1" says nothing');
    assert.ok(!text.includes('+3'), 'per-game counts are not signed deltas');
    assert.ok(!text.includes('+7'));
}

{
    // Every supported game uses the same layout, with its own headline stats.
    for (const [game, mode, stats, expected] of [
        ['SkyWars', 'SKYWARS', { wins: 1, kills: 4, assists: 2 }, '4 KILLS'],
        ['Duels', 'DUELS', { wins: 1, kills: 2, deaths: 1 }, '2 KILLS   1 DEATHS']
    ]) {
        const client = fakeClient();
        renderGameRecap(client, { game, mode,
            delta: makeDelta({ Bedwars: {}, SkyWars: {}, Duels: {}, [game]: stats }),
            record: { durationMs: 180000, result: 'win' }, sessionDelta: null });
        assert.equal(client.lines.length, 4);
        assert(client.lines[0].includes('RECAP'));
        assert(client.lines[2].includes(expected));
    }
}

{
    const client = fakeClient();
    renderGameRecap(client, makeRecap({ record: { durationMs: 0, result: 'loss', opponents: [] } }));
    const text = client.text();
    assert.ok(text.includes('DEFEAT'), 'loss badge renders');
    assert.ok(!text.includes('(§70s'), 'a zero duration is omitted rather than shown as 0s');
}

{
    // An undecided game gets no badge at all.
    const client = fakeClient();
    renderGameRecap(client, makeRecap({ record: { durationMs: 1000, result: null, opponents: [] } }));
    assert.ok(!client.text().includes('WIN') && !client.text().includes('LOSS'));
}

{
    // A recap for a game whose delta is empty renders nothing.
    const client = fakeClient();
    const empty = makeRecap({ delta: makeDelta({ Bedwars: {}, SkyWars: {}, Duels: {} }) });
    assert.strictEqual(renderGameRecap(client, empty), false);
    assert.strictEqual(client.lines.length, 0);
}

// --- recap stays free of encounter history ---------------------------------

{
    const sample = makeRecap({
        record: { result: 'win', durationMs: 666000, metadata: { variant: 'Solos' } },
        sessionDelta: makeDelta({ Bedwars: { games_played_bedwars: 6, wins_bedwars: 4, losses_bedwars: 2 } })
    });
    const plain = fakeClient();
    const goalOnly = { style: 'scoreboard', fields: ['result', 'duration', 'game_stats', 'goals'] };
    renderGameRecapActual(plain, sample, goalOnly);
    assert.equal(plain.lines.length, 4, 'Default scoreboard has exactly two content rows and two rules');
    assert(plain.lines[0].includes('------ BED WARS RECAP ------'));
    assert(plain.lines[1].includes('VICTORY   11m 06s   Solos'));
    assert(plain.lines[2].includes('3 FINALS   1 BEDS   7 KILLS'));
    assert(!plain.text().includes('Session:') && !plain.text().includes('GAMES GOAL'));
    assert(plain.colored().includes('<yellow>1 BEDS') && plain.colored().includes('<aqua>7 KILLS'),
        'Scoreboard keeps the selected semantic colors');
    const { chatTextWidth } = require('../../src/stats/recapScoreboard');
    for (const map of ['Airshow', '§cAirshow\nDoubles', 'W'.repeat(80), null, undefined, '', '  ']) {
        const mapped = fakeClient();
        renderGameRecapActual(mapped, { ...sample, record: { ...sample.record,
            metadata: { ...sample.record.metadata, map } } }, goalOnly);
        assert.equal(mapped.lines.length, 4, 'Map information adds no chat rows');
        assert(mapped.lines.every(line => chatTextWidth(line) <= 320), 'Map names fit standard chat width');
        if (map === 'Airshow') assert(mapped.lines[1].includes('Solos   Map: Airshow'));
        else if (map?.startsWith('§')) {
            assert(mapped.lines[1].includes('Map: Airshow Doubles'));
            assert(!mapped.colored().includes('<red>Airshow'), 'Map metadata cannot inject chat colors');
        } else if (map?.startsWith('W')) assert(mapped.lines[1].endsWith('...'));
        else assert(!mapped.text().includes('Map:'), 'Unknown maps have no placeholder');
    }
    const goal = fakeClient();
    renderGameRecapActual(goal, sample, { ...goalOnly, goals: { games: 10, wins: 10, finals: 30 } });
    assert.equal(goal.lines.length, 5, 'Only the enabled games goal adds a third content row');
    assert(goal.lines[3].includes('GAMES GOAL 6/10 [||||||----]'));
    assert(!goal.text().includes('wins:') && !goal.text().includes('finals:'));
    for (const line of goal.lines) {
        const width = helpers.chatTextWidth(line), contentWidth = helpers.chatTextWidth(line.trimStart());
        const center = width - contentWidth / 2;
        assert(Math.abs(center - 160) <= 2, 'Chat rows share a center within one half-space');
        assert(width <= 320, 'Normal scoreboard content fits standard chat width');
    }
    for (const target of [0, -1, undefined]) {
        const client = fakeClient();
        renderGameRecapActual(client, sample, { ...goalOnly, goals: { games: target } });
        assert.equal(client.lines.length, 4, 'Disabled games goals add no row or gap');
    }
    const complete = fakeClient();
    renderGameRecapActual(complete, sample, { ...goalOnly, goals: { games: 5 } });
    assert(complete.lines[3].includes('6/5 [||||||||||]'), 'Completed goals keep their true count with a full bounded bar');
    const local = fakeClient();
    renderGameRecapActual(local, {
        game: 'Duels', mode: 'DUELS', record: { result: 'loss', durationMs: 9000 },
        delta: { local: true, modes: [{ mode: 'DUELS', kills: 0, deaths: 1 }] },
        sessionDelta: { local: true, modes: [{ mode: 'DUELS', wins: 1 }] }
    }, { ...goalOnly, goals: { games: 10 } });
    assert(local.lines[0].includes('DUELS RECAP') && local.lines[1].includes('DEFEAT'));
    assert(local.lines[2].includes('0 KILLS   1 DEATHS'));
    assert(local.lines[3].includes('GAMES GOAL ?/10 [----------]'), 'Unavailable local progress is not an invented zero');

    const combined = fakeClient();
    renderGameRecapActual(combined, makeRecap(), { goals: { games: 10 } });
    assert.equal(combined.lines.length, 5, 'Session totals and games goal share one optional row');
    assert(combined.lines[3].includes('SESSION 4W / 2L   FKDR 2.00   GAMES'));
    assert(combined.clicks().includes('/session'), 'The session row opens the existing full session command');
    const sessionOnly = fakeClient();
    renderGameRecapActual(sessionOnly, sample, { style: 'scoreboard', fields: ['session_totals'], goals: { games: 10 } });
    assert(sessionOnly.lines[3].includes('SESSION 4W / 2L'));
    assert(!sessionOnly.text().includes('GAMES'), 'The goal toggle hides a configured target');
    const incomplete = fakeClient();
    renderGameRecapActual(incomplete, {
        game: 'Bedwars', mode: 'BEDWARS', record: { result: 'win', durationMs: 60000 },
        delta: { local: true, modes: [{ mode: 'BEDWARS', finals: 2, beds: 1, kills: 3 }] },
        sessionDelta: { local: true, modes: [{ mode: 'BEDWARS', wins: 1 }] }
    }, { goals: { games: 10 } });
    assert(incomplete.lines[3].includes('SESSION 1W / ?L   FKDR ?   GAMES ?/10'), 'Partial local session coverage stays explicit');
}

{
    for (const legacyStyle of ['compact', 'detailed', 'custom', 'invalid']) {
        const client = fakeClient(), expected = fakeClient();
        renderGameRecapActual(client, makeRecap(), { style: legacyStyle, goals: { games: 10 } });
        renderGameRecapActual(expected, makeRecap(), { style: 'scoreboard', goals: { games: 10 } });
        assert.deepStrictEqual(client.lines, expected.lines, `${legacyStyle} cannot resurrect an old recap layout`);
    }
    const custom = fakeClient();
    renderGameRecapActual(custom, makeRecap(), { style: 'custom', fields: ['game_stats'] });
    assert.equal(custom.lines.length, 4);
    assert(custom.text().includes('VICTORY') && custom.text().includes('3 FINALS'));
    assert(!custom.text().includes('SESSION'), 'The session toggle is still respected after migration');
}

{
    // The recap card must say nothing about who you have played before —
    // that is summarized separately from the recap card.
    const client = fakeClient();
    renderGameRecap(client, makeRecap());
    const text = client.text();
    assert.ok(!text.toLowerCase().includes('played before'), 'recap does not mention encounter history');
    assert.ok(!text.toLowerCase().includes('seen'), 'recap has no encounter badges');
    // Extra options are ignored rather than resurrecting the old line.
    const legacy = fakeClient();
    renderGameRecap(legacy, makeRecap(), { encounters: [{ name: 'Rival', games: 9 }] });
    assert.ok(!legacy.text().includes('Rival'), 'a stray encounters option cannot reintroduce it');
}

// --- session history -------------------------------------------------------

{
    const bw = makeDelta({
        Bedwars: {
            wins_bedwars: 4, losses_bedwars: 2,
            final_kills_bedwars: 20, final_deaths_bedwars: 10
        },
        SkyWars: {},
        Duels: {}
    });
    assert.ok(historyHeadline(bw).includes('+4W'), 'headline shows wins');
    assert.ok(historyHeadline(bw).includes('2.00'), 'headline shows the session FKDR');
    assert.strictEqual(historyHeadline(makeDelta({ Bedwars: {}, SkyWars: {}, Duels: {} })), null, 'empty delta has no headline');
    assert.strictEqual(historyHeadline(null), null);

    // Picks the game with the most movement.
    const mixed = makeDelta({
        Bedwars: { wins_bedwars: 1 },
        SkyWars: { wins: 3, losses: 1, kills: 20, deaths: 10, games: 4, assists: 2 },
        Duels: {}
    });
    assert.ok(historyHeadline(mixed).includes('KDR'), 'SkyWars dominates and uses a KDR headline');
}

{
    // Stamps: today / yesterday / older / another year.
    const now = new Date(2026, 7, 4, 18, 0, 0).getTime();
    assert.ok(formatSessionStamp(new Date(2026, 7, 4, 14, 32).getTime(), now).startsWith('Today'));
    assert.ok(formatSessionStamp(new Date(2026, 7, 3, 9, 5).getTime(), now).startsWith('Yesterday'));
    assert.ok(formatSessionStamp(new Date(2026, 7, 1, 21, 40).getTime(), now).startsWith('Aug 1'));
    assert.ok(formatSessionStamp(new Date(2025, 11, 25, 12, 0).getTime(), now).includes('2025'));
    assert.strictEqual(formatSessionStamp(0, now), 'unknown');
}

{
    const client = fakeClient();
    assert.strictEqual(renderSessionHistory(client, []), false);
    assert.ok(client.text().includes('No sessions recorded yet'));
}

{
    const now = new Date(2026, 7, 4, 18, 0, 0).getTime();
    const entries = [
        {
            active: true,
            session: { startedAt: new Date(2026, 7, 4, 16, 0).getTime(), games: [{}, {}, {}] },
            delta: makeDelta({
                Bedwars: { wins_bedwars: 2, losses_bedwars: 1, final_kills_bedwars: 9, final_deaths_bedwars: 3 },
                SkyWars: {},
                Duels: {}
            }, { spanMs: 7_200_000 })
        },
        {
            active: false,
            session: { startedAt: new Date(2026, 7, 3, 20, 0).getTime(), games: [{}] },
            delta: makeDelta({
                Bedwars: { wins_bedwars: 1, losses_bedwars: 0, final_kills_bedwars: 4, final_deaths_bedwars: 2 },
                SkyWars: {},
                Duels: {}
            }, { spanMs: 1_800_000 })
        }
    ];

    const client = fakeClient();
    assert.strictEqual(renderSessionHistory(client, entries, { now }), true);
    const text = client.text();
    assert.ok(text.includes('Session History'));
    assert.ok(text.includes('Today'), 'newest entry is today');
    assert.ok(text.includes('Yesterday'), 'older entry is yesterday');
    assert.ok(text.includes('2h 0m'), 'entries show their duration');
    assert.ok(text.includes('3g'), 'entries show the game count');
    assert.ok(text.includes('3.00'), 'entries show a headline ratio');
    assert.ok(client.clicks().includes('/session history 1'), 'rows are click-to-open');
    assert.ok(client.clicks().includes('/session history 2'));
}

{
    // Overflow is summarized, not dumped.
    const entries = Array.from({ length: 20 }, (unused, index) => ({
        active: false,
        session: { startedAt: 1_000_000 + index, games: [] },
        delta: makeDelta({ Bedwars: { wins_bedwars: 1 }, SkyWars: {}, Duels: {} })
    }));
    const client = fakeClient();
    renderSessionHistory(client, entries, { limit: 5 });
    assert.ok(client.text().includes('and 15 older'));
}

{
    // A past session renders through the normal card with a date header.
    const client = fakeClient();
    const delta = makeDelta({
        Bedwars: { wins_bedwars: 3, losses_bedwars: 1, final_kills_bedwars: 12, final_deaths_bedwars: 4 },
        SkyWars: {},
        Duels: {}
    });
    renderLocalSession(client, delta, {
        name: 'Tester',
        gamesPlayed: 4,
        title: 'Aug 2, 21:40',
        subtitle: '§8Finished session'
    });
    const text = client.text();
    assert.ok(text.includes('Aug 2, 21:40'), 'title replaces the player name for history playback');
    assert.ok(!text.includes('Tester'), 'and the player name is not also shown');
    assert.ok(text.includes('Finished session'), 'subtitle renders');
    assert.ok(text.includes('3.00'), 'the past session still shows its own ratios');
}

// --- footer wiring ---------------------------------------------------------

{
    assert.strictEqual(sessionFooter(null, 'Bedwars'), null);
    assert.strictEqual(sessionFooter(makeDelta({ Bedwars: {} }), 'Bedwars'), null, 'empty session, no footer');

    const swFooter = sessionFooter(makeDelta({ SkyWars: { wins: 3, losses: 1, kills: 20, deaths: 10 } }), 'SkyWars');
    assert.ok(swFooter.includes('+3W'));
    assert.ok(swFooter.includes('2.00'), 'SkyWars footer KDR is 20/10');
}

// --- end-to-end: real snapshots through the real render --------------------

{
    // The property that matters most: two lifetime snapshots in, session
    // ratios out — never a subtraction of lifetime ratios.
    const player = (wins, losses, finals, finalDeaths) => ({
        player: {
            uuid: 'aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa',
            displayname: 'Tester',
            networkExp: 0,
            karma: 0,
            achievements: {},
            stats: {
                Bedwars: {
                    wins_bedwars: wins,
                    losses_bedwars: losses,
                    final_kills_bedwars: finals,
                    final_deaths_bedwars: finalDeaths,
                    beds_broken_bedwars: 100,
                    beds_lost_bedwars: 100,
                    kills_bedwars: 100,
                    deaths_bedwars: 100,
                    games_played_bedwars: 1000
                },
                SkyWars: {},
                Duels: {}
            }
        }
    });

    // Lifetime FKDR is exactly 1.00 before and after (5000/5000 -> 5006/5002
    // is still ~1.00), but the session itself was 6 finals to 2 deaths.
    const before = captureSessionSnapshot(player(1000, 500, 5000, 5000), { now: () => 0 });
    const after = captureSessionSnapshot(player(1002, 501, 5006, 5002), { now: () => 60000 });
    const delta = diffSessionSnapshots(before, after);

    const stats = collectors.collectBedwarsStats(delta.stats.Bedwars, BEDWARS_MODE_DEFS[0], delta.root);
    assert.strictEqual(stats.fkdr, 3, 'session FKDR is 6/2 = 3.00, not the lifetime 1.00');
    assert.strictEqual(stats.wlr, 2, 'session WLR is 2/1 = 2.00');

    const client = fakeClient();
    renderLocalSession(client, delta, { name: 'Tester', gamesPlayed: 1 });
    assert.ok(client.text().includes('3.00'), 'the card shows the session FKDR');
    assert.ok(
        !client.text().includes('1.00'),
        'and never the lifetime FKDR — no rendered value in this fixture is 1.00'
    );
}

{
    // Exercise the production command: a saved loss without API counters
    // must not be described as a game that never finished.
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../../proxy.js'), 'utf8');
    const start = source.indexOf('        function handleRecapCommand(client) {');
    const end = source.indexOf('\n        // Nester Deck', start);
    assert(start >= 0 && end > start);
    let record = null;
    const messages = [];
    const context = require('vm').createContext({
        normalizeUuid: value => value,
        sessionStore: { getLastGame: () => record },
        sendChat: (_client, message) => messages.push(message),
        renderGameRecap: () => { throw new Error('Unverified counters must not be rendered'); }
    });
    require('vm').runInContext(source.slice(start, end), context);
    const run = () => { messages.length = 0; context.handleRecapCommand({ uuid: 'test' }); return messages.join('\n'); };
    assert(run().includes('No game recorded yet'));
    record = { result: 'loss', verificationStatus: 'pending', delta: null };
    assert(run().includes('§closs') && run().includes('Waiting for Hypixel'));
    record.verificationStatus = 'unverified';
    assert(run().includes('§closs') && run().includes('could not be verified'));
    record.result = null;
    assert(run().includes('unknown result'));
    let rendered;
    context.renderGameRecap = (_client, recap) => { rendered = recap; return true; };
    context.sessionTracker = { getSessionDelta: () => ({ local: true, modes: [] }) };
    context.gameForMode = () => 'Bedwars';
    context.state = {};
    record = { result: 'loss', verificationStatus: 'pending', mode: 'BEDWARS', durationMs: 60000,
        localModes: [{ mode: 'BEDWARS', games: 1, wins: 0, losses: 1, kills: 3 }] };
    assert.equal(run(), '', 'Observed games do not show an unavailable-recap warning');
    assert.equal(rendered.delta.local, true);
    assert.equal(rendered.delta.modes[0].kills, 3, '/recap replays observed counters while the API is pending');
}

{
    const { normalizeRecapFields, SESSION_RECAP_FIELDS, SESSION_DEFAULTS } = require('../../src/session/settings');
    const { chatTextWidth } = require('../../src/stats/recapScoreboard');
    assert.deepEqual(normalizeRecapFields([]), [], 'All-off survives normalization');
    assert.deepEqual(normalizeRecapFields(['map', 'map', 'invalid']), ['map']);
    assert.deepEqual(normalizeRecapFields(['assists', 'rounds', 'final_deaths', 'beds_lost']), [],
        'Previously saved fields cannot restore removed recap stats');
    assert.deepEqual(normalizeRecapFields(), SESSION_DEFAULTS.sessionRecapFields);
    assert(normalizeRecapFields(['game_stats', 'session_totals']).includes('session_wins'));
    const sample = makeRecap();
    sample.record.metadata = { map: 'Airshow', variant: 'Solos' };
    const checks = [
        ['header', 'RECAP'], ['result', 'VICTORY'], ['duration', '6m 12s'], ['map', 'Map: Airshow'],
        ['mode', 'Solos'], ['finals', '3 FINALS'], ['beds', '1 BEDS'], ['kills', '7 KILLS'],
        ['deaths', 'DEATHS'],
        ['session_wins', 'SESSION 4W'], ['session_losses', 'SESSION 2L'],
        ['session_ratio', 'SESSION FKDR 2.00'], ['session_games', 'SESSION PLAYED'], ['goals', 'GAMES GOAL']
    ];
    for (const [field, text] of checks) {
        const client = fakeClient();
        renderGameRecapActual(client, sample, { fields: [field], goals: { games: 10 } });
        assert(client.text().includes(text), `${field} can render on its own`);
        assert.equal(client.lines.length, field === 'header' ? 2 : 1, `${field} has no forced rows`);
        for (const [other, forbidden] of checks) {
            if (field !== other) assert(!client.text().includes(forbidden), `${field} does not force ${other}`);
        }
    }
    const empty = fakeClient();
    assert.equal(renderGameRecapActual(empty, sample, { fields: [], goals: { games: 10 } }), true);
    assert.deepEqual(empty.lines, [], 'No stray border, mode, badge or goal when every field is off');
    const all = fakeClient();
    renderGameRecapActual(all, sample, { fields: SESSION_RECAP_FIELDS, goals: { games: 10 } });
    assert(all.lines.every(line => chatTextWidth(line) <= 320), 'Additional stats wrap within chat width');
    for (const game of ['SkyWars', 'Duels']) {
        const { scoreboardRecapLines } = require('../../src/stats/recapScoreboard');
        assert.deepEqual(scoreboardRecapLines({ game, fields: ['session_ratio'], session: { kdr: 2 } }), [],
            'Session FKDR does not fall back to KDR in other games');
    }
}

console.log('test_game_recap.js: all assertions passed');
