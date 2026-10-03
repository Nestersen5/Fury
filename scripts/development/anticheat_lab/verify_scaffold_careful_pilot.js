'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), Module = require('module');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real/careful-pilots/scaffold');
const file = path.join(__dirname, 'mod_real_analysis.js');
let source = require('./adapt_scaffold_careful_validation')(require('./adapt_scaffold_context_validation')(fs.readFileSync(file, 'utf8')));
const before = "const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');";
assert.strictEqual(source.split(before).length, 2);
source = source.replace(before, "const outputRoot = path.join(root, 'output/anticheat-lab/mod-real/careful-pilots');");
const anchor = 'const [action, part] = process.argv.slice(2);';
assert.strictEqual(source.split(anchor).length, 2);
source = source.slice(0, source.indexOf(anchor)) + '\nmodule.exports = { buildEvidence, replayTrial, detectorDirs };';
const compiled = new Module(file, module); compiled.filename = file;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, file);
const analysis = compiled.exports, evidence = analysis.buildEvidence('scaffold');
assert.strictEqual(evidence.rows.length, 1, 'Exactly one manually reviewed careful pilot required');
const row = evidence.rows[0], truth = JSON.parse(fs.readFileSync(path.join(row.trialDirectory, 'ground-truth.json')));
assert(truth.pilot && truth.scenarioId === 'L10' && truth.requestedEnabled.length === 0);
assert(truth.intentionalAirClicks.length >= 3);
const replay = analysis.replayTrial(row, analysis.detectorDirs.NEW);
const trace = fs.readFileSync(path.join(row.directory, 'fury-profile/lab-detector-trace.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const live = trace.filter(e => e.kind === 'flag' && e.flag?.entityId === truth.actorId &&
    e.observedAt >= replay.recordingStartAt && e.observedAt <= replay.recordingEndAt).map(e => ({ family: e.family, ...e.flag }));
const normalize = flags => flags.map(f => ({ family: f.family, tier: f.tier, at: f.at,
    evidence: f.evidence, weight: f.weight, strikes: f.strikes }));
assert.deepStrictEqual(normalize(live), normalize(replay.flags), 'Pilot live/offline callback parity');
const launch = JSON.parse(fs.readFileSync(path.join(row.trialDirectory, 'client-launch.json')));
assert(path.resolve(launch.arguments[launch.arguments.indexOf('--gameDir') + 1]).startsWith(path.join(root, 'output/anticheat-lab/mod-real/client-game')));
const result = { generatedAt: new Date().toISOString(), passed: true, id: row.id,
    excludedFromFullResults: true, evidence: evidence.attempts.find(a => a.valid),
    intentionalAirClicks: truth.intentionalAirClicks, liveCallbacks: live, offlineCallbacks: replay.flags };
fs.writeFileSync(path.join(base, 'CAREFUL_PILOT_CHECK.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, id: row.id, clicks: truth.intentionalAirClicks.length,
    placements: result.evidence.evidence.acceptedPlacements, callbacks: live.length }));
