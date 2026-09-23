'use strict';
const assert = require('assert');
const { relativeDate } = require('../../src/launcher/renderer/launcher_session_card');
const cases = [
    ['2026-09-12T01:00:00', '2026-09-12T23:00:00', '(today)'],
    ['2026-09-11T23:59:00', '2026-09-12T00:01:00', '(1 day ago)'],
    ['2026-09-03', '2026-09-12', '(9 days ago)'],
    ['2026-08-07', '2026-09-12', '(1 month 5 days ago)'],
    ['2026-07-11', '2026-09-12', '(2 months 1 day ago)'],
    ['2026-01-31', '2026-02-28', '(1 month ago)'],
    ['2024-01-31', '2024-02-29', '(1 month ago)'],
    ['2026-08-31', '2026-09-12', '(12 days ago)'],
    ['2025-12-07', '2026-01-12', '(1 month 5 days ago)'],
    ['2026-03-28', '2026-03-30', '(2 days ago)'],
    ['2026-09-13', '2026-09-12', ''],
    ['invalid', '2026-09-12', '']
];
for (const [start, now, expected] of cases) {
    const local = value => new Date(value.includes('T') || value === 'invalid' ? value : `${value}T12:00:00`);
    assert.strictEqual(relativeDate(local(start), local(now)), expected, `${start} to ${now}`);
}
console.log('Session card relative dates passed (calendar boundaries, leap years, DST, invalid/future dates).');

const {stats}=require('../../src/launcher/renderer/launcher_session_card');
for(const [value,colors] of [[0.5,['#aaaaaa','#aaaaaa','#aaaaaa']],[2,['#55ff55','#55ff55','#55ff55']],[4,['#ffaa00','#00aa00','#00aa00']],[8,['#aa0000','#ffff55','#ffff55']],[20,['#aa0000','#aa0000','#aa0000']]]){
    const entries=stats({mode:'BEDWARS',wlr:value,fkdr:value,kdr:value,bblr:value});
    assert.deepStrictEqual(entries.map(e=>e.color),[...colors,'#ffff55']);
}
console.log('BedWars card ratios match /stats threshold colors, including yellow BBLR.');
