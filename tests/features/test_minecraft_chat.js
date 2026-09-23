'use strict';

const assert = require('assert');
const {
    stripAnsi,
    getHypixelColor,
    extractText,
    extractFormattedText,
    getRankedName,
    legacyTextToSegments,
    normalizeLegacyJsonComponent,
    closestLegacyChatColor,
    setChatPrefixAccent,
    featurePrefixRange,
    bedwarsEventLabelRanges,
    applyBedwarsEventLabelAccent,
    applyBedwarsSidebarTeamColors,
    getBedwarsSidebarTeamStatus,
    rewriteBedwarsSidebarTeamStatusLine,
    rewriteBedwarsSidebarTeamStatusSuffix,
    sendChat,
    sendActionBar
} = require('../../features/minecraft_chat.js');

assert.strictEqual(stripAnsi('\x1B[31m\u00a7aGreen \\u00a7cRed'), 'Green Red', 'stripAnsi should remove ANSI and Minecraft color codes');
assert.strictEqual(stripAnsi(null), '', 'stripAnsi should ignore non-string values');

const component = {
    text: '\u00a7aHello ',
    extra: [
        { text: 'Player', color: 'gold' },
        {
            text: ' ',
            extra: [{ text: 'World', color: 'red' }]
        }
    ],
    with: [{ text: '!' }]
};

assert.strictEqual(extractText(component), 'Hello !Player World', 'extractText should flatten visible JSON text and strip formatting');
assert.strictEqual(
    extractFormattedText({ text: 'Hi ', color: 'green', extra: [{ text: 'there' }, { text: '!', color: 'red' }] }),
    '\u00a7aHi \u00a7athere\u00a7c!',
    'extractFormattedText should preserve inherited and explicit component colors'
);

assert.strictEqual(getHypixelColor('GOLD'), '\u00a76');
assert.strictEqual(getHypixelColor('unknown'), '\u00a7c');
assert.strictEqual(
    getRankedName({ displayname: 'DemoPlayer_', newPackageRank: 'MVP_PLUS', rankPlusColor: 'GOLD' }),
    '\u00a7b[MVP\u00a76+\u00a7b] DemoPlayer_',
    'getRankedName should format rank prefixes with plus colors'
);

assert.deepStrictEqual(
    legacyTextToSegments('\u00a7aGreen \u00a7lBold\u00a7r Plain'),
    [
        { color: 'green', text: 'Green ' },
        { color: 'green', bold: true, text: 'Bold' },
        { text: ' Plain' }
    ],
    'legacyTextToSegments should convert legacy colors and formatting to JSON styles'
);

const normalized = normalizeLegacyJsonComponent({
    text: '\u00a7cClick',
    clickEvent: { action: 'run_command', value: '/hello' },
    extra: [{ text: ' child', color: 'yellow' }]
});
assert.strictEqual(normalized.text, '');
assert.deepStrictEqual(normalized.extra[0].clickEvent, { action: 'run_command', value: '/hello' });
assert.strictEqual(normalized.extra[0].color, 'red');
assert.strictEqual(normalized.extra[1].color, 'yellow');

const writes = [];
const client = {
    write(name, payload) {
        writes.push({ name, payload });
    }
};
sendChat(client, '\u00a7aHello');
sendActionBar(client, { text: '\u00a7cBar' });

assert.strictEqual(writes[0].name, 'chat');
assert.strictEqual(writes[0].payload.position, 0);
assert.strictEqual(JSON.parse(writes[0].payload.message).extra[0].color, 'green');
assert.strictEqual(writes[1].payload.position, 2);
assert.strictEqual(JSON.parse(writes[1].payload.message).extra[0].color, 'red');
sendActionBar(client, '§6Looking for §eFours');
assert.deepStrictEqual(
    JSON.parse(writes[2].payload.message),
    { text: '§6Looking for §eFours' },
    '1.8 drops JSON colours on the action bar, so string colour codes stay inline'
);

assert.strictEqual(closestLegacyChatColor('#e5b35d').code, '6', 'the default Sun accent should map to Minecraft gold');
assert.strictEqual(closestLegacyChatColor('#16b8c8').code, '3', 'the Aqua launcher accent should map to Minecraft dark aqua');
assert.deepStrictEqual(
    featurePrefixRange('[Party Overview] Checking players'),
    { start: 0, end: 16, label: 'Party Overview' },
    'known bracketed feature labels should be detected as prefixes'
);
assert.deepStrictEqual(
    featurePrefixRange('Pregame » [19✫] Th4rny_Drag9n'),
    { start: 0, end: 9, label: 'Pregame' },
    'pregame stat lines should use the launcher accent prefix'
);
assert.strictEqual(featurePrefixRange('[MVP+] Player joined'), null, 'Minecraft rank prefixes must not be recolored');

setChatPrefixAccent('#16b8c8');
const accentWrites = [];
const accentClient = { write: (name, payload) => accentWrites.push({ name, payload }) };
sendChat(accentClient, '\u00a78[\u00a75\u00a7lParty Overview\u00a78] \u00a77Checking players');
sendChat(accentClient, '\u00a76\u00a7lFury \u00a78\u00bb \u00a7aReady');
sendChat(accentClient, '\u00a7b[MVP+] Player');

const partyPrefix = JSON.parse(accentWrites[0].payload.message).extra;
assert.strictEqual(partyPrefix[0].color, 'dark_aqua');
assert.strictEqual(partyPrefix[1].color, 'dark_aqua');
assert.strictEqual(partyPrefix[2].color, 'dark_aqua');
assert.strictEqual(partyPrefix.at(-1).color, 'gray', 'message body colors should remain semantic');

const furyPrefix = JSON.parse(accentWrites[1].payload.message).extra;
assert.strictEqual(furyPrefix[0].color, 'dark_aqua');
assert.strictEqual(furyPrefix[1].color, 'dark_aqua');
assert.strictEqual(furyPrefix.at(-1).color, 'green');

const rankPrefix = JSON.parse(accentWrites[2].payload.message).extra;
assert.strictEqual(rankPrefix[0].color, 'aqua', 'ordinary player rank colors should remain untouched');

assert.deepStrictEqual(
    bedwarsEventLabelRanges('TEAM ELIMINATED > Red Team has been eliminated!'),
    [{ start: 0, end: 17, label: 'TEAM ELIMINATED >' }],
    'team-elimination labels should be located without including the team result'
);

const teamEliminated = applyBedwarsEventLabelAccent({
    text: 'TEAM ELIMINATED > Red Team has been eliminated!',
    color: 'red'
});
assert.strictEqual(teamEliminated.extra[0].text, 'TEAM ELIMINATED >');
assert.strictEqual(teamEliminated.extra[0].color, 'dark_aqua');
assert.strictEqual(teamEliminated.extra[1].color, 'red', 'team-elimination message body should keep Hypixel coloring');

const bedDestroyed = applyBedwarsEventLabelAccent({
    text: '',
    extra: [
        { text: 'BED ', color: 'yellow', bold: true },
        { text: 'DESTRUCTION > Green Bed was destroyed by Player!', color: 'green' }
    ]
});
const bedLabelSegments = bedDestroyed.extra.filter(segment => ['BED ', 'DESTRUCTION >'].includes(segment.text));
assert.strictEqual(bedLabelSegments.length, 2, 'labels split across JSON components should remain intact');
assert(bedLabelSegments.every(segment => segment.color === 'dark_aqua'), 'every part of a split bed label should use the accent');
assert.strictEqual(bedDestroyed.extra.at(-1).color, 'green', 'bed-destruction message body should keep its color');

const finalKill = applyBedwarsEventLabelAccent({
    text: 'TIMEWISE got rekt by Naeku. FINAL KILL!',
    color: 'gray'
});
assert.strictEqual(finalKill.extra.at(-1).text, 'FINAL KILL!');
assert.strictEqual(finalKill.extra.at(-1).color, 'dark_aqua', 'alternate Hypixel kill messages should color the final-kill label');

const playerChat = { text: 'Naeku: FINAL KILL!', color: 'white' };
const accentedPlayerChat = applyBedwarsEventLabelAccent(playerChat);
assert.strictEqual(accentedPlayerChat.extra.at(-1).text, 'FINAL KILL!');
assert.strictEqual(accentedPlayerChat.extra.at(-1).color, 'dark_aqua', 'every exact label occurrence in a chat packet should be accented');

assert.deepStrictEqual(
    bedwarsEventLabelRanges('Notice: BED DESTRUCTION > then FINAL KILL!'),
    [
        { start: 8, end: 25, label: 'BED DESTRUCTION >' },
        { start: 31, end: 42, label: 'FINAL KILL!' }
    ],
    'all label occurrences should be found without interpreting the surrounding message'
);

const coloredSidebarTeams = applyBedwarsSidebarTeamColors('\u00a77Red: \u00a7a✓ \u00a77Blue: \u00a7c✗ \u00a7ePink');
assert.strictEqual(
    coloredSidebarTeams,
    '\u00a7cRed\u00a77: \u00a7a✓ \u00a79Blue\u00a77: \u00a7c✗ \u00a7dPink\u00a7e',
    'BedWars sidebar team names should use their own colors and restore the surrounding style'
);
assert.strictEqual(
    applyBedwarsSidebarTeamColors('Redstone and Bluer are not team names'),
    'Redstone and Bluer are not team names',
    'only complete BedWars team names should be recolored'
);

const shortenedSidebarTeam = rewriteBedwarsSidebarTeamStatusLine('\u00a7cR \u00a7fRed\u00a7f: \u00a7a');
assert.strictEqual(
    shortenedSidebarTeam,
    '\u00a7cRed\u00a7f: \u00a7a',
    'BedWars sidebar rows should drop the letter and color the full team name'
);
assert.strictEqual(shortenedSidebarTeam.length, 11, 'the shortened sidebar prefix must stay below the 16-character limit');
assert.strictEqual(
    rewriteBedwarsSidebarTeamStatusLine('\u00a7c\u00a7lR \u00a7r\u00a7c'),
    '\u00a7c\u00a7lR \u00a7r\u00a7c',
    'normal player-team prefixes must not be changed'
);
assert.deepStrictEqual(
    getBedwarsSidebarTeamStatus('\u00a79B \u00a7fBlue\u00a7f: \u00a7c'),
    { teamName: 'Blue', eliminated: true, statusInPrefix: false },
    'red status values should identify an eliminated BedWars sidebar team'
);
assert.strictEqual(
    rewriteBedwarsSidebarTeamStatusLine('\u00a79B \u00a7fBlue\u00a7f: \u00a7c'),
    '\u00a78\u00a7mBlue\u00a7r',
    'eliminated teams should render as dark-gray strikethrough names without a status prefix'
);
assert.deepStrictEqual(
    getBedwarsSidebarTeamStatus('W \u00a7fWhite\u00a7f: ', '\u00a7cX \u00a77YOU'),
    { teamName: 'White', eliminated: true, statusInPrefix: false },
    'the suffix color should identify eliminated rows when Hypixel splits the status from the prefix'
);
assert.strictEqual(
    rewriteBedwarsSidebarTeamStatusLine('W \u00a7fWhite\u00a7f: ', '\u00a7cX \u00a77YOU'),
    '\u00a78\u00a7mWhite\u00a7r',
    'suffix-based eliminated rows should still use a dark-gray strikethrough prefix'
);
assert.strictEqual(
    rewriteBedwarsSidebarTeamStatusSuffix('\u00a7cX \u00a77YOU', { teamName: 'White', eliminated: true }),
    ' \u00a77YOU',
    'eliminated rows should remove the X while preserving the own-team marker'
);
assert.strictEqual(
    rewriteBedwarsSidebarTeamStatusSuffix('\u00a7cX', { teamName: 'Red', eliminated: true }),
    '',
    'eliminated rows without an own-team marker should have an empty suffix'
);
const redStatusInPrefix = getBedwarsSidebarTeamStatus('\u00a7cR \u00a7fRed\u00a7f: \u00a7a1', '');
assert.deepStrictEqual(
    redStatusInPrefix,
    { teamName: 'Red', eliminated: false, statusInPrefix: true },
    'Red should be recognized when Hypixel fits its status character into the prefix field'
);
assert.strictEqual(
    rewriteBedwarsSidebarTeamStatusLine('\u00a7cR \u00a7fRed\u00a7f: \u00a7a1', ''),
    '\u00a7cRed\u00a7f: \u00a7a1',
    'active Red rows should drop the redundant team letter while retaining their status'
);
const eliminatedRedStatus = getBedwarsSidebarTeamStatus('\u00a7cR \u00a7fRed\u00a7f: \u00a7cX', ' \u00a77YOU');
assert.deepStrictEqual(
    eliminatedRedStatus,
    { teamName: 'Red', eliminated: true, statusInPrefix: true },
    'Red elimination should be detected when its X is stored in the prefix'
);
assert.strictEqual(
    rewriteBedwarsSidebarTeamStatusSuffix(' \u00a77YOU', eliminatedRedStatus),
    ' \u00a77YOU',
    'an own-team marker in the suffix must survive when Red\'s X was removed with the prefix'
);

console.log('Minecraft chat utility tests passed.');
