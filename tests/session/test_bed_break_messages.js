'use strict';
const assert = require('assert');
const patterns = require('../../assets/kill-message-patterns.json');
const { parseBedDestroyChat } = require('../../src/cosmetics/bedMessages');
const { parseGameEvents } = require('../../src/session/gameEvents');
const { createGame, observe, localModes } = require('../../src/session/localStats');

const start = { key: 'bed-test', mode: 'BEDWARS', startedAt: 1000, ownName: 'Tester', ownTeam: 'Aqua',
    observedFromStart: true, standardBedwars: true, identityKnown: true };
const cases = [{ name: 'Default', lines: ['Green Bed was destroyed by ExampleKiller!'] }, ...patterns];
let covered = 0;
for (const pattern of cases) {
    for (const sample of pattern.lines.filter(line => /^Green Bed\b/.test(line))) {
        covered++;
        const live = sample.replaceAll('ExampleKiller', 'Tester').replaceAll('#1', '#12,345');
        for (const target of ['Your', 'Red', 'Blue', 'Green', 'Yellow', 'Aqua', 'White', 'Pink', 'Gray', 'Grey']) {
            const line = '\n§c§lBED DESTRUCTION > §r' + live.replace('Green Bed', `${target} Bed`) + '\n';
            const parsed = parseBedDestroyChat(line);
            assert.equal(parsed?.breaker, 'Tester', `${pattern.name}: exact breaker for ${target}`);
            assert.equal(parsed.team, target);
            assert.equal(parsed.beds, live.includes('#') ? 12345 : null);
            const events = parseGameEvents(line, { ownTeam: 'Aqua' });
            assert.equal(events.length, 1);
            assert.equal(events[0].type, 'bed_break');
            assert.equal(events[0].actor, 'Tester');
            assert.equal(events[0].targetTeam, target === 'Your' ? 'Aqua' : target === 'Grey' ? 'Gray' : target);
        }
        const game = createGame(start);
        const opponentBed = 'BED DESTRUCTION > ' + live.replace('Green Bed', 'Red Bed');
        observe(game, opponentBed);
        observe(game, opponentBed);
        const ownBed = 'BED DESTRUCTION > ' + live.replace('Green Bed', 'Your Bed').replaceAll('Tester', 'Enemy');
        observe(game, ownBed);
        observe(game, ownBed.replace('Your Bed', 'Aqua Bed'));
        const stats = localModes({ current: game })[0];
        assert.equal(stats.beds, 1, `${pattern.name}: credited once`);
        assert.equal(stats.bedsLost, 1, `${pattern.name}: own bed lost once`);
        assert(game.bedGone);
        assert.equal(game.endObserved, false, 'Losing a bed alone does not end the game');
        assert.equal(stats.kills, 0, 'A bed message cannot count as a player kill');
        observe(game, 'TEAM ELIMINATED > Aqua Team has been eliminated!', { at: 61000 });
        assert.equal(localModes({ current: game })[0].losses, 1, `${pattern.name}: own-team elimination completes the game`);
    }
}
assert.equal(covered, 32, 'Default plus the 31 cosmetic bed preview samples currently shipped');
for (const line of ['Friend: BED DESTRUCTION > Your Bed was destroyed by Tester!',
    '[MVP+] Friend: BED DESTRUCTION > Your Bed was gulped by Tester!',
    'Party > Friend: Your Bed was destroyed by Tester!',
    'BED DESTRUCTION > Your Bed was destroyed by Tester! bonus text']) {
    assert.equal(parseBedDestroyChat(line), null, 'Spoofed or unknown messages cannot award a bed');
    assert(!parseGameEvents(line, { ownTeam: 'Aqua' }).some(event => event.type === 'bed_break'));
}
const unknown = createGame(start);
observe(unknown, 'BED DESTRUCTION > Your Bed disappeared mysteriously!');
assert(unknown.bedGone, 'An unknown own-bed announcement still establishes that the bed is gone');
assert(!('beds' in localModes({ current: unknown })[0]), 'Unknown wording does not invent exact counters');
console.log('Bed breaks: all shipped cosmetic samples, team aliases, colors, exact actors, duplicates, unknowns and elimination passed.');
