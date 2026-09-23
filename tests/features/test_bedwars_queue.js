'use strict';
const assert = require('assert');
const { pregameLobbyIdForScoreboard, requeueCommandForScoreboard } = require('../../src/dodge/bedwarsQueue.js');

assert.deepStrictEqual(requeueCommandForScoreboard('BED WARS Mode: Doubles Starting in 20s'), { label: 'Doubles', command: '/play bedwars_eight_two', fallback: false, teamSize: 2 });
assert.deepStrictEqual(requeueCommandForScoreboard('Mode: 3v3v3v3 Players: 5/12'), { label: 'Threes', command: '/play bedwars_four_three', fallback: false, teamSize: 3 });
assert.deepStrictEqual(requeueCommandForScoreboard('§eMode: §b4v4v4v4 §eMap: Lectus'), { label: 'Fours', command: '/play bedwars_four_four', fallback: false, teamSize: 4 });
assert.deepStrictEqual(requeueCommandForScoreboard('§eMode: §b4v4 §eMap: Lectus'), { label: '4v4', command: '/play bedwars_two_four', fallback: false, teamSize: 4 });
assert.deepStrictEqual(requeueCommandForScoreboard('Waiting for players...'), { label: 'Unknown', command: '/rq', fallback: true, teamSize: null });
assert.strictEqual(pregameLobbyIdForScoreboard('BED WARS 07/04/26 m36DK Mode: Doubles Starting in 20s'), 'm36DK');
assert.strictEqual(pregameLobbyIdForScoreboard('BED WARS Mode: Doubles Starting in 20s'), null);
// Real Hypixel lines split the id around an emoji sidebar entry.
assert.strictEqual(pregameLobbyIdForScoreboard('§e§lBED WARS §709/16/26  §8L3🔮§82A §fLevel: §71920'), 'L32A');
assert.strictEqual(pregameLobbyIdForScoreboard('§709/10/26  §8m2🔮§837S'), 'm237S');
console.log('BedWars queue tests passed.');
