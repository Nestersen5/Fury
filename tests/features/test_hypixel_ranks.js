'use strict';

// Rank resolution: every Hypixel rank the proxy renders, plus the two colour
// fields (rankPlusColor, monthlyRankColor) and the "who can /nick" gate that
// the party-denick variation pool is built from.

const assert = require('assert');
const {
    resolveHypixelRank,
    hypixelRankIdFromText,
    isNickCapableRankId,
    displayLooksNickCapable,
    getHypixelRankPrefix,
    getHypixelRankNameColor,
    getHypixelRankLabel,
    getRankedName
} = require('../../features/minecraft_chat.js');
const { getOverlayRankNameColor } = require('../../src/overlay/tags.js');

// --- YouTube rank --------------------------------------------------------

const youtuber = { displayname: 'No5Daemon', rank: 'YOUTUBER', newPackageRank: 'MVP_PLUS', rankPlusColor: 'AQUA' };
assert.strictEqual(
    getRankedName(youtuber),
    '§c[§fYOUTUBE§c] No5Daemon',
    'YouTube rank should render red brackets around a white wordmark'
);
assert.strictEqual(getHypixelRankNameColor(youtuber), '§c', 'A YouTube rank colours the name red');
assert.strictEqual(getOverlayRankNameColor(youtuber), '§c', 'The overlay should colour a YouTube rank red too');
assert.strictEqual(getHypixelRankLabel(youtuber), '[YOUTUBE]', 'The general-stats rank row should read [YOUTUBE]');
assert.strictEqual(resolveHypixelRank(youtuber).isYoutube, true);
assert.strictEqual(resolveHypixelRank(youtuber).canNick, true, 'A YouTube rank can /nick');
assert.strictEqual(
    resolveHypixelRank(youtuber).id,
    'YOUTUBER',
    'The YouTube rank must win over the donor rank the account also holds'
);

// --- Staff ranks ---------------------------------------------------------

const staff = [
    ['ADMIN', '§c[ADMIN]', '§c'],
    ['GAME_MASTER', '§2[GM]', '§2'],
    ['MODERATOR', '§2[MOD]', '§2'],
    ['HELPER', '§9[HELPER]', '§9'],
    ['JR_HELPER', '§9[JR HELPER]', '§9']
];
staff.forEach(([rank, prefix, color]) => {
    const player = { displayname: 'Aceify', rank };
    assert.strictEqual(getHypixelRankPrefix(player), prefix, `${rank} should render ${prefix}`);
    assert.strictEqual(getHypixelRankNameColor(player), color, `${rank} should colour the name ${color}`);
    assert.strictEqual(resolveHypixelRank(player).isStaff, true, `${rank} should be flagged as staff`);
    assert.strictEqual(resolveHypixelRank(player).canNick, true, `${rank} should be able to /nick`);
});

// The legacy `rank` field still holds donor values on old accounts. Reading
// those as staff would hand a plain VIP the ability to /nick.
['NORMAL', 'VIP', 'VIP_PLUS', 'MVP', 'MVP_PLUS'].forEach((rank) => {
    const resolved = resolveHypixelRank({ displayname: 'OldAccount', rank, newPackageRank: 'VIP' });
    assert.strictEqual(resolved.isStaff, false, `rank="${rank}" is a donor value, not staff`);
    assert.strictEqual(resolved.canNick, false, `rank="${rank}" must not grant /nick`);
    assert.strictEqual(resolved.id, 'VIP', `rank="${rank}" should fall through to the package rank`);
});

// --- MVP++ colour choice -------------------------------------------------

assert.strictEqual(
    getRankedName({ displayname: 'Esgrimidor', monthlyPackageRank: 'SUPERSTAR', rankPlusColor: 'AQUA' }),
    '§6[MVP§b++§6] Esgrimidor',
    'MVP++ defaults to gold with the chosen plus colour'
);
const aquaSuperstar = {
    displayname: 'AquaStar',
    monthlyPackageRank: 'SUPERSTAR',
    monthlyRankColor: 'AQUA',
    rankPlusColor: 'GOLD'
};
assert.strictEqual(
    getRankedName(aquaSuperstar),
    '§b[MVP§6++§b] AquaStar',
    'An MVP++ who picked AQUA renders the brackets and name in aqua'
);
assert.strictEqual(
    getOverlayRankNameColor(aquaSuperstar),
    '§b',
    'The overlay must follow monthlyRankColor, not assume gold'
);
assert.strictEqual(
    resolveHypixelRank(aquaSuperstar).canNick,
    true,
    'An aqua MVP++ is still MVP++ and can /nick'
);

// --- Donor ranks ---------------------------------------------------------

const donors = [
    [{ displayname: 'DemoPlayer_', newPackageRank: 'MVP_PLUS', rankPlusColor: 'GOLD' }, '§b[MVP§6+§b] DemoPlayer_'],
    [{ displayname: 'PlainMvp', newPackageRank: 'MVP' }, '§b[MVP] PlainMvp'],
    [{ displayname: 'VipPlus', newPackageRank: 'VIP_PLUS' }, '§a[VIP§6+§a] VipPlus'],
    [{ displayname: 'Vip', newPackageRank: 'VIP' }, '§a[VIP] Vip'],
    [{ displayname: 'Nobody' }, '§7Nobody']
];
donors.forEach(([player, expected]) => {
    assert.strictEqual(getRankedName(player), expected, `${player.displayname} should render ${expected}`);
    assert.strictEqual(resolveHypixelRank(player).canNick, false, `${player.displayname} cannot /nick`);
});
assert.strictEqual(getHypixelRankLabel({ displayname: 'Nobody' }), 'Default', 'A rankless player reads as Default');

// A custom prefix is the server's final word and is passed through verbatim.
assert.strictEqual(
    getRankedName({ displayname: 'Pig', prefix: '§d[PIG§b+++§d]' }),
    '§d[PIG§b+++§d] Pig',
    'A custom prefix should render exactly as Hypixel sent it'
);
assert.strictEqual(
    getHypixelRankNameColor({ displayname: 'Pig', prefix: '§d[PIG§b+++§d]' }),
    '§d',
    'A custom prefix colours the name with its leading colour code'
);
assert.strictEqual(
    resolveHypixelRank({ displayname: 'Yt', prefix: '§c[§fYOUTUBE§c]' }).canNick,
    true,
    'A YouTube rank delivered as a custom prefix still grants /nick'
);

// --- Classifying rendered text ------------------------------------------

assert.strictEqual(hypixelRankIdFromText('§c[§fYOUTUBE§c] No5Daemon'), 'YOUTUBER');
assert.strictEqual(hypixelRankIdFromText('[MVP++] Esgrimidor'), 'MVP_PLUS_PLUS');
assert.strictEqual(hypixelRankIdFromText('[MVP+] Someone'), 'MVP_PLUS');
assert.strictEqual(hypixelRankIdFromText('[VIP] Someone'), 'VIP');
assert.strictEqual(hypixelRankIdFromText('PlainName'), 'NONE');

// Only bracketed tags are classified, so a player's own name can never be
// mistaken for a rank and slip into the nick candidate pool.
assert.strictEqual(
    hypixelRankIdFromText('[VIP] YouTubeFan'),
    'VIP',
    'A name containing "YouTube" must not read as the YouTube rank'
);
assert.strictEqual(displayLooksNickCapable('[VIP] YouTubeFan'), false);
assert.strictEqual(displayLooksNickCapable('YouTubeFan'), false);
assert.strictEqual(displayLooksNickCapable('[YOUTUBE] No5Daemon'), true);
assert.strictEqual(displayLooksNickCapable('[MVP++] Esgrimidor'), true);
assert.strictEqual(displayLooksNickCapable('[ADMIN] Aceify'), true);
assert.strictEqual(displayLooksNickCapable('[MVP+] Someone'), false);
assert.strictEqual(displayLooksNickCapable(''), false);

assert.strictEqual(isNickCapableRankId('YOUTUBER'), true);
assert.strictEqual(isNickCapableRankId('MVP_PLUS_PLUS'), true);
assert.strictEqual(isNickCapableRankId('MVP_PLUS'), false);
assert.strictEqual(isNickCapableRankId(''), false);

// Missing/garbage input must not throw - these run on partial tab entries.
[undefined, null, {}, { displayname: '' }, { rank: 'SOMETHING_NEW' }].forEach((player) => {
    assert.doesNotThrow(() => resolveHypixelRank(player), 'resolveHypixelRank should tolerate partial players');
    assert.doesNotThrow(() => getRankedName(player), 'getRankedName should tolerate partial players');
});
assert.strictEqual(resolveHypixelRank({ rank: 'SOMETHING_NEW' }).id, 'NONE', 'An unknown rank falls back to none');

console.log('Hypixel rank tests passed.');
