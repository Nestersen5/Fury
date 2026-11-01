'use strict';

// Synthetic examples, independent of live player stats and saved API keys.
const scenarios = [];
const playerNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const people = values => values.map((value, i) => ({ name: playerNames[i] || `Player${i}`, finals: value, beds: value }));

function single(stat, id, title, values, expected, extra = {}) {
    scenarios.push({ id: `${stat}-${id}`, title, group: stat === 'finals' ? 'Finals only' : 'Beds only',
        events: [{ counts: { [stat]: 1000 } }], players: people(values), expected, ...extra });
}

for (const stat of ['finals', 'beds']) {
    single(stat, 'zero', 'No matches in either range', [799], { names: [], primary: 0, expanded: true, outcome: 'no-match' });
    single(stat, 'zero-to-one', 'No primary matches; widening finds one', [850], { names: ['Alpha'], primary: 0, expanded: true });
    single(stat, 'zero-to-two', 'No primary matches; widening finds two', [850, 800], { names: ['Alpha', 'Bravo'], primary: 0, expanded: true });
    single(stat, 'zero-to-three', 'No primary matches; widening finds three', [899, 850, 800], { names: ['Alpha', 'Bravo', 'Charlie'], primary: 0, expanded: true });
    single(stat, 'zero-to-four', 'No primary matches; widening finds too many', [899, 850, 825, 800], { names: [], primary: 0, expanded: true, outcome: 'too-many' });
    single(stat, 'one', 'One primary match; widening finds nobody else', [1000, 799], { names: ['Alpha'], primary: 1, expanded: true });
    single(stat, 'one-to-two', 'One primary match; widening adds one', [1000, 850], { names: ['Alpha', 'Bravo'], primary: 1, expanded: true });
    single(stat, 'one-to-three', 'One primary match; widening adds two', [1000, 850, 800], { names: ['Alpha', 'Bravo', 'Charlie'], primary: 1, expanded: true });
    single(stat, 'one-to-four', 'One primary match; widening finds too many', [1000, 899, 850, 800], { names: [], primary: 1, expanded: true, outcome: 'too-many' });
    single(stat, 'two', 'Two primary matches; widening finds nobody else', [1000, 950, 799], { names: ['Alpha', 'Bravo'], primary: 2, expanded: true });
    single(stat, 'two-to-three', 'Two primary matches; widening fills the third slot', [1000, 950, 850], { names: ['Alpha', 'Bravo', 'Charlie'], primary: 2, expanded: true });
    single(stat, 'two-to-four', 'Two primary matches; widening finds a fourth', [1000, 950, 850, 800], { names: [], primary: 2, expanded: true, outcome: 'too-many' });
    single(stat, 'three', 'Three primary matches; ignore a player 150 below', [1000, 950, 900, 850], { names: ['Alpha', 'Bravo', 'Charlie'], primary: 3, expanded: false });
    single(stat, 'four', 'Four primary matches; stop checking further players', [1000, 990, 950, 900, 850], { names: [], primary: 4, expanded: false, outcome: 'too-many', checks: 4 });
    single(stat, 'minus100', 'Exactly 100 below belongs to the primary range', [900], { names: ['Alpha'], primary: 1, expanded: true });
    single(stat, 'minus101', 'Exactly 101 below needs widening', [899], { names: ['Alpha'], primary: 0, expanded: true });
    single(stat, 'minus200', 'Exactly 200 below is accepted after widening', [800], { names: ['Alpha'], primary: 0, expanded: true });
    single(stat, 'minus201', 'Exactly 201 below is rejected', [799], { names: [], primary: 0, expanded: true, outcome: 'no-match' });
    single(stat, 'ceiling', 'Highest allowed total above the detected count', [stat === 'finals' ? 1004 : 1000], { names: ['Alpha'], primary: 1, expanded: true });
    single(stat, 'above-ceiling', 'One above the upper allowance is rejected', [stat === 'finals' ? 1005 : 1001], { names: [], primary: 0, expanded: true, outcome: 'no-match' });
    single(stat, 'empty', 'Aurora returns nobody', [], { names: [], primary: 0, expanded: true, outcome: 'no-match', checks: 0 });
    single(stat, 'duplicates', 'Repeated names are checked and displayed once', [1000], { names: ['Alpha'], primary: 1, expanded: true, checks: 1 }, { lists: { [stat]: ['Alpha', 'ALPHA'] } });
    single(stat, 'limited', 'A full provider list does not mark the search incomplete', [1000], { names: ['Alpha'], primary: 1, expanded: true, complete: true, checks: 1 }, { lists: { [stat]: Array(10).fill('Alpha') } });
    single(stat, 'count-zero', 'A detected total of zero is valid', [0], { names: ['Alpha'], primary: 1, expanded: true }, { events: [{ counts: { [stat]: 0 } }] });
}

function combined(id, title, players, expected, extra = {}) {
    scenarios.push({ id: `combined-${id}`, title, group: 'Both stats', players,
        events: [{ counts: { finals: 1000, beds: 1000 } }], expected, ...extra });
}

combined('unique', 'One complete match confirms', people([1000]), { outcome: 'confirmed', names: ['Alpha'], complete: true });
combined('two', 'Two players match both stats', people([1000, 950]), { outcome: 'ambiguous', names: ['Alpha', 'Bravo'] });
combined('none', 'No player matches both stats', [{ name: 'Alpha', finals: 1000, beds: 1001 }], { outcome: 'combined-no-match', names: [] });
combined('minus100', 'Both stats exactly 100 below can confirm', people([900]), { outcome: 'confirmed', names: ['Alpha'] });
combined('minus101-finals', 'Combined finals do not widen to 200', [{ name: 'Alpha', finals: 899, beds: 1000 }], { outcome: 'combined-no-match', names: [] });
combined('minus101-beds', 'Combined beds do not widen to 200', [{ name: 'Alpha', finals: 1000, beds: 899 }], { outcome: 'combined-no-match', names: [] });
combined('finals-plus4', 'Four extra finals and no extra beds can confirm', [{ name: 'Alpha', finals: 1004, beds: 1000 }], { outcome: 'confirmed', names: ['Alpha'] });
combined('finals-plus5', 'Five extra finals prevent confirmation', [{ name: 'Alpha', finals: 1005, beds: 1000 }], { outcome: 'combined-no-match', names: [] });
combined('beds-plus1', 'One extra bed prevents confirmation', [{ name: 'Alpha', finals: 1000, beds: 1001 }], { outcome: 'combined-no-match', names: [] });
combined('one-list', 'A player in only one list can still confirm', people([1000]), { outcome: 'confirmed', names: ['Alpha'] }, { lists: { finals: ['Alpha'], beds: [] } });
combined('gap25-62', 'A 50-finals gap permits a 62-beds gap', [{ name: 'Alpha', finals: 950, beds: 938 }], { outcome: 'confirmed', names: ['Alpha'] });
combined('gap25-63', 'A 50-finals gap rejects a 63-beds gap', [{ name: 'Alpha', finals: 950, beds: 937 }], { outcome: 'combined-no-match', names: [] });
combined('gap25-exact', 'A four-finals gap permits exactly five beds', [{ name: 'Alpha', finals: 996, beds: 995 }], { outcome: 'confirmed', names: ['Alpha'] });
combined('gap25-zero', 'Exact finals require exact beds', [{ name: 'Alpha', finals: 1000, beds: 999 }], { outcome: 'combined-no-match', names: [] });
combined('limited', 'One verified match confirms despite a full provider list', people([1000]), { outcome: 'confirmed', names: ['Alpha'], complete: true },
    { lists: { finals: Array(10).fill('Alpha'), beds: ['Alpha'] } });

for (const firstStat of ['finals', 'beds']) {
    for (const pendingFirst of [false, true]) {
        const other = firstStat === 'finals' ? 'beds' : 'finals';
        scenarios.push({ id: `latest-${firstStat}${pendingFirst ? '-pending' : ''}`, group: 'Latest counts',
            title: `Use the latest ${firstStat} when ${other} arrives${pendingFirst ? ' during the first search' : ''}`,
            players: [{ name: 'Alpha', finals: firstStat === 'finals' ? 1001 : 1000, beds: firstStat === 'beds' ? 1001 : 1000 }],
            events: [{ counts: { [firstStat]: 1000 } }, { waitMs: 60000, counts: { [firstStat]: 1001 } }, { waitMs: 60000, counts: { [other]: 1000 } }],
            pendingFirst, expected: { outcome: 'confirmed', names: ['Alpha'], searched: { [firstStat]: 1001, [other]: 1000 } } });
    }
}

for (const combinedQuery of [false, true]) {
    scenarios.push({ id: `error-${combinedQuery ? 'combined' : 'single'}-discovery`, group: 'Errors and limits', title: 'Aurora failure is an error, not no matches',
        players: people([1000]), events: [{ counts: combinedQuery ? { finals: 1000, beds: 1000 } : { finals: 1000 } }],
        response: { data: { success: false } }, expected: { outcome: 'error', names: [], checks: 0 } });
    scenarios.push({ id: `error-${combinedQuery ? 'combined' : 'single'}-profile`, group: 'Errors and limits', title: 'Hypixel failure is an error, not no matches',
        players: people([1000]), events: [{ counts: combinedQuery ? { finals: 1000, beds: 1000 } : { finals: 1000 } }],
        profileError: 'Alpha', expected: { outcome: 'error', names: [], checks: 1 } });
}

const cappedPlayers = Array.from({ length: 26 }, (_, i) => ({ name: `Player${i}`, finals: i === 25 ? 1000 : 799, beds: i === 25 ? 1000 : 799 }));
scenarios.push({ id: 'limit-single-25', group: 'Errors and limits', title: 'The 26th player is not checked beyond the profile limit when stored counts are unknown',
    players: cappedPlayers, events: [{ counts: { finals: 1000 } }], expected: { outcome: 'no-match', names: [], checks: 25, complete: true, primary: 0, expanded: true } });
combined('limit-25', 'A match after the profile limit remains unknown without stored counts to prioritize it', cappedPlayers, { outcome: 'combined-no-match', names: [], checks: 25, complete: true });
combined('one-within-limit', 'One checked match confirms without checking the 26th player', cappedPlayers.map((person, i) =>
    i === 0 ? { ...person, finals: 1000, beds: 1000 } : person), { outcome: 'confirmed', names: ['Player0'], checks: 25, complete: true });

scenarios.push({ id: 'test-reset', group: 'Test command', title: 'Reset clears the first stat before entering another', modes: ['test'],
    players: people([1000]), events: [{ counts: { finals: 1000 } }, { reset: true }, { counts: { beds: 1000 } }],
    expected: { names: ['Alpha'], searched: { beds: 1000 } } });

module.exports = { scenarios };
