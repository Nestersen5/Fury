'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { createRequire } = require('module');
const { fixture } = require('./test_hypixel_api_coordinator');
const { buildTeamSummaryEntries, buildTeamSummaryPreviewEntries, MAX_PC_LENGTH } = require('../../src/overlay/shareTags');
const { extractText } = require('../../features/minecraft_chat');
const { createShareEchoRewriter } = require('../../src/overlay/shareEchoRewriter');
const include = new Set(['tagged', 'nicks', 'threats']);
const rows = [
    { name: 'CheaterA', team: 'RED', uTag: 'Blatant - scaffold', isNicked: true, isThreat: true, fkdr: 20 },
    { name: 'CheaterB', team: 'RED', uTag: 'Closet - scaffold, autoblock', isThreat: true, fkdr: 10 },
    { name: 'Nick', team: 'RED', isNicked: true, isThreat: true, fkdr: 8 },
    { name: 'Sweat', team: 'RED', isThreat: true, fkdr: 8.4 },
    { name: 'BlueA', team: 'BLUE', isNicked: true },
    { name: 'BlueB', team: 'BLUE', isNicked: true },
    { name: 'GreenA', team: 'GREEN', isThreat: true, fkdr: 6.5 },
    { name: 'GreenB', team: 'GREEN', isThreat: true, fkdr: 9.2 }
];
const expected = ['Red team has 2 cheaters (Scaffold, Auto Block), 1 nicked, 8 FKDR', 'Blue team has 2 nicked', 'Green team has 7 FKDR, 9 FKDR'];
const colored = buildTeamSummaryEntries(rows, include, true);
assert.deepStrictEqual(colored.map(entry => entry.line), expected);
assert.ok(colored.every(entry => extractText(entry.component) === entry.line));
assert.deepStrictEqual(colored[0].component.extra, [
    { text: 'Red team', color: 'red' },
    { text: ' has 2 cheaters (Scaffold, Auto Block), 1 nicked, 8 FKDR', color: 'white' }
]);
assert.ok(colored.every(entry => entry.component.extra.slice(1).every(node => node.color === 'white')), 'all content after the team name stays white');
const echo = createShareEchoRewriter({ getLocalUsername: () => 'Self' });
echo.register(colored[0].line, colored[0].component);
const serverEcho = { position: 0, message: JSON.stringify({ text: `§9Party §f> §b[MVP+] Self§f: ${colored[0].line}` }) };
const rewritten = JSON.parse(echo.rewrite(serverEcho));
assert.strictEqual(extractText(rewritten), `Party > [MVP+] Self: ${expected[0]}`);
assert.deepStrictEqual(rewritten.extra[1], colored[0].component, 'only our message body is recolored');
assert.strictEqual(echo.rewrite({ ...serverEcho, message: serverEcho.message.replace('Self', 'Friend') }), null, 'other players keep their original messages');
assert.deepStrictEqual(buildTeamSummaryEntries(rows).map(entry => entry.line), expected);
assert.deepStrictEqual(buildTeamSummaryEntries(rows).map(entry => entry.line), buildTeamSummaryPreviewEntries(8)[0].entries.map(entry => entry.line));
assert.deepStrictEqual(buildTeamSummaryEntries([...rows, ...rows.map(row => ({ ...row, name: row.name.toLowerCase() }))]).map(entry => entry.line), expected, 'each player counts once');
assert.deepStrictEqual(buildTeamSummaryEntries(rows, new Set(['nicks'])).map(entry => entry.line), ['Red team has 2 nicked', 'Blue team has 2 nicked']);
assert.deepStrictEqual(buildTeamSummaryEntries(rows, new Set()).map(entry => entry.line), []);
const otherTags = ['Caution', 'Legit', 'Sniper', 'Blacklisted', 'Unusual tag'].map((uTag, index) => ({ name: `Tag${index}`, team: 'BLUE', uTag, isThreat: true, fkdr: 9 }));
const otherLine = buildTeamSummaryEntries(otherTags)[0].line;
assert.strictEqual(otherLine, 'Blue team has 1 caution, 1 legit sniper, 1 sniper, 1 blacklisted, 1 tagged');
assert.ok(!otherLine.includes('cheater'), 'non-cheating tags never become cheaters');
assert.deepStrictEqual(buildTeamSummaryEntries([{ ...rows[0], lookupFailed: true }]), []);
assert.ok(buildTeamSummaryEntries([{ ...rows[3], team: null }])[0].line.includes('Sweat:'), 'unknown teams retain individual messages');
assert.ok(buildTeamSummaryEntries([{ ...rows[3], team: null }, rows[0]])[0].line.startsWith('Red team'), 'known teams keep priority over unknown players');
assert.strictEqual(buildTeamSummaryEntries([{ ...rows[0], uTag: 'Confirmed' }])[0].line, 'Red team has 1 cheater', 'no invented cheats or empty brackets');
const allCheats = 'scaffold doubleshifting autoblock lag range blink autoclicker esp fast place safewalk velocity nuking piercing';
const long = buildTeamSummaryEntries([
    { ...rows[0], uTag: `Blatant - ${allCheats}` },
    { ...rows[1], uTag: `Closet - ${allCheats}` },
    { ...rows[2], isNicked: false, isThreat: true, fkdr: 99999999 },
    { ...rows[3], fkdr: 99999999 }
])[0];
assert.ok(long.line.length + 4 <= MAX_PC_LENGTH && long.line.includes('2 cheaters') && long.line.includes('99999999 FKDR'));
assert.strictEqual(extractText(long.component), long.line);
assert.strictEqual(long.component.color, 'white');

const statRows = [
    { name: 'StarsOnly', team: 'RED', isThreat: true, starThreat: true, fkdrThreat: false, stars: 1200, fkdr: 6.7 },
    { name: 'FkdrOnly', team: 'BLUE', isThreat: true, starThreat: false, fkdrThreat: true, stars: 1200, fkdr: 6.7 },
    { name: 'BothStats', team: 'GREEN', isThreat: true, starThreat: true, fkdrThreat: true, stars: 1200, fkdr: 6.7 }
];
const statLines = ['Red team has 1200 stars', 'Blue team has 7 FKDR', 'Green team has 7 FKDR'];
assert.deepStrictEqual(buildTeamSummaryEntries(statRows).map(entry => entry.line), statLines);
const mixedStats = buildTeamSummaryEntries(statRows.map(row => ({ ...row, team: 'RED' })), include, true)[0];
assert.strictEqual(mixedStats.line, 'Red team has 1200 stars, 7 FKDR, 7 FKDR');
assert.strictEqual(extractText(mixedStats.component), mixedStats.line);
assert.strictEqual(buildTeamSummaryEntries([{ ...statRows[0], team: null }])[0].line, '[UNKNOWN] [1200✫] StarsOnly');

function harness(extra = {}) {
    const { clock } = fixture(), filename = require.resolve('../../src/overlay/shareTags'), module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: createRequire(filename), module, exports: module.exports, console, setTimeout: clock.setTimeout }, { filename });
    const messages = [], echoes = [], state = { shareTagsTeamSummary: true, shareTagsFancy: true, shareTagsColorLocal: true, shareTagsMonthlyFkdr: true,
        shareTagsIncludeTagged: true, shareTagsIncludeNicks: true, shareTagsIncludeThreats: true, ...extra };
    const b = module.exports.createShareTagsBroadcaster({ state, sendChat() {}, getHypixelClient: () => ({}), getLocalUsername: () => 'Self',
        isPartyMember: name => ['friend', 'realfriend'].includes(String(name).toLowerCase()),
        getDenickResult: name => name === 'HiddenFriend' ? { realName: 'RealFriend' } : null,
        fetchMonthlySession: () => assert.fail('team summaries do not fetch monthly stats'),
        fetchPlayerProfile: () => assert.fail('team summaries do not fetch extra profiles'),
        registerLocalEcho: (line, component) => echoes.push({ line, component }),
        sendHypixelCommand: async (message, options) => { if (options.shouldSend && !options.shouldSend()) return { sent: false }; messages.push({ message, at: clock.now }); return { sent: true }; }
    });
    return { b, state, clock, messages, echoes };
}

(async () => {
    const stats = harness({ lastScanResults: { at: Date.now(), gameMode: 'BEDWARS', results: statRows } });
    const statStream = stats.b.createStream({}, { gameMode: 'BEDWARS' });
    statRows.forEach(statStream.onRow);
    const statsDone = statStream.end();
    await stats.clock.until(2000); await statsDone;
    assert.deepStrictEqual(stats.messages.map(row => row.message), statLines.map(line => `/pc ${line}`));
    const statsManual = stats.b.broadcast({});
    await stats.clock.until(4000); await statsManual;
    assert.deepStrictEqual(stats.messages.slice(3).map(row => row.message), statLines.map(line => `/pc ${line}`));
    assert.ok(stats.echoes.every(entry => extractText(entry.component) === entry.line));

    const h = harness();
    const stream = h.b.createStream({}, { gameMode: 'BEDWARS' });
    rows.forEach(stream.onRow);
    await h.clock.until(10);
    assert.strictEqual(h.messages.length, 0, 'wait for team completion');
    stream.onTeam('BLUE', rows.filter(row => row.team === 'BLUE'));
    await h.clock.until(20);
    assert.strictEqual(h.messages.length, 1, 'a complete team sends while other teams are pending');
    stream.onTeam('RED', rows.filter(row => row.team === 'RED'));
    stream.onTeam('RED', rows.filter(row => row.team === 'RED'));
    stream.onTeam('GREEN', rows.filter(row => row.team === 'GREEN'));
    const done = stream.end();
    await h.clock.until(2000); await done;
    assert.deepStrictEqual(h.messages.map(row => row.message), [`/pc ${expected[1]}`, `/pc ${expected[0]}`, `/pc ${expected[2]}`]);
    for (let i = 1; i < h.messages.length; i++) assert.ok(h.messages[i].at - h.messages[i - 1].at >= 400);
    assert.ok(h.echoes.every(entry => entry.component.extra && extractText(entry.component) === entry.line));

    const uncolored = harness({ shareTagsColorLocal: false });
    const plainStream = uncolored.b.createStream({}, { gameMode: 'BEDWARS' });
    rows.forEach(plainStream.onRow);
    const plainDone = plainStream.end();
    await uncolored.clock.until(2000); await plainDone;
    assert.deepStrictEqual(uncolored.messages.map(row => row.message), expected.map(line => `/pc ${line}`), 'colors never enter the transmitted party message');
    assert.strictEqual(uncolored.echoes.length, 0, 'off does not arm local recoloring');
    assert.ok(uncolored.b.getPreview().every(entry => !entry.component.extra && entry.component.color === 'white'));
    uncolored.b.setColorLocal(true);
    assert.ok(uncolored.b.getPreview().every(entry => entry.component.extra));
    assert.ok(uncolored.b.getTeamSummaryPreview(8)[0].entries.every(entry => entry.component.extra), 'numbered test previews follow the shared setting');

    // Row-only callers flush completed input at end; self, party, failed rows
    // and party members known only through a denick never enter the summary.
    const filtered = harness();
    const filtering = filtered.b.createStream({}, { gameMode: 'BEDWARS' });
    for (const name of ['Self', 'Friend', 'HiddenFriend']) filtering.onRow({ ...rows[0], name });
    filtering.onRow({ ...rows[0], name: 'Failed', lookupFailed: true });
    filtering.onRow(rows[3]);
    const finished = filtering.end();
    await filtered.clock.until(2000); await finished;
    assert.deepStrictEqual(filtered.messages.map(row => row.message), ['/pc Red team has 8 FKDR']);

    const finalRows = harness(), finalStream = finalRows.b.createStream({}, { gameMode: 'BEDWARS' });
    finalStream.onRow(rows[0]);
    finalStream.onRow(rows[3]);
    finalStream.onTeam('RED', [{ ...rows[0], lookupFailed: true }, rows[3]]);
    const finalDone = finalStream.end();
    await finalRows.clock.until(1000); await finalDone;
    assert.deepStrictEqual(finalRows.messages.map(row => row.message), ['/pc Red team has 8 FKDR'], 'final team data overrides stale individual rows');

    // Manual sharing uses the same summary formatter and selected destination.
    const manual = harness({ shareTagsDestination: 'all', lastScanResults: { at: Date.now(), gameMode: 'BEDWARS', results: rows } });
    const broadcast = manual.b.broadcast({}, { includeSet: ['all'] });
    await manual.clock.until(2000); await broadcast;
    assert.strictEqual(manual.messages.length, 3);
    assert.ok(manual.echoes.every(entry => entry.component.extra), 'manual sharing uses local summary colors too');
    assert.ok(manual.messages.every(row => row.message.startsWith('/ac ') && !row.message.includes('MFKDR')));

    let active = true;
    const stale = harness(), cancelled = stale.b.createStream({}, { gameMode: 'BEDWARS', isStillActive: () => active });
    cancelled.onRow(rows[3]); active = false;
    const ended = cancelled.end();
    await stale.clock.until(1000); await ended;
    assert.strictEqual(stale.messages.length, 0, 'stale scan cannot flush summaries');

    const skywars = harness();
    const solo = skywars.b.createStream({}, { gameMode: 'SKYWARS' });
    solo.onRow({ name: 'SkyPlayer', team: null, isThreat: true, kdr: 5 });
    const skyDone = solo.end();
    await skywars.clock.until(1000); await skyDone;
    assert.ok(skywars.messages[0].message.includes('SkyPlayer') && skywars.messages[0].message.includes('KDR 5.00'), 'SkyWars retains individual messages');

    // Settings round-trip through the actual disk writer/bootstrap parser and
    // profile allowlist, while existing Fancy Share choices remain intact.
    const config = require('../../app_config'), original = config.paths.features;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-share-summary-'));
    try {
        config.paths.features = path.join(directory, 'features.json');
        assert.strictEqual(config.loadFeatureSettings().shareTagsTeamSummary, true, 'team summaries are the built-in default');
        config.saveFeatureSettings({ shareTagsTeamSummary: true, shareTagsFancy: true });
        config.saveFeatureSettings({});
        assert.strictEqual(config.loadFeatureSettings().shareTagsTeamSummary, true);
        assert.strictEqual(config.loadFeatureSettings().shareTagsFancy, true);
        const { createConfigLoader } = require('../../src/bootstrap/config');
        const loader = createConfigLoader({ loadFeatureSettings: config.loadFeatureSettings, state: {}, clampDodgeDelay: Number, normalizeTabStatsModeSetting: config.normalizeTabStatsModeSetting });
        assert.strictEqual(loader.parseFeatureConfig().shareTagsTeamSummary, true);
        config.saveFeatureSettings({ shareTagsTeamSummary: false });
        config.saveFeatureSettings({});
        assert.strictEqual(loader.parseFeatureConfig().shareTagsTeamSummary, false);
        const { filterPresetSettings } = require('../../src/profiles/profileStore');
        assert.strictEqual(filterPresetSettings({ shareTagsTeamSummary: true }).shareTagsTeamSummary, true);
    } finally { config.paths.features = original; fs.rmSync(directory, { recursive: true, force: true }); }
    h.b.setTeamSummary(false); assert.strictEqual(h.b.getSettings().teamSummary, false);
    h.b.setTeamSummary(true); assert.strictEqual(h.b.getSettings().teamSummary, true);
    console.log('Share team summary checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
