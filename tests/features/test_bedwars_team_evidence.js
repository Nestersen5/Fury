'use strict';
const assert = require('assert');
const { TEAM_DEFS, teamFromPrefix, resolveTeamEvidence } = require('../../src/net/session/bedwarsTeamEvidence');

// Minimal packet fields from the September 10 /teamdebug reports. Numeric
// packet color was 15 even for Green/Red, so it is not team-color evidence.
for (const [raw, prefix, expected] of [
    ['Pink0', '§lW §r§f', 'White'], ['Pink1', '§lW §r§f', 'White'],
    ['Yellow0', '§a§lG §r§a', 'Green'], ['Yellow1', '§a§lG §r§a', 'Green'],
    ['Yellow2', '§a§lG §r§a', 'Green'], ['Blue10', '§c§lR §r§c', 'Red'],
    ['Yellow11', '§e§lY §r§e', 'Yellow'], ['Gray16', '§8§lS §r§8', 'Gray']
]) {
    const initial = resolveTeamEvidence(raw, prefix);
    assert.deepStrictEqual(initial, { name: expected, source: 'prefix' });
    for (const temporary of ['', ' ', '§7', '§f', '§8']) {
        assert.deepStrictEqual(resolveTeamEvidence(raw, temporary, initial), initial, `${raw}: temporary prefix must preserve ${expected}`);
    }
    assert.strictEqual(resolveTeamEvidence(raw, '§9B ', initial).name, 'Blue', 'A real new marker overrides remembered evidence');
}
for (const team of TEAM_DEFS) {
    assert.strictEqual(teamFromPrefix(`${team.color}${team.letter} `).name, team.name);
    assert.strictEqual(resolveTeamEvidence(`${team.name}12`, '').name, team.name);
}
assert.strictEqual(teamFromPrefix('G'), null, 'Uncolored G is ambiguous between Gray and Green');
assert.strictEqual(teamFromPrefix('§8G §r§f').name, 'Gray', 'Read the marker color, not the following name reset');
for (const prefix of ['§a[VIP] ', '§b[MVP+] ', 'Diamond II in §a', '§cRedstoneKid', '§aG Green: ', '§7']) {
    assert.strictEqual(resolveTeamEvidence('team_13', prefix), null, 'Sidebar/rank text cannot create a team');
}
assert.strictEqual(resolveTeamEvidence('Yellow2', '').name, 'Yellow', 'A recreated raw team does not inherit old Green evidence');
assert.strictEqual(resolveTeamEvidence('RedstoneKid', ''), null);
console.log('BedWars team evidence: report regressions, all colors, neutral updates and reset boundaries passed.');
