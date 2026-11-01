'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateDenickStatGaps, evaluateDenickStats } = require('../../src/denick/commands');
const { player, lookupHarness, harness } = require('../../scripts/test_support/auto_stats_denick');

test('beds gap permits 25 percent more than the finals gap, including exact and fractional boundaries', () => {
    const targets = { finals: 1000, beds: 1000 };
    for (const [finalsGap, bedsGap, expected] of [[50, 62, true], [50, 63, false], [4, 5, true], [4, 6, false],
        [0, 0, true], [0, 1, false], [1, 1, true], [1, 2, false]]) {
        const verdict = evaluateDenickStats(targets, { finals: 1000 - finalsGap, beds: 1000 - bedsGap });
        assert.equal(verdict.gapOk, expected, `${finalsGap} finals / ${bedsGap} beds`);
        assert.equal(verdict.maxBedsGap, finalsGap * 1.25);
        assert(verdict.finalsOk && verdict.bedsOk, 'the existing per-stat ranges are independent');
    }
    assert.equal(evaluateDenickStatGaps(targets, { finals: 950, beds: 925 }, { bedsGapAllowancePercent: 50 }).gapOk, true);
    assert.equal(evaluateDenickStatGaps(targets, { finals: 950, beds: 925 }).gapOk, false);
    assert.equal(evaluateDenickStatGaps({ finals: 1000 }, { finals: 999, beds: 100 }).gapOk, true);
    assert.equal(evaluateDenickStatGaps(targets, { finals: 1000 }).gapOk, true, 'missing counts stay unknown');
    assert.equal(evaluateDenickStats(targets, { finals: 1005, beds: 1000 }).finalsOk, false);
    assert.equal(evaluateDenickStats(targets, { finals: 950, beds: 1001 }).bedsOk, false);
});

test('Aurora gap filtering saves profile requests, merges case-insensitive rows, and preserves missing counts', async () => {
    const events = [];
    const h = lookupHarness({ lists: {
        finals: [{ name: 'vnsw', finals: 4497 }, { name: 'Siennawr', finals: 4467 }, { name: 'UnknownBeds', finals: 4450 }],
        beds: [{ name: 'VNSW', beds: 1796 }, { name: 'SIENNAWR', beds: 1874 }]
    }, profiles: { vnsw: player(4450, 1882), siennawr: player(4467, 1874), unknownbeds: player(4450, 1820) } });
    const result = await h.find({ finals: 4500, beds: 1882 }, { onTrace: event => events.push(event) });
    assert.deepEqual(result.candidates.map(c => c.name), ['siennawr', 'unknownbeds']);
    assert.deepEqual(h.verified.map(v => v.name), ['siennawr', 'unknownbeds']);
    assert.equal(h.requests.length, 2);
    const skipped = events.find(event => event.type === 'candidate-filter');
    assert.equal(skipped.name, 'vnsw');
    assert.equal(skipped.finalsGap, 3);
    assert.equal(skipped.bedsGap, 86);
    assert.equal(skipped.maxBedsGap, 3.75);
    assert(!JSON.stringify(events).includes('fixture'));
});

test('verified gaps reject vnsw and accept Siennawr across manual, automatic and test lookups', async () => {
    for (const [name, finals, beds, targetFinals, expected] of [['vnsw', 4497, 1796, 4500, false], ['Siennawr', 4467, 1874, 4479, true]]) {
        for (const mode of ['manual', 'live', 'test']) {
            const profile = player(finals, beds);
            profile.data.player.displayname = name;
            const lookup = lookupHarness({ profiles: { realplayer: profile } });
            if (mode === 'manual') assert.equal((await lookup.find({ finals: targetFinals, beds: 1882 })).candidates.length, expected ? 1 : 0);
            else {
                const h = harness({ find: lookup.find, realAnnouncements: true, profileLookup: async () => profile });
                if (mode === 'test') await h.context.handleAutoDenickTestCommand(['/denick', 'test', 'finals', String(targetFinals), 'beds', '1882']);
                else { await h.record('finals', targetFinals); await h.record('beds', 1882); }
                assert.equal(h.messages.some(message => message.includes('Confirmed match:')), expected);
                assert.equal(h.saved.length, mode === 'live' && expected ? 1 : 0);
            }
        }
    }
});

test('Aurora gap rejections do not consume the twenty-five-profile budget', async () => {
    const names = [...Array.from({ length: 16 }, (_, i) => `Rejected${i}`), 'Allowed'];
    const rows = names.map(name => ({ name, finals: name === 'Allowed' ? 950 : 999, beds: name === 'Allowed' ? 938 : 900 }));
    const h = lookupHarness({ lists: { finals: rows, beds: rows }, profiles: { allowed: player(950, 938) } });
    const result = await h.find({ finals: 1000, beds: 1000 });
    assert.deepEqual(h.verified.map(v => v.name), ['allowed']);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.complete, true);
});

test('a correct fiftieth Aurora candidate with both stats is prioritized before partial-stat candidates', async () => {
    const decoys = Array.from({ length: 49 }, (_, i) => `Decoy${i}`);
    const rows = [...decoys.map(name => ({ name, finals: 1000 })), { name: 'Correct', finals: 1000 }];
    const profiles = Object.fromEntries([...decoys.map(name => [name.toLowerCase(), player(1000, 99999)]), ['correct', player(1000, 1000)]]);
    const h = lookupHarness({ lists: { finals: rows, beds: [{ name: 'Correct', beds: 1000 }] }, profiles });
    const events = [];
    const result = await h.find({ finals: 1000, beds: 1000 }, { onTrace: event => events.push(event) });
    const shortlist = events.find(event => event.type === 'shortlist');
    assert.equal(shortlist.verifyLimit, 25);
    assert.equal(shortlist.names[0], 'correct');
    assert.equal(shortlist.ranking[0].knownStats, 2);
    assert.equal(shortlist.ranking[0].score, 0);
    assert.equal(h.verified[0].name, 'correct');
    assert.equal(h.verified.length, 25);
    assert.deepEqual(result.candidates.map(candidate => candidate.name), ['correct']);
});

test('priority uses both-stat evidence, known distance, delayed totals and stable ties without assuming missing counts', async () => {
    const rows = [{ name: 'PartialFar', finals: 970 }, { name: 'FullTie', finals: 994, beds: 997 },
        { name: 'Unknown' }, { name: 'Outdated', finals: 700, beds: 700 }, { name: 'FullCloser', finals: 995, beds: 996 },
        { name: 'PartialExact', finals: 1000 }, { name: 'PartialOld', finals: 799 }];
    const h = lookupHarness({ lists: { finals: rows, beds: [] } });
    const events = [];
    await h.find({ finals: 1000, beds: 1000 }, { verifyLimit: 0, onTrace: event => events.push(event) });
    const shortlist = events.find(event => event.type === 'shortlist');
    assert.deepEqual(shortlist.names, ['fulltie', 'fullcloser', 'partialexact', 'partialfar', 'partialold', 'outdated', 'unknown']);
    assert.equal(shortlist.ranking[0].score, 9);
    assert.equal(shortlist.ranking[1].score, 9, 'equal combined distances preserve discovery order');
    assert.equal(shortlist.ranking.at(-1).knownStats, 0);
    assert.equal(shortlist.ranking.at(-1).reason, 'stored counts unknown');
    assert.equal(h.verified.length, 0);
});
