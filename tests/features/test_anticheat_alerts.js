'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const chatController = require('../../features/chat_controller');
const { sendChat, extractText } = require('../../features/minecraft_chat');

// Exercise the production alert and Minecraft chat serialization without a
// connection, external lookups, or changes to the player's saved denick list.
const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
const start = source.indexOf('        function announceAnticheatFlag(');
const end = source.indexOf('        const SCAFFOLD_GROUP_LABELS', start);
assert(start !== -1 && end > start);
const packets = [], broadcasts = [], teamLookups = [];
let live = null, saved = null;
let actorTeam = 'Blue';
const context = {
    chatController, sendChat,
    client: { write: (name, packet) => packets.push({ name, ...packet }) },
    console: { log() {} },
    broadcastScaffoldFlag: flag => broadcasts.push(flag),
    getAutoDenickResult: () => live,
    findKnownDenickByNick: () => saved,
    isValidPlayerName: name => typeof name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(name),
    isOwnPlayerName: name => name.toLowerCase() === 'self',
    anticheatTeamAlertsEnabled: false,
    currentGamemode: 'BEDWARS',
    clientBedwarsTeamName: () => 'Red',
    resolveBedwarsTeamName: name => { teamLookups.push(name); return actorTeam; }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const evidence = [{ group: 'Swing', reason: 'silent placement', hard: true }];
function alert(tier = 'confirmed', name = 'NickName') {
    context.announceAnticheatFlag({ cheat: 'Scaffold', name, tier, evidence, weight: 5 });
    return packets.length ? JSON.parse(packets.pop().message) : null;
}

assert.strictEqual(extractText(alert()), '[AC] NickName » Scaffold', 'unknown players retain their observed name');
saved = { realName: 'SavedIGN', realIGN: 'SavedIGN' };
let message = alert();
assert.strictEqual(extractText(message), '[AC] SavedIGN » Scaffold', 'saved denicks use the real IGN without needing a live result');
assert.strictEqual(broadcasts.at(-1).name, 'NickName', 'party filtering keeps the observed identity');
assert.strictEqual(teamLookups.at(-1), 'NickName', 'team filtering keeps the observed identity');
const components = message.extra;
assert.strictEqual(components.find(part => part.text === 'SavedIGN').color, 'white');
const verdict = components.find(part => part.text === 'Scaffold');
assert.strictEqual(verdict.color, 'red');
assert.strictEqual(verdict.bold, true);
assert(extractText(verdict.hoverEvent.value).includes('silent placement'), 'evidence stays in the hover');

live = { realName: 'LiveIGN' };
message = alert('possible');
assert.strictEqual(extractText(message), '[AC] LiveIGN » Possibly Scaffold', 'live results take priority');
assert.strictEqual(message.extra.find(part => part.text === 'Possibly Scaffold').color, 'yellow');
live = null;
saved = { realIGN: 'UpdatedIGN' };
assert.strictEqual(extractText(alert()), '[AC] UpdatedIGN » Scaffold', 'each alert reads the current saved identity');
saved = { realIGN: 'bad name' };
assert.strictEqual(extractText(alert()), '[AC] NickName » Scaffold', 'invalid replacements fall back to the observed name');
saved = null;
assert.strictEqual(extractText(alert()), '[AC] NickName » Scaffold', 'removed matches are not retained by alerts');
actorTeam = 'Red';
assert.strictEqual(alert(), null, 'teammate alerts remain hidden');
actorTeam = null;
assert.strictEqual(alert(), null, 'unknown teams remain hidden');
actorTeam = 'Blue';
assert.strictEqual(alert('confirmed', 'Self'), null, 'self alerts remain hidden');
console.log('Anticheat alert identity checks passed.');
