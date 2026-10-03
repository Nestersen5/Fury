'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'output/anticheat-lab/mod-real');
const base = path.join(output, 'scaffold'), archive = path.join(output, 'overnight/scaffold-context-before-repair');
assert(!fs.existsSync(archive), 'Context repair already documented'); fs.mkdirSync(archive);
for (const name of ['FULL_EVIDENCE.json','FULL_HUD_REVIEW.json','LIVE_REPLAY_AUDIT.json','LIVE_CONTEXT_DIAGNOSTIC.json','POSITION_CONTEXT_CANDIDATE_CHECK.json'])
    if (fs.existsSync(path.join(base, name))) fs.copyFileSync(path.join(base, name), path.join(archive, name), fs.constants.COPYFILE_EXCL);
const runs = ['full-1790717797095', 'full-1790717942500'];
const reason = 'Whole protocol superseded: live Scaffold ignored starting positions during disabled arena setup; compact recorder snapshots supplied them offline. Rerun every captured ID with verified actual observer teleport packets while detection is on, independent of each detector verdict.';
const exclusionsFile = path.join(base, 'FULL_EXCLUSIONS.json');
const exclusions = fs.existsSync(exclusionsFile) ? JSON.parse(fs.readFileSync(exclusionsFile)) : { runs: {} };
for (const run of runs) { assert(fs.existsSync(path.join(base, run))); exclusions.runs[run] = reason; }
fs.writeFileSync(exclusionsFile, JSON.stringify(exclusions, null, 2) + '\n');
const addendum = { createdAt: new Date().toISOString(), protocol: 'enabled-position-v1', supersededRuns: runs,
    originalFrozenPlanUnchanged: true, orderAndSeedsUnchanged: true, moduleSettingsUnchanged: true,
    detectorSourcesAndThresholdsUnchanged: true, exclusionsApplyToWholeProtocolNotSelectedOutcomes: true,
    reason, interruptedAttempt: { id: 'l10_003', run: runs[1], attempt: 'attempt-001',
        reason: 'Owned runner stopped during active play for protocol correction; no completed ground truth, excluded.' } };
fs.writeFileSync(path.join(base, 'CONTEXT_PROTOCOL_ADDENDUM.json'), JSON.stringify(addendum, null, 2) + '\n', { flag: 'wx' });
const stopFile = path.join(output, 'overnight/scaffold-context-repair-stop.json');
const stop = JSON.parse(fs.readFileSync(stopFile)); stop.reason = addendum.interruptedAttempt.reason;
fs.writeFileSync(stopFile, JSON.stringify(stop, null, 2) + '\n');
const pilot = path.join(output, 'context-pilots/scaffold'); fs.mkdirSync(pilot, { recursive: true });
fs.copyFileSync(path.join(base, 'FULL_PLAN_scaffold.json'), path.join(pilot, 'FULL_PLAN_scaffold.json'), fs.constants.COPYFILE_EXCL);
console.log(JSON.stringify(addendum));
