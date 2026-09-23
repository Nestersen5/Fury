'use strict';

const assert = require('assert');
const {
    resolveLfMode,
    findLfTrigger,
    formatLfActionBar,
    createLookingForTriggers
} = require('../../features/looking_for_triggers.js');
const { classifySocialOverlayText } = require('../../src/overlay/chat_overlay_annotation.js');

assert.strictEqual(resolveLfMode('Doubles').key, 'doubles');
assert.strictEqual(resolveLfMode('2s').key, 'doubles');
assert.strictEqual(resolveLfMode('4v4v4v4').key, 'fours');
assert.strictEqual(resolveLfMode('4v4').key, '4v4');
assert.strictEqual(resolveLfMode('solos'), null, 'Solos is not an /lf mode');

// Doubles
assert.strictEqual(findLfTrigger('1/2 lf 1 good', 'doubles'), '1/2');
assert.strictEqual(findLfTrigger('ONE OUT OF TWO need one', 'doubles'), 'one out of two');
assert.strictEqual(findLfTrigger('anyone  duos?', 'doubles'), 'duos');
assert.strictEqual(findLfTrigger('3/4 lf 1', 'doubles'), null, 'Fours ads must not fire in Doubles');
assert.strictEqual(findLfTrigger('won 11/20 games', 'doubles'), null, 'Fractions must match whole tokens');

// Threes
assert.strictEqual(findLfTrigger('2/3 lf1', 'threes'), '2/3');
assert.strictEqual(findLfTrigger('3v3v3v3 anyone', 'threes'), '3v3v3v3');
assert.strictEqual(findLfTrigger('1/2 lf 1', 'threes'), null);

// Fours
assert.strictEqual(findLfTrigger('3/4 lf 1 fkdr 5+', 'fours'), '3/4');
assert.strictEqual(findLfTrigger('two/four', 'fours'), 'two/four');
assert.strictEqual(findLfTrigger('4v4v4v4 need 1', 'fours'), '4v4v4v4');
assert.strictEqual(findLfTrigger('3/4 4v4 lf 1', 'fours'), null, '4v4 ads stay out of Fours');

// 4v4 requires "4v4" in the message
assert.strictEqual(findLfTrigger('3/4 lf 1', '4v4'), null, '4v4 needs the word 4v4');
assert.strictEqual(findLfTrigger('3/4 4v4 lf 1', '4v4'), '3/4');
assert.strictEqual(findLfTrigger('lf 4v4 party', '4v4'), '4v4');
assert.strictEqual(findLfTrigger('3/4 4v4v4v4 lf 1', '4v4'), null, '4v4v4v4 is not 4v4');

// Controller lifecycle
const lf = createLookingForTriggers();
assert.strictEqual(lf.isActive(), false);
assert.strictEqual(lf.match('3/4'), null, 'Nothing matches while off');
assert.deepStrictEqual(lf.add([resolveLfMode('fours')], 'L32A'), { added: ['Fours'], already: [] });
assert.strictEqual(lf.match('3/4 lf 1'), '3/4');
assert.strictEqual(lf.match('1/2 lf 1'), null, 'Doubles is not on yet');
assert.strictEqual(lf.isLobbyChange('L32A'), false);
assert.strictEqual(lf.isLobbyChange(null), false, 'A missing lobby id is not a lobby change');
assert.strictEqual(lf.isLobbyChange('L12B'), true);

// Several modes at once, in the same lobby
assert.deepStrictEqual(
    lf.add([resolveLfMode('doubles'), resolveLfMode('fours'), resolveLfMode('4v4')], 'L32A'),
    { added: ['Doubles', '4v4'], already: ['Fours'] }
);
assert.deepStrictEqual(lf.getState().labels, ['Doubles', 'Fours', '4v4']);
assert.strictEqual(lf.match('1/2 lf 1'), '1/2');
assert.strictEqual(lf.match('3/4 lf 1'), '3/4');
assert.strictEqual(lf.match('2/4 4v4 need 2'), '2/4', '4v4 still matches while Fours rejects it');
assert.strictEqual(lf.match('2/3 lf 1'), null, 'Threes is still off');
assert.deepStrictEqual(lf.matchDetails('3/4 lf 1'), { trigger: '3/4', modes: ['4s'] });
assert.deepStrictEqual(lf.matchDetails('2s or 4s lf 1'), { trigger: '2s', modes: ['2s', '4s'] });
assert.deepStrictEqual(lf.matchDetails('2/4 4v4 need 2'), { trigger: '2/4', modes: ['4v4'] });
assert.strictEqual(lf.matchDetails('2/3 lf 1'), null);

assert.deepStrictEqual(lf.remove([resolveLfMode('fours'), resolveLfMode('threes')]), ['Fours']);
assert.deepStrictEqual(lf.getState().labels, ['Doubles', '4v4']);
assert.strictEqual(lf.match('3/4 lf 1'), null, 'Fours was removed');
assert.deepStrictEqual(lf.stop().labels, ['Doubles', '4v4']);
assert.strictEqual(lf.isActive(), false);
assert.strictEqual(lf.isLobbyChange('L12B'), false);

lf.add([resolveLfMode('threes')], 'L32A');
assert.deepStrictEqual(lf.remove([resolveLfMode('threes')]), ['Threes']);
assert.strictEqual(lf.isActive(), false, 'Removing the last mode turns /lf off');

// The match sound plays once per player per lobby.
const alerts = createLookingForTriggers();
assert.strictEqual(alerts.shouldAlert('Someone'), false, 'No sound while /lf is off');
alerts.add([resolveLfMode('fours')], 'L32A');
assert.strictEqual(alerts.shouldAlert('Someone'), true);
assert.strictEqual(alerts.shouldAlert('someone'), false, 'Names are case-insensitive');
assert.strictEqual(alerts.shouldAlert('Other'), true);
alerts.stop();
alerts.add([resolveLfMode('threes')], 'L32A');
assert.strictEqual(alerts.shouldAlert('Someone'), false, 'Restarting in the same lobby keeps the list');
alerts.add([resolveLfMode('threes')], 'L12B');
assert.strictEqual(alerts.shouldAlert('Someone'), true, 'A new lobby resets the list');

// Only the mode names type out, hold, erase, and switch colours.
// "Fours" is 5 characters: type 0-4, hold 5-29, erase 30-32, empty 33-36.
const strip = text => text.replace(/§[0-9a-fk-or]/gi, '');
assert.strictEqual(formatLfActionBar(['Fours'], 0), '§6» §6Looking for: §eF§f_ §6«', 'Label and arrows are static, modes start with one letter');
assert.strictEqual(strip(formatLfActionBar(['Fours'], 1)), '» Looking for: Fo_ «');
assert.strictEqual(formatLfActionBar(['Fours'], 10), '§6» §6Looking for: §eFours §6«', 'Full line holds without the cursor');
assert.strictEqual(strip(formatLfActionBar(['Fours'], 30)), '» Looking for: Fou_ «', 'Erasing removes two letters a frame');
assert.strictEqual(strip(formatLfActionBar(['Fours'], 34)), '» Looking for: _ «', 'Label and arrows stay during the gap');
assert.strictEqual(formatLfActionBar(['Fours'], 37), '§3» §3Looking for: §bF§f_ §3«', 'Next cycle uses the next colours');
assert.strictEqual(strip(formatLfActionBar(['Doubles', 'Fours'], 20)), '» Looking for: Doubles, Fours «');
assert.ok(formatLfActionBar(['Doubles', 'Fours'], 20).includes('§7, §e'), 'Separators stay grey');

// A custom matcher replaces the saved trigger list in chat classification.
const matchFours = message => findLfTrigger(message, 'fours');
assert.deepStrictEqual(
    classifySocialOverlayText('[MVP+] Someone: 2/4 lf 2', { triggers: ['lf'], matchTrigger: matchFours }),
    { type: 'trigger', sender: 'Someone', trigger: '2/4' }
);
assert.strictEqual(
    classifySocialOverlayText('[MVP+] Someone: lf party', { triggers: ['lf'], matchTrigger: matchFours }),
    null,
    'Saved triggers are muted while a custom matcher is active'
);

console.log('looking for trigger tests passed');
