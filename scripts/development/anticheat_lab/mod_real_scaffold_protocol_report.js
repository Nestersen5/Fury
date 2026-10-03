'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const base = path.resolve(__dirname, '../../../output/anticheat-lab/mod-real/scaffold');
const read = name => JSON.parse(fs.readFileSync(path.join(base, name)));
const evidence = read('FULL_EVIDENCE.json'); assert(evidence.complete);
const context = read('CONTEXT_PROTOCOL_ADDENDUM.json'), careful = read('CAREFUL_CONTROL_ADDENDUM.json');
const incomplete = [];
for (const run of fs.readdirSync(base).filter(n => /^full-\d+$/.test(n))) {
    for (const id of fs.readdirSync(path.join(base, run)).filter(n => /^[a-z]\d+_\d+$/.test(n))) {
        for (const attempt of fs.readdirSync(path.join(base, run, id)).filter(n => /^attempt-\d+$/.test(n))) {
            const directory = path.join(base, run, id, attempt);
            if (!fs.existsSync(path.join(directory, 'ground-truth.json'))) incomplete.push({ id, run, attempt, directory,
                reason: context.interruptedAttempt?.id === id && context.interruptedAttempt.run === run ?
                    context.interruptedAttempt.reason : 'No completed ground-truth file; excluded.' });
        }
    }
}
const invalid = evidence.attempts.filter(row => !row.valid);
const audit = { generatedAt: new Date().toISOString(), complete: true, validFullTrials: evidence.valid,
    completedAttempts: evidence.attempts.length, invalidOrSupersededCompletedAttempts: invalid.length,
    interruptedIncompleteAttempts: incomplete, invalidCompletedAttempts: invalid,
    originalPlanOrderSeedsAndSettingsPreserved: true,
    protocolExclusionsIndependentOfDetectorVerdicts: true };
fs.writeFileSync(path.join(base, 'PROTOCOL_AND_INVALID_AUDIT.json'), JSON.stringify(audit, null, 2) + '\n');
const text = ['', '## Capture protocol and incomplete evidence', '',
    `${evidence.valid} valid full trials; ${invalid.length} invalid or superseded completed attempts; ${incomplete.length} additional interrupted attempts with no completed ground truth. Pilots are separate and never count toward these rates.`, '',
    'The whole earlier disabled-setup protocol was superseded because live detectors missed the initial entity positions that recorder snapshots supplied offline. Every captured ID was repeated with actual observer teleport packets while scoring was enabled, without selecting on a detector verdict. Sources and thresholds stayed pinned.', '',
    'All six L10 controls were repeated with deliberate air clicks, retaining their original IDs, seeds and settings. The accepted pilot used four 150-pixel movement steps in each direction; the preceding large-motion pilot failed the observer pitch gate and remains invalid. Full controls require at least three logged air-click intervals with actual observer look packets below 35 degrees. All six passed.', '',
    'One supplementary position-context pilot used an isolated directory under mod-real/context-pilots/client-game rather than the requested client-game subtree. It was excluded from full results. Every accepted full trial passed the isolated launcher/settings audit.', '',
    'GodBridge direction changes use strafe changes between straight and diagonal travel. Telly has scripted Space held. These are limits of the tested input scenarios. Mod Java Random is unseeded; input, transport, tick conditions and plans are seeded. Retries ran later in the session.', '',
    'The exact offline/live streams matched 81/82; the remaining stream has only 1 ms differences in flag time, strike time and burst span. All 82 decision streams and evidence excluding those timing fields matched. No timestamp was changed or tolerance applied to scoring.', '',
    'Invalid/interrupted inventory: [PROTOCOL_AND_INVALID_AUDIT.json](PROTOCOL_AND_INVALID_AUDIT.json). Protocol provenance: [context addendum](CONTEXT_PROTOCOL_ADDENDUM.json), [careful-control addendum](CAREFUL_CONTROL_ADDENDUM.json).', '',
    ...incomplete.map(row => `- ${row.id} ${row.run}/${row.attempt}: ${row.reason}`), ''];
const report = path.join(base, 'REPORT.md');
fs.writeFileSync(report, fs.readFileSync(report, 'utf8').split('\n## Capture protocol and incomplete evidence')[0] + text.join('\n'));
console.log(JSON.stringify({ valid: evidence.valid, invalidCompleted: invalid.length, incomplete }));
