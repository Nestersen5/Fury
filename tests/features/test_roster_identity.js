'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { isRosterProfileMismatch } = require('../../src/stats/pregameIdentity');
const { createStatsLookup } = require('../../src/stats/lookup');
const { makeFallbackPlayerProfile } = createStatsLookup({
    getPlayerData: async () => null, makeUrchinData: () => ({}), makePingData: value => value
});
const uuid = 'abcdef0123456789abcdef0123456789';
const nickUuid = 'b'.repeat(32);
const account = { data: { player: { uuid, displayname: 'RealEye' }, isNicked: false }, fromCache: true };
const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
const lookupSource = source.slice(source.indexOf('        async function getStatsProfileForRosterPlayer('), source.indexOf('        function leaveBedwarsPregame('));
const restoreSource = source.slice(source.indexOf('        function reapplyCachedTabStatsForPlayer('), source.indexOf('        function reapplyTabStatsFromCache('));

assert(isRosterProfileMismatch(account, nickUuid));
assert(!isRosterProfileMismatch(account, 'ABCDEF01-2345-6789-ABCD-EF0123456789'), 'UUID formatting must not cause false nicks');
for (const tabUuid of [null, '', 'invalid']) assert(!isRosterProfileMismatch(account, tabUuid));
for (const profile of [null, {}, { error: true, ...account }, { data: { player: {} } },
    { data: { ...account.data, lookupFailed: true } }, { data: { ...account.data, isNicked: true } }]) {
    assert(!isRosterProfileMismatch(profile, nickUuid), 'Missing or failed identity data is not proof of a collision');
}

function fixture() {
    const info = { uuid: nickUuid, inTab: true };
    const rendered = [];
    let requests = 0, pregame = null, known = null, detected = false, settledAt = null;
    let beforeResponse = () => {};
    const context = {
        isRosterProfileMismatch, makeFallbackPlayerProfile,
        lobbyPlayers: new Map([['RealEye', info]]), getAutoDenickResult: () => known,
        isKnownNickedPlayer: () => detected, nickKey: name => name.toLowerCase(),
        settledNickVerifiedAt: { get: () => settledAt, set: (_, at) => { settledAt = at; } }, SETTLED_NICK_RECHECK_MS: 60000,
        getCachedOrPendingPregameChatProfile: async (_, onPrimaryProfile) => {
            if (pregame) onPrimaryProfile?.(pregame);
            return pregame;
        },
        getPlayerDataWithNickDetection: async (_, options) => {
            requests++;
            beforeResponse();
            options.onPrimaryProfile?.(account);
            return account;
        },
        isTabStatsActiveInGame: () => true, isDenickAliasDuplicate: () => false,
        gameRoster: new Set(['RealEye']), isEligibleForCurrentGameRoster: () => true,
        cachedTabStatsProfileForPlayer: () => ({ profile: account, denickResult: known }),
        buildTabStatsDisplay: (_, profile) => profile,
        currentGamemode: 'BEDWARS', writeTabDisplayName: (_, profile) => rendered.push(profile),
        tabStatsAppliedNames: new Set()
    };
    vm.createContext(context);
    vm.runInContext(`${lookupSource}\n${restoreSource}`, context);
    return { context, info, rendered, requests: () => requests,
        pregame: profile => { pregame = profile; }, known: mapping => { known = mapping; },
        detected: () => { detected = true; settledAt = Date.now(); }, beforeResponse: fn => { beforeResponse = fn; } };
}

(async () => {
    let f = fixture();
    const previews = [];
    assert((await f.context.getStatsProfileForRosterPlayer('RealEye', {
        lookup: { onPrimaryProfile: profile => previews.push(profile) }
    })).data.isNicked, 'A successful lookup for another UUID must stay nicked');
    assert.equal(previews.length, 1);
    assert(previews[0].data.isNicked, 'The early primary preview cannot leak the unrelated account');
    assert.equal(f.requests(), 1, 'Identity comparison does not add requests');
    assert.equal(account.data.isNicked, false, 'The shared real-account cache remains untouched');
    assert.equal(account.data.player.uuid, uuid);
    assert(f.context.reapplyCachedTabStatsForPlayer('RealEye'));
    assert(f.rendered[0].data.isNicked, 'Raw server display updates cannot restore unrelated cached stats');

    f = fixture(); f.pregame(account);
    assert((await f.context.getStatsProfileForRosterPlayer('RealEye')).data.isNicked, 'Pregame caches are checked against current tab identity');
    assert.equal(f.requests(), 0);

    f = fixture(); f.info.uuid = uuid;
    assert.equal(await f.context.getStatsProfileForRosterPlayer('RealEye'), account, 'Matching accounts keep their full stats');
    for (const absent of [undefined, 'invalid']) {
        f.info.uuid = absent;
        assert.equal(await f.context.getStatsProfileForRosterPlayer('RealEye'), account, 'Missing UUIDs must not invent nicks');
    }
    f.info.uuid = nickUuid; f.info.inTab = false;
    assert.equal(await f.context.getStatsProfileForRosterPlayer('RealEye'), account, 'Departed tab entries cannot prove a collision');

    f = fixture(); f.info.uuid = uuid;
    f.beforeResponse(() => { f.info.uuid = nickUuid; });
    assert((await f.context.getStatsProfileForRosterPlayer('RealEye')).data.isNicked, 'Tab evidence arriving during lookup is checked at completion');

    f = fixture(); f.known({ realName: 'FacebookMessages' });
    await f.context.getStatsProfileForRosterPlayer('RealEye');
    assert.equal(f.requests(), 0, 'Saved identities keep precedence over nickname lookups');
    f.context.reapplyCachedTabStatsForPlayer('RealEye');
    assert.equal(f.rendered[0], account, 'Saved-account stats intentionally have a different UUID from the nick');

    f = fixture(); f.detected();
    assert((await f.context.getStatsProfileForRosterPlayer('RealEye')).data.isNicked);
    assert.equal(f.requests(), 0, 'Settled nicks keep their existing recheck interval');
    console.log('Roster identity, primary previews and cached tab restoration tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
