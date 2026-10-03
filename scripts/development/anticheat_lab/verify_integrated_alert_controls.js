'use strict';
// Exercise the production announcer in an isolated VM, without a game client.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const root = path.resolve(__dirname, '../../..'), base = path.join(root, 'output/anticheat-lab/mod-real');
const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
const start = proxy.indexOf('        function announceAnticheatFlag('), end = proxy.indexOf('        const SCAFFOLD_GROUP_LABELS', start);
assert(start > 0 && end > start);
const captured = [], context = {
    currentGamemode: 'BEDWARS', anticheatPossibleAlertsEnabled: true, anticheatTeamAlertsEnabled: false,
    ownTeam: 'Red', actorTeam: 'Blue', ownName: 'LabObserver',
    isOwnPlayerName: name => name === context.ownName,
    clientBedwarsTeamName: () => context.ownTeam,
    resolveBedwarsTeamName: () => context.actorTeam,
    console: { log() {} }, client: {},
    chatController: { hover: lines => ({ value: lines }), text: (text, color, extra) => ({ text, color, ...extra }), line: parts => parts },
    sendChat: (_client, message) => captured.push(message)
};
vm.createContext(context);
vm.runInContext(proxy.slice(start, end), context);
const flag = { cheat: 'Jump Reset', name: 'LabActor', tier: 'possible', evidence: [
    { group: 'Jump timing', reason: 'Matching motion; manual timing can look the same', hard: false }
] };
function check(name, values, expected) {
    Object.assign(context, { anticheatPossibleAlertsEnabled: true, anticheatTeamAlertsEnabled: false,
        currentGamemode: 'BEDWARS', ownTeam: 'Red', actorTeam: 'Blue' }, values);
    captured.length = 0; context.announceAnticheatFlag(flag);
    assert.strictEqual(captured.length, expected, name);
}
check('opponent possible alert', {}, 1);
assert(captured[0].some(p => p.text === 'Possibly Jump Reset' && p.color === 'yellow' && !p.bold));
check('Possible alerts OFF', { anticheatPossibleAlertsEnabled: false }, 0);
check('same team quiet by default', { actorTeam: 'Red' }, 0);
check('unknown target team quiet by default', { actorTeam: null }, 0);
check('unknown own team quiet by default', { ownTeam: null }, 0);
check('explicit teammate opt-in', { actorTeam: 'Red', anticheatTeamAlertsEnabled: true }, 1);
check('own player always quiet', { ownName: 'LabActor', anticheatTeamAlertsEnabled: true }, 0);
context.ownName = 'LabObserver';
// Test the actual factory's owning gate with captured dependencies, not labels.
const factoryStart = proxy.indexOf('        const jumpResetDetector = createJumpResetDetector(');
const factoryEnd = proxy.indexOf('        const positionContext', factoryStart);
assert(factoryStart > 0 && factoryEnd > factoryStart);
let dependencies;
Object.assign(context, { createJumpResetDetector: deps => { dependencies = deps; return {}; },
    scaffoldDetector: { nameOf: () => 'LabActor' }, observerPacketClock: { now: () => 123 },
    anticheatEnabled: true, anticheatJumpResetEnabled: true, inReplayViewer: false,
    gameGate: true, isAnticheatInGame: () => context.gameGate });
vm.runInContext(proxy.slice(factoryStart, factoryEnd), context);
assert(dependencies.isEnabled());
for (const [key, value] of [['anticheatEnabled', false], ['anticheatJumpResetEnabled', false], ['gameGate', false], ['inReplayViewer', true]]) {
    const previous = context[key]; context[key] = value;
    assert.strictEqual(dependencies.isEnabled(), false, key); context[key] = previous;
}
const output = { generatedAt: new Date().toISOString(), passed: true,
    sourceSha256: crypto.createHash('sha256').update(proxy).digest('hex'),
    checks: ['Possible presentation', 'Possible filter', 'teammate filter', 'unknown-team filter', 'team opt-in', 'self filter',
        'master gate', 'individual gate', 'game gate', 'replay blocked'], scope: 'Production functions in isolated VM; no account/profile/network or injected chat.' };
fs.mkdirSync(path.join(base, 'integration'), { recursive: true });
fs.writeFileSync(path.join(base, 'integration/ALERT_CONTROL_CHECK.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
