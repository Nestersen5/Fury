'use strict';

// Covers the Duels scan's pure pieces: sidebar/chat parsing, mode-name -> mode
// def matching (including the families whose display name doesn't match the
// internal prefix), and the family-combined stat aggregation math.

const assert = require('assert');
const {
    normalizeDuelsModeName,
    matchDuelsMode,
    parseOpponentsFromLabeledLine,
    extractDuelsInfoFromScoreboard,
    isDuelsScoreboard,
    bedwarsDuelsIntroMode
} = require('../../src/net/session/duelsMatch.js');
const { createStatsCollector } = require('../../src/stats/collect.js');

// Representative subset of the real proxy.js DUELS_MODE_DEFS (same id / family /
// prefix / short shape). Enough to exercise every matcher branch.
const DEFS = [
    { id: 'overall', family: 'Overview', label: 'Overall', short: 'overall', prefix: '' },
    { id: 'skywars_1v1', family: 'SkyWars', label: 'SkyWars 1v1', short: 'sw_1v1', prefix: 'sw_duel' },
    { id: 'skywars_2v2', family: 'SkyWars', label: 'SkyWars 2v2', short: 'sw_2v2', prefix: 'sw_doubles' },
    { id: 'bridge_1v1', family: 'The Bridge', label: 'Bridge 1v1', short: 'bridge_1v1', prefix: 'bridge_duel' },
    { id: 'bridge_2v2', family: 'The Bridge', label: 'Bridge 2v2', short: 'bridge_2v2', prefix: 'bridge_doubles' },
    { id: 'bridge_3v3', family: 'The Bridge', label: 'Bridge 3v3', short: 'bridge_3v3', prefix: 'bridge_threes' },
    { id: 'bridge_4v4', family: 'The Bridge', label: 'Bridge 4v4', short: 'bridge_4v4', prefix: 'bridge_four' },
    { id: 'bedwars_duel', family: 'BedWars', label: 'Bed Wars Duel', short: 'bedwars_duel', prefix: 'bedwars_two_one_duels' },
    { id: 'bed_rush_duel', family: 'BedWars', label: 'Bed Rush Duel', short: 'bed_rush', prefix: 'bedwars_two_one_duels_rush' },
    { id: 'classic_1v1', family: 'Classic', label: 'Classic 1v1', short: 'classic_1v1', prefix: 'classic_duel' },
    { id: 'classic_2v2', family: 'Classic', label: 'Classic 2v2', short: 'classic_2v2', prefix: 'classic_doubles' },
    { id: 'uhc_1v1', family: 'UHC', label: 'UHC 1v1', short: 'uhc_1v1', prefix: 'uhc_duel' },
    { id: 'uhc_2v2', family: 'UHC', label: 'UHC 2v2', short: 'uhc_2v2', prefix: 'uhc_doubles' },
    { id: 'uhc_4v4', family: 'UHC', label: 'UHC 4v4', short: 'uhc_4v4', prefix: 'uhc_four' },
    { id: 'uhc_ffa', family: 'UHC', label: 'UHC 8 Player FFA', short: 'uhc_ffa', prefix: 'uhc_meetup' },
    { id: 'nodebuff_1v1', family: 'NoDebuff', label: 'NoDebuff 1v1', short: 'nodebuff', prefix: 'potion_duel' },
    { id: 'sumo_1v1', family: 'Sumo', label: 'Sumo 1v1', short: 'sumo', prefix: 'sumo_duel' },
    { id: 'mega_walls_1v1', family: 'Mega Walls', label: 'Mega Walls 1v1', short: 'mega_walls', prefix: 'mw_duel' },
    { id: 'bow_1v1', family: 'Bow', label: 'Bow 1v1', short: 'bow', prefix: 'bow_duel' }
];

function match(name) {
    const def = matchDuelsMode(name, DEFS);
    return def ? def.id : null;
}

// --- normalize ---------------------------------------------------------------
assert.strictEqual(normalizeDuelsModeName('§eClassic Duel'), 'classic duel');
assert.strictEqual(normalizeDuelsModeName('Bridge 3v3'), 'bridge 3v3');

// --- mode matching: 1v1 vs 2v2 within a family -------------------------------
assert.strictEqual(match('Classic Duel'), 'classic_1v1');
assert.strictEqual(match('Classic Doubles'), 'classic_2v2');
assert.strictEqual(match('Bridge Duel'), 'bridge_1v1');
assert.strictEqual(match('Bridge Doubles'), 'bridge_2v2');
assert.strictEqual(match('Bridge 3v3'), 'bridge_3v3');
assert.strictEqual(match('Bridge 4v4'), 'bridge_4v4');

// --- families whose display name != internal prefix --------------------------
assert.strictEqual(match('SkyWars Duel'), 'skywars_1v1');
assert.strictEqual(match('SkyWars Doubles'), 'skywars_2v2');
assert.strictEqual(match('No Debuff Duel'), 'nodebuff_1v1');
assert.strictEqual(match('NoDebuff Duel'), 'nodebuff_1v1');
assert.strictEqual(match('UHC Fours'), 'uhc_4v4');
assert.strictEqual(match('UHC Deathmatch'), 'uhc_ffa');
assert.strictEqual(match('Mega Walls Duel'), 'mega_walls_1v1');

// --- the two Bed* duels that share Bedwars's start message -------------------
assert.strictEqual(match('Bed Wars Duel'), 'bedwars_duel');
assert.strictEqual(match('Bed Wars Rush Duel'), 'bed_rush_duel');
assert.strictEqual(match('Bed Rush Duel'), 'bed_rush_duel');

// --- color-coded name + unknown fallback -------------------------------------
assert.strictEqual(match('§bClassic §dDoubles'), 'classic_2v2');
assert.strictEqual(match('Totally Made Up Mode'), null);

// --- opponent parsing from labeled lines -------------------------------------
assert.deepStrictEqual(parseOpponentsFromLabeledLine('Opponent: elpabloGG'), ['elpabloGG']);
assert.deepStrictEqual(
    parseOpponentsFromLabeledLine('Opponents: [VIP] dog0223_TW, jeremy0714'),
    ['dog0223_TW', 'jeremy0714']
);
assert.deepStrictEqual(
    parseOpponentsFromLabeledLine('§eOpponents:§r §b[MVP+] §fCoolGuy123§r, §7noob_2'),
    ['CoolGuy123', 'noob_2']
);
assert.deepStrictEqual(parseOpponentsFromLabeledLine('Mode: Classic Duel'), []);

// --- full sidebar extraction (Classic 1v1 sample) ----------------------------
const classicLines = [
    'Time Left: 07:43',
    '',
    'Opponent:',
    '⇝ elpabloGG 20❤',
    '',
    'Mode: Classic Duel',
    'Overall Winstreak: 1',
    'Mode Winstreak: 1',
    'www.hypixel.net'
];
const classicInfo = extractDuelsInfoFromScoreboard(classicLines);
assert.strictEqual(classicInfo.modeName, 'Classic Duel');
assert.deepStrictEqual(classicInfo.opponents, ['elpabloGG']);
assert.strictEqual(match(classicInfo.modeName), 'classic_1v1');

// --- doubles sidebar with inline opponents -----------------------------------
const bridgeLines = [
    'Time Left: 05:12',
    'Opponents: [VIP] dog0223_TW, jeremy0714',
    'Mode: Bridge Doubles'
];
const bridgeInfo = extractDuelsInfoFromScoreboard(bridgeLines);
assert.strictEqual(bridgeInfo.modeName, 'Bridge Doubles');
assert.deepStrictEqual(bridgeInfo.opponents, ['dog0223_TW', 'jeremy0714']);

// --- isDuelsScoreboard gate --------------------------------------------------
assert.strictEqual(isDuelsScoreboard('DUELS', classicLines), true);
assert.strictEqual(isDuelsScoreboard('§eDUELS', ['Mode: Bed Wars Duel']), true);
assert.strictEqual(isDuelsScoreboard('BED WARS', ['Diamond', 'Emerald']), false);
assert.strictEqual(isDuelsScoreboard('DUELS', ['just a lobby line']), false);

// --- family aggregation math -------------------------------------------------
const safeStatNumber = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const statValue = (stats, key) => safeStatNumber(stats[key]);
const sumStatValues = (stats, keys) => keys.reduce((s, k) => s + statValue(stats, k), 0);
const ratioValue = (n, d) => n / Math.max(d, 1);

const { collectDuelsStats, collectDuelsFamilyStats } = createStatsCollector({
    statValue,
    sumStatValues,
    ratioValue,
    safeStatNumber,
    bwKey: () => '',
    getSkyWarsLevelFromXp: () => 0,
    getSkyWarsLevelDelta: () => 0,
    getTopSkyWarsKit: () => null,
    BEDWARS_MODE_DEFS: [{ id: 'overall', prefix: '' }],
    SKYWARS_MODE_DEFS: [{ id: 'overall', kind: 'overall' }],
    DUELS_MODE_DEFS: DEFS
});

const duels = {
    classic_duel_wins: 10, classic_duel_losses: 5, classic_duel_kills: 20, classic_duel_deaths: 10,
    best_winstreak_mode_classic_duel: 7,
    classic_doubles_wins: 4, classic_doubles_losses: 6, classic_doubles_kills: 8, classic_doubles_deaths: 12,
    best_winstreak_mode_classic_doubles: 3
};

const oneVone = collectDuelsStats(duels, DEFS.find(d => d.id === 'classic_1v1'));
assert.strictEqual(oneVone.wins, 10);
assert.strictEqual(oneVone.losses, 5);

const classicFamily = collectDuelsFamilyStats(duels, 'Classic');
assert.strictEqual(classicFamily.modeCount, 2);
assert.strictEqual(classicFamily.wins, 14, 'family wins = 10 + 4');
assert.strictEqual(classicFamily.losses, 11, 'family losses = 5 + 6');
assert.strictEqual(classicFamily.kills, 28, 'family kills = 20 + 8');
assert.strictEqual(classicFamily.deaths, 22, 'family deaths = 10 + 12');
assert.ok(Math.abs(classicFamily.wlr - (14 / 11)) < 1e-9, 'family WLR recomputed from totals');
assert.ok(Math.abs(classicFamily.kdr - (28 / 22)) < 1e-9, 'family KDR recomputed from totals');
assert.strictEqual(classicFamily.bestWs, 7, 'family best WS = max of sub-modes');

// Single-mode family: modeCount 1 so the scan skips the redundant "overall" line.
const sumoFamily = collectDuelsFamilyStats(duels, 'Sumo');
assert.strictEqual(sumoFamily.modeCount, 1);

{
    const fs = require('fs');
    const vm = require('vm');
    const proxy = fs.readFileSync(require('path').resolve(__dirname, '../../proxy.js'), 'utf8');
    const intro = '     Bed Wars Duels\n     Destroy the enemy bed and then eliminate them!';
    assert.equal(bedwarsDuelsIntroMode(intro), 'Bed Wars Duels');
    assert.equal(bedwarsDuelsIntroMode('§eBed Wars Duels'), 'Bed Wars Duels');
    assert.equal(bedwarsDuelsIntroMode('Destroy the enemy bed and then eliminate them!'), 'Bed Wars Duel');
    assert.equal(bedwarsDuelsIntroMode('Player: Bed Wars Duels'), null);
    assert.equal(bedwarsDuelsIntroMode('Player: Destroy the enemy bed and then eliminate them!'), null);
    assert.equal(bedwarsDuelsIntroMode('Protect your bed and destroy the enemy beds.'), null);
    assert(isDuelsScoreboard('§eBED WARS DUELS', []), 'Duel title is enough before opponents arrive');
    assert(isDuelsScoreboard('BED WARS', ['Mode: Bed Wars Duel']), 'A duel mode line overrides the plain Bed Wars title');
    assert(!isDuelsScoreboard('DUELS', []), 'The generic Duels lobby remains excluded');
    const { isBedwarsPregameScoreboard } = require('../../src/net/session/pregame_chat');
    assert(!isBedwarsPregameScoreboard('BED WARS DUELS Map: Arena Mode: Bed Wars Duel Players: 2/2 Starting in 1s'));
    const context = vm.createContext({
        stripAnsi: value => value.replace(/§./g, ''), displayValueToString: String,
        bedwarsDuelsIntroMode, matchDuelsMode, DUELS_MODE_DEFS: DEFS,
        gameActive: true, currentGamemode: 'BEDWARS', sessionGameFinalized: false,
        bedwarsPregameActive: true,
        bedwarsDuelConfirmed: false,
        isDuelsScoreboard, extractDuelsInfoFromScoreboard, isBedwarsPregameScoreboard,
        getCompactScoreboardText: value => value.toUpperCase().replace(/[^A-Z]/g, ''),
        detectLobbyFromScoreboard: require('../../src/net/session/pregame_chat').detectLobbyModeScoreboard,
        getCurrentScoreboardTitle: () => context.title,
        getScoreboardLineList: () => context.lines,
        nametagOverlayEnabled: false,
        clearDuelsState() { context.duelsState.active = false; },
        duelsState: { active: false, sessionId: 0 },
        sessionTracker: { excludeCurrentGame() { context.excluded = true; } },
        bedwarsStatsDebug: { discardCurrentGame() { context.debugDiscarded = true; } },
        resetMatchState() {
            assert(context.excluded && context.sessionGameFinalized, 'Discard a provisional Bed Wars game before reset can finalize it');
            context.gameActive = false;
        },
        leaveBedwarsPregame() { context.bedwarsPregameActive = false; }
    });
    for (const [startMarker, endMarker] of [
        ['function detectGamemodeFromText(', '\nfunction isSupportedTabStatsMode('],
        ['        function observeBedwarsDuelsIntro(', '\n        function clearDuelsState('],
        ['        function updateDuelsStateFromScoreboard(', '\n        function scheduleDuelsAutoScan(']
    ]) {
        const start = proxy.indexOf(startMarker);
        const end = proxy.indexOf(endMarker, start);
        assert(start >= 0 && end > start);
        vm.runInContext(proxy.slice(start, end), context);
    }
    for (const sidebar of ['BED WARS DUELS Red: Alive Blue: Alive', 'DUELS Mode: Bed Wars Duel', 'DUELS Mode: SkyWars Duel']) {
        assert.equal(context.detectGamemodeFromText(sidebar), null, 'Duels never enter Bed Wars/SkyWars activation');
    }
    assert.equal(context.detectGamemodeFromText('BED WARS Red: Alive Blue: Alive'), 'BEDWARS');
    assert.equal(context.detectGamemodeFromText('BED WARS Map: DuelArena Red: DuelPlayer'), 'BEDWARS',
        'Names containing duel are not a game-mode signal');
    assert.equal(context.detectGamemodeFromText('SKYWARS Players left: 12'), 'SKYWARS');
    assert(context.observeBedwarsDuelsIntro(intro));
    assert(context.duelsState.active && context.duelsState.modeDef.id === 'bedwars_duel');
    assert(!context.gameActive && !context.bedwarsPregameActive && context.debugDiscarded);
    assert.equal(context.duelsState.sessionId, 1);
    context.observeBedwarsDuelsIntro('Bed Wars Duels');
    assert.equal(context.duelsState.sessionId, 1, 'Repeated introduction does not start another duel');
    context.duelsState.opponents = [];
    for (const [title, lines] of [['', []], ['DUELS', []], ['BED WARS', ['Red: Alive', 'Blue: Alive']]]) {
        context.title = title;
        context.lines = lines;
        assert(context.updateDuelsStateFromScoreboard(), 'Partial and plain Bed Wars sidebars keep the confirmed duel excluded');
        assert(context.duelsState.active);
    }
    context.duelsState.active = false; // GAME OVER resets scan state, but the sidebar can linger.
    assert(context.updateDuelsStateFromScoreboard(), 'Post-game sidebar cannot reactivate a Bed Wars session game');
    const startChat = proxy.indexOf('                    let gameStartMode = null;');
    const endChat = proxy.indexOf('                    // Each packet is already forwarded above;', startChat);
    assert(startChat >= 0 && endChat > startChat);
    context.isSupportedTabStatsMode = mode => mode === 'BEDWARS' || mode === 'SKYWARS';
    context.isActionBar = false;
    context.activated = 0;
    context.activateGame = () => context.activated++;
    for (const chat of ['protect your bed and destroy the enemy beds', 'the game starts in 1 second']) {
        context.cleanChatText = chat;
        vm.runInContext(`{ ${proxy.slice(startChat, endChat)} }`, context);
    }
    assert.equal(context.activated, 0, 'Start instructions cannot create Bed Wars games after duel scan state resets');
    context.lines = ['Map: Airshow', 'Mode: Doubles', 'Players: 1/16', 'Waiting...'];
    assert(!context.updateDuelsStateFromScoreboard(), 'A real Bed Wars waiting room releases the exclusion');
    assert(!context.bedwarsDuelConfirmed);
    context.lines = ['Mode: Bed Wars Duel'];
    assert(context.updateDuelsStateFromScoreboard(), 'Scoreboard evidence also confirms a duel without its intro');
    assert(context.bedwarsDuelConfirmed);
    context.lines = ['Level: 98', 'Progress: 10%'];
    assert(!context.updateDuelsStateFromScoreboard(), 'A lobby releases the exclusion');
    assert(!context.bedwarsDuelConfirmed);
    assert(proxy.indexOf('if (!isActionBar) observeBedwarsDuelsIntro(text);')
        < proxy.indexOf('if (!isActionBar) observeSessionGameChat(text);'),
    'Duel introduction is classified before session chat observations');
}

console.log('test_duels_scan.js passed');
