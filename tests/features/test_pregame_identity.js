'use strict';

const assert = require('assert');
const { createPregameIdentityLookup, shouldHidePregamePartyMember } = require('../../src/stats/pregameIdentity');
const { createStatsLookup } = require('../../src/stats/lookup');

const { makeFallbackPlayerProfile } = createStatsLookup({
    getPlayerData: async () => null,
    makeUrchinData: () => ({}), makePingData: value => value
});
const realProfile = (name, uuid = 'a'.repeat(32)) => ({ data: {
    player: { uuid, displayname: name, stats: { Bedwars: { final_kills_bedwars: 1200 } } },
    isNicked: false
} });

async function run() {
    const party = new Set(['partyfriend']);
    const mappings = new Map([
        ['friendlynick', { realIGN: 'PartyFriend' }],
        ['othernick', { realIGN: 'OtherPlayer' }]
    ]);
    const visibility = {
        isPartyMember: name => party.has(name.toLowerCase()),
        getKnownDenick: name => mappings.get(name.toLowerCase())
    };
    assert(shouldHidePregamePartyMember('PartyFriend', visibility), 'current party members are hidden by real name');
    assert(shouldHidePregamePartyMember('FriendlyNick', visibility), 'saved nicknames of current party members are hidden');
    assert(!shouldHidePregamePartyMember('OtherNick', visibility), 'saved identities outside the party keep their stats line');
    assert(!shouldHidePregamePartyMember('UnknownNick', visibility), 'unknown nicks remain visible as nicked');
    party.clear();
    assert(!shouldHidePregamePartyMember('FriendlyNick', visibility), 'leaving the party makes a saved player visible again');
    party.add('otherplayer');
    assert(shouldHidePregamePartyMember('OtherNick', visibility), 'party membership is evaluated at rendering time');

    let saved = null, detected = false, rosterUuid = 'a'.repeat(32);
    let nickResponse = realProfile('VisibleNick');
    let realResponse = realProfile('PartyFriend', 'b'.repeat(32));
    const nickRequests = [], realRequests = [];
    const lookup = createPregameIdentityLookup({
        lookupNick: async name => { nickRequests.push(name); return typeof nickResponse === 'function' ? nickResponse() : nickResponse; },
        lookupReal: async name => { realRequests.push(name); return realResponse; },
        getKnownDenick: () => saved,
        getRosterUuid: () => rosterUuid,
        isDetectedNick: () => detected,
        makeFallback: makeFallbackPlayerProfile
    });

    assert.strictEqual((await lookup('VisibleNick')).data.player.stats.Bedwars.final_kills_bedwars, 1200, 'normal players retain their stats');
    rosterUuid = 'c'.repeat(32);
    const collision = await lookup('VisibleNick');
    assert(collision.data.isNicked, 'a visible nick cannot borrow the stats of an unrelated account with the same name');
    assert.notStrictEqual(collision.data.player.stats.Bedwars.final_kills_bedwars, 1200);

    detected = true;
    const before = nickRequests.length;
    assert((await lookup('VisibleNick')).data.isNicked);
    assert.strictEqual(nickRequests.length, before, 'known unresolved nicks never trigger a misleading username lookup');

    saved = { realIGN: 'PartyFriend', nick: 'VisibleNick' };
    const resolved = await lookup('VisibleNick');
    assert.strictEqual(resolved.data.isNicked, false, 'saved identities are exempt from the unknown-nick label');
    assert.strictEqual(resolved.pregameRealName, 'PartyFriend');
    assert.strictEqual(resolved.pregameKnownDenick.realName, 'PartyFriend', 'Dodge receives the real party identity for its teammate exclusion');
    assert.strictEqual(resolved.data.player.uuid, 'b'.repeat(32));
    assert.deepStrictEqual(realRequests, ['PartyFriend']);
    assert.strictEqual(nickRequests.length, before);

    realResponse = { error: true, message: 'API unavailable' };
    const failedSaved = await lookup('VisibleNick');
    assert.strictEqual(failedSaved.pregameRealName, 'PartyFriend', 'a failed real-account lookup keeps the known identity');
    assert.strictEqual(failedSaved.data.lookupFailed, true);
    assert.strictEqual(failedSaved.data.isNicked, false, 'API failure does not turn a saved teammate back into an unknown nick');

    saved = null; detected = false; rosterUuid = null;
    nickResponse = makeFallbackPlayerProfile('VisibleNick', { lookupFailed: true, message: 'Rate limited' });
    assert.strictEqual((await lookup('VisibleNick')).data.isNicked, false, 'an API failure alone is not proof of a nick');
    nickResponse = makeFallbackPlayerProfile('VisibleNick', { isNicked: true });
    assert.strictEqual((await lookup('VisibleNick')).data.isNicked, true);

    realResponse = realProfile('PartyFriend');
    nickResponse = () => {
        saved = { realIGN: 'PartyFriend' };
        return realProfile('UnrelatedAccount');
    };
    assert.strictEqual((await lookup('VisibleNick')).pregameRealName, 'PartyFriend', 'a mapping added during lookup takes precedence before rendering');
    saved = null;
    nickResponse = () => { rosterUuid = 'c'.repeat(32); return realProfile('VisibleNick'); };
    assert.strictEqual((await lookup('VisibleNick')).data.isNicked, true, 'a tab UUID arriving during lookup is checked before rendering');
    console.log('Pregame identity tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
