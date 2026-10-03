'use strict';

const assert = require('assert');
const {
    DEFAULT_CHAT_ANNOTATION_TIMEOUT_MS,
    isLobbyChatAnnotationEligible,
    classifySocialOverlayText,
    mentionsOwnName,
    shortTagValue,
    compactOverlayTags,
    formatLobbyChatAnnotation,
    buildOverlayTagComponents,
    appendChatComponent,
    annotateChatPacket
} = require('../../src/overlay/chat_overlay_annotation.js');

assert.strictEqual(DEFAULT_CHAT_ANNOTATION_TIMEOUT_MS, 800);
assert.strictEqual(isLobbyChatAnnotationEligible({ stateLabel: 'LOBBY' }), true);
assert.strictEqual(isLobbyChatAnnotationEligible({ stateLabel: 'ACTIVE_GAME' }), false);
assert.strictEqual(isLobbyChatAnnotationEligible({ stateLabel: 'PREGAME_LOBBY' }), false);
assert.strictEqual(isLobbyChatAnnotationEligible({ stateLabel: 'LOBBY', position: 2 }), false);
assert.strictEqual(isLobbyChatAnnotationEligible({ stateLabel: 'LOBBY', annotationEnabled: false }), false);
assert.strictEqual(isLobbyChatAnnotationEligible({ stateLabel: 'LOBBY', socialEnabled: false }), false);
assert.strictEqual(isLobbyChatAnnotationEligible({ stateLabel: 'LOBBY', sourceEnabled: false }), false);
assert.deepStrictEqual(classifySocialOverlayText(
    '[MVP+] Alice: 3/4 anyone?',
    { triggers: ['3/4'], ownNames: ['MyPlayer'] }
), { type: 'trigger', sender: 'Alice', trigger: '3/4' });
assert.deepStrictEqual(classifySocialOverlayText(
    '[VIP] Bob: hey MyPlayer, join?',
    { triggers: [], ownNames: ['MyPlayer'] }
), { type: 'mention', sender: 'Bob' });
assert.deepStrictEqual(classifySocialOverlayText(
    '[VIP] Bob: nestersen',
    { triggers: [], ownNames: ['Nestersen'] }
), { type: 'mention', sender: 'Bob' });
assert.deepStrictEqual(classifySocialOverlayText(
    '[VIP] Bob: yoooNestersen??',
    { triggers: [], ownNames: ['Nestersen'] }
), { type: 'mention', sender: 'Bob' });
assert.strictEqual(
    mentionsOwnName('bracelets are cool', ['Ace']),
    false,
    'short names should not use loose substring matching'
);
assert.deepStrictEqual(classifySocialOverlayText(
    'From [MVP++] Carol: hello',
    { triggers: [], ownNames: ['MyPlayer'] }
), { type: 'dm', sender: 'Carol' });
assert.strictEqual(classifySocialOverlayText(
    '[MVP+] MyPlayer: 3/4 anyone?',
    { triggers: ['3/4'], ownNames: ['MyPlayer'] }
), null);
assert.strictEqual(classifySocialOverlayText(
    '[MVP+] Alice: regular lobby message',
    { triggers: ['3/4'], ownNames: ['MyPlayer'] }
), null);
{
    const { BEDWARS_PREGAME_IGNORED_SENDERS } = require('../../src/net/session/pregame_chat.js');
    const blockedSenderTokens = [...BEDWARS_PREGAME_IGNORED_SENDERS];
    [
        'Party Leader: [MVP+] MyPlayer ●',
        'Party Moderators: [VIP] MyPlayer ● 3/4',
        'Party Members: [MVP+] MyPlayer ●',
        'Leaders: MyPlayer',
        'Moderator: 3/4 MyPlayer',
        'Member: MyPlayer',
        'Reminder: MyPlayer 3/4',
        'Reminders: MyPlayer'
    ].forEach((line) => {
        assert.strictEqual(
            classifySocialOverlayText(line, { triggers: ['3/4'], ownNames: ['MyPlayer'], blockedSenderTokens }),
            null,
            `${line} must not add a system word as a player`
        );
    });
}

assert.strictEqual(shortTagValue('Legacy Cheater'), 'Cheater');
assert.strictEqual(shortTagValue('[Scaffold Report]'), 'Scaffold');
assert.strictEqual(shortTagValue('\uE000\uE001'), 'BC', 'legacy tag glyph payloads should become readable acronyms');
assert.deepStrictEqual(compactOverlayTags([
    { source: 'Urchin', title: 'Urchin Report', value: 'Scaffold Report' },
    { source: 'Seraph', title: 'Seraph Blacklist', value: 'Cheating' },
    { source: 'Urchin', title: 'Urchin API Status', value: 'API FAIL' }
]), ['U:Scaffold']);

const row = {
    stats: { fkdr: 4.821 },
    tags: [
        { source: 'Urchin', title: 'Urchin Report', value: 'Scaffold Report' },
        { source: 'Seraph', title: 'Seraph Blacklist', value: 'Cheating' }
    ]
};
assert.strictEqual(
    formatLobbyChatAnnotation(row, { fkdrColor: '§c' }),
    ' §8[§fFKDR: §c4.82 §8| §e[Scaffold Report]§8]'
);
assert.strictEqual(formatLobbyChatAnnotation({ lookupFailed: true, stats: { fkdr: 2 } }), '');
assert.strictEqual(formatLobbyChatAnnotation({ isNicked: true, stats: { fkdr: 2 } }), '');

const original = {
    text: '',
    extra: [
        { text: '[MVP+] ', color: 'aqua' },
        { text: 'Player: 3/4 anyone?' }
    ]
};
const appended = appendChatComponent(original, ' §8[§fFKDR: §c4.82§8]');
assert.strictEqual(appended.extra[0], original);
assert.strictEqual(appended.extra[1].text.includes('4.82'), true);

const packet = {
    message: JSON.stringify(original),
    position: 0
};
const hoverRow = {
    stats: { fkdr: 4.821 },
    tags: [
        {
            source: 'Urchin',
            title: 'Urchin Report',
            value: 'Scaffold Report',
            addedBy: 'Somebody',
            when: '2 days ago',
            reasons: 'legit scaffold, autoblock'
        },
        {
            source: 'Urchin',
            title: 'Urchin Report',
            value: 'Cheating',
            addedBy: 'Unknown',
            when: 'Unknown',
            reasons: 'reach, killaura'
        }
    ]
};
const annotated = annotateChatPacket(packet, hoverRow, { fkdrColor: '§c' });
assert.ok(annotated);
assert.strictEqual(annotated.position, 0);
const annotatedMsg = JSON.parse(annotated.message);
assert.strictEqual(annotatedMsg.extra[0].extra[1].text, 'Player: 3/4 anyone?');
const suffixExtras = annotatedMsg.extra[1].extra;
const tagComponents = suffixExtras.filter(node => node && node.hoverEvent);
assert.strictEqual(tagComponents.length, 2, 'both tags should have hover events');
assert.strictEqual(tagComponents[0].text, '[Scaffold Report · AB]');
assert.strictEqual(tagComponents[0].color, 'yellow', 'unclassified reports retain a readable warning color');
assert.strictEqual(tagComponents[0].hoverEvent.action, 'show_text');
assert.ok(tagComponents[0].hoverEvent.value.includes('Reason'));
assert.ok(tagComponents[0].hoverEvent.value.includes('legit scaffold'));
assert.ok(tagComponents[0].hoverEvent.value.includes('Somebody'));
assert.strictEqual(tagComponents[1].text, '[+1]');
assert.strictEqual(tagComponents[1].color, 'gray', 'additional classifications have a neutral counter');
assert.ok(tagComponents[1].hoverEvent.value.includes('reach, killaura'));
assert.ok(!tagComponents[1].hoverEvent.value.includes('Added by'), 'placeholder addedBy should be omitted');
assert.strictEqual(annotateChatPacket({ message: '{bad json' }, hoverRow), null);
assert.strictEqual(annotateChatPacket(packet, { lookupFailed: true, stats: { fkdr: 3 } }), null);

// Clickable tags: with a clickName, each tag chip runs the full lookup for
// its source and advertises the click in the hover text.
const clickableTags = buildOverlayTagComponents(hoverRow.tags, { clickName: 'DemoPlayer_' });
assert.strictEqual(clickableTags.length, 2);
assert.deepStrictEqual(clickableTags[0].clickEvent, { action: 'run_command', value: '/urchin DemoPlayer_' },
    'Urchin tag chips should click through to /urchin <player>');
assert.deepStrictEqual(clickableTags[1].clickEvent, { action: 'run_command', value: '/tagdetails DemoPlayer_' },
    'additional tags should open the detail panel with source links');
assert.ok(clickableTags[0].hoverEvent.value.includes('/urchin DemoPlayer_'), 'Hover should advertise the click action');
assert.ok(clickableTags[0].hoverEvent.value.includes('legit scaffold'), 'Hover must still carry the tag details');

// Without a clickName (or with an invalid one) the chips stay hover-only.
const hoverOnlyTags = buildOverlayTagComponents(hoverRow.tags);
assert.strictEqual(hoverOnlyTags[0].clickEvent, undefined);
assert.ok(hoverOnlyTags[0].hoverEvent, 'Hover details must remain without a click target');
const badNameTags = buildOverlayTagComponents(hoverRow.tags, { clickName: 'not a name; /op' });
assert.strictEqual(badNameTags[0].clickEvent, undefined, 'Invalid names must not produce click commands');

console.log('Chat overlay annotation tests passed.');

{
    const { groupTags, formatTagBadges, formatTabTags, tagDetailLines } = require('../../src/stats/tagDisplay');
    const reports = [
        { source: 'Urchin', value: 'Caution', reasons: 'Replays needed', addedBy: 'ReviewerA', when: '2026-09-16' },
        { source: 'Urchin', value: 'Blatant Cheater', reasons: 'Autoblock', addedBy: 'ReviewerB', when: '2026-09-15' },
        { source: 'Seraph', value: 'Blatant', reasons: 'Scaffold', addedBy: 'ReviewerC', when: '2026-09-14' },
        { source: 'Seraph', value: 'Sniper', reasons: 'Targeted queues' },
        { source: 'Urchin', title: 'Urchin API Status', value: 'FAIL' }
    ];
    const badges = buildOverlayTagComponents(reports, { clickName: 'DemoPlayer' });
    assert.deepStrictEqual(badges.map(badge => badge.text), ['[Blatant · AB]', '[+1]']);
    assert.strictEqual(badges[0].color, 'red');
    assert.strictEqual(badges[0].clickEvent.value, '/urchin DemoPlayer');
    const hover = badges[0].hoverEvent.value;
    for (const value of ['§b§lUrchin', '§7Reason: §fAutoblock', '§7Added by: §fReviewerB', '§7Date: §f2026-09-15']) {
        assert(hover.includes(value), `merged colored hover must retain ${value}`);
    }
    assert(badges[1].hoverEvent.value.includes('Replays needed'));
    assert(!badges[1].hoverEvent.value.includes('Targeted queues'));
    assert.deepStrictEqual(groupTags(reports).map(group => group.label), ['Blatant', 'Caution'], 'retired reports are ignored');
    assert.strictEqual(formatTagBadges(reports), '§c[Blatant · AB] §6[Caution]', 'chat badges expose classifications and reason labels');
    assert.strictEqual(formatTabTags(reports), '§d[Blatant] §d[Caution]', 'tab shows only Urchin-backed tags in pink when Urchin reports exist');
    assert.strictEqual(formatTabTags([reports[2], reports[3]]), '', 'tab ignores retired provider tags');
    assert.deepStrictEqual(groupTags(reports)[0].reports.map(report => report.source), ['Urchin'], 'retired reports cannot merge into Urchin tags');
    assert.deepStrictEqual(buildOverlayTagComponents([reports[3], reports[0]]).map(badge => badge.text), ['[Caution]'], 'retired tags do not produce badges');
    const lines = tagDetailLines('demoplayer');
    const buttons = lines.at(-1).extra;
    assert.deepStrictEqual(buttons.map(button => button.clickEvent.value), ['/urchin demoplayer']);
    assert(!lines.some(line => line.text.includes('ReviewerC')), 'detail panel excludes retired reports');
    assert.strictEqual(buildOverlayTagComponents([{ source: 'Urchin', value: 'Replays' }])[0].color, 'yellow');
    assert.strictEqual(buildOverlayTagComponents([{ source: 'Urchin', value: 'Legit Sniper' }])[0].color, 'green');
    assert.deepStrictEqual(buildOverlayTagComponents([]), []);
    assert.strictEqual(groupTags([reports[1], reports[1]])[0].reports.length, 1);
    assert([...hover.matchAll(/§([0-9a-f])/g)].every(match => ['b', '7', 'f'].includes(match[1])), 'hover uses only aqua, gray, and white');
    const commandLines = tagDetailLines('DemoPlayer', [reports[1]], { source: 'Urchin' });
    assert.deepStrictEqual(commandLines.map(line => line.text), [
        '§d§lUrchin §8» §f§lDemoPlayer §8· §71 report',
        '§8§m--------------------------------',
        '  §c§lBlatant Cheater · AB',
        '    §7Reason: §fAutoblock',
        '    §7Added by: §7ReviewerB §8· §72026-09-15',
        '§8§m--------------------------------'
    ], 'source commands use one heading and compact report blocks without duplicate source buttons');
    const confirmed = [{ source: 'Urchin', value: 'Confirmed' }];
    assert.strictEqual(buildOverlayTagComponents(confirmed)[0].text, '[C.Cheater]');
    assert.strictEqual(formatTabTags(confirmed), '§d[C.Cheater]');
}

// Reason summaries stay local to chat presentation; source reports and the
// classifications consumed by tab/overlay/dodge code remain unchanged.
{
    const { tagReasonLabels } = require('../../src/stats/tagReasonLabels');
    const { formatTagBadges, formatTabTags, tagDetailLines } = require('../../src/stats/tagDisplay');
    const report = reasons => ({ source: 'Urchin', value: 'Caution', reasons });
    const labels = reason => tagReasonLabels([report(reason)]);
    for (const [reason, expected] of [
        ['4q blatant', ['Blatant', '4Q']],
        ['scaff nuke 4q', ['Scaffold', 'Nuker']],
        ['scaffold, all the works (didnt nuke idk)', ['Scaffold']],
        ['autoblock? not today big dawg, Team > 4q', ['AB?']],
        ['legitscaff, 4q sniping', ['Scaffold', '4Q']],
        ['AB, lagrange, blink, timer, auto clutch', ['AB', 'Lag Abuse']],
        ['aim assist and velocity in op', ['Aim', 'Velocity']],
        ['playing with cheater', ['Cheat Party']],
        ['playing with a blatant cheater', ['Cheat Party']],
        ["q’ing with cheaters", ['Cheat Party']],
        ["q'ing with ccc", []],
        ['4q doubles', ['4Q']],
        ['blisted on other apis, ban from hypixel', ['History']],
        ['INSTANT crossmap', ['Crossmap']],
        ['fastmine', ['Fastmine']],
        ['hopping', ['Bhop']],
        ['auto clutch, timer', ['Timer', 'AutoClutch']],
        ['No reason listed', []],
        ['No specific cheats listed', []],
        ['No detailed tooltip available', []],
        ['Replays needed', []],
        ['sniping', []],
        ['§cScaff§r, §dnuke', ['Scaffold', 'Nuker']],
        ['not cheating, no scaffold or nuker', []],
        ["doesn't use autoblock", []],
        ['scaffold not confirmed', []],
        ['maybe lag switch', ['Lag Abuse?']],
        ['not sure if using scaffold', ['Scaffold?']],
        ['fights against bhoppers', []],
        ['his teammate uses scaffold', []],
        ['[SHOUT] [BLUE] Player: sniped by a blatant bhopper', []],
        ['"autoblock, scaffold" is what someone said', []],
        ['bought a punch bow and obsidian', []],
        ['annoying punch bow player', ['Annoying']],
        ['bow spamming and camping', ['Annoying']],
        ['deliberate stalling', ['Annoying']],
        ['not annoying, does not bow spam', []],
        ['ab, blink, this guy and his tm8 keep invis jump speed pot rushing can he not tell', ['Annoying', 'AB']],
        ['scaffold but no nuker', ['Scaffold']]
    ]) {
        assert.deepStrictEqual(labels(reason), expected, reason);
    }
    assert.deepStrictEqual(tagReasonLabels([{ ...report('annoying'), source: 'Seraph' }]), []);
    assert.deepStrictEqual(tagReasonLabels([{ ...report('scaffold'), source: '' }]), []);
    assert.deepStrictEqual(tagReasonLabels([{ ...report('scaffold'), title: 'Urchin API Status' }]), []);
    assert.deepStrictEqual(tagReasonLabels([report('AB?'), report('autoblock')]), ['AB']);
    assert.deepStrictEqual(tagReasonLabels([report('autoblock'), report('AB?')]), ['AB']);
    assert.deepStrictEqual(tagReasonLabels([report('Blatant autoblock')], 'Blatant'), ['AB']);

    const reports = Object.freeze([
        Object.freeze({ ...report('annoying punch bow player'), addedBy: 'Reviewer', when: '2026-10-03' }),
        Object.freeze(report('playing with cheater')),
        Object.freeze({ source: 'Urchin', value: 'Replays', reasons: 'No reason listed' })
    ]);
    const before = JSON.stringify(reports);
    const components = buildOverlayTagComponents(reports, { clickName: 'LabelPlayer' });
    assert.deepStrictEqual(components.map(node => node.text), ['[Caution · Annoying · Cheat Party]', '[+1]']);
    assert.strictEqual(components[0].color, 'gold');
    assert.strictEqual(components[0].clickEvent.value, '/urchin LabelPlayer');
    assert.strictEqual(components[1].clickEvent.value, '/tagdetails LabelPlayer');
    for (const text of ['annoying punch bow player', 'playing with cheater', 'Reviewer', '2026-10-03']) {
        assert(components[0].hoverEvent.value.includes(text), `full hover retains ${text}`);
    }
    assert.strictEqual(formatTagBadges(reports), '§6[Caution · Annoying · Cheat Party] §e[Replays]');
    assert.strictEqual(formatTabTags(reports), '§d[Caution] §d[Replays]');
    const cachedDetails = tagDetailLines('labelplayer');
    assert(cachedDetails.some(line => line.text === '  §6§lCaution · Annoying §8· §7Urchin'));
    assert(cachedDetails.some(line => line.text === '  §6§lCaution · Cheat Party §8· §7Urchin'));
    assert(cachedDetails.some(line => line.text.includes('annoying punch bow player')));
    assert.deepStrictEqual(tagDetailLines('labelplayer', reports), cachedDetails);
    assert.strictEqual(JSON.stringify(reports), before, 'summaries never mutate provider data');
}

console.log('Urchin reason label tests passed.');
