'use strict';
// Keep exact discrepancies visible, then describe whether only timing fields
// differ. Do not change scoring timestamps, detector inputs or trial validity.
const fs = require('fs'), path = require('path'), assert = require('assert');
const part = process.argv[2]; assert(['autoblock','scaffold'].includes(part));
const output = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real');
const base = part === 'scaffold' ? path.join(output, part) : output;
const result = JSON.parse(fs.readFileSync(path.join(base, 'FULL_RESULTS.json')));
const timingKeys = new Set(['at','t','spanMs']);
function projection(list, omitTiming = false) {
    const selected = list.map(f => ({ family: f.family, tier: f.tier, at: f.at,
        evidence: f.evidence, weight: f.weight, strikes: f.strikes }));
    function visit(v) {
        if (Array.isArray(v)) return v.map(visit);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v)
            .filter(([key]) => !omitTiming || !timingKeys.has(key)).map(([key, value]) => [key, visit(value)]));
        return v;
    }
    return visit(selected);
}
function differences(a, b, prefix = '') {
    if (a === b) return [];
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [{ path: prefix, live: a, offline: b,
        deltaMs: timingKeys.has(prefix.split('.').at(-1)) && Number.isFinite(a) && Number.isFinite(b) ? a - b : null }];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => differences(a[key], b[key], prefix ? prefix + '.' + key : key));
}
const rows = result.liveReplay.divergences.map(row => {
    const live = row.live.map(e => ({ family: e.family, ...e.flag })), offline = row.offline;
    const a = projection(live), b = projection(offline);
    const sameDecisions = JSON.stringify(live.map(f => [f.family,f.tier])) === JSON.stringify(offline.map(f => [f.family,f.tier]));
    const timingOnly = JSON.stringify(projection(live, true)) === JSON.stringify(projection(offline, true));
    return { id: row.id, sameDecisions, category: timingOnly ? 'timing-fields-only' : sameDecisions ? 'evidence-difference' : 'decision-difference',
        differences: differences(a, b), live, offline };
});
const audit = { generatedAt: new Date().toISOString(), trials: result.liveReplay.total,
    exactMatches: result.liveReplay.matched,
    sameDecisionStreams: result.liveReplay.matched + rows.filter(r => r.sameDecisions).length,
    sameEvidenceExcludingTimingFields: result.liveReplay.matched + rows.filter(r => r.category === 'timing-fields-only').length,
    maxAbsoluteTimingDeltaMs: Math.max(0, ...rows.flatMap(r => r.differences).map(r => Math.abs(r.deltaMs || 0))), rows,
    explanation: 'The original owning path calls Date.now separately for recording, Scaffold, and compact combat conversion. Exact differences are retained; no tolerance is used in scoring or validation.' };
fs.writeFileSync(path.join(base, 'CALLBACK_DIFFERENCE_AUDIT.json'), JSON.stringify(audit, null, 2) + '\n');
const section = ['','## Exact callback difference audit','',
    `Exact streams ${audit.exactMatches}/${audit.trials}; identical decision streams ${audit.sameDecisionStreams}/${audit.trials}; identical evidence excluding timing fields ${audit.sameEvidenceExcludingTimingFields}/${audit.trials}.`,
    `Maximum observed timing-field difference: ${audit.maxAbsoluteTimingDeltaMs} ms. Timing fields include flag time, strike time and burst span.`,
    audit.explanation,
    `Discrepancies: ${rows.map(r => r.id + ' (' + r.category + ')').join(', ') || 'none'}. Raw differences: [CALLBACK_DIFFERENCE_AUDIT.json](CALLBACK_DIFFERENCE_AUDIT.json).`, ''].join('\n');
const file = path.join(base, 'REPORT.md');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n## Exact callback difference audit')[0] + section);
console.log(JSON.stringify({ part, ...audit, rows: rows.map(r => ({ id: r.id, category: r.category, differences: r.differences })) }));
