'use strict';

const assert = require('assert');
const board = require('../../src/launcher/renderer/launcher_overlay_board.js');

const player = (name, team, stats = {}, extra = {}) => ({
    name,
    mode: 'BEDWARS',
    rowSource: 'live',
    team: { name: team },
    stats: { stars: 100, fkdr: 1, wlr: 1, ws: null, ...stats },
    tags: [],
    ping: 50,
    ...extra
});

const helpers = {
    statText: (row, key) => {
        const value = row.stats?.[key];
        if (value === null || value === undefined) return '?';
        return ['fkdr', 'wlr', 'kdr', 'bblr'].includes(key) ? Number(value).toFixed(2) : String(value);
    },
    statClass: () => '',
    statLabel: key => ({ fkdr: 'FKDR', wlr: 'WLR', ws: 'WS', ping: 'PING', tags: 'TAG' })[key] || key.toUpperCase(),
    levelHtml: row => `[${row.stats?.stars}✫]`
};

// Fours: teams in Hypixel order, players sorted by FKDR, teams ranked by average FKDR.
const fours = [
    player('Nestersen', 'Red', { fkdr: 11.21 }),
    player('tortugos', 'Red', { fkdr: 35.36 }),
    player('dusttn', 'red', { fkdr: 8.08 }),
    player('Gamerrbot', 'Red', { fkdr: 16.02 }),
    player('Manhal_IQ_', 'Blue', { fkdr: 21.49 }),
    player('nalini25', 'Blue', { fkdr: 4.77 }),
    player('fyechris', 'Green', { fkdr: 13.39 }, {
        tags: [
            { source: 'Seraph', value: 'Closet Cheater', reasons: 'legit scaff' },
            { source: 'Urchin', value: 'Replays Needed' }
        ]
    }),
    player('AuroraXI', 'Green', { fkdr: 2.67 }, { tags: [{ source: 'Urchin', title: 'Urchin API Status', value: 'API 429' }] }),
    player('Yoshiko', 'Yellow', {}, { isNicked: true }),
    player('added_friend', null, { fkdr: 3 }, { rowSource: 'manual' })
];
const order = ['fkdr', 'wlr', 'ws', 'ping'];
const model = board.buildBoardModel(fours, { mode: 'BEDWARS', order, account: 'nestersen', myTeam: '' });

assert.deepStrictEqual(model.groups.map(group => group.key), ['Red', 'Blue', 'Green', 'Yellow', 'Added']);
assert.deepStrictEqual(model.groups[0].rows.map(row => row.name), ['tortugos', 'Gamerrbot', 'Nestersen', 'dusttn']);
assert.strictEqual(model.groups[0].isMine, true, 'the account name marks its team as mine');
assert.strictEqual(model.groups[0].rank, 1);
assert.strictEqual(model.groups[3].strength, null, 'nicked players without a real name do not count toward team strength');
assert.strictEqual(model.groups[3].rank, null);
assert.strictEqual(model.summary.flagged, 1, 'API status tags are not threats');
assert.strictEqual(model.summary.nicked, 1);
assert.strictEqual(model.summary.teamCount, 4);
assert.strictEqual(model.summary.mine.rank, 1);
assert.strictEqual(model.summary.strongest.team, 'Red');
assert.deepStrictEqual(model.columns, order);

// Danger ignores your own team: opponents here average (21.49 + 4.77 + 13.39 + 2.67 + 3) / 5.
const opponentsFkdr = (21.49 + 4.77 + 13.39 + 2.67 + 3) / 5;
assert.deepStrictEqual(model.summary.danger, board.dangerLevel(opponentsFkdr));
assert.strictEqual(board.dangerLevel(12.1).label, 'EXTREME');
assert.strictEqual(board.dangerLevel(0.4).label, 'LOW');
assert.strictEqual(board.dangerLevel(0.4).blocks, 1);
assert.strictEqual(board.describeLobby(model, { gameActive: true }), 'Live · BedWars · 4 teams of 4 · 10 players');

// The scoreboard team wins even when the account row is missing from the roster.
const byScoreboard = board.buildBoardModel(fours.slice(4), { mode: 'BEDWARS', order, account: 'Nestersen', myTeam: 'Blue' });
assert.strictEqual(byScoreboard.groups.find(group => group.key === 'Blue').isMine, true);

// Doubles: eight teams of two.
const doublesRows = board.TEAM_ORDER.flatMap((team, index) => [
    player(`${team}_one`, team, { fkdr: index + 1 }),
    player(`${team}_two`, team, { fkdr: index + 2 })
]);
const doubles = board.buildBoardModel(doublesRows, { mode: 'BEDWARS', order });
assert.strictEqual(board.describeLobby(doubles), 'Waiting for a game · BedWars · 8 teams of 2 · 16 players');
assert.strictEqual(doubles.groups[7].rank, 1, 'Gray has the highest FKDR in this fixture');

// List view and SkyWars both collapse into one card.
assert.deepStrictEqual(board.buildBoardModel(fours, { mode: 'BEDWARS', order, view: 'list' }).groups.map(group => group.key), ['Players']);
const skywars = board.buildBoardModel([player('a', null, { wlr: 2 }), player('b', null, { wlr: 5 })], { mode: 'SKYWARS', order: ['wlr', 'kdr', 'ws', 'ping'] });
assert.deepStrictEqual(skywars.groups[0].rows.map(row => row.name), ['b', 'a']);
assert.strictEqual(skywars.summary.danger, null, 'danger is only defined for FKDR');

// Rendered markup: stars before the name, tags after it, hidden winstreaks as ?, removal hooks kept.
const { html } = board.renderBoard(fours, { mode: 'BEDWARS', order, account: 'Nestersen' }, helpers);
const nestersenRow = html.slice(html.indexOf('data-player="Nestersen"'), html.indexOf('</div>', html.indexOf('data-player="Nestersen"')));
assert(nestersenRow.indexOf('[100✫]') < nestersenRow.indexOf('>Nestersen<'), 'star level is a prefix');
assert(nestersenRow.indexOf('>Nestersen<') < nestersenRow.indexOf('[YOU]'), 'tags are a suffix');
assert(html.includes('[CLOSET CHEATER]') && html.includes('+1'), 'extra tags collapse into +N');
assert(html.includes('[NICK]') && html.includes('[ADDED]'));
assert(html.includes('>?</span>'), 'hidden winstreak renders as ?');
assert(html.includes('data-overlay-remove="tortugos"') && html.includes('data-overlay-remove-source="live"'));
assert(!html.includes('>TAG<'), 'tags are never a column');
assert(/--board-template:24px minmax\(160px,1fr\) (\d+px ){4}16px/.test(html), 'one shared column template for every card');

const escaped = board.renderBoard([player('<img>', 'Red', {}, { tags: [{ source: 'Urchin', value: '"><script>' }] })], { mode: 'BEDWARS', order }, helpers).html;
assert(!escaped.includes('<script>') && !escaped.includes('<img>'), 'player names and tag text are escaped');

assert.strictEqual(board.tagTone({ value: 'Sniper' }), 'red');
assert.strictEqual(board.tagTone({ value: 'Replays Needed' }), 'yellow');
assert.strictEqual(board.fkdrTone(35.36), 'dark-red');
assert.strictEqual(board.canonicalTeam('grey'), 'Gray');

console.log('Overlay team board tests passed.');
