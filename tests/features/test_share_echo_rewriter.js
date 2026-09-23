'use strict';

const assert = require('assert');
const { createShareEchoRewriter, sliceFormattedByVisible } = require('../../src/overlay/shareEchoRewriter.js');
const { formatLine, formatLineComponent, buildPreviewEntries } = require('../../src/overlay/shareTags.js');
const { extractText } = require('../../features/minecraft_chat.js');

// ---- formatLineComponent must reproduce formatLine's exact visible text ----

const includeAll = new Set(['tagged', 'nicks', 'threats']);

const taggedRow = {
    name: 'CheaterMan',
    team: 'RED',
    fkdr: 3.2,
    monthlyFkdr: 2.1,
    stars: 460,
    uTag: 'Blatant',
    urchinRaw: { rawTags: [{ tooltip: 'Blatant (Added by Tester 2026-01-01) - scaffold' }] }
};
const threatRow = { name: 'SweatLord', team: 'BLUE', fkdr: 5.5, stars: 300 };
const nickRow = {
    name: 'nickedGuy',
    team: 'GREEN',
    isNicked: true,
    denickResult: { realName: 'RealDude' },
    denickedAs: 'RealDude',
    fkdr: 4.0
};

for (const fancy of [false, true]) {
    for (const row of [taggedRow, threatRow, nickRow]) {
        const line = formatLine(row, 'BEDWARS', includeAll, fancy);
        const component = formatLineComponent(row, 'BEDWARS', includeAll, fancy);
        assert.strictEqual(
            extractText(component),
            line,
            `component text must equal formatLine (fancy=${fancy}, ${row.name}): got "${extractText(component)}" vs "${line}"`
        );
    }
}

// The tagged component should carry team color + a click-to-lookup on the name.
const taggedComponent = formatLineComponent(taggedRow, 'BEDWARS', includeAll, false);
const teamChip = taggedComponent.extra[0];
assert.strictEqual(teamChip.text, '[RED]');
assert.strictEqual(teamChip.color, 'red', 'RED team chip should be red');
const nameNode = taggedComponent.extra.find(n => n.text === 'CheaterMan');
assert.ok(nameNode && nameNode.clickEvent, 'name should be clickable');
assert.strictEqual(nameNode.clickEvent.value, '/urchin CheaterMan');
const urchinTagNode = taggedComponent.extra.find(n => n.text === 'Blatant Cheater');
assert.strictEqual(urchinTagNode?.color, 'light_purple', 'Urchin share tags should be pink');

const seraphTaggedRow = {
    name: 'SeraphTarget',
    team: 'AQUA',
    fkdr: 2.4,
    sTag: 'Blacklisted',
    seraphRaw: { report_type: 'Blacklisted', tooltip: 'Blacklisted: report details' }
};
const seraphTagComponent = formatLineComponent(seraphTaggedRow, 'BEDWARS', includeAll, false);
const seraphTagNode = seraphTagComponent.extra.find(n => n.text === 'Blacklisted');
assert.strictEqual(seraphTagNode?.color, 'dark_aqua', 'Seraph share tags should use the dark-aqua accent');

// ---- sliceFormattedByVisible cuts on a visible-char boundary ----

assert.strictEqual(sliceFormattedByVisible('§aHello§bWorld', 5), '§aHello');
assert.strictEqual(sliceFormattedByVisible('§aHello§bWorld', 7), '§aHello§bWo');
assert.strictEqual(sliceFormattedByVisible('plain', 3), 'pla');

// ---- rewrite: repaints our own party echo, leaves everything else alone ----

let clock = 1000;
const rewriter = createShareEchoRewriter({
    getLocalUsername: () => 'MeUser',
    ttlMs: 8000,
    now: () => clock
});

// Nothing registered yet -> no rewrite, hasPending false.
assert.strictEqual(rewriter.hasPending(), false);

const shareLine = formatLine(taggedRow, 'BEDWARS', includeAll, false);
const shareComponent = formatLineComponent(taggedRow, 'BEDWARS', includeAll, false);
rewriter.register(shareLine, shareComponent);
assert.strictEqual(rewriter.hasPending(), true);

// Our own party echo: "Party > [MVP+] MeUser: <shareLine>"
const ownEcho = {
    position: 0,
    message: JSON.stringify({
        text: '',
        extra: [
            { text: '§2Party §f> §b[MVP§6+§b] MeUser§f: ' },
            { text: shareLine }
        ]
    })
};
const rewritten = rewriter.rewrite(ownEcho);
assert.ok(rewritten, 'own share echo should be rewritten');
const rebuilt = JSON.parse(rewritten);
// Prefix preserved, share portion replaced by the colored component.
const rebuiltText = extractText(rebuilt);
assert.ok(rebuiltText.startsWith('Party > [MVP+] MeUser: '), `prefix kept: ${rebuiltText}`);
assert.ok(rebuiltText.endsWith(shareLine), 'share content text preserved');
assert.deepStrictEqual(rebuilt.extra[1], shareComponent, 'stored component spliced in');

// A teammate's identical line (their name in prefix) must NOT be rewritten.
const teammateEcho = {
    position: 0,
    message: JSON.stringify({ text: `Party > [VIP] OtherGuy: ${shareLine}` })
};
assert.strictEqual(rewriter.rewrite(teammateEcho), null, 'teammate echo left untouched');

// An unrelated chat line must NOT be rewritten.
const unrelated = { position: 0, message: JSON.stringify({ text: 'Party > [MVP+] MeUser: gg wp' }) };
assert.strictEqual(rewriter.rewrite(unrelated), null, 'normal chat left untouched');

// After the TTL expires, the entry no longer matches.
clock += 9000;
assert.strictEqual(rewriter.hasPending(), false, 'entries expire after ttl');
assert.strictEqual(rewriter.rewrite(ownEcho), null, 'expired echo not rewritten');

// clear() drops everything immediately.
clock = 20000;
rewriter.register(shareLine, shareComponent);
assert.strictEqual(rewriter.hasPending(), true);
rewriter.clear();
assert.strictEqual(rewriter.hasPending(), false);

// ---- buildPreviewEntries covers the scenarios and stays text-faithful ----

for (const fancy of [false, true]) {
    const entries = buildPreviewEntries(fancy);
    assert.ok(entries.length >= 8, 'preview should cover many scenarios');
    for (const entry of entries) {
        assert.ok(entry.note, 'each preview entry should carry a scenario note');
        assert.strictEqual(
            extractText(entry.component),
            entry.line,
            `preview component text must equal its line (fancy=${fancy}, ${entry.note})`
        );
    }
    // The scenario mix must include a tag, a nick, a caution and a threat.
    const text = entries.map(e => extractText(e.component)).join('\n');
    assert.ok(/Blatant Cheater/.test(text), 'preview includes a blatant cheater');
    assert.ok(/\[NICK\]|NICK/.test(text), 'preview includes a nicked player');
    assert.ok(/Caution/.test(text), 'preview includes a caution tag');
    assert.ok(/KDR: /.test(text), 'preview includes a SkyWars KDR threat');
}

console.log('test_share_echo_rewriter: all assertions passed');
