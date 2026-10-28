'use strict';
const assert = require('assert');
const { canAutoSaveTeammateNick } = require('../../src/denick/teammateAutoSave');
const { createPartyTracker } = require('../../src/net/session/partyTracking');
const valid = {
    enabled: true, singleMatch: { nick: 'NewNick', realName: 'Friend' }, sameContext: true,
    unresolved: [], allRankChecksSucceeded: true, disconnectedMembers: [],
    partyMembers: ['Friend', 'KnownFriend'], teammateNames: ['NewNick', 'KnownNick'],
    accountedParty: ['Friend', 'KnownFriend'], alreadyKnown: false, realNameAlreadyUsed: false, teammatesPresent: true
};
assert(canAutoSaveTeammateNick(valid), 'one unknown nick alongside an accounted known nick can save');
for (const change of [
    { enabled: false }, { singleMatch: null }, { sameContext: false },
    { unresolved: ['lookup failed'] }, { allRankChecksSucceeded: false },
    { disconnectedMembers: ['Friend'] }, { alreadyKnown: true }, { realNameAlreadyUsed: true }, { teammatesPresent: false },
    { accountedParty: ['Friend', null] }, { accountedParty: ['Friend', 'Friend'] },
    { teammateNames: ['NewNick'] }, { partyMembers: ['Friend', 'KnownFriend', 'MissingFriend'] },
    { accountedParty: ['Friend', 'RandomPlayer'] }
]) assert(!canAutoSaveTeammateNick({ ...valid, ...change }), JSON.stringify(change));
assert(canAutoSaveTeammateNick({ ...valid, accountedParty: ['FRIEND', 'knownfriend'] }));

const tracker = createPartyTracker({ stripFormatting: text => text, getSelfName: () => 'Self', requestPartyListCommand: () => {}, sendChat: () => {} });
const before = tracker.getStatusSnapshot().revision;
tracker.handleChatLine('Friend has disconnected, they have 5 minutes to rejoin before they are removed from the party.');
assert.deepStrictEqual(tracker.getStatusSnapshot().disconnectedMembers, ['friend']);
assert(tracker.getStatusSnapshot().revision > before);
tracker.handleChatLine('Friend has rejoined.');
assert.deepStrictEqual(tracker.getStatusSnapshot().disconnectedMembers, []);
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
const build = source.slice(source.indexOf('        async function buildPartyDenickReview()'), source.indexOf('        function confirmPartyDenickReview('));
const undo = source.slice(source.indexOf('        async function handlePartyDenickCommand('), source.indexOf('        const ENDER_DUST_REMINDER_TEST_SCENARIOS'));
const controller = source.slice(source.indexOf('        function handleDenickControllerCommand('), source.indexOf('        function handleTabStatsCommand('));
async function exercise({ rankFailure = false, changeParty = false } = {}) {
    const messages = [], saved = new Map(), undoEntries = new Map();
    let removed = 0;
    let persisted = 0;
    const snapshot = { revision: 1, initialized: true, inParty: true, uncertain: false, disconnectedMembers: [] };
    const context = {
        canAutoSaveTeammateNick, gameActive: true, currentGamemode: 'BEDWARS', gameSessionId: 1,
        autoSaveTeammateNicknames: true, partyDenickReview: null, teammateNickUndo: undoEntries, teammateNickUndoId: 0,
        getConfirmedPartyMemberNames: () => ['Friend', 'KnownFriend'], partyTracker: { getStatusSnapshot: () => ({ ...snapshot }) },
        nickKey: name => String(name).toLowerCase(), isValidPlayerName: Boolean, isOwnPlayerName: () => false,
        gameRoster: new Set(['NewNick', 'KnownNick']), isSameTeamAsClient: () => true, clientBedwarsTeamName: () => 'red',
        lobbyPlayers: new Map([['NewNick', {}], ['KnownNick', {}]]),
        applyKnownDenickFromHistory: () => {}, getAutoDenickResult: nick => nick === 'KnownNick' ? { realName: 'KnownFriend' } : saved.get(nick),
        getStatsProfileForRosterPlayer: async () => ({ data: { isNicked: true } }), markNickedPlayer: () => {}, getRealNameFromSkin: () => null,
        isPartyMemberVisibleInTab: () => false, getDenickAliasForRealName: () => null,
        isConfirmedNickCapablePartyMember: async name => { if (changeParty) snapshot.revision++; return rankFailure && name === 'KnownFriend' ? null : true; },
        partyDenickPermutations: values => [values],
        findKnownDenickByNick: nick => saved.get(nick), loadDenickHistoryStore: () => ({ byNick: new Map([...saved].map(([nick, entry]) => [nick.toLowerCase(), entry])) }),
        storeDenickResult: (nick, realName, method) => { saved.set(nick, { realName, method }); return true; },
        denickTracker: { mappingVersion: () => '1' }, client: {}, sendChat: (_, message) => messages.push(message),
        parseControllerToggle: value => value === 'on', saveFeatureConfig: () => persisted++, renderDenickController: () => {},
        sendPartyDenickReview: () => {}, announceKnownPregameDenickToParty: () => {},
        removeDenickMapping: (_, nick) => { saved.delete(nick); removed++; return { removed: true }; }
    };
    vm.createContext(context);
    vm.runInContext(`${build}\n${undo}\n${controller}`, context);
    await context.buildPartyDenickReview({ automatic: true });
    if (rankFailure || changeParty) {
        assert.strictEqual(saved.size, 0, 'failed checks or changed party cannot save');
        return;
    }
    assert.strictEqual(saved.get('NewNick').realName, 'Friend');
    assert(messages[0].extra[0].text.includes('Saved §fNewNick §8→ §fFriend'));
    assert.strictEqual(messages[0].extra[1].clickEvent.value, '/denick party undo 1');
    assert.strictEqual(messages.length, 1, 'Only the saved notice and Undo are shown');
    context.handleDenickControllerCommand(['denick', 'autoteammates', 'off']);
    assert.strictEqual(context.autoSaveTeammateNicknames, true);
    assert.strictEqual(persisted, 0, 'Legacy off commands cannot change the feature');
    const original = saved.get('NewNick');
    saved.set('NewNick', { realName: 'Correction', method: 'manual' });
    await context.handlePartyDenickCommand(['denick', 'party', 'undo', '1']);
    assert.strictEqual(removed, 0, 'Undo must preserve a later correction');
    saved.set('NewNick', original);
    await context.handlePartyDenickCommand(['denick', 'party', 'undo', '1']);
    assert.strictEqual(removed, 1);
    await context.handlePartyDenickCommand(['denick', 'party', 'undo', '1']);
    assert.strictEqual(removed, 1, 'Undo is single-use');
}
(async () => {
    await exercise();
    await exercise({ rankFailure: true });
    await exercise({ changeParty: true });
    console.log('Teammate nickname auto-save tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
