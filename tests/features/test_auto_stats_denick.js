'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDenickStatComparison } = require('../../src/stats/scanLine');
const { stripAnsi, extractText, sendChat } = require('../../features/minecraft_chat');
const { flush, deferred, player, candidate, match, lookupHarness, harness } = require('../../scripts/test_support/auto_stats_denick');
const possibleRows = h => h.messages.filter(message => /\) \?/.test(stripAnsi(message)));


test('lookup applies the four-finals ceiling, ranks candidates, and keeps configurable inspector tolerances', async () => {
    const h = lookupHarness({ lists: { finals: ['upper', 'outside', 'lower', 'nearest'] }, profiles: {
        upper: player(1100), outside: player(1101), lower: player(900), nearest: player(990)
    } });
    const result = await h.find({ finals: 1000 }, { verifyRange: 100, includeScanStats: true });
    assert.deepEqual(result.candidates.map(c => c.name), ['nearest', 'lower']);
    assert.equal(result.complete, true);
    assert(h.requests[0].url.includes('range=800&max=50'));
    assert.equal(h.requests[0].options.timeout, 10000);
    assert(h.verified.every(v => v.options.includeErrors));
    assert.equal(result.candidates[0].scanStats.stars, 250);
    assert.equal((await h.find({ finals: 1000 })).candidates.length, 2, 'manual lookup also rejects finals more than four above the target');
    assert.equal((await h.find({ finals: 1000 }, { verifyRange: 100, verifyFinalsAhead: 100 })).candidates.length, 3,
        'the separate inspector can still explicitly experiment with a different upper allowance');
});

test('discovery retains fifty candidates while verification uses its separate profile budget', async () => {
    const names = Array.from({ length: 60 }, (_, i) => `player${i}`);
    const profiles = Object.fromEntries(names.map((name, i) => [name, player(i === 49 ? 1000 : 99999, 500)]));
    const h = lookupHarness({ lists: { finals: names }, profiles });
    const events = [];
    const limited = await h.find({ finals: 1000 }, { onTrace: event => events.push(event) });
    assert.equal(new URL(h.requests[0].url).searchParams.get('max'), '50');
    assert.equal(new URL(h.requests[0].url).searchParams.has('limit'), false);
    assert.equal(events.find(event => event.type === 'discovery').rows.length, 50);
    assert.equal(events.find(event => event.type === 'shortlist').names.length, 50);
    assert.equal(h.verified.length, 25);
    assert.equal(limited.candidates.length, 0, 'the fiftieth candidate is unverified with the current default budget');
    h.verified.length = 0;
    const expanded = await h.find({ finals: 1000 }, { verifyLimit: 50 });
    assert.equal(h.verified.length, 50);
    assert.deepEqual(expanded.candidates.map(candidate => candidate.name), ['player49']);
});

test('beds-only and combined either-list verification respect every provided stat', async () => {
    const h = lookupHarness({ lists: { finals: ['same', 'finalsonly', 'wrongbeds'], beds: ['SAME', 'wrongbeds', 'bedsonly'] }, profiles: {
        same: player(900, 500), wrongbeds: player(1000, 501), bedsonly: player(99999, 400)
    } });
    assert.deepEqual((await h.find({ beds: 500 }, { verifyRange: 100 })).candidates.map(c => c.name), ['same', 'bedsonly']);
    assert.deepEqual((await h.find({ finals: 1000, beds: 500 }, { verifyRange: 100 })).candidates.map(c => c.name), ['finalsonly', 'same']);
});

test('beds verification has no upper tolerance and preserves lower allowances and explicit inspector experiments', async () => {
    const values = { exact: 1880, oneabove: 1881, fourabove: 1884, screenshot: 2048,
        autobottom: 1780, manualbottom: 1680, belowmanual: 1679 };
    const names = Object.keys(values);
    const profiles = Object.fromEntries(Object.entries(values).map(([name, beds]) => [name, player(4490 - Math.ceil(Math.abs(1880 - beds) / 1.25), beds)]));
    const h = lookupHarness({ lists: { finals: names, beds: names }, profiles });
    assert.deepEqual((await h.find({ beds: 1880 })).candidates.map(candidate => candidate.name), ['exact', 'autobottom', 'manualbottom']);
    assert.deepEqual((await h.find({ beds: 1880 }, { verifyRange: 100 })).candidates.map(candidate => candidate.name), ['exact', 'autobottom']);
    assert.deepEqual((await h.find({ finals: 4490, beds: 1880 })).candidates.map(candidate => candidate.name), ['exact', 'autobottom', 'manualbottom']);
    const custom = await h.find({ beds: 1880 }, { verifyRange: 100, verifyBedsAhead: 4 });
    assert.deepEqual(custom.candidates.map(candidate => candidate.name), ['exact', 'oneabove', 'fourabove', 'autobottom']);
});

test('single-stat fallback widens only after at most two primary matches and reuses each verified profile', async () => {
    for (const stat of ['finals', 'beds']) {
        for (const primaryCount of [0, 1, 2, 3]) {
            const values = Object.fromEntries(Array.from({ length: primaryCount }, (_, i) => [`primary${i}`, [1000, 900, 950][i]]));
            Object.assign(values, { firstouter: 899, boundary200: 800, outside: 799,
                upper: stat === 'finals' ? 1005 : 1001 });
            const profiles = Object.fromEntries(Object.entries(values).map(([name, value]) =>
                [name, player(stat === 'finals' ? value : 1000, stat === 'beds' ? value : 500)]));
            const names = Object.keys(values);
            const h = lookupHarness({ lists: { [stat]: names }, profiles });
            const result = await h.find({ [stat]: 1000 }, { verifyRange: 100, singleStatFallbackRange: 200 });
            assert.equal(result.singleStat.primaryCount, primaryCount);
            assert.equal(result.singleStat.expanded, primaryCount <= 2);
            const expected = Object.entries(values).filter(([name]) => name.startsWith('primary')
                || (primaryCount <= 2 && ['firstouter', 'boundary200'].includes(name)))
                .sort((a, b) => Math.abs(a[1] - 1000) - Math.abs(b[1] - 1000)).map(([name]) => name);
            assert.deepEqual(result.candidates.map(c => c.name), expected);
            assert.equal(h.requests.length, 1, 'the existing broad discovery is reused');
            assert.equal(h.verified.length, names.length, 'each profile is checked once, including fallback');
        }
    }
});

test('adaptive single-stat checks stop at four primary matches and preserve the existing verification cap', async () => {
    const names = Array.from({ length: 26 }, (_, i) => `player${i}`);
    const dense = lookupHarness({ lists: { beds: names }, profiles: Object.fromEntries(names.map(name => [name, player(1000, 500)])) });
    const options = { verifyRange: 100, singleStatFallbackRange: 200 };
    const result = await dense.find({ beds: 500 }, options);
    assert.equal(dense.verified.length, 4, 'a fourth primary match is enough to stop spending requests');
    assert.equal(result.singleStat.expanded, false);
    assert.equal(result.singleStat.tooMany, true);
    assert.equal(result.complete, true);
    const sparse = lookupHarness({ lists: { beds: names }, profiles: Object.fromEntries(names.map(name => [name, player(1000, 350)])) });
    const expanded = await sparse.find({ beds: 500 }, options);
    assert.equal(sparse.verified.length, 25, 'expansion cannot increase the profile-check budget');
    assert.equal(sparse.requests.length, 1);
    assert.equal(expanded.singleStat.expanded, true);
    assert.equal(expanded.complete, true);
    const failed = lookupHarness({ lists: { beds: ['first', 'error', 'later'] }, profiles: {
        first: player(1000, 350), error: { error: true, errorType: 'hypixel_rate_limited' }
    } });
    const failure = await failed.find({ beds: 500 }, options);
    assert(failure.error);
    assert.equal(failure.candidates.length, 0, 'an unfinished primary pass cannot produce fallback suggestions');
    assert.equal(failed.verified.length, 2);
});

test('empty primary search can find a 200-below match but combined verification never widens', async () => {
    for (const stat of ['finals', 'beds']) {
        const h = lookupHarness({ profiles: { realplayer: player(850, 350) } });
        const options = { verifyRange: 100, singleStatFallbackRange: 200 };
        const single = await h.find({ [stat]: stat === 'finals' ? 1000 : 500 }, options);
        assert.equal(single.singleStat.primaryCount, 0);
        assert.equal(single.singleStat.expanded, true);
        assert.equal(single.candidates.length, 1);
        assert.equal((await h.find({ finals: 1000, beds: 500 }, options)).candidates.length, 0);
        assert.equal((await h.find({ [stat]: stat === 'finals' ? 1000 : 500 }, { verifyRange: 100 })).candidates.length, 0,
            'callers without the single-stat policy keep their current tolerances');
    }
});

test('manual beds-only, combined-stat and cosmetic searches reject beds above the entered count', async () => {
    const values = { Siennawr: 1874, scampixel: 1880, OneBedAbove: 1881, mvdhor: 2048 };
    const names = Object.keys(values);
    const profiles = Object.fromEntries(Object.entries(values).map(([name, beds]) => {
        const profile = player(name === 'Siennawr' ? 4467 : name === 'scampixel' ? 4382 : 4484, beds);
        profile.data.player.displayname = name;
        return [name.toLowerCase(), profile];
    }));
    for (const mode of ['beds', 'both', 'cosmetics']) {
        const stats = mode === 'beds' ? { beds: 1880 } : { finals: 4490, beds: 1880 };
        const parsed = { hasStats: true, hasCosmetics: mode === 'cosmetics', stats, statLabels: ['beds: 1,880'], filters: {}, labels: ['beds: 1,880'] };
        const h = lookupHarness({ lists: { finals: names, beds: names }, profiles, parsed, cosmetics: names.map(name => ({ name })) });
        await h.handle({}, ['/denick', 'beds', '1880'], new Map());
        const output = h.messages.join('\n');
        assert(output.includes('Siennawr'));
        assert(output.includes('scampixel'));
        assert(!output.includes('OneBedAbove'));
        assert(!output.includes('mvdhor'));
        assert.equal(h.requests.filter(request => request.url.includes('/lookup/')).length, Object.keys(stats).length);
    }
});

test('automatic and test searches reject even one extra bed without spending extra discovery requests', async () => {
    for (const beds of [1879, 1880, 1881, 2048]) {
        for (const simulated of [false, true]) {
            const lookup = lookupHarness({ profiles: { realplayer: player(4489, beds) } });
            const h = harness({ find: lookup.find });
            if (simulated) await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'beds', '1880']);
            else await h.record('beds', 1880);
            assert.equal(h.messages.some(message => message.includes('Possible matches:')), beds <= 1880);
            if (simulated) await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'finals', '4490']);
            else await h.record('finals', 4490);
            assert.equal(simulated ? h.messages.some(message => message.includes('Confirmed match:')) : h.saved.length > 0, beds <= 1880);
            assert.equal(lookup.requests.length, 3);
        }
    }
});

test('combined discovery keeps a valid player returned by only one stat and preserves the legacy comparison mode', async () => {
    for (const sourceStat of ['finals', 'beds']) {
        const lists = { finals: ['finaldecoy'], beds: ['beddecoy'] };
        lists[sourceStat].push('Siennawr', 'SIENNAWR');
        const h = lookupHarness({ lists, profiles: {
            finaldecoy: player(4490, 9999), beddecoy: player(99999, 1880), siennawr: player(4467, 1874)
        } });
        const result = await h.find({ finals: 4490, beds: 1880 });
        assert.deepEqual(result.candidates.map(candidate => candidate.name), ['siennawr']);
        assert.equal(h.verified.filter(item => item.name === 'siennawr').length, 1, 'duplicate names use one verification');
        assert.equal(h.requests.length, 2, 'still one discovery request per stat');
        const old = await h.find({ finals: 4490, beds: 1880 }, { candidateMode: 'intersection' });
        assert.equal(old.candidates.length, 0, 'legacy behavior is retained for comparison/reversion');
    }
});

test('ten-row discovery does not block confirmation of one verified combined match', async () => {
    const names = ['siennawr', ...Array.from({ length: 9 }, (_, i) => `decoy${i}`)];
    const profiles = Object.fromEntries(names.map(name => [name, name === 'siennawr' ? player(4467, 1874) : player(99999, 9999)]));
    const lookup = lookupHarness({ lists: { finals: names, beds: names }, profiles });
    const result = await lookup.find({ finals: 4490, beds: 1880 });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.complete, true, 'full provider lists do not mark a successful lookup incomplete');
    for (const simulated of [false, true]) {
        const h = harness({ find: lookup.find, realAnnouncements: true });
        if (simulated) await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'finals', '4490', 'beds', '1880']);
        else { await h.record('finals', 4490); await h.record('beds', 1880); }
        assert.equal(h.saved.length, simulated ? 0 : 1);
        assert.equal(h.announced.length, simulated ? 0 : 1);
        assert(h.messages.some(message => message.includes('Confirmed match:')));
    }
    const limited = lookupHarness({ lists: { finals: Array.from({ length: 10 }, (_, i) => `final${i}`), beds: Array.from({ length: 10 }, (_, i) => `bed${i}`) } });
    const partial = await limited.find({ finals: 1000, beds: 500 });
    assert.equal(limited.verified.length, 20);
    assert.equal(partial.complete, true);
});

test('Nestersen screenshot confirms in live and test paths even when the returned union exceeds twenty-five profiles', async () => {
    for (const simulated of [false, true]) {
        const lists = { finals: ['Nestersen', ...Array.from({ length: 14 }, (_, i) => `FinalDecoy${i}`)],
            beds: ['Nestersen', ...Array.from({ length: 14 }, (_, i) => `BedDecoy${i}`)] };
        const nestersen = player(56227, 25501);
        nestersen.data.player.displayname = 'Nestersen';
        const profiles = Object.fromEntries([...lists.finals, ...lists.beds].map(name =>
            [name.toLowerCase(), name === 'Nestersen' ? nestersen : player(99999, 99999)]));
        const lookup = lookupHarness({ lists, profiles });
        const checkedPerSearch = [];
        const h = harness({ realAnnouncements: true, profileLookup: async () => nestersen, find: async (targets, options) => {
            const before = lookup.verified.length;
            const result = await lookup.find(targets, options);
            checkedPerSearch.push(lookup.verified.length - before);
            return result;
        } });
        if (simulated) await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'finals', '56310', 'beds', '25501']);
        else { await h.record('finals', 56310); await h.record('beds', 25501); }
        assert.equal(checkedPerSearch.at(-1), 25, 'the new request limit is shared across both lists');
        assert(h.messages.some(message => /Confirmed match:.*Nestersen/.test(message)));
        assert(!h.messages.some(message => message.includes('Could not confidently')));
        assert.equal(h.saved.length, simulated ? 0 : 1);
        assert.equal(h.announced.length, simulated ? 0 : 1);
    }
});

test('manual full-list searches do not show an incomplete warning', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `player${i}`);
    const profiles = Object.fromEntries(names.map(name => [name, player(99999, 9999)]));
    const h = lookupHarness({ lists: { finals: names, beds: names }, profiles,
        parsed: { hasStats: true, hasCosmetics: false, stats: { finals: 4490, beds: 1880 }, statLabels: ['finals: 4,490', 'beds: 1,880'] } });
    await h.handle({}, ['/denick', 'finals', '4490', 'beds', '1880'], new Map());
    assert(!h.messages.some(message => message.includes('limited')));
    assert(h.messages.some(message => message === 'No candidates found.'));
});

test('manual and automatic finals verification share the four-finals ceiling while keeping their lower allowances', async () => {
    const h = lookupHarness({ lists: { finals: ['fiveahead', 'fourahead', 'exact', 'behind', 'toofarbehind'] }, profiles: {
        fiveahead: player(56005), fourahead: player(56004), exact: player(56000),
        behind: player(55900), toofarbehind: player(55899)
    } });
    const result = await h.find({ finals: 56000 }, { verifyRange: 100, verifyFinalsAhead: 4 });
    assert.deepEqual(result.candidates.map(c => c.name), ['exact', 'fourahead', 'behind']);
    assert.equal(result.complete, true);
    assert.deepEqual((await h.find({ finals: 56000 })).candidates.map(candidate => candidate.name), ['exact', 'fourahead', 'behind', 'toofarbehind'],
        'manual /denick retains its 200-finals lower allowance and rejects five ahead');
});

test('manual finals-only, combined-stat and cosmetic/stat commands reject screenshot candidates above the four-finals ceiling', async () => {
    const values = { ExactPlayer: 56227, FourAhead: 56231, FiveAhead: 56232,
        aricatT_T: 56262, Luoyuana: 56316, Adhaam: 56345, LowerBoundary: 56027, TooFarBelow: 56026 };
    const names = Object.keys(values), lists = { finals: names, beds: names };
    const profiles = Object.fromEntries(Object.entries(values).map(([name, finals]) => {
        const result = player(finals, 25501); result.data.player.displayname = name;
        return [name.toLowerCase(), result];
    }));
    for (const mode of ['finals', 'both', 'cosmetics']) {
        const stats = mode === 'finals' ? { finals: 56227 } : { finals: 56227, beds: 25501 };
        const parsed = { hasStats: true, hasCosmetics: mode === 'cosmetics', stats, statLabels: ['finals: 56,227'],
            filters: { beddestroy: 'ghosts' }, labels: ['finals: 56,227', 'Ghosts'] };
        const h = lookupHarness({ lists, profiles, parsed, cosmetics: names.map(name => ({ name })) });
        await h.handle({}, ['/denick', 'finals', '56227'], new Map());
        const output = h.messages.join('\n');
        for (const name of ['ExactPlayer', 'FourAhead', 'LowerBoundary']) assert(output.includes(name), `${mode}: ${name} should remain listed`);
        for (const name of ['FiveAhead', 'aricatT_T', 'Luoyuana', 'Adhaam', 'TooFarBelow']) assert(!output.includes(name), `${mode}: ${name} must be excluded`);
        assert.equal(h.requests.filter(request => request.url.includes('/lookup/')).length, Object.keys(stats).length);
    }
});

test('optional inspector traces expose discovery and verdicts without credentials or changing lookup behavior', async () => {
    const h = lookupHarness({ lists: { finals: ['accepted', 'rejected', 'excluded'], beds: ['accepted', 'rejected'] }, profiles: {
        accepted: player(1004, 500), rejected: player(1005, 500)
    } });
    const events = [];
    const options = { verifyRange: 100, verifyFinalsAhead: 4, candidateMode: 'intersection' };
    const result = await h.find({ finals: 1000, beds: 500 }, { ...options, onTrace: event => events.push(event) });
    assert.deepEqual(result.candidates.map(candidate => candidate.name), ['accepted']);
    assert.equal(events.filter(event => event.type === 'discovery').length, 2);
    assert(events[0].rows.some(row => row.name === 'excluded'));
    assert.deepEqual(events.find(event => event.type === 'shortlist').names, ['accepted', 'rejected']);
    assert.deepEqual(events.filter(event => event.type === 'verification').map(event => event.status), ['accepted', 'rejected']);
    assert(!JSON.stringify(events).includes('fixture'));
    const throwing = await h.find({ finals: 1000, beds: 500 }, { ...options, onTrace: () => { throw new Error('Inspector failed'); } });
    assert.deepEqual(throwing, result, 'an observer cannot change a production lookup');
});

test('upstream and verification failures remain errors instead of completed no-match searches', async () => {
    for (const response of [{ data: { success: false } }, { data: { success: true, data: null } }]) {
        assert((await lookupHarness({ response }).find({ finals: 1000 })).error);
    }
    for (const profile of [null, { error: true, errorType: 'hypixel_rate_limited' }, { data: { lookupFailed: true, player: {} } }]) {
        assert((await lookupHarness({ profiles: { realplayer: profile } }).find({ finals: 1000 })).error);
    }
    const removed = await lookupHarness({ profiles: { realplayer: { error: true, errorType: 'player_not_found' } } }).find({ finals: 1000 });
    assert.equal(removed.complete, true);
    assert.equal(removed.candidates.length, 0);
    const empty = await lookupHarness({ lists: { finals: [] } }).find({ finals: 1000 });
    assert.equal(empty.complete, true);
    assert.equal(empty.candidates.length, 0);
});

test('bounded searches complete within the profile cap, duplicate names count once, and stale work stops', async () => {
    const names = Array.from({ length: 26 }, (_, i) => `player${i}`);
    const limited = await lookupHarness({ lists: { finals: names } }).find({ finals: 1000 });
    assert.equal(limited.complete, true);
    assert.equal(limited.candidates.length, 25);
    const capped = await lookupHarness({ lists: { finals: Array(100).fill('realplayer') } }).find({ finals: 1000 });
    assert.equal(capped.complete, true);
    assert.equal(capped.candidates.length, 1);
    const duplicates = await lookupHarness({ lists: { finals: ['realplayer', 'REALPLAYER'] } }).find({ finals: 1000 });
    assert.equal(duplicates.complete, true);
    assert.equal(duplicates.candidates.length, 1);
    const stale = lookupHarness();
    assert.equal((await stale.find({ finals: 1000 }, { isCurrent: () => false })).cancelled, true);
    assert.equal(stale.requests.length, 0);
});

test('one-stat matches are tentative and cannot save, rename, update overlays, or broadcast', async () => {
    for (const stat of ['finals', 'beds']) {
        const h = harness();
        await h.record(stat, 1000);
        assert.equal(h.queries.length, 1);
        assert.equal(h.queries[0].options.verifyRange, 100);
        assert.equal(h.messages.length, 3);
        assert.match(h.messages[0], new RegExp(`Started denicking HiddenNick using their ${stat}`));
        assert.match(h.messages[1], /Possible matches:/);
        assert.match(h.messages[2], /HiddenNick.*RealPlayer.*FKDR:.*WLR:.*WS:/);
        assert(!h.messages[2].includes('✔'));
        assert.equal(h.saved.length, 0);
        assert.equal(h.announced.length, 0);
        assert.equal(h.updates.length, 0);
        assert.equal(h.context.autoDenickResults.size, 0);
        await h.record(stat, 1001);
        await h.advance(60000);
        assert.equal(h.queries.length, 1);
        assert.equal(h.messages.length, 3);
    }
});

test('a single stat with no match sends one start notice then waits for new evidence', async () => {
    const h = harness({ find: async () => ({ complete: true, candidates: [] }) });
    await h.record('finals', 1000);
    assert.equal(h.messages.length, 1);
    assert.match(h.messages[0], /Started denicking HiddenNick using their finals/);
    await h.record('finals', 1001);
    assert.equal(h.queries.length, 1);
    await h.record('beds', 500);
    assert.equal(h.queries.length, 2);
    assert.match(h.messages.at(-1), /Could not confidently denick/);
    await h.record('beds', 501);
    await h.advance(60000);
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 0);
});

test('ambiguous and incomplete single-stat searches show candidates but cannot confirm', async () => {
    for (const result of [{ complete: true, candidates: [candidate(), candidate('Other')] }, { complete: false, candidates: [candidate()] }]) {
        const h = harness({ find: async () => result });
        await h.record('finals', 1000);
        assert.equal(h.messages.length, 2 + result.candidates.length);
        h.messages.slice(2).forEach((line, i) => assert.match(line, new RegExp(`HiddenNick.*${result.candidates[i].name}`)));
        assert(!h.messages.some(line => line.includes('Waiting for their')));
        await h.record('finals', 1001);
        assert.equal(h.queries.length, 1);
        await h.record('beds', 500);
        assert.equal(h.queries.length, 2);
        assert.match(h.messages.at(-1), /Could not confidently denick/);
        await h.record('beds', 501);
        await h.advance(60000);
        assert.equal(h.queries.length, 2);
        assert.equal(h.saved.length, 0);
        assert.equal(h.announced.length, 0);
        assert.equal(h.updates.length, 0);
        assert.equal(h.context.autoDenickResults.size, 0);
    }
});

test('a truncated single-stat search still shows the one checked match that manual denick would list', async () => {
    const names = Array.from({ length: 26 }, (_, i) => `player${i}`);
    const profiles = Object.fromEntries(names.map(name => [name, player(name === 'player3' ? 1000 : 5000)]));
    const lookup = lookupHarness({ lists: { finals: names }, profiles });
    const h = harness({ find: lookup.find });
    await h.record('finals', 1000);
    assert.equal(lookup.verified.length, 25);
    assert.equal(h.queries[0].options.verifyRange, 100);
    assert.equal(h.messages.length, 3);
    assert.match(h.messages[2], /HiddenNick.*RealPlayer/);
    assert.equal(h.saved.length, 0);
    assert.equal(h.context.autoDenickResults.size, 0);
});

test('single-stat searches with more than three candidates wait for the other stat instead of picking three', async () => {
    const h = harness({ find: async () => ({ complete: false, candidates: ['First', 'Second', 'Third', 'Fourth'].map(candidate) }) });
    await h.record('beds', 500);
    assert.equal(h.messages.length, 1);
    assert.match(h.messages[0], /Started denicking HiddenNick using their beds/);
    assert(!h.messages.some(line => line.includes('Possible matches:')));
    assert.equal(h.saved.length, 0);
});

test('live and test single-stat searches apply the fallback and suppress an expanded fourth match', async () => {
    for (const stat of ['finals', 'beds']) {
        for (const simulated of [false, true]) {
            for (const expandedCount of [1, 2]) {
                const values = { first: 1000, second: 950, outer: 850, ...(expandedCount === 2 ? { fourth: 800 } : {}) };
                const profiles = Object.fromEntries(Object.entries(values).map(([name, value]) =>
                    [name, player(stat === 'finals' ? value : 1000, stat === 'beds' ? value : 500)]));
                const lookup = lookupHarness({ lists: { [stat]: Object.keys(values) }, profiles });
                const h = harness({ find: lookup.find });
                if (simulated) await h.context.handleAutoDenickTestCommand(['/denick', 'test', stat, '1000']);
                else await h.record(stat, 1000);
                assert.equal(h.queries[0].options.singleStatFallbackRange, 200);
                assert.equal(h.messages.filter(m => m.includes('Possible matches:')).length, expandedCount === 1 ? 1 : 0);
                assert.equal(possibleRows(h).length, expandedCount === 1 ? 3 : 0);
                assert.equal(h.messages.some(m => m.includes('Too many players match')), false);
                assert.equal(lookup.requests.length, 1);
                assert.equal(lookup.verified.length, Object.keys(values).length);
                assert.equal(h.saved.length, 0);
                assert.equal(h.announced.length, 0);
            }
        }
    }
});

test('second stat upgrades immediately, confirms once, and stores the searched counts', async () => {
    const h = harness();
    h.context.observeAutoDenickChat("Victim was HiddenNick's final #1,000. FINAL KILL!");
    await flush();
    h.context.observeAutoDenickChat('BED DESTRUCTION > Red Bed was bed #500 destroyed by HiddenNick!');
    await flush();
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].stats.finals, 1000);
    assert.equal(h.saved[0].stats.beds, 500);
    assert.equal(h.announced.length, 1);
    assert.equal(h.context.getAutoDenickResult('HiddenNick').realName, 'RealPlayer');
    await h.record('finals', 1001);
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
});

test('combined search uses the latest first-stat count in either order, including an unfinished single-stat lookup', async () => {
    for (const firstStat of ['beds', 'finals']) {
        for (const unfinished of [false, true]) {
            const pending = deferred();
            const noMatch = { complete: true, candidates: [] };
            const lookup = lookupHarness({ profiles: { realplayer: player(1001, 501) } });
            const h = harness({ find: targets => Object.keys(targets).length === 1
                ? (unfinished ? pending.promise : Promise.resolve(noMatch)) : lookup.find(targets) });
            const detect = async (stat, count) => {
                h.context.observeAutoDenickChat(stat === 'beds'
                    ? `BED DESTRUCTION > Red Bed was bed #${count} destroyed by HiddenNick!`
                    : `Victim was HiddenNick's final #${count}. FINAL KILL!`);
                await flush();
            };
            await detect(firstStat, firstStat === 'beds' ? 500 : 1000);
            await h.advance(60000);
            await detect(firstStat, firstStat === 'beds' ? 501 : 1001);
            assert.equal(h.queries.length, 1, 'updating one stat does not spend another search');
            await h.advance(60000);
            await detect(firstStat === 'beds' ? 'finals' : 'beds', firstStat === 'beds' ? 1001 : 501);
            if (unfinished) {
                assert.equal(h.queries.length, 1, 'combined search waits for the existing lookup to finish');
                pending.resolve(noMatch);
                await flush();
            }
            assert.equal(h.queries.length, 2);
            assert.equal(h.queries[1].targets.finals, 1001);
            assert.equal(h.queries[1].targets.beds, 501);
            assert.equal(h.saved.length, 1);
            assert.equal(h.saved[0].stats.finals, 1001);
            assert.equal(h.saved[0].stats.beds, 501);
            assert.equal(lookup.requests.length, 2, 'combined discovery still requests each stat once');
        }
    }
});

test('second stat arriving during a search discards the tentative result and starts combined lookup', async () => {
    const first = deferred();
    const h = harness({ find: targets => targets.beds === undefined ? first.promise : Promise.resolve(match()) });
    await h.record('finals', 1000);
    await h.record('beds', 500);
    assert.equal(h.queries.length, 1);
    first.resolve(match());
    await flush();
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
    assert(!h.messages.some(line => line.includes('Possible match')));
});

test('only errors retry at the existing 30-second spacing without repeated notices', async () => {
    let calls = 0;
    const h = harness({ find: async () => {
        if (++calls === 1) throw new Error('timeout');
        if (calls === 2) return { error: 'rate limited', candidates: [] };
        return match();
    } });
    await h.record('finals', 1000);
    assert.equal(h.timers.size, 1);
    await h.record('finals', 1001);
    await h.advance(29999);
    assert.equal(h.queries.length, 1);
    await h.advance(1);
    assert.equal(h.queries.length, 2);
    assert.equal(h.messages.filter(m => m.includes('Could not check')).length, 1);
    await h.advance(30000);
    assert.equal(h.queries.length, 3);
    assert.equal(h.messages.filter(m => m.includes('Started denicking')).length, 1);
    assert.match(h.messages.at(-1), /HiddenNick.*RealPlayer/);
    assert.equal(h.timers.size, 0);
    assert.equal(h.saved.length, 0);
});

test('second stat cancels a pending single-stat retry and does not inherit its cooldown', async () => {
    const h = harness({ find: async targets => targets.beds === undefined ? { error: 'offline' } : match() });
    await h.record('finals', 1000);
    assert.equal(h.timers.size, 1);
    await h.record('beds', 500);
    assert.equal(h.queries.length, 2);
    assert.equal(h.saved.length, 1);
    assert.equal(h.timers.size, 0);
    await h.advance(30000);
    assert.equal(h.queries.length, 2);
});

test('late results cannot cross session, mapping, skin, teammate, setting, or connection boundaries', async () => {
    for (const invalidate of [
        h => { h.context.gameSessionId++; },
        h => { h.tracker.applySavedMappingChange('HiddenNick', null); },
        h => { h.tracker.rememberKnownDenickInSession('HiddenNick', 'SkinPlayer', 'skin'); },
        h => { h.teammates.add('HiddenNick'); },
        h => { h.context.autoStatsDenickEnabled = false; },
        h => { h.context.connectionTimersCleared = true; },
        h => { h.context.autoDenickStats.clear(); }
    ]) {
        const next = deferred();
        const current = harness({ find: targets => targets.beds === undefined ? Promise.resolve({ complete: true, candidates: [] }) : next.promise });
        await current.record('finals', 1000);
        await current.record('beds', 500);
        invalidate(current);
        next.resolve(match());
        await flush();
        assert.equal(current.saved.length, 0);
        assert.equal(current.announced.length, 0);
    }
});

test('production lookup and automatic stages agree on the four-finals upper allowance and do not save a single-stat match', async () => {
    const lookup = lookupHarness({ profiles: { realplayer: player(1004, 495) } });
    const h = harness({ find: lookup.find });
    await h.record('finals', 1000);
    assert.match(h.messages.at(-1), /HiddenNick.*RealPlayer/);
    assert.equal(h.saved.length, 0);
    await h.record('beds', 500);
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].stats.matchedFinals, 1004);
    assert.equal(h.saved[0].stats.matchedBeds, 495);
    assert.equal(lookup.requests.length, 3, 'one single-stat search, followed by both searches');
});

test('configuration errors do not start background retries or repeated notices', async () => {
    const h = harness({ find: async () => ({ error: 'missing keys', retryable: false, candidates: [] }) });
    await h.record('finals', 1000);
    await h.record('finals', 1001);
    assert.equal(h.timers.size, 0);
    assert.equal(h.queries.length, 1);
    assert.match(h.messages.at(-1), /Check your Hypixel and Aurora API keys/);
    await h.advance(30000);
    assert.equal(h.queries.length, 1);
});

test('quiet mode, unknown nick verification, and snapshot clones retain their contracts', async () => {
    const quiet = harness({ local: false });
    await quiet.record('beds', 500);
    await quiet.record('finals', 1000);
    assert.equal(quiet.messages.length, 0);
    assert.equal(quiet.saved.length, 1);
    const unknown = harness({ detected: false });
    await unknown.record('beds', 500);
    assert.equal(unknown.queries.length, 1);
    const live = unknown.context.autoDenickStats.get('hiddennick');
    live.inFlight = true;
    const copy = unknown.context.cloneAutoDenickObservation(live, 2);
    copy.attempts.beds.complete = false;
    assert.equal(live.attempts.beds.complete, true);
    assert.equal(copy.inFlight, false);
    assert.equal(copy.sessionId, 2);
});

test('post-game combined errors retry only inside the existing grace period; cleanup cancels timers', async () => {
    const h = harness({ find: async () => ({ error: 'offline' }) });
    await h.record('finals', 1000);
    await h.record('beds', 500);
    h.context.gameActive = false;
    h.context.gameSessionId++;
    h.context.autoDenickGraceUntil = 1060000;
    await h.advance(30000);
    assert.equal(h.queries.length, 3);
    await h.advance(31000);
    assert.equal(h.queries.length, 3);
    assert.equal(h.timers.size, 0);
    const disconnected = harness({ find: async () => ({ error: 'offline' }) });
    await disconnected.record('finals', 1000);
    disconnected.context.clearAutoDenickRetryTimers();
    assert.equal(disconnected.timers.size, 0);
});

const simulate = (h, ...tokens) => h.context.handleAutoDenickTestCommand(['/denick', 'test', ...tokens]);
const assertTestIsLocal = h => {
    assert.equal(h.saved.length, 0);
    assert.equal(h.announced.length, 0);
    assert.equal(h.updates.length, 0);
    assert.equal(h.cosmetics.length, 0);
    assert.equal(h.partyAnnounced.length, 0);
    assert.equal(h.tracker.hasAnnouncedDenick('TestNick'), false);
    assert.equal(h.tracker.autoDenickStats.size, 0);
    assert.equal(h.tracker.autoDenickResults.size, 0);
    assert.equal(h.timers.size, 0);
};

test('live and test AutoDenick reject five or more extra finals in both single-stat and combined searches', async () => {
    for (const delta of [-201, -200, -101, -100, 0, 3, 4, 5, 100]) {
        for (const simulated of [false, true]) {
            const lookup = lookupHarness({ profiles: { realplayer: player(56000 + delta, 1874) } });
            const h = harness({ find: lookup.find });
            const allowed = delta >= -100 && delta <= 4;
            if (simulated) await simulate(h, 'finals', '56000');
            else await h.record('finals', 56000);
            assert.equal(h.messages.some(line => line.includes('Possible matches:')), delta >= -200 && delta <= 4, `delta ${delta}, simulated ${simulated}`);
            if (simulated) await simulate(h, 'beds', '1874');
            else await h.record('beds', 1874);
            assert.equal(simulated ? h.messages.some(line => line.includes('Confirmed match:')) : h.saved.length === 1, allowed);
            assert(h.queries.every(query => query.options.verifyFinalsAhead === 4));
            assert.equal(lookup.requests.length, 3, 'existing discovery request count is unchanged');
            if (simulated) assertTestIsLocal(h);
        }
    }
});

test('test command searches finals, beds, or both from a lobby without saving or changing settings', async () => {
    for (const tokens of [['finals', '1,000'], ['beds', '500'], ['finals', '1000', 'beds', '500'], ['BEDS', '500', 'FINALS', '1000']]) {
        const realLookup = lookupHarness();
        const h = harness({ find: realLookup.find, detected: false, local: false });
        h.context.gameActive = false;
        h.context.currentGamemode = null;
        h.context.autoStatsDenickEnabled = false;
        await simulate(h, ...tokens);
        assert.equal(h.queries.length, 1);
        const combined = tokens.length === 4;
        assert(h.messages.some(m => m.includes(combined ? 'Confirmed match:' : 'Possible matches:')));
        assert(h.messages.some(m => m.includes('RealPlayer') && m.includes('TestNick') && m.includes('FKDR:')));
        assert(h.messages.every(m => m.startsWith('[AutoDenick]') || /\) \?/.test(m)));
        assert.equal(h.queries[0].options.verifyRange, 100);
        assert.equal(h.context.autoStatsDenickEnabled, false);
        assert.equal(h.context.denickChatAnnouncementsEnabled, false);
        assert(realLookup.verified.length > 0, 'uses production lookup and profile verification');
        assertTestIsLocal(h);
    }
});

test('test counts carry over, reset clears them, and invalid commands leave them alone', async () => {
    const h = harness();
    await simulate(h, 'finals', '1000');
    for (const tokens of [[], ['beds'], ['beds', '-1'], ['beds', '1.5'], ['beds', '1e3'],
        ['beds', '1,2'], ['beds', '9007199254740992'], ['wins', '500'],
        ['beds', '500', 'beds', '600'], ['reset', 'beds', '500'], ['clear', 'beds', '500'], ['messages', 'beds', '500']]) {
        await simulate(h, ...tokens);
    }
    assert.equal(h.queries.length, 1, 'help and invalid arguments send no requests');
    await simulate(h, 'beds', '500');
    assert.equal(JSON.stringify(h.queries[1].targets), JSON.stringify({ finals: 1000, beds: 500 }));
    assert(h.messages.some(m => m.includes('Confirmed match:')));
    await simulate(h, 'reset');
    await simulate(h, 'beds', '0');
    assert.equal(JSON.stringify(h.queries[2].targets), JSON.stringify({ beds: 0 }));
    assertTestIsLocal(h);
});

test('clear discards both test counts without a request and starts the next player from either stat', async () => {
    for (const stat of ['finals', 'beds']) {
        const h = harness();
        await simulate(h, 'finals', '1000', 'beds', '500');
        const before = h.queries.length;
        await simulate(h, 'clear');
        await simulate(h, 'CLEAR');
        assert.equal(h.queries.length, before, 'clearing sends no lookup requests');
        assert(h.messages.at(-1).includes('Test counts cleared.'));
        await simulate(h, stat, '2000');
        assert.equal(JSON.stringify(h.queries.at(-1).targets), JSON.stringify({ [stat]: 2000 }));
        assertTestIsLocal(h);
    }
});

test('combined tests preserve no-match, ambiguity, truncation, and error outcomes without retries', async () => {
    for (const result of [
        { complete: true, candidates: [] },
        { complete: true, candidates: [candidate(), candidate('OtherPlayer')] },
        { complete: false, candidates: [candidate()] },
        { error: 'offline' }, { error: 'keys', retryable: false }
    ]) {
        const h = harness({ find: async () => result });
        await simulate(h, 'finals', '1000', 'beds', '500');
        assert(!h.messages.some(m => m.includes('Confirmed match:')));
        assert(h.messages.some(m => /Could not confidently|Could not check/.test(m)));
        await h.advance(30000);
        assert.equal(h.queries.length, 1);
        assertTestIsLocal(h);
    }
});

test('clear, reset, replacement, and disconnect discard outstanding test replies', async () => {
    for (const action of ['clear', 'reset', 'replace', 'disconnect']) {
        const pending = deferred();
        const h = harness({ find: (targets) => Object.hasOwn(targets, 'beds') ? Promise.resolve(match()) : pending.promise });
        const oldRun = simulate(h, 'finals', '1000');
        assert.equal(h.queries.length, 1);
        if (action === 'replace') await simulate(h, 'beds', '500');
        else if (action === 'reset' || action === 'clear') await simulate(h, action);
        else h.context.connectionTimersCleared = true;
        const before = h.messages.length;
        pending.resolve(match());
        await oldRun;
        assert.equal(h.messages.length, before, 'stale lookup sends no result');
        if (action === 'replace') assert(h.messages.some(m => m.includes('Confirmed match:')));
        assertTestIsLocal(h);
    }
});

test('test mode cannot overwrite a live TestNick match or cancel its pending retry', async () => {
    const h = harness();
    const live = { name: 'TestNick', finals: 30, beds: null, sessionId: 1 };
    const result = { realName: 'ExistingPlayer' };
    h.tracker.autoDenickStats.set('testnick', live);
    h.tracker.autoDenickResults.set('testnick', result);
    h.context.autoDenickRetryTimers.set('testnick', 123);
    await simulate(h, 'finals', '1000', 'beds', '500');
    assert(h.messages.some(m => m.includes('Confirmed match:')));
    assert.equal(h.tracker.autoDenickStats.get('testnick'), live);
    assert.equal(h.tracker.autoDenickResults.get('testnick'), result);
    assert.equal(h.context.autoDenickRetryTimers.get('testnick'), 123);
    assert.equal(h.saved.length, 0);
    assert.equal(h.announced.length, 0);
    assert.equal(h.updates.length, 0);
});

test('live and simulated suggestions group rows under one heading without stat comparisons', async () => {
    for (const stat of ['finals', 'beds']) {
        for (const simulated of [false, true]) {
            const candidates = [-10, 0, 25].map((delta, i) => ({ ...candidate(`Player${i}`), [stat]: 1000 + delta }));
            const h = harness({ find: async () => ({ complete: true, candidates }) });
            if (simulated) await simulate(h, stat, '1000');
            else await h.record(stat, 1000);
            assert.equal(h.messages.filter(m => m.includes('Possible matches:')).length, 1);
            const lines = possibleRows(h);
            assert.equal(lines.length, 3);
            lines.forEach((line, i) => assert(line.includes(`Player${i}`)));
            assert(lines.every(line => /FKDR:.*WLR:.*WS:/.test(line)));
            assert(lines.every(line => !/AutoDenick|Finals:|Beds:|detected |diff /.test(line)));
            assert.equal(h.saved.length, 0);
        }
    }
});

test('later chat counts do not add comparisons to a pending suggestion', async () => {
    const pending = deferred();
    const h = harness({ find: () => pending.promise });
    await h.record('finals', 1000);
    await h.record('finals', 1050);
    pending.resolve({ complete: true, candidates: [{ ...candidate(), finals: 990 }] });
    await flush();
    const line = possibleRows(h)[0];
    assert(line.includes('RealPlayer'));
    assert.equal(h.queries[0].targets.finals, 1000);
    assert(!/Finals:|Beds:|detected |diff /.test(line));
    assert(!line.includes('1,050'));
});

test('combined simulated confirmations omit comparisons while diagnostic comparison support preserves zero', async () => {
    const h = harness({ find: async () => ({ complete: true, candidates: [{ ...candidate(), finals: 990, beds: 525 }] }) });
    await simulate(h, 'finals', '1000', 'beds', '500');
    const line = h.messages.find(m => m.includes('Confirmed match:'));
    assert(/Confirmed match:.*RealPlayer.*FKDR:.*WLR:.*WS:/.test(line));
    assert(!/Finals:|Beds:|detected |diff /.test(line));
    assertTestIsLocal(h);
    assert.equal(stripAnsi(formatDenickStatComparison({ finals: 0 }, { finals: 0 })), ' | Finals: 0 (detected 0; diff 0)');
    assert.equal(formatDenickStatComparison({ finals: null, beds: 0 }, { finals: 1000, beds: null }), '');
});

const taggedUrchin = {
    ok: true, requestStatus: 'ok', rawTags: [
        { type: 'Sniper', reason: 'Synthetic report reason', added_by_username: 'FixtureAuthor', added_on: '2026-10-01' },
        { type: 'Caution', reason: 'Synthetic caution', added_by_username: 'FixtureAuthor', added_on: '2026-10-02' }
    ]
};
const wireMessages = h => {
    const packets = [];
    const client = { write: (name, packet) => {
        assert.equal(name, 'chat');
        assert.equal(packet.position, 0);
        packets.push(JSON.parse(packet.message));
    } };
    h.rawMessages.forEach(message => sendChat(client, message));
    return packets;
};
const walkComponents = component => [component, ...(component.extra || []).flatMap(walkComponents)];

test('start notices are immediate, once per evidence stage, and gray/yellow on the Minecraft wire', async () => {
    for (const first of ['finals', 'beds']) {
        const pending = deferred();
        let calls = 0;
        const h = harness({ find: async () => ++calls === 1 ? pending.promise : { complete: true, candidates: [] } });
        await h.record(first, 1000);
        const starts = () => h.messages.filter(line => line.includes('Started denicking'));
        assert.deepEqual(starts(), [`[AutoDenick] Started denicking HiddenNick using their ${first}.`]);
        await h.record(first, 1001);
        await h.record(first, 1002);
        const second = first === 'finals' ? 'beds' : 'finals';
        await h.record(second, 500);
        assert.equal(starts().length, 1, 'The combined notice waits until its search actually starts.');
        pending.resolve({ complete: true, candidates: [] }); await flush();
        assert.deepEqual(starts(), [
            `[AutoDenick] Started denicking HiddenNick using their ${first}.`,
            '[AutoDenick] Started denicking HiddenNick using their finals and beds.'
        ]);
        await h.record(second, 501); await h.record(first, 1003); await h.advance(60000);
        assert.equal(starts().length, 2, 'Repeated finals, beds and completed stages never repeat the notice.');
        const packets = wireMessages(h).filter(packet => extractText(packet).includes('Started denicking'));
        for (const packet of packets) {
            const segments = walkComponents(packet).filter(part => part.text?.trim());
            assert(segments.every(part => ['gray', 'yellow'].includes(part.color)));
            assert(segments.some(part => part.color === 'yellow' && part.text.includes('HiddenNick')));
            assert(segments.some(part => part.color === 'gray' && part.text.includes('Started denicking')));
        }
        assert.equal(h.partyAnnounced.length, 0);
    }
});

test('start notice ownership is per player and fresh game, while disabled announcements stay quiet', async () => {
    const h = harness({ find: async () => ({ complete: true, candidates: [] }) });
    await h.record('finals', 1000);
    h.context.markNickedPlayer('OtherNick');
    await h.record('finals', 2000, 'OtherNick');
    assert.equal(h.messages.filter(m => m.includes('Started denicking')).length, 2);
    h.context.gameSessionId = 2; h.context.lastBedwarsGameSessionId = 2;
    await h.record('finals', 1001);
    assert.equal(h.messages.filter(m => m.includes('Started denicking HiddenNick')).length, 2);
    const quiet = harness({ local: false, find: async () => ({ complete: true, candidates: [] }) });
    await quiet.record('finals', 1000); await quiet.record('beds', 500);
    assert.equal(quiet.messages.length, 0);
});

test('live and test tagged results are identical on the Minecraft wire, including hover/click events and colors', async () => {
    for (const stat of ['finals', 'beds']) {
        for (const urchin of [taggedUrchin, { ok: true, requestStatus: 'ok', rawTags: [] },
            { ok: false, requestStatus: 'rate_limited' }]) {
            const profile = player();
            profile.data.urchin = urchin;
            const makeHarness = () => {
                const lookup = lookupHarness({ profiles: { realplayer: profile } });
                return harness({ find: lookup.find, realAnnouncements: true, profileLookup: async () => profile });
            };
            const live = makeHarness(), simulated = makeHarness();
            live.context.markNickedPlayer('TestNick');
            await live.record(stat, stat === 'finals' ? 1000 : 500, 'TestNick');
            await simulate(simulated, stat, stat === 'finals' ? '1000' : '500');
            assert.deepEqual(wireMessages(live), wireMessages(simulated), 'possible matches have identical content and formatting');
            const otherStat = stat === 'finals' ? 'beds' : 'finals';
            await live.record(otherStat, otherStat === 'beds' ? 500 : 1000, 'TestNick');
            await simulate(simulated, otherStat, otherStat === 'beds' ? '500' : '1000');
            const livePackets = wireMessages(live);
            assert.deepEqual(livePackets, wireMessages(simulated), 'checking and confirmed results have identical content and formatting');
            assert(!JSON.stringify(livePackets).includes('AutoDenick Test'));
            if (urchin === taggedUrchin) {
                const resultPackets = livePackets.filter(packet => /\(RealPlayer\)/.test(extractText(packet)));
                assert.equal(resultPackets.length, 2);
                for (const packet of resultPackets) {
                    const components = walkComponents(packet);
                    const sniper = components.find(part => part.text.includes('[Sniper'));
                    assert(sniper, 'tags are visible on tentative and confirmed players');
                    assert.equal(sniper.color, 'light_purple');
                    assert.equal(sniper.clickEvent.value, '/urchin RealPlayer', 'actions target the candidate real IGN');
                    assert(sniper.hoverEvent.value.includes('Synthetic report reason'));
                    assert(sniper.hoverEvent.value.includes('FixtureAuthor'));
                    assert(sniper.hoverEvent.value.includes('2026-10-01'));
                    const more = components.find(part => part.text.includes('[+1]'));
                    assert.equal(more.clickEvent.value, '/tagdetails RealPlayer');
                    assert(more.hoverEvent.value.includes('Synthetic caution'));
                }
            } else if (urchin.ok) {
                assert(!JSON.stringify(livePackets).includes('clickEvent'), 'untagged candidates have no tag badges or tag actions');
            } else {
                assert(extractText(livePackets.at(-1)).includes('[U:'), 'provider errors stay distinct from untagged players');
            }
            assert.equal(live.saved.length, 1);
            assert.equal(live.partyAnnounced.length, 1);
            assert.equal(live.cosmetics.length, 2);
            assert(!Object.hasOwn(live.saved[0], 'urchin'), 'tag payloads are not persisted with nickname mappings');
            assert(!Object.hasOwn(live.context.getAutoDenickResult('TestNick'), 'urchin'));
            assertTestIsLocal(simulated);
        }
    }
});

test('live and test errors, no-match results, ambiguity, and unavailable stats use identical wire messages', async () => {
    const results = [
        { complete: true, candidates: [] },
        { complete: true, candidates: [candidate(), candidate('OtherPlayer')] },
        { complete: false, candidates: [candidate()] },
        { complete: false, candidates: ['First', 'Second', 'Third', 'Fourth'].map(candidate) },
        { error: 'offline' }, { error: 'keys', retryable: false },
        { complete: true, candidates: [{ ...candidate(), urchin: taggedUrchin }] }
    ];
    for (const result of results) {
        for (const throwing of [false, true]) {
            const makeHarness = () => harness({ find: async () => result, realAnnouncements: true,
                profileLookup: async () => { if (throwing) throw new Error('offline'); return { error: true }; } });
            const live = makeHarness(), simulated = makeHarness();
            live.context.markNickedPlayer('TestNick');
            await live.record('finals', 1000, 'TestNick');
            await simulate(simulated, 'finals', '1000');
            await live.record('beds', 500, 'TestNick');
            await simulate(simulated, 'beds', '500');
            assert.deepEqual(wireMessages(live), wireMessages(simulated));
            if (result.complete && result.candidates?.length === 1) {
                assert(simulated.messages.at(-1).includes('Stats unavailable right now.'));
                assert(simulated.messages.at(-1).includes('[Sniper'), 'known tags survive a failed confirmation profile refresh');
            }
            assertTestIsLocal(simulated);
        }
    }
});

test('clear, reset and disconnect also discard test results waiting on the confirmation profile', async () => {
    for (const action of ['clear', 'reset', 'disconnect']) {
        const pending = deferred();
        const h = harness({ profileLookup: () => pending.promise });
        const testing = simulate(h, 'finals', '1000', 'beds', '500');
        await flush();
        if (action === 'reset' || action === 'clear') await simulate(h, action);
        else h.context.connectionTimersCleared = true;
        const before = h.rawMessages.length;
        pending.resolve({ ...player(), data: { ...player().data, urchin: taggedUrchin } });
        await testing;
        assert.equal(h.rawMessages.length, before);
        assertTestIsLocal(h);
    }
});
