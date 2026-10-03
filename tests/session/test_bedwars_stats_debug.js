'use strict';

const assert = require('assert');
const { createBedwarsStatsDebug } = require('../../src/session/bedwarsStatsDebug');

let stamp = 100000;
let apiAvailable = true;
const messages = [];
const debug = createBedwarsStatsDebug({
    send: message => messages.push(message.replace(/§[0-9a-fk-or]/gi, '')),
    now: () => stamp,
    isApiAvailable: () => apiAvailable,
    detectKnownKillMessageForStats: line => line === 'Rival was too shy to meet Tester.'
        ? { victim: 'Rival', killer: 'Tester', final: false } : null
});
const count = needle => messages.filter(message => message.includes(needle)).length;
const start = { startedAt: stamp, serverId: 'mini1', ownName: 'Tester', ownNames: ['Tester'],
    ownTeam: 'Aqua', identityKnown: true, observedFromStart: true, standardBedwars: true,
    variant: 'Doubles' };

assert.equal(debug.status().enabled, false);
debug.start(start);
assert.equal(messages.length, 0, 'disabled debug emits nothing');
debug.setEnabled(true);
debug.start(start);
debug.observeChat('Rival was too shy to meet Tester.');
debug.observeChat('Rival was too shy to meet Tester.');
assert.equal(count('Kills +1'), 1, 'known cosmetic kill is shown once');
debug.observeChat('+36 tokens! (Bed Destroyed)');
assert.equal(count('Beds broken unknown'), 0, 'reward message does not invalidate bed tracking');
assert.equal(count('Beds lost unknown'), 0, 'reward message does not invalidate bed-loss tracking');
debug.observeChat('YOU GOT LUCKY! You will receive DOUBLE EXP this game!');
debug.observeChat('YOU GOT LUCKY! You will receive DOUBLE EXP this game!|');
assert.equal(count('Kills unknown'), 0, 'double EXP announcement does not invalidate kills');
assert.equal(count('Deaths unknown'), 0, 'double EXP announcement does not invalidate deaths');
stamp += 1500;
debug.observeChat('Enemy was killed by Tester. FINAL KILL!');
debug.observeChat('BED DESTRUCTION > Red Bed was destroyed by Tester!');
debug.observeChat('BED DESTRUCTION > Your Bed was destroyed by Enemy!');
assert.equal(count('Beds broken +1'), 1, 'real bed announcement still counts after the reward');
assert.equal(count('Beds lost +1'), 1, 'own bed announcement still counts after the reward');
debug.observeChat('Tester was killed by Enemy. FINAL KILL!');
debug.observeTitle('GAME OVER!');
debug.observeTitle('VICTORY!');
assert(messages.some(message => message.includes('Losses -1')), 'corrected result is visible');
assert(messages.some(message => message.includes('Wins +1')), 'win is visible');
stamp += 10000;
debug.end({ at: stamp, serverId: 'mini1' });
assert.equal(debug.status().awaitingApi, 1);
assert(messages.some(message => message.includes('Beds broken 1')));
assert(messages.some(message => message.includes('Final deaths 1')));
const recap = { mode: 'BEDWARS', record: { at: stamp, verificationStatus: 'verified',
    metadata: { serverId: 'mini1' } }, delta: { stats: { Bedwars: {
    kills_bedwars: 2, deaths_bedwars: 0, final_kills_bedwars: 1, final_deaths_bedwars: 1,
    beds_broken_bedwars: 1, beds_lost_bedwars: 1, wins_bedwars: 1, losses_bedwars: 0,
    games_played_bedwars: 1
} } } };
debug.onRecap({ ...recap, record: { ...recap.record, metadata: { serverId: 'mini2' } } });
assert.equal(debug.status().awaitingApi, 1, 'another game must not consume comparison');
debug.onRecap(recap);
assert.equal(debug.status().awaitingApi, 0);
assert(messages.some(message => message.includes('8/9 available stats match')));
assert(messages.some(message => message.includes('Kills: Local 1 | API 2 DIFF')));
assert(messages.some(message => message.includes('Beds broken: Local 1 | API 1')),
    'the API check lists matching fields as well as differences');

stamp += 10000;
debug.start({ ...start, startedAt: stamp, serverId: 'mini3' });
debug.end({ at: stamp + 35000, serverId: 'mini3' });
assert.equal(debug.status().paused, true);
debug.onRecap({ ...recap, record: { ...recap.record, at: stamp + 35000,
    metadata: { serverId: 'mini3' } }, delta: { stats: { Bedwars: { kills_bedwars: 1 } } } });
assert.equal(debug.status().paused, true, 'an API combat update does not prove the game ended');
debug.start({ ...start, startedAt: stamp, serverId: 'mini3', observedFromStart: false,
    apiComparable: false });
assert.equal(debug.status().paused, false, 'rejoin resumes existing game');
debug.observeChat('Enemy was killed by Tester.');
assert(messages.some(message => message.includes('Kills +1')));
debug.observeTitle('VICTORY!');
debug.end({ at: stamp + 50000, serverId: 'mini3' });
assert.equal(debug.status().awaitingApi, 0, 'API boundary at leave cannot verify a rejoined game');
debug.setEnabled(false);
const length = messages.length;
debug.observeChat('Rival was killed by Tester.');
debug.onRecap(recap);
assert.equal(messages.length, length, 'off mode is silent');

apiAvailable = false;
debug.setEnabled(true);
stamp += 10000;
debug.start({ ...start, startedAt: stamp, serverId: 'mini4' });
debug.observeTitle('DEFEAT!');
debug.end({ at: stamp + 45000, serverId: 'mini4' });
assert.equal(debug.status().awaitingApi, 0, 'API-off game does not claim verification');
assert(messages.some(message => message.includes('API comparison unavailable')));

stamp += 10000;
debug.start({ ...start, startedAt: stamp, serverId: 'mini5', observedFromStart: false });
debug.observeChat('Rival was too shy to meet Tester.');
assert(messages.some(message => message.includes('Kills +1 (1) (incomplete)')),
    'midgame observations remain visible without claiming complete coverage');
debug.end({ at: stamp + 45000, serverId: 'mini5', confirmed: true });
assert(messages.some(message => message.includes('Kills ? (seen 1)')));

apiAvailable = true;
stamp += 10000;
debug.start({ ...start, startedAt: stamp, serverId: 'mini6' });
debug.observeTitle('VICTORY!');
debug.end({ at: stamp + 45000, serverId: 'mini6' });
debug.onRecap({ ...recap, record: { ...recap.record, at: stamp + 45000,
    metadata: { serverId: 'mini6' } }, delta: { stats: { Bedwars: { kills_bedwars: 1 } } } });
assert(messages.some(message => message.includes('has not published a win or loss')),
    'a partial API publication must not claim the local totals were verified');

stamp += 10000;
debug.start({ ...start, startedAt: stamp, serverId: 'mini7' });
debug.observeChat('Rival was too shy to meet Tester.');
debug.end({ at: stamp + 35000, serverId: 'mini7' });
const queued = debug.onNewQueue(stamp + 45000);
assert(queued.needsResult, 'a new queue closes a game with no detected result');
assert.equal(debug.status().active, false);
debug.confirmQueuedResult({ result: 'win', at: queued.at, serverId: queued.serverId });
debug.onRecap({ ...recap, record: { ...recap.record, at: queued.at,
    metadata: { serverId: 'mini7' } }, delta: { stats: { Bedwars: {
    kills_bedwars: 1, wins_bedwars: 1, games_played_bedwars: 1
} } } });
assert(messages.some(message => message.includes('Wins: Local 1 | API 1')),
    'confirmed result is included in the readable local/API comparison');

console.log('BedWars stats debug: live observations, corrected result, rejoin, API comparison and API-off behavior passed.');
