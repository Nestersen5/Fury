'use strict';

// Party-denick review invariants. buildPartyDenickReview lives inside the
// per-client closure in proxy.js and cannot be imported, so these are source
// assertions in the same style as test_party_overview.js.

const assert = require('assert');
const fs = require('fs');

const proxy = fs.readFileSync('proxy.js', 'utf8');

// --- Who is offered as a candidate --------------------------------------

assert(
    /function isConfirmedNickCapablePartyMember\(name\)[\s\S]{0,600}isNickCapableProfileData\(profile\.data\)/.test(proxy),
    'Party-denick candidates should be gated on whether the rank can /nick at all'
);
assert(
    /function isNickCapableProfileData\(profileData = \{\}\)[\s\S]{0,300}resolveHypixelRank\(player \|\| \{\}\)\.canNick/.test(proxy),
    'Nick capability should come from the shared rank resolver, not a rank-name string match'
);
assert(
    !/is not verified MVP\+\+/.test(proxy),
    'The review should no longer reject a candidate purely for not being MVP++'
);

// A YouTube or staff teammate can /nick, so they must be reachable as a
// candidate; gating on MVP++ alone made their nick permanently unattributable.
assert(
    /HYPIXEL_NICK_CAPABLE_RANKS/.test(proxy) || /resolveHypixelRank/.test(proxy),
    'proxy.js should consume the shared nick-capable rank set'
);

// --- Candidate pool narrowing -------------------------------------------

assert(
    /function isPartyMemberVisibleInTab\(realName\)[\s\S]{0,500}info\?\.inTab !== false/.test(proxy),
    'The review needs a tab-presence check for party members'
);
assert(
    /lockedRealNameKeys = new Set\(\[[\s\S]{0,900}isPartyMemberVisibleInTab\(realName\)/.test(proxy),
    'A party member visible in tab under their own name must be locked out of the candidate pool'
);
assert(
    /lockedRealNameKeys = new Set\(\[[\s\S]{0,1600}getDenickAliasForRealName\(realName\)/.test(proxy),
    'A party member whose nick was resolved elsewhere must stay locked out of the candidate pool'
);
assert(
    /candidateRealNames\.length === variationNicks\.length/.test(proxy),
    'Variations should only be offered when unaccounted members and unexplained nicks match exactly'
);
assert(
    /variationNicks\.length >= 1 && variationNicks\.length <= 3/.test(proxy),
    'The permutation fan-out must stay bounded'
);

// --- Chat colours --------------------------------------------------------

// Now that a rank can resolve to any of the 16 colours, the variation lines
// must not be handed the launcher's hyphenated CSS spelling: Minecraft's chat
// JSON only accepts "dark_green"/"light_purple" and renders anything else as
// plain white.
assert(
    /function legacyColorCodeToChatColor\(code\)[\s\S]{0,400}LEGACY_COLOR_NAMES\[key\]/.test(proxy),
    'Chat components need a legacy-code to chat-colour mapper'
);
assert(
    /function partyDenickRealNameColor\(realName\)[\s\S]{0,900}legacyColorCodeToChatColor\(getOverlayRankNameColor\(cachedPlayer\)\)/.test(proxy),
    'Party-denick name colours must use the chat-colour spelling, not the CSS one'
);
assert(
    !/function partyDenickRealNameColor\(realName\)[\s\S]{0,900}legacyColorCodeToName\(/.test(proxy),
    'Party-denick name colours must not use the hyphenated launcher CSS spelling'
);

// --- Review output ------------------------------------------------------

const sendReview = proxy.slice(
    proxy.indexOf('function sendPartyDenickReview(review)'),
    proxy.indexOf('function partyDenickPermutations(')
);
assert(sendReview, 'sendPartyDenickReview should be present');

const variationBlockStart = sendReview.indexOf('if (variations.length) {');
const unresolvedLine = sendReview.indexOf('§eNot saved:');
assert(variationBlockStart >= 0 && unresolvedLine > variationBlockStart, 'sanity: both branches present');
assert(
    !/sendChat\(client, '§r '\);\s*return;/.test(sendReview),
    'The variation branch must not return early - unresolved nicks were being dropped whenever variations were shown'
);
assert(
    /Only one assignment fits your party roster/.test(sendReview),
    'A single forced variation should say it is forced by the roster rather than reading as a verified match'
);
assert(
    /not skin-verified/.test(sendReview),
    'A forced variation should say it is unverified before the user saves it'
);

console.log('Party denick review tests passed.');
