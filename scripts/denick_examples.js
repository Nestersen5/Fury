'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripAnsi } = require('../features/minecraft_chat');
const { scenarios } = require('./test_support/denick_scenarios');
const { flush, deferred, player, lookupHarness, harness } = require('./test_support/auto_stats_denick');

const plain = value => JSON.parse(JSON.stringify(value));

async function runScenario(scenario, mode) {
    const profiles = Object.fromEntries(scenario.players.map(person => {
        const profile = player(person.finals, person.beds);
        profile.data.player.displayname = person.name;
        return [person.name.toLowerCase(), person.name === scenario.profileError
            ? { error: true, errorType: 'hypixel_rate_limited' } : profile];
    }));
    const names = scenario.players.map(person => person.name);
    const lookup = lookupHarness({ profiles, lists: scenario.lists || { finals: names, beds: names }, response: scenario.response });
    const gate = deferred(), records = [];
    const h = harness({ realAnnouncements: true, profileLookup: async name => profiles[name.toLowerCase()],
        find: async (targets, options) => {
            const index = records.length;
            records.push({ targets: plain(targets), messageStart: h.messages.length });
            if (scenario.pendingFirst && index === 0) await gate.promise;
            const profileStart = lookup.verified.length, discoveryStart = lookup.requests.length, events = [];
            const result = await lookup.find(targets, { ...options, onTrace: event => events.push(event) });
            Object.assign(records[index], { result: plain(result), events, checked: lookup.verified.slice(profileStart).map(row => row.name),
                discoveryRequests: lookup.requests.length - discoveryStart });
            return result;
        } });
    h.context.markNickedPlayer('TestNick');
    h.context.gameRoster.add('TestNick');
    const commands = [], pendingCommands = [];
    for (const event of scenario.events) {
        if (event.waitMs) await h.advance(event.waitMs);
        if (event.reset) {
            assert.equal(mode, 'test');
            commands.push('/denick test reset');
            await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'reset']);
            continue;
        }
        const tokens = Object.entries(event.counts).flatMap(([stat, count]) => [stat, String(count)]);
        commands.push(`/denick test ${tokens.join(' ')}`);
        if (mode === 'test') {
            const command = h.context.handleAutoDenickTestCommand(['/denick', 'test', ...tokens]);
            if (scenario.pendingFirst) { pendingCommands.push(command); await flush(); }
            else await command;
        } else {
            for (const [stat, count] of Object.entries(event.counts)) {
                h.context.observeAutoDenickChat(stat === 'finals'
                    ? `Victim was TestNick's final #${count}. FINAL KILL!`
                    : `BED DESTRUCTION > Red Bed was bed #${count} destroyed by TestNick!`);
                await flush();
            }
        }
    }
    gate.resolve();
    await Promise.all(pendingCommands);
    await flush();

    const last = records.at(-1);
    assert(last?.result && !last.result.cancelled, 'the last search must finish');
    const messages = h.messages.map(stripAnsi);
    const finalMessages = messages.slice(last.messageStart);
    const offered = finalMessages.filter(message => /TestNick\s+\([^)]+\)\s+[?✔]/.test(message))
        .map(message => message.match(/TestNick\s+\(([^)]+)\)/)?.[1]);
    const outcome = finalMessages.some(message => message.includes('Confirmed match:')) ? 'confirmed'
        : Object.keys(last.targets).length === 1 && last.result.candidates?.length > 3 ? 'too-many'
            : finalMessages.some(message => message.includes('Could not check')) ? 'error'
                : finalMessages.some(message => message.includes('Could not confidently'))
                    ? offered.length ? last.result.complete ? 'ambiguous' : 'limited' : 'combined-no-match'
                    : offered.length ? 'possible' : 'no-match';
    const expected = scenario.expected;
    assert.equal(outcome, expected.outcome || 'possible', `${scenario.id}/${mode}: outcome`);
    assert.deepEqual(offered, expected.names, `${scenario.id}/${mode}: displayed players`);
    assert(!messages.some(message => /Checking |Too many players match|Could not identify|Finals:|Beds:|detected |diff /.test(message)), 'hidden progress, single-stat failures and stat comparisons stay out of chat');
    if (outcome === 'too-many') assert.equal(finalMessages.length, 0, 'too many single-stat matches are silent');
    if (outcome === 'no-match') assert.equal(finalMessages.length, 0, 'single-stat misses are silent');
    if (expected.primary !== undefined) assert.equal(last.result.singleStat?.primaryCount, expected.primary);
    if (expected.expanded !== undefined) assert.equal(last.result.singleStat?.expanded, expected.expanded);
    if (expected.complete !== undefined) assert.equal(last.result.complete, expected.complete);
    if (expected.checks !== undefined) assert.equal(last.checked.length, expected.checks);
    if (expected.searched) assert.deepEqual(last.targets, expected.searched);
    assert(last.checked.length <= 25, 'each search preserves the profile limit');
    assert.equal(new Set(last.checked).size, last.checked.length, 'expansion does not re-fetch a profile');
    assert.equal(h.saved.length, mode === 'live' && outcome === 'confirmed' ? 1 : 0);
    if (mode === 'test') {
        assert.equal(h.tracker.autoDenickStats.size, 0);
        assert.equal(h.tracker.autoDenickResults.size, 0);
        assert.equal(h.announced.length, 0);
        assert.equal(h.partyAnnounced.length, 0);
        assert.equal(h.cosmetics.length, 0);
    }
    return { mode, commands, outcome, offered, searched: last.targets, selection: last.result.singleStat || null,
        complete: last.result.complete ?? null, profileChecks: last.checked.length, checked: last.checked,
        allMessages: messages, finalMessages, searches: records, fixtureDiscoveryRequests: lookup.requests.length,
        fixtureProfileChecks: lookup.verified.length, externalRequests: 0 };
}

const outcomeLabel = result => ({ possible: 'Possible: ' + result.offered.join(', '), confirmed: 'Confirmed: ' + result.offered.join(', '),
    'too-many': 'Too many matches; no chat message', 'no-match': 'No match; silently wait for the other stat',
    ambiguous: 'Multiple combined matches; no confirmation', limited: 'Limited search; possible match only',
    'combined-no-match': 'No combined match', error: 'API error; no result' })[result.outcome];
const cell = text => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function runExample(scenario) {
    const results = [];
    for (const mode of scenario.modes || ['live', 'test']) results.push(await runScenario(scenario, mode));
    if (results.length === 2) {
        assert.deepEqual(results[0].finalMessages, results[1].finalMessages, `${scenario.id}: live/test final chat must match`);
        assert.deepEqual(results[0].searched, results[1].searched, `${scenario.id}: live/test searched counts must match`);
    }
    return { ...scenario, results };
}

function renderExamples(reports) {
    const lines = ['# AutoDenick test examples', '',
        'These are synthetic, repeatable examples checked against the actual matching code, chat parser and chat formatter. No saved keys are read, no network requests are sent, and no real nicknames are saved or shared.', '',
        'Run all examples and regenerate this report:', '', '```powershell', 'node scripts/denick_examples.js', '```', '',
        'Run one example: `node scripts/denick_examples.js finals-two-to-three`. List IDs with `node scripts/denick_examples.js --list`.', '',
        'The commands below describe the detected inputs. Running them normally in Minecraft uses live APIs; it does not inject these fictional players. Only this offline runner supplies the listed fake API replies.', '',
        'Use `/denick test messages` in Minecraft for an offline showcase of all current stats-denick chat messages. It shows one/two/three-row possible-match groups and the confirmation/failure variants without changing entered test counts or sending requests. Search-start and too-many-single-stat messages are hidden, and match rows omit finals/beds comparisons. Backend counts and decisions remain in this report.', '',
        'Discovery requests up to 50 candidates per stat. Verification checks up to 25 ranked profiles per search. Both stored stats in range take priority, followed by a single known stat in range, then older/outside-range totals and unknown counts. Closer known differences rank first within each group; ties preserve discovery order. A player outside the first 25 can still be missed. Names-only fixtures retain their supplied order because stored counts are unknown.', '',
        'Rules: start at 100 below; widen to 200 below only with zero, one or two primary matches. Three primary matches prevent widening. Four or more matches in the chosen range suppress single-stat suggestions. Finals allow at most four above; beds allow none above. With both stats, the absolute beds gap must also be at most the absolute finals gap multiplied by 1.25 (25% extra). Both stats use 100 below without widening, and confirmation requires exactly one verified match from a successfully finished lookup. Full provider lists and the profile cap do not mark a successful search incomplete.', '',
        'Live mode feeds server-shaped messages through the real chat parser; test mode executes `/denick test`. Their final chat messages are checked for equality. Simulated time advances instantly. Candidate counts describe checked profiles, so a provider/profile limit can still hide players. Detected counts are 1,000 for each entered stat unless an input block says otherwise. Fixtures set both stats to the same value unless a table below says otherwise.', '',
        `Verified ${reports.length} scenarios in ${reports.reduce((sum, report) => sum + report.results.length, 0)} live/test runs. External requests: **0**.`, ''];
    for (const group of [...new Set(reports.map(report => report.group))]) {
        lines.push(`## ${group}`, '', '| ID | Supplied finals / beds | Primary matches | Widened? | Result |', '|---|---|---:|---|---|');
        for (const report of reports.filter(report => report.group === group)) {
            const result = report.results.find(result => result.mode === 'test') || report.results[0];
            const inputs = report.players.length <= 5 ? report.players.map(person => `${person.name} ${person.finals}/${person.beds}`).join('; ') : `${report.players.length} players (see details)`;
            lines.push(`| ${cell(report.id)} | ${cell(inputs || 'Empty list')} | ${result.selection?.primaryCount ?? '-'} | ${result.selection ? result.selection.expanded ? 'Yes' : 'No' : '-'} | ${cell(outcomeLabel(result))} |`);
        }
        lines.push('');
    }
    lines.push('## Inputs and actual chat', '', 'For multiple-step examples, each output block includes the full sequence. The JSON report also contains each lookup trace, accepted/rejected names and profile-check counts.', '');
    for (const report of reports) {
        lines.push('<details>', `<summary>${report.id}: ${report.title}</summary>`, '', '**Inputs**', '', '```text');
        for (const event of report.events) {
            if (event.waitMs) lines.push(`Wait ${event.waitMs / 1000} seconds (simulated).`);
            lines.push(event.reset ? '/denick test reset' : `/denick test ${Object.entries(event.counts).map(([stat, count]) => `${stat} ${count}`).join(' ')}`);
        }
        lines.push('```', '', '| Player | Finals | Beds |', '|---|---:|---:|');
        for (const person of report.players) lines.push(`| ${person.name} | ${person.finals} | ${person.beds} |`);
        if (report.lists) lines.push('', `Discovery lists: \`${JSON.stringify(report.lists)}\`.`);
        if (report.profileError) lines.push('', `Hypixel lookup for ${report.profileError} returns an error.`);
        if (report.response) lines.push('', 'Aurora returns a failed response.');
        for (const result of report.results) {
            lines.push('', `**${result.mode === 'live' ? 'Automatic chat detection' : '/denick test'}**: ${outcomeLabel(result)}. Last search checked ${result.profileChecks} profile(s); lookup ${result.complete === null ? 'failed' : result.complete ? 'finished' : 'unfinished'}.`, '', '```text', ...result.allMessages, '```');
        }
        lines.push('', '</details>', '');
    }
    return lines.join('\n');
}

async function main() {
    const argument = process.argv[2];
    if (argument === '--list') { scenarios.forEach(scenario => console.log(`${scenario.id}: ${scenario.title}`)); return; }
    const selected = argument ? scenarios.filter(scenario => scenario.id === argument) : scenarios;
    if (!selected.length || process.argv.length > 3) throw new Error('Use an example ID or --list.');
    const reports = [];
    for (const scenario of selected) {
        const report = await runExample(scenario);
        const { results } = report;
        reports.push(report);
        console.log(`PASS ${scenario.id}: ${outcomeLabel(results.at(-1))}`);
        if (argument) results.forEach(result => console.log(`\n${result.mode}:\n${result.allMessages.join('\n')}`));
    }
    if (!argument) {
        const root = path.resolve(__dirname, '..');
        const directory = path.join(root, 'output', 'denick-examples');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(root, 'docs', 'DENICK_TEST_EXAMPLES.md'), renderExamples(reports));
        fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ externalRequests: 0, reports }, null, 2));
        console.log(`\n${reports.length} scenarios passed. External requests: 0.\nExamples: ${path.join(root, 'docs', 'DENICK_TEST_EXAMPLES.md')}`);
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { runScenario, runExample, renderExamples };
