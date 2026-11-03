'use strict';

const assert = require('assert');
const { createShareEchoRewriter, sliceFormattedByVisible } = require('../../src/overlay/shareEchoRewriter.js');
const { formatLine, formatLineComponent, buildPreviewEntries, buildTeamSummaryPreviewEntries, createShareTagsBroadcaster, createSharePreviewPlayer, SEND_INTERVAL_MS, MAX_PC_LENGTH } = require('../../src/overlay/shareTags.js');
const { extractText, sendChat } = require('../../features/minecraft_chat.js');

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
assert.strictEqual(seraphTagNode, undefined, 'retired provider tags are not shared');

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

// Proposed summaries cover each total once, with no names or zero categories.
const scenarios = buildTeamSummaryPreviewEntries();
assert.deepStrictEqual(scenarios.map(scenario => scenario.playerCount), [1, 2, 3, 4, 5, 6, 7, 8]);
for (const scenario of scenarios) {
    const counts = scenario.entries.map(entry => {
        assert.strictEqual(extractText(entry.component), entry.line);
        assert.strictEqual(entry.component.color, 'white', 'summary text is plain white');
        assert.ok(!entry.component.extra && !/§/.test(entry.component.text), 'no team or category colors');
        const packets = [];
        sendChat({ write: (name, data) => packets.push({ name, data }) }, entry.component);
        assert.strictEqual(packets.length, 1, 'the production chat sender accepts each summary');
        assert.strictEqual(packets[0].name, 'chat');
        assert.strictEqual(packets[0].data.position, 0);
        assert.strictEqual(extractText(JSON.parse(packets[0].data.message)), entry.line);
        assert.ok(entry.line.length + '/pc '.length <= MAX_PC_LENGTH);
        assert.ok(!/\b0 (?:cheaters?|nicked)\b/.test(entry.line), 'zero categories stay hidden');
        assert.ok(!/\bthreats?\b/i.test(entry.line), 'FKDR replaces the threat label');
        assert.ok(!/\d+\.\d+/.test(entry.line), 'summary FKDRs have no decimal digits');
        const taggedAndNicked = [...entry.line.matchAll(/\b(\d+) (?:cheaters?|nicked)\b/g)].reduce((sum, match) => sum + Number(match[1]), 0);
        return taggedAndNicked + [...entry.line.matchAll(/\b\d+ FKDR\b/g)].length;
    });
    assert.strictEqual(counts.reduce((sum, count) => sum + count, 0), scenario.playerCount);
    assert.ok(counts.every(count => count <= 4), 'each team fits four players');
    assert.deepStrictEqual(buildTeamSummaryPreviewEntries(scenario.playerCount), [scenario]);
}
assert.deepStrictEqual(scenarios[7].entries.map(entry => entry.line), [
    'Red team has 2 cheaters (Scaffold, Auto Block), 1 nicked, 8 FKDR',
    'Blue team has 2 nicked',
    'Green team has 7 FKDR, 9 FKDR'
]);
assert.strictEqual(scenarios[0].entries[0].line, 'Red team has 1 cheater (Scaffold)');
assert.strictEqual(scenarios[1].entries[0].line, 'Red team has 2 cheaters (Scaffold, Auto Block)', 'shared cheats are listed once per team');
assert.ok(scenarios[7].entries.slice(1).every(entry => !/[()]/.test(entry.line)), 'teams without cheaters have no cheat brackets');
for (const invalid of [0, 9, -1, 1.5, NaN, '8']) assert.deepStrictEqual(buildTeamSummaryPreviewEntries(invalid), []);

// Execute the actual proxy preview branch. Network, API and persistence calls
// fail the check, and neither real scan data nor sharing settings may change.
{
    const fs = require('fs'), vm = require('vm');
    const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
    const branch = source.indexOf("} else if (sub === 'preview' || sub === 'test' || sub === 'demo') {");
    const start = source.indexOf("                    if (arg2 === 'teams'", branch);
    const end = source.indexOf("                } else if (sub === 'dest'", start);
    assert.ok(branch >= 0 && start > branch && end > start);
    const state = { shareTagsDestination: 'all', shareTagsColorLocal: false,
        lastScanResults: { results: [{ name: 'RealPlayer', team: 'RED', isNicked: true }] } };
    const before = JSON.stringify(state);
    const forbidden = () => assert.fail('local previews must not send commands, fetch data or save');
    const broadcaster = createShareTagsBroadcaster({ state, sendChat: forbidden,
        getHypixelClient: forbidden, getLocalUsername: forbidden, saveFeatureConfig: forbidden,
        sendHypixelCommand: forbidden, fetchMonthlySession: forbidden, fetchPlayerProfile: forbidden });
    const messages = [];
    const delivered = [];
    const timers = new Map();
    let now = 0, nextTimer = 0;
    const localSend = message => { messages.push(message); delivered.push({ at: now, text: extractText(message) }); };
    const sharePreviewPlayer = createSharePreviewPlayer({ sendChat: localSend,
        setTimeoutImpl: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeoutImpl: id => timers.delete(id) });
    const advance = ms => {
        const target = now + ms;
        while (timers.size) {
            const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (timer.at > target) break;
            now = timer.at;
            timers.delete(id);
            timer.callback();
        }
        now = target;
    };
    let rankedDisplay = '§b[MVP§c+§b] §bTester';
    const handle = vm.runInNewContext(`(function(args) {
        const sub = args[1].toLowerCase(), arg2 = (args[2] || '').toLowerCase();
        ${source.slice(start, end)}
    })`, { shareTagsBroadcaster: broadcaster, sharePreviewPlayer, client: { username: 'Tester' },
        resolveRankedPlayer: name => { assert.strictEqual(name, 'Tester'); return { display: rankedDisplay }; },
        sendChat: (_client, message) => localSend(message) });
    const run = args => { handle(args); advance(20000); };
    assert.strictEqual(SEND_INTERVAL_MS, 400, 'preview uses the actual Share interval');
    handle(['/share', 'test', '8']);
    assert.strictEqual(delivered.filter(message => message.text.startsWith('Party >')).length, 1, 'first summary arrives immediately');
    advance(399);
    assert.strictEqual(delivered.filter(message => message.text.startsWith('Party >')).length, 1, 'no early second summary');
    advance(1);
    assert.strictEqual(delivered.filter(message => message.text.startsWith('Party >')).length, 2);
    advance(400);
    assert.deepStrictEqual(delivered.filter(message => message.text.startsWith('Party >')).map(message => message.at), [0, 400, 800]);
    assert.strictEqual(timers.size, 0, 'no trailing timer after the last message');

    messages.length = 0;
    handle(['/share', 'test', '8']);
    handle(['/share', 'test', '1']);
    advance(1000);
    assert.strictEqual(messages.filter(message => typeof message === 'object').length, 2, 'a new preview cancels older pending lines');
    handle(['/share', 'test', '8']);
    sharePreviewPlayer.stop();
    const stoppedLength = messages.length;
    advance(1000);
    assert.strictEqual(messages.length, stoppedLength, 'connection cleanup cancels pending preview lines');
    assert.strictEqual(timers.size, 0);
    assert.ok(/function clearConnectionTimers\(\)\s*\{\s*sharePreviewPlayer\.stop\(\)/.test(source), 'disconnect and shutdown stop the preview');
    for (let count = 1; count <= 8; count++) {
        messages.length = 0;
        run(['/share', 'test', String(count)]);
        const lines = messages.filter(message => typeof message === 'object').map(extractText);
        assert.deepStrictEqual(lines, scenarios[count - 1].entries.map(entry => `Party > [MVP+] Tester: ${entry.line}`));
        assert.ok(messages.some(message => extractText(message).includes(`${count} flagged player`)));
    }
    for (const args of [['/share', 'preview', 'teams'], ['/share', 'test', 'all']]) {
        messages.length = 0;
        run(args);
        assert.strictEqual(messages.filter(message => typeof message === 'object').length, scenarios.reduce((sum, scenario) => sum + scenario.entries.length, 0));
    }
    for (const args of [['/share', 'test', '0'], ['/share', 'test', '9'], ['/share', 'test', '2.5'], ['/share', 'test', 'bad'], ['/share', 'test', '8', 'extra'], ['/share', 'preview', 'teams', '9']]) {
        messages.length = 0;
        run(args);
        assert.strictEqual(messages.length, 1);
        assert.ok(extractText(messages[0]).includes('Usage:'));
    }
    messages.length = 0;
    run(['/share', 'preview']);
    assert.ok(messages.some(message => extractText(message).includes('Names are clickable')), 'original preview still works');
    assert.ok(messages.some(message => extractText(message).startsWith('[MVP+] Tester: ')), 'original preview uses the actual ranked name too');
    for (const display of ['§7Tester', null]) {
        rankedDisplay = display;
        messages.length = 0;
        run(['/share', 'test', '1']);
        assert.ok(messages.some(message => extractText(message) === 'Party > Tester: Red team has 1 cheater (Scaffold)'), 'unranked and unknown ranks keep the real username');
    }
    assert.strictEqual(JSON.stringify(state), before);
}

console.log('test_share_echo_rewriter: all assertions passed');
