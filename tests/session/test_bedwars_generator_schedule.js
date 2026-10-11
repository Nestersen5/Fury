'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { bedwarsElapsedFromSidebar } = require('../../src/session/gameClips.js');
const { normalizeBedwarsTabSettings } = require('../../src/session/bedwarsTabSettings.js');
const {
    getBedwarsGeneratorStats, appendGeneratorRowToFooter, componentText
} = require('../../src/session/bedwarsGeneratorSchedule.js');

const examples = [
    [0, 0, 0, 3, 32],
    [2, 0, 0, 1, 30],
    [3, 1, 0, 30, 29],
    [32, 1, 1, 1, 65],
    [33, 2, 1, 30, 64],
    [62, 2, 1, 1, 35],
    [345, 12, 5, 16, 12],
    [357, 12, 6, 4, 65],
    [360, 12, 6, 1, 62],
    [361, 13, 6, 23, 61],
    [363, 13, 6, 21, 59], // Cancelled Tier I diamond spawn.
    [384, 14, 6, 23, 38],
    [720, 28, 12, 9, 50],
    [747, 29, 12, 5, 23], // Cancelled Tier I emerald spawn.
    [1080, 44, 19, 1, 40],
    [1081, 45, 19, 12, 39],
    [1097, 46, 19, 8, 23], // Cancelled Tier II diamond spawn.
    [1440, 74, 27, 1, 35],
    [1470, 77, 27, 7, 5] // Cancelled Tier II emerald spawn.
];
for (const [seconds, diamonds, emeralds, diamondSeconds, emeraldSeconds] of examples) {
    assert.deepStrictEqual(getBedwarsGeneratorStats(seconds * 1000),
        { diamonds, emeralds, diamondSeconds, emeraldSeconds }, `at ${seconds}s`);
}

// Independently enumerate the actual events through an hour of gameplay,
// including every boundary. Verify both fractional and exact deadlines.
function events(first, interval, end) {
    const output = [];
    for (let at = first; at < end; at += interval) output.push(at);
    return output;
}
const diamondEvents = [...events(2, 30, 360), ...events(360, 23, 1080), ...events(1080, 12, 3700)].map(at => at + 1);
const emeraldEvents = [...events(32, 65, 720), ...events(720, 50, 1440), ...events(1440, 35, 3700)];
for (let elapsed = 0; elapsed <= 3600; elapsed += 0.25) {
    const stats = getBedwarsGeneratorStats(elapsed * 1000);
    for (const [timeline, amountKey, timerKey] of [
        [diamondEvents, 'diamonds', 'diamondSeconds'],
        [emeraldEvents, 'emeralds', 'emeraldSeconds']
    ]) {
        assert.strictEqual(stats[amountKey], timeline.filter(at => at <= elapsed).length);
        assert.strictEqual(stats[timerKey], Math.ceil(timeline.find(at => at > elapsed) - elapsed));
    }
}
assert.deepStrictEqual(getBedwarsGeneratorStats(-100), getBedwarsGeneratorStats(0));
assert.deepStrictEqual(getBedwarsGeneratorStats(NaN), getBedwarsGeneratorStats(0));

const footer = JSON.stringify({ text: '', extra: [
    { text: 'Kills: 0  Beds Broken: 0\n', color: 'aqua', bold: true },
    { text: 'STORE.HYPIXEL.NET', color: 'red', clickEvent: { action: 'open_url', value: 'https://store.hypixel.net' } }
] });
const rendered = appendGeneratorRowToFooter(footer, getBedwarsGeneratorStats(345000));
assert.strictEqual(componentText(rendered),
    'Kills: 0  Beds Broken: 0\n\nEmeralds (1): 5  Diamonds (2): 12\nSTORE.HYPIXEL.NET');
assert.deepStrictEqual(JSON.parse(rendered).extra.slice(2, 13), [
    { text: 'Emeralds (', color: 'green' },
    { text: '1', color: 'white' },
    { text: ')', color: 'green' },
    { text: ': ', color: 'green' },
    { text: '5', color: 'gray' },
    { text: '  ', color: 'white' },
    { text: 'Diamonds (', color: 'aqua' },
    { text: '2', color: 'white' },
    { text: ')', color: 'aqua' },
    { text: ': ', color: 'aqua' },
    { text: '12', color: 'gray' }
]);
assert.deepStrictEqual(JSON.parse(rendered).extra.at(-1), JSON.parse(footer).extra.at(-1));
assert.strictEqual(appendGeneratorRowToFooter('Lobby footer', {}), 'Lobby footer');
assert.strictEqual(appendGeneratorRowToFooter(null, {}), null);

// Exercise the production refresh functions with a controlled clock/client.
const proxy = fs.readFileSync(path.resolve(__dirname, '../../proxy.js'), 'utf8');
const refreshCode = proxy.slice(proxy.indexOf('        function syncBedwarsGeneratorClock('),
    proxy.indexOf('        function saveCurrentMatchSnapshot('));
const writes = [];
const timers = new Map();
let nextTimer = 0;
let stamp = 100000 + 345250;
const context = vm.createContext({
    Date: { now: () => stamp },
    getBedwarsGeneratorStats, appendGeneratorRowToFooter,
    bedwarsElapsedFromSidebar, generatorSidebarElapsedMs: null,
    generatorClockFallbackStartAt: null,
    activeSessionGameMetadata: {}, sidebarLines: [],
    getScoreboardLineList: () => context.sidebarLines,
    generatorFooterRefreshTimer: null, originalTabFooterPacket: { header: 'Header', footer },
    lastGeneratorFooterSignature: '', gameStartTime: 100000,
    gameActive: true, currentGamemode: 'BEDWARS', gameSessionId: 1, proxyStopping: false,
    enabled: true, isTabStatsActiveInGame: () => context.enabled,
    bedwarsTabSettings: normalizeBedwarsTabSettings(),
    isProxyAutoThrottleActive: () => !context.enabled,
    mc: { states: { PLAY: 'play' } },
    client: { state: 'play', write: (name, packet) => writes.push({ name, packet }) },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id)
});
vm.runInContext(refreshCode, context);
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(writes.length, 1);
assert.strictEqual(timers.size, 1);
assert.strictEqual([...timers.values()][0].delay, 750);
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(writes.length, 1, 'unchanged footer is not sent twice');
assert.strictEqual(timers.size, 1, 'only one refresh timer');
const tick = [...timers.values()][0].callback;
timers.clear();
stamp = 100000 + 361000; // Delayed callback crosses the upgrade without drift.
tick();
assert(componentText(writes.at(-1).packet.footer).includes('Diamonds (2): 13'));
assert.strictEqual(timers.size, 1);
context.enabled = false;
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(timers.size, 0);
assert.strictEqual(writes.at(-1).packet.footer, footer);
context.enabled = true;
context.refreshBedwarsGeneratorFooter();
const staleTick = [...timers.values()][0].callback;
timers.clear();
context.gameSessionId++;
const beforeStale = writes.length;
staleTick();
assert.strictEqual(writes.length, beforeStale, 'old game callback cannot write to a new session');
context.gameActive = false;
context.gameStartTime = null;
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(timers.size, 0);
assert.strictEqual(writes.at(-1).packet.footer, footer);
context.gameActive = true;
context.gameStartTime = 100000;
context.originalTabFooterPacket = { footer: 'Lobby' };
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(timers.size, 0, 'no polling when the footer has no insertion point');

// The scoreboard is authoritative even when wall-clock start detection differs.
context.originalTabFooterPacket = { header: 'Header', footer };
context.sidebarLines = ['Diamond II in 0:02'];
context.syncBedwarsGeneratorClock();
assert(componentText(writes.at(-1).packet.footer).includes('Diamonds (2): 12'));
assert.strictEqual(timers.size, 0, 'scoreboard mode has no competing local countdown');
const beforeClockTick = writes.length;
stamp += 2300;
context.syncBedwarsGeneratorClock();
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(writes.length, beforeClockTick, 'wall time cannot advance the displayed scoreboard clock');
context.sidebarLines = ['Diamond II in 0:01'];
context.syncBedwarsGeneratorClock();
assert.strictEqual(writes.length, beforeClockTick, 'unchanged resource totals do not resend the footer on a scoreboard tick');
assert(componentText(writes.at(-1).packet.footer).includes('Diamonds (2): 12'));
context.sidebarLines = ['Emerald II in 6:00'];
context.syncBedwarsGeneratorClock();
assert(componentText(writes.at(-1).packet.footer).includes('Diamonds (2): 12'));
context.sidebarLines = ['Emerald II in 5:59'];
context.syncBedwarsGeneratorClock();
assert(componentText(writes.at(-1).packet.footer).includes('Diamonds (2): 13'));
assert.strictEqual(timers.size, 0);
context.sidebarLines = ['Emerald II in 0:01'];
context.syncBedwarsGeneratorClock();
assert(componentText(writes.at(-1).packet.footer).includes('Emeralds (1): 11'));
context.sidebarLines = ['Diamond III in 6:00'];
context.syncBedwarsGeneratorClock();
assert(componentText(writes.at(-1).packet.footer).includes('Emeralds (1): 12'));
context.sidebarLines = [];
context.syncBedwarsGeneratorClock();
assert.strictEqual(context.generatorSidebarElapsedMs, null);
assert.strictEqual(timers.size, 1, 'missing scoreboard clock restores the fallback timer');
assert(componentText(writes.at(-1).packet.footer).includes('Emeralds (1): 12'),
    'fallback continues from the last synchronized clock instead of jumping to local start time');
context.sidebarLines = ['Diamond II in 0:01'];
context.activeSessionGameMetadata = { privateGame: true };
context.syncBedwarsGeneratorClock();
assert.strictEqual(context.generatorSidebarElapsedMs, null, 'private event times remain unsupported');

// Settings apply without waiting for the next scoreboard tick or rejoining.
context.activeSessionGameMetadata = {};
context.sidebarLines = ['Diamond II in 2:41'];
context.syncBedwarsGeneratorClock();
context.bedwarsTabSettings = normalizeBedwarsTabSettings({
    tabResourcesEnabled: false, tabPhasesEnabled: true, tabPhaseTypes: ['gameend', 'diamond2']
});
context.isTabStatsActiveInGame = () => false;
context.refreshBedwarsGeneratorFooter();
assert(!componentText(writes.at(-1).packet.footer).includes('Diamonds (2):'));
assert(componentText(writes.at(-1).packet.footer).includes('Diamond II: 2:41  |  Game End: 46:41'));
assert.strictEqual(timers.size, 0);
context.bedwarsTabSettings = normalizeBedwarsTabSettings({ tabResourcesEnabled: false, tabPhasesEnabled: false });
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(writes.at(-1).packet.footer, footer, 'turning both sections off restores the original footer immediately');
context.gameActive = false;
context.bedwarsTabSettings = normalizeBedwarsTabSettings({ tabResourceTypes: ['emerald'] });
context.refreshBedwarsGeneratorFooter();
assert.strictEqual(writes.at(-1).packet.footer, footer, 'outside a match settings do not fabricate a game clock');
context.gameActive = true;
context.refreshBedwarsGeneratorFooter();
assert(componentText(writes.at(-1).packet.footer).includes('Emeralds (1):'));
assert(!componentText(writes.at(-1).packet.footer).includes('Diamonds (2):'));

console.log('BedWars generator schedule and footer refresh tests passed.');
