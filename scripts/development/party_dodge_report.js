'use strict';

// Aggregates the self-labeled party-arrival records the proxy appends to
// recordings/party_arrivals.jsonl (one line per started game).
//
//   node scripts/development/party_dodge_report.js
//
// A co-arrival group labeled same_team is party evidence; split_teams is a
// confirmed false positive. Labels from games with only 2 visible teams
// (4v4) are marked weak: once one team fills, everyone else is forced onto
// the other team, so same_team stops meaning much there.

const fs = require('fs');
const { dataPath } = require('../../src/storage/runtimePaths.js');

const file = process.argv[2] || dataPath('recordings', 'party_arrivals.jsonl');
if (!fs.existsSync(file)) {
    console.error(`No label file at ${file} - play some games with the proxy running first.`);
    process.exit(1);
}

const records = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
    .filter(Boolean);

console.log(`${records.length} labeled game(s) in ${file}\n`);

const tally = { same_team: [], split_teams: [], unresolved: [] };
records.forEach((record, index) => {
    const teams = new Set(record.arrivals.map(a => a.team).filter(Boolean));
    const weak = teams.size <= 2;
    const when = new Date(record.at).toISOString().replace('T', ' ').slice(0, 16);
    const groups = Array.isArray(record.groups) ? record.groups : [];
    console.log(`game ${index + 1} (${when}) teams=${teams.size || '?'}${weak ? ' [weak labels]' : ''}: `
        + `${record.arrivals.length} arrivals, ${groups.length} group(s)`);
    groups.forEach(group => {
        console.log(`   ${group.size}x [${group.aliases.join(', ')}] spread=${group.spreadMs}ms `
            + `maxGap=${group.maxGapMs}ms -> ${group.label}`);
        tally[group.label]?.push({ ...group, weak });
    });
});

function stats(list, field) {
    if (!list.length) return 'n/a';
    const values = list.map(g => g[field]).sort((a, b) => a - b);
    return `min=${values[0]} med=${values[Math.floor(values.length / 2)]} max=${values[values.length - 1]}`;
}

console.log('\n=== calibration summary (co-arrival groups, size >= 2) ===');
['same_team', 'split_teams', 'unresolved'].forEach(label => {
    const all = tally[label];
    const strong = all.filter(g => !g.weak);
    console.log(`${label}: ${all.length} total (${strong.length} strong-label)`);
    if (all.length) {
        console.log(`   spreadMs ${stats(all, 'spreadMs')} | maxGapMs ${stats(all, 'maxGapMs')}`);
    }
});
console.log('\nThe detector threshold must sit above same_team maxGap values and');
console.log('below split_teams gaps. Overlap means: collect more games (prefer');
console.log('solos/doubles - 8 teams - for strong labels).');
