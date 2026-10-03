'use strict';
// Read-only analysis of frozen real-client recordings. Writes only mod-real outputs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveTarget } = require('../../../src/recorder/recordingAnalysis');
const { evaluate } = require('./evaluate_campaign');

const root = path.resolve(__dirname, '../../..');
const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file));
const rows = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const partDir = part => part === 'scaffold' ? path.join(outputRoot, 'scaffold') : outputRoot;
const detectorDirs = {
    OLD: path.join(root, 'output/anticheat-lab/autoblock-v2/baseline-detectors'),
    NEW: path.join(root, 'src/detect')
};
const pinned = {
    'output/anticheat-lab/autoblock-v2/baseline-detectors/autoblockDetector.js': 'a7ce23bacdb1681c2f2d0711cab7c39f4c95385eae3d2f84c936e2facb5afc8e',
    'src/detect/autoblockDetector.js': 'eb13ff1a2303b1691033c7461a5a07fc89105086e4d92b2a3d8b411b011be6cf',
    'src/detect/detectorShared.js': '2113d07146dab75e9f77a48ebe17796087834fe3b663fd64c0478727b5efa986',
    'src/detect/scaffoldDetector.js': '4c4c7a6a2a7225b420bd5ddb38b9653f51a7337cf55ee90a976073e3a0212555'
};
function checkHashes() {
    for (const [file, expected] of Object.entries(pinned))
        assert.strictEqual(sha(fs.readFileSync(path.join(root, file))), expected, file);
    assert.strictEqual(sha(fs.readFileSync(path.join(detectorDirs.OLD, 'scaffoldDetector.js'))), pinned['src/detect/scaffoldDetector.js']);
}

function buildEvidence(part) {
    checkHashes();
    const base = partDir(part), planFile = path.join(base, `FULL_PLAN_${part}.json`);
    const planBytes = fs.readFileSync(planFile), plan = JSON.parse(planBytes);
    const reviewFile = path.join(base, 'FULL_HUD_REVIEW.json');
    const reviews = fs.existsSync(reviewFile) ? readJson(reviewFile) : {};
    const exclusionsFile = path.join(base, 'FULL_EXCLUSIONS.json');
    const excludedRuns = fs.existsSync(exclusionsFile) ? readJson(exclusionsFile).runs : {};
    const addendumFile = path.join(base, 'FULL_PROTOCOL_ADDENDUM.json');
    const addendum = fs.existsSync(addendumFile) ? readJson(addendumFile) : null;
    const replayExclusionsFile = path.join(base, 'FULL_REPLAY_EXCLUSIONS.json');
    const replayExclusions = fs.existsSync(replayExclusionsFile) ? readJson(replayExclusionsFile).runs : {};
    const attempts = [], selected = [];
    const runs = fs.readdirSync(base).filter(name => name.startsWith('full-') && fs.statSync(path.join(base, name)).isDirectory()).sort();
    for (const runName of runs) {
        const run = path.join(base, runName);
        const ticks = rows(path.join(run, 'server-ticks.jsonl'));
        const relay = rows(path.join(run, 'transport.jsonl'));
        const byTicks = new Map(), byRelay = new Map();
        for (const row of ticks) { if (!byTicks.has(row.label)) byTicks.set(row.label, []); byTicks.get(row.label).push(row); }
        for (const row of relay) { if (!byRelay.has(row.label)) byRelay.set(row.label, []); byRelay.get(row.label).push(row); }
        for (const trialId of fs.readdirSync(run).filter(name => /^[a-z]\d+_\d+$/.test(name))) {
            const spec = plan.trials.find(row => row.id === trialId);
            if (!spec) continue;
            for (const attemptName of fs.readdirSync(path.join(run, trialId)).filter(name => name.startsWith('attempt-')).sort()) {
                const directory = path.join(run, trialId, attemptName);
                const truthFile = path.join(directory, 'ground-truth.json');
                if (!fs.existsSync(truthFile)) continue;
                const truthBytes = fs.readFileSync(truthFile), truth = JSON.parse(truthBytes);
                const label = `${spec.id}_a${String(Number(attemptName.slice(8))).padStart(2, '0')}`;
                const activeStart = truth.cheatStartAt || truth.controlStartAt || truth.startedAt;
                const activeEnd = truth.activeEndAt || truth.endedAt;
                const observerFile = path.join(run, `${label}.observer-packets.jsonl`);
                const packets = rows(observerFile), actor = packets.filter(row => row.data?.entityId === truth.actorId &&
                    row.t >= activeStart && row.t <= activeEnd);
                const moves = actor.filter(row => ['rel_entity_move', 'entity_move_look', 'entity_teleport'].includes(row.name));
                const swings = actor.filter(row => row.name === 'animation' && row.data?.animation === 0);
                const uses = actor.filter(row => row.name === 'entity_metadata' && row.data?.metadata?.some(entry => entry.key === 0 && (entry.value & 16)));
                const placed = packets.filter(row => row.t >= activeStart && row.t <= activeEnd &&
                    row.name === 'block_change' && row.data?.type === 16 &&
                    (spec.scenarioId === 'L11' || row.data?.location?.y === 79));
                const uniquePlaced = [...new Map(placed.map(row =>
                    [`${row.data.location.x},${row.data.location.y},${row.data.location.z}`, row])).values()];
                const placements = uniquePlaced.map(row =>
                    `${row.data.location.x},${row.data.location.y},${row.data.location.z}`);
                const input = rows(path.join(directory, 'input.jsonl'));
                const screenshots = ['hud_all_off.png', ...spec.enabled.map(name => `hud_after_${name.toLowerCase()}.png`)];
                const reviewKey = path.relative(base, directory).replaceAll('\\', '/');
                const review = reviews[reviewKey] || { status: 'pending' };
                const launchFile = path.join(directory, 'client-launch.json');
                const recorderFile = truth.recorderFile ? path.join(run, truth.recorderFile) : null;
                const recording = recorderFile && fs.existsSync(recorderFile) ? rows(recorderFile) : [];
                const header = recording.find(row => row.k === 'header');
                const target = recording.length ? resolveTarget(recording, { player: 'LabActor' }) : null;
                const ownTicks = (byTicks.get(label) || []).filter(row => row.t >= activeStart && row.t <= activeEnd);
                const ownRelay = (byRelay.get(label) || []).filter(row => row.type === 'delivery' && row.receivedAt >= activeStart && row.receivedAt <= activeEnd);
                const checks = {
                    planMatchesTruth: truth.seed === spec.seed && truth.scenarioId === spec.scenarioId &&
                        JSON.stringify(truth.requestedEnabled) === JSON.stringify(spec.enabled),
                    correctedScenario: !addendum?.correctionIds.includes(spec.id) ||
                        (runName !== addendum.supersededRun && !!truth.protocolBehavior),
                    sprintLeadIn: spec.scenarioId !== 'L3' || !truth.protocolBehavior || actor.some(row =>
                        row.name === 'entity_metadata' && row.data?.metadata?.some(entry => entry.key === 0 && (entry.value & 8))),
                    foodConsumed: spec.scenarioId !== 'L5' || !truth.protocolBehavior?.startsWith('food:') || actor.some(row =>
                        row.name === 'entity_equipment' && row.data?.slot === 0 && row.data?.item?.blockId === 297 &&
                        row.data.item.itemCount < 64),
                    inputLog: input.length > 10 && input.every(row => row.ok && (row.command !== 'key' ||
                        (Number.isInteger(row.vk) && typeof row.down === 'boolean')) && (row.command !== 'mouse' ||
                        (['left','right'].includes(row.button) && typeof row.down === 'boolean'))),
                    toggleLog: truth.toggles?.length === spec.enabled.length,
                    localTarget: fs.existsSync(launchFile) && readJson(launchFile).target.host === '127.0.0.1',
                    recording: !!header && header.source === 'live' && header.player === 'LabActor' && target.ids.has(Number(truth.actorId)),
                    movement: moves.some(row => row.data?.dX || row.data?.dY || row.data?.dZ),
                    swings: swings.length > 0,
                    useFlag: part === 'scaffold' || uses.length > 0,
                    placements: part === 'autoblock' || placements.length >= 12,
                    ticks: ownTicks.length >= 20,
                    relay: ownRelay.some(row => row.owner === 'actor') && ownRelay.some(row => row.owner === 'observer'),
                    screenshots: screenshots.every(name => fs.existsSync(path.join(directory, name))),
                    hudConfirmed: review.status === 'confirmed'
                };
                const invalidReasons = [...truth.invalidReasons,
                    ...(excludedRuns[runName] ? [excludedRuns[runName]] : []),
                    ...(replayExclusions[runName]?.[spec.id] ? [replayExclusions[runName][spec.id]] : []),
                    ...Object.entries(checks).filter(([, okay]) => !okay).map(([name]) => name)];
                const attempt = { id: spec.id, scenario: spec.scenarioId, run: runName, attempt: attemptName, directory,
                    valid: invalidReasons.length === 0, invalidReasons, checks, review,
                    evidence: { swings: swings.length, useOnUpdates: uses.length, nonzeroMoves: moves.filter(row =>
                        row.data?.dX || row.data?.dY || row.data?.dZ).length, acceptedPlacements: placements.length,
                        tickSamples: ownTicks.length, actorRelayDeliveries: ownRelay.filter(row => row.owner === 'actor').length,
                        observerRelayDeliveries: ownRelay.filter(row => row.owner === 'observer').length } };
                attempts.push(attempt);
                if (attempt.valid) selected.push({ id: spec.id, scenario: spec.scenarioId, split: 'evaluation',
                    effectExpected: spec.effectExpected, directory: run, recorderFile: truth.recorderFile,
                    recorderSha256: sha(fs.readFileSync(recorderFile)), groundTruthSha256: sha(truthBytes),
                    observerSha256: sha(fs.readFileSync(observerFile)), actorId: truth.actorId,
                    startedAt: part === 'scaffold' && spec.effectExpected ? truth.firstCheatAssistedPlacementAt : activeStart,
                    activeEndAt: activeEnd, firstCheatAssistedPlacementAt: truth.firstCheatAssistedPlacementAt,
                    acceptedPlacementTimes: uniquePlaced.map(row => row.t), trialDirectory: directory,
                    run: runName, attempt: attemptName });
            }
        }
    }
    const unique = new Map();
    for (const row of selected) if (!unique.has(row.id)) unique.set(row.id, row);
    const missing = plan.trials.filter(row => !unique.has(row.id)).map(row => row.id);
    const duplicates = selected.filter((row, i) => selected.findIndex(other => other.id === row.id) !== i).map(row => row.id);
    const evidence = { schema: 1, part, generatedAt: new Date().toISOString(), planFile,
        planSha256: sha(planBytes), complete: missing.length === 0 && duplicates.length === 0,
        planned: plan.trials.length, valid: unique.size, missing, duplicates,
        attempts, rows: [...unique.values()].sort((a, b) => plan.trials.findIndex(p => p.id === a.id) - plan.trials.findIndex(p => p.id === b.id)) };
    write(path.join(base, 'FULL_EVIDENCE.json'), evidence);
    console.log(JSON.stringify({ part, planned: evidence.planned, valid: evidence.valid,
        attempts: attempts.length, missing, duplicates }, null, 2));
    return evidence;
}

function replayTrial(trial, detectorDir) {
    const recording = rows(path.join(trial.directory, trial.recorderFile));
    const flags = [], notes = [];
    let peakScaffold = null;
    const { createScaffoldDetector } = require(path.join(detectorDir, 'scaffoldDetector.js'));
    const { createAutoblockDetector } = require(path.join(detectorDir, 'autoblockDetector.js'));
    const { createStasisDetector } = require(path.join(detectorDir, 'stasisDetector.js'));
    const scaffold = createScaffoldDetector({ onFlag: flag => flags.push({ family: 'Scaffold', ...flag }),
        log: message => notes.push(message), requireCleanPlayback: () => false });
    const autoblock = createAutoblockDetector({ onFlag: flag => flags.push({ family: 'Autoblock', ...flag }) });
    const stasis = createStasisDetector({ onFlag: flag => flags.push({ family: 'Stasis', ...flag }) });
    for (const record of recording) {
        for (const detector of [scaffold, autoblock, stasis]) detector.observeRecord(record);
        // Scaffold weight can decay before the recording ends. Retain the
        // highest observed weight so a near miss is not hidden by that decay.
        if (record.k === 'blk' || record.k === 'mblk') {
            const current = scaffold.getStatus().find(row => row.name === 'LabActor');
            if (current && (!peakScaffold || current.weight > peakScaffold.weight))
                peakScaffold = { ...current, at: record.t,
                    evidence: notes.filter(message => message.includes('strike on LabActor')).slice(-5) };
        }
    }
    return { flags: flags.filter(flag => Number(flag.entityId) === Number(trial.actorId)),
        status: scaffold.getStatus().find(row => row.name === 'LabActor') || null,
        peakScaffold,
        notes: notes.filter(message => message.includes('LabActor')),
        recordingStartAt: recording[0]?.t, recordingEndAt: recording.at(-1)?.t };
}

function replay(part) {
    checkHashes();
    const base = partDir(part), evidence = readJson(path.join(base, 'FULL_EVIDENCE.json'));
    assert(evidence.complete, `Incomplete ${part} evidence: ${evidence.missing.length} missing`);
    for (const [name, detectorDir] of Object.entries(detectorDirs)) {
        const campaignFile = path.join(base, `FULL_REPLAY_${name}_campaign.json`);
        if (!fs.existsSync(campaignFile)) evaluate(path.join(base, 'FULL_EVIDENCE.json'), detectorDir, 'evaluation', campaignFile, 1);
    }
    const out = { schema: 1, part, evidenceSha256: sha(fs.readFileSync(path.join(base, 'FULL_EVIDENCE.json'))),
        variants: {} };
    for (const [name, detectorDir] of Object.entries(detectorDirs)) {
        out.variants[name] = evidence.rows.map(trial => ({ id: trial.id, scenario: trial.scenario,
            effectExpected: trial.effectExpected, ...replayTrial(trial, detectorDir) }));
    }
    write(path.join(base, 'FULL_REPLAY_DETAILS.json'), out);
    console.log(JSON.stringify({ part, replayed: evidence.rows.length }, null, 2));
    return out;
}

function auditLiveReplay(part) {
    checkHashes();
    const base = partDir(part), exclusionsFile = path.join(base, 'FULL_EXCLUSIONS.json');
    const excludedRuns = fs.existsSync(exclusionsFile) ? readJson(exclusionsFile).runs : {};
    const addendumFile = path.join(base, 'FULL_PROTOCOL_ADDENDUM.json');
    const addendum = fs.existsSync(addendumFile) ? readJson(addendumFile) : null;
    const replayExclusionsFile = path.join(base, 'FULL_REPLAY_EXCLUSIONS.json');
    const replayExclusions = fs.existsSync(replayExclusionsFile) ? readJson(replayExclusionsFile).runs : {};
    const audits = [];
    for (const runName of fs.readdirSync(base).filter(name => name.startsWith('full-') && !excludedRuns[name])) {
        const run = path.join(base, runName);
        if (!fs.statSync(run).isDirectory()) continue;
        const traceFile = path.join(run, 'fury-profile/lab-detector-trace.jsonl');
        if (!fs.existsSync(traceFile)) continue;
        const trace = rows(traceFile);
        for (const trialId of fs.readdirSync(run).filter(name => /^[a-z]\d+_\d+$/.test(name))) {
            if (replayExclusions[runName]?.[trialId] || runName === addendum?.supersededRun &&
                addendum.correctionIds.includes(trialId)) continue;
            for (const attemptName of fs.readdirSync(path.join(run, trialId)).filter(name => name.startsWith('attempt-'))) {
                const truthFile = path.join(run, trialId, attemptName, 'ground-truth.json');
                if (!fs.existsSync(truthFile)) continue;
                const truth = readJson(truthFile);
                if (!truth.automatedValid) continue;
                const trial = { id: truth.id, directory: run, recorderFile: truth.recorderFile,
                    actorId: truth.actorId };
                const offline = replayTrial(trial, detectorDirs.NEW);
                const live = trace.filter(row => row.kind === 'flag' && Number(row.flag?.entityId) === Number(trial.actorId) &&
                    row.observedAt >= offline.recordingStartAt && row.observedAt <= offline.recordingEndAt)
                    .map(row => ({ family: row.family, ...row.flag }));
                const normalized = list => list.map(flag => JSON.stringify({ family: flag.family, tier: flag.tier,
                    at: flag.at, evidence: flag.evidence, weight: flag.weight, strikes: flag.strikes })).sort();
                audits.push({ id: truth.id, run: runName, attempt: attemptName,
                    matched: JSON.stringify(normalized(live)) === JSON.stringify(normalized(offline.flags)),
                    live, offline: offline.flags });
            }
        }
    }
    const output = { schema: 1, part, generatedAt: new Date().toISOString(), checked: audits.length,
        matched: audits.filter(row => row.matched).length, divergences: audits.filter(row => !row.matched) };
    write(path.join(base, 'LIVE_REPLAY_AUDIT.json'), output);
    console.log(JSON.stringify({ part, checked: output.checked, matched: output.matched,
        divergences: output.divergences.map(row => row.id) }));
}

const [action, part] = process.argv.slice(2);
assert(['autoblock', 'scaffold'].includes(part), 'Usage: node mod_real_analysis.js validate|replay|audit autoblock|scaffold');
if (action === 'validate') buildEvidence(part);
else if (action === 'replay') replay(part);
else if (action === 'audit') auditLiveReplay(part);
else throw new Error('Expected validate, replay or audit');
