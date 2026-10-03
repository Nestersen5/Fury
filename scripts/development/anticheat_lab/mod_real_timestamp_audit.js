'use strict';
// Preserve exact timestamp mismatches instead of rerunning based on verdicts.
const fs = require('fs'), path = require('path'), assert = require('assert');
const part = process.argv[2]; assert(['autoblock', 'scaffold'].includes(part));
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real', part === 'scaffold' ? 'scaffold' : '');
const result = JSON.parse(fs.readFileSync(path.join(base, 'FULL_RESULTS.json')));
const normalize = flag => JSON.stringify({ family: flag.family, tier: flag.tier,
    evidence: flag.evidence, weight: flag.weight, strikes: flag.strikes });
const audits = result.liveReplay.divergences.map(row => {
    const live = row.live.map(e => ({ family: e.family, ...e.flag })).sort((a, b) => a.at - b.at);
    const offline = row.offline.slice().sort((a, b) => a.at - b.at);
    const sameEvidence = live.length === offline.length && live.every((f, i) => normalize(f) === normalize(offline[i]));
    return { id: row.id, sameEvidence, deltasMs: sameEvidence ? live.map((f, i) => f.at - offline[i].at) : null, live, offline };
});
const output = { generatedAt: new Date().toISOString(), trials: result.liveReplay.total,
    exactMatches: result.liveReplay.matched,
    verdictAndEvidenceMatches: result.liveReplay.matched + audits.filter(a => a.sameEvidence).length,
    maxAbsoluteTimestampDifferenceMs: Math.max(0, ...audits.flatMap(a => a.deltasMs || []).map(Math.abs)),
    audits,
    explanation: 'Recorder and live conversion call Date.now separately in the established proxy post-forward path. Offline replay retains original recording timestamps; no tolerance is applied to scoring or trial validity.' };
fs.writeFileSync(path.join(base, 'LIVE_TIMESTAMP_AUDIT.json'), JSON.stringify(output, null, 2) + '\n');
const note = ['','## Timestamp fidelity detail','',
    `Exact callback streams: ${output.exactMatches}/${output.trials}. Same verdicts, tiers and evidence: ${output.verdictAndEvidenceMatches}/${output.trials}. Largest timestamp difference: ${output.maxAbsoluteTimestampDifferenceMs} ms.`,
    output.explanation,
    'The exact mismatches remain in the raw report. Valid trials were not discarded or rerun to obtain matching detector results. See [LIVE_TIMESTAMP_AUDIT.json](LIVE_TIMESTAMP_AUDIT.json).',''].join('\n');
const report = path.join(base, 'REPORT.md');
const before = fs.readFileSync(report, 'utf8').split('\n## Timestamp fidelity detail')[0];
fs.writeFileSync(report, before + note);
console.log(JSON.stringify({ part, ...output, audits: audits.map(a => ({ id: a.id, sameEvidence: a.sameEvidence, deltasMs: a.deltasMs })) }));
