'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the connection-owned broadcaster without opening a proxy connection.
const source = fs.readFileSync(path.join(__dirname, '../../proxy.js'), 'utf8');
const start = source.indexOf('        function broadcastScaffoldFlag(');
const end = source.indexOf('        // One chat style', start);
assert(start !== -1 && end > start);
const sent = [];
let realName;
let party = true;
let active = true;
let ownTeam = 'Red';
let actorTeam = 'Blue';
const members = new Set();
const context = {
    anticheatPartyBroadcastEnabled: true,
    currentGamemode: 'BEDWARS', inReplayViewer: false,
    isAnticheatInGame: () => active,
    partyTracker: { isInParty: () => party, isTrackedMember: name => members.has(name.toLowerCase()) },
    isValidPlayerName: name => typeof name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(name),
    isOwnPlayerName: name => name.toLowerCase() === 'self',
    getAutoDenickResult: () => realName ? { realName } : null,
    findKnownDenickByNick: () => null,
    clientBedwarsTeamName: () => ownTeam,
    resolveBedwarsTeamName: () => actorTeam,
    isSameTeamAsClient: () => false,
    sendHypixelCommand: (command, options) => sent.push({ command, options })
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const flag = (name = 'NickName', tier = 'possible', cheat = 'Scaffold') => context.broadcastScaffoldFlag({ name, tier, cheat });
flag();
assert.equal(sent.pop().command, '/pc [AC] NickName flagged Scaffold');
context.anticheatPartyBroadcastEnabled = false;
flag();
assert.equal(sent.length, 0, 'Disabled party broadcasts send no command');
context.anticheatPartyBroadcastEnabled = true;
realName = 'RealIGN';
flag('NickName', 'confirmed');
assert.equal(sent.pop().command, '/pc [AC] NickName (RealIGN) flagged Scaffold (high confidence)');
context.getAutoDenickResult = () => null;
context.findKnownDenickByNick = () => ({ realIGN: 'SavedIGN' });
flag();
assert.equal(sent.pop().command, '/pc [AC] NickName (SavedIGN) flagged Scaffold');
members.add('savedign'); flag(); members.clear();
members.add('nickname'); flag(); members.clear();
actorTeam = 'Red'; flag();
actorTeam = null; flag();
actorTeam = 'Blue'; ownTeam = null; flag(); ownTeam = 'Red';
flag('Self'); flag('entity #4'); flag('NickName', 'possible', 'Autoblock');
party = false; flag(); party = true;
active = false; flag(); active = true;
context.inReplayViewer = true; flag(); context.inReplayViewer = false;
assert.equal(sent.length, 0, 'Teammates, unknown teams, self, invalid actors and non-live flags stay private');
context.currentGamemode = 'SKYWARS';
members.add('savedign'); flag();
assert.equal(sent.length, 0, 'Denicked party teammates stay private in SkyWars too');
members.clear(); flag();
assert.equal(sent.pop().command, '/pc [AC] NickName (SavedIGN) flagged Scaffold');
assert(source.includes('broadcastScaffoldFlag({ cheat, name, tier });'));
console.log('Anticheat party broadcast checks passed.');
