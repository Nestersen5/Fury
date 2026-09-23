const assert = require('assert');
const {
    detectLobbyModeScoreboard,
    isBedwarsPregameScoreboard,
    parseBedwarsPregameMap,
    reconstructScoreboardLine,
    parseBedwarsPregameChat
} = require('../../src/net/session/pregame_chat.js');

const screenshotScoreboard = [
    '\u00a7c\u00a7lBED WARS',
    '06/09/26',
    'Map: \u00a7aAirshow',
    'Players: \u00a7a15/16',
    'Starting in \u00a7a6s',
    'Mode: \u00a7aDoubles',
    'Version: v1.11.2'
].join(' ');

assert.equal(isBedwarsPregameScoreboard(screenshotScoreboard), true);
assert.equal(isBedwarsPregameScoreboard('BED WARS Map: Airshow Players: 8/16 Waiting... Mode: Doubles'), true);
assert.equal(isBedwarsPregameScoreboard('BED WARS Map: Lighthouse Players: 12/16 Starting in 14s Mode: Doubles'), true);
assert.equal(isBedwarsPregameScoreboard('BED WARS Map: Any Future Map Players: 7/8 Starting in 3s Mode: Solo'), true);
assert.equal(isBedwarsPregameScoreboard('BED WARS Slumber Tickets: 12 Level: 100 Progress: 50%'), false);
assert.equal(isBedwarsPregameScoreboard('BED WARS Diamond II in 4:20 Red: \u2714 Blue: \u2714'), false);
assert.equal(isBedwarsPregameScoreboard('SKYWARS Map: Aegis Players: 11/12 Starting in 5s Mode: Solo'), false);
assert.equal(parseBedwarsPregameMap(screenshotScoreboard), 'Airshow');
assert.equal(parseBedwarsPregameMap('BED WARS Map: Any Future Map Players: 7/8 Starting in 3s Mode: Solo'), 'Any Future Map');
assert.equal(parseBedwarsPregameMap('BED WARS Players: 8/16 Map: Lighthouse Mode: Doubles Waiting...'), 'Lighthouse');
assert.equal(parseBedwarsPregameMap([
    'BED WARS',
    'Players: 15/16',
    'Version: v1.11.2',
    'Map: Orchestra',
    '06/09/26 mini12A',
    'Mode: Doubles',
    'Starting in 6s'
]), 'Orchestra');
assert.equal(parseBedwarsPregameMap('BED WARS Diamond II in 4:20 Red: ✔ Blue: ✔'), null);
assert.equal(parseBedwarsPregameMap('SKYWARS Map: Aegis Players: 11/12 Starting in 5s Mode: Solo'), null);

const reconstructedScoreboard = [
    'BED WARS',
    reconstructScoreboardLine('\u00a70', { prefix: 'Map: ', suffix: 'Airshow' }),
    reconstructScoreboardLine('\u00a71', { prefix: 'Players: ', suffix: '15/16' }),
    reconstructScoreboardLine('\u00a72', { prefix: 'Starting in ', suffix: '6s' }),
    reconstructScoreboardLine('\u00a73', { prefix: 'Mode: ', suffix: 'Doubles' })
].join(' ');
assert.equal(isBedwarsPregameScoreboard(reconstructedScoreboard), true);
assert.equal(parseBedwarsPregameMap(reconstructedScoreboard), 'Airshow');
assert.equal(parseBedwarsPregameMap([
    'BED WARS',
    reconstructScoreboardLine('\u00a70', { prefix: 'Players: ', suffix: '15/16' }),
    reconstructScoreboardLine('\u00a71', { prefix: 'Map: ', suffix: 'Any Future Map' }),
    reconstructScoreboardLine('\u00a72', { prefix: 'Mode: ', suffix: 'Doubles' }),
    reconstructScoreboardLine('\u00a73', { prefix: 'Waiting', suffix: '...' })
]), 'Any Future Map');

const reconstructedBedwarsLobby = [
    'BED WARS',
    reconstructScoreboardLine('\u00a70', { prefix: 'Slumber ', suffix: 'Tickets: 42' }),
    reconstructScoreboardLine('\u00a71', { prefix: 'Level: ', suffix: '1725' }),
    reconstructScoreboardLine('\u00a72', { prefix: 'Progress: ', suffix: '64%' })
].join(' ');
assert.equal(detectLobbyModeScoreboard(reconstructedBedwarsLobby), 'BEDWARS');
assert.equal(detectLobbyModeScoreboard('SKYWARS Solo Kills: 10 Solo Wins: 2 Souls: 150'), 'SKYWARS');
assert.equal(detectLobbyModeScoreboard(screenshotScoreboard), null);

[
    ['[MVP++] Ninja616: hello', 'Ninja616', 'hello'],
    ['[MVP+] LeEat: joined', 'LeEat', 'joined'],
    ['[VIP] DemoPlayer_: hi guys', 'DemoPlayer_', 'hi guys'],
    ['DonJavid: hi', 'DonJavid', 'hi']
].forEach(([line, sender, message]) => {
    assert.deepEqual(parseBedwarsPregameChat(line), { sender, message });
});

assert.equal(parseBedwarsPregameChat('[MVP++] Ninja616 joined the lobby!'), null);
assert.equal(parseBedwarsPregameChat('From [MVP++] Ninja616: hello'), null);
assert.equal(parseBedwarsPregameChat('Party > [MVP++] Ninja616: hello'), null);
assert.equal(parseBedwarsPregameChat('Guild > Ninja616: hello'), null);
['Reminder', 'Reminders', 'Leader', 'Leaders', 'Moderator', 'Moderators', 'Member', 'Members'].forEach((name) => {
    assert.equal(parseBedwarsPregameChat(`${name}: system text`), null, `${name} must not trigger a pregame player lookup`);
    assert.equal(parseBedwarsPregameChat(`[VIP] ${name}: system text`), null, `${name} must stay excluded when rank-formatted`);
});

console.log('Pregame chat tests passed.');
