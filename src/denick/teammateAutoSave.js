'use strict';

const key = name => String(name || '').toLowerCase();

function canAutoSaveTeammateNick({ enabled, singleMatch, sameContext, unresolved,
    allRankChecksSucceeded, disconnectedMembers = [], partyMembers, teammateNames,
    accountedParty, alreadyKnown, realNameAlreadyUsed, teammatesPresent }) {
    if (!enabled || !singleMatch || !sameContext || unresolved.length
        || !allRankChecksSucceeded || !teammatesPresent || disconnectedMembers.length || alreadyKnown || realNameAlreadyUsed) return false;
    // Require the entire team to be this party, with every member accounted for
    // exactly once. A missing member plus a random teammate is unsafe to infer.
    const party = new Set(partyMembers.map(key));
    const accounted = accountedParty.map(key);
    return party.size === teammateNames.length && accounted.length === teammateNames.length
        && new Set(accounted).size === party.size && accounted.every(name => party.has(name));
}

module.exports = { canAutoSaveTeammateNick };
