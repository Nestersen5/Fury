'use strict';
const assert = require('assert');
const {compactModes} = require('../../src/session/launcherSessionHistory');
const {submodeStats} = require('../../src/session/submodeStats');

const sw = compactModes({stats:{SkyWars:{games:5,wins:3,losses:2,
    wins_solo_normal:2,losses_solo_normal:1,kills_solo_normal:8,deaths_solo_normal:1,
    wins_team_insane:1,losses_team_insane:1,kills_team_insane:3,deaths_team_insane:1,
    games_kit_basic_solo_default:100}}})[0];
assert.deepStrictEqual(sw.submodes.map(e=>e.label),['Normal Solo','Insane Doubles']);
assert.equal(sw.submodes[0].games,3);
assert.equal(sw.submodes[0].kdr,8);
assert.equal(sw.submodes[1].wins,1);
assert(!('assists' in sw.submodes[0]),'missing stat groups must not be fabricated');

const stats = {rounds_played:31,wins:31};
for(let i=0;i<31;i++)Object.assign(stats,{[`variant_${i}_duel_rounds_played`]:1,[`variant_${i}_duel_wins`]:1,[`variant_${i}_duel_kills`]:i});
Object.assign(stats,{best_tnt_games_winstreak:50,classic_duel_kit_wins:20});
const duels = compactModes({stats:{Duels:stats}})[0];
assert.equal(duels.submodes.length,31,'all played modes must survive projection');
assert.equal(duels.breakdown.entries.length,31);
assert.equal(duels.submodes.find(e=>e.id==='variant_30_duel').kills,30);
const family = submodeStats('DUELS',{bedwars_two_one_duels_rounds_played:6,bedwars_two_one_duels_wins:5,
    bedwars_two_one_duels_rush_rounds_played:4,bedwars_two_one_duels_rush_wins:3});
assert.equal(family.reduce((n,e)=>n+e.games,0),6);
assert.equal(family.reduce((n,e)=>n+e.wins,0),5);
assert.equal(submodeStats('DUELS',{classic_duel_wins:2,classic_duel_losses:1})[0].games,3,'results cover modes without rounds');
const legacy = submodeStats('DUELS',{classic_duel_rounds_played:2})[0];
assert(!('kills' in legacy));assert(!('wins' in legacy));
assert.deepStrictEqual(submodeStats('DUELS',{bridge_duel_rounds_played:1,bridge_duel_bridge_kills:4}).map(e=>e.id),['bridge_duel'],'Bridge-specific kill counters are not another mode');
console.log('Session submode stats passed: SkyWars variants, 31 Duels modes, ratios, sparse counters and family deduplication.');
