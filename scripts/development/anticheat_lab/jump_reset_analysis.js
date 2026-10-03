'use strict';
// Labels and input logs are used only for independent validation and scoring.
// The detector receives compact observer records only, in their original order.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { resolveTarget, uuidNameMap, entityName } = require('../../../src/recorder/recordingAnalysis');
const { createJumpResetDetector, DEFAULTS } = require('./jump_reset_candidate');
const { stats, analysis } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real/jump-reset');
const read = file => JSON.parse(fs.readFileSync(file));
const rows = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (name, value, exclusive = false) => fs.writeFileSync(path.join(base, name), JSON.stringify(value, null, 2) + '\n', exclusive ? { flag: 'wx' } : {});
const args = process.argv.slice(2), action = args[0];
const split = args.find(a => a.startsWith('--split='))?.split('=')[1];
assert(!split || ['calibration', 'evaluation'].includes(split));

function validate() {
    analysis.checkHashes();
    const planFile = path.join(base, 'FULL_PLAN.json'), plan = read(planFile);
    const reviews = fs.existsSync(path.join(base, 'FULL_HUD_REVIEW.json')) ? read(path.join(base, 'FULL_HUD_REVIEW.json')) : {};
    const attempts = [], selected = new Map();
    for (const runName of fs.readdirSync(base).filter(n => /^full-\d+$/.test(n)).sort()) {
        const run = path.join(base, runName), tickRows = rows(path.join(run, 'server-ticks.jsonl')),
            relayRows = rows(path.join(run, 'transport.jsonl')), serverLog = fs.readFileSync(path.join(run, 'server.log'), 'utf8');
        for (const spec of plan.trials) {
            const trial = path.join(run, spec.id); if (!fs.existsSync(trial)) continue;
            for (const attemptName of fs.readdirSync(trial).filter(n => /^attempt-\d+$/.test(n)).sort()) {
                const directory = path.join(trial, attemptName), truthFile = path.join(directory, 'ground-truth.json');
                if (!fs.existsSync(truthFile)) continue;
                const truth = read(truthFile), label = `${spec.id}_a${String(Number(attemptName.slice(8))).padStart(2, '0')}`;
                const start = truth.controlStartAt, end = truth.activeEndAt;
                const input = rows(path.join(directory, 'input.jsonl'));
                const packets = rows(path.join(run, truth.observerPacketFile || `${label}.observer-packets.jsonl`));
                const actor = packets.filter(r => Number(r.data?.entityId) === Number(truth.actorId) && r.t >= start && r.t <= end);
                const recordFile = truth.recorderFile && path.join(run, truth.recorderFile);
                const records = recordFile ? rows(recordFile) : [], header = records.find(r => r.k === 'header');
                const target = records.length ? resolveTarget(records, { player: 'LabActor' }) : null;
                const launchFile = path.join(directory, 'client-launch.json'), launch = fs.existsSync(launchFile) ? read(launchFile) : null;
                const key = path.relative(base, directory).replaceAll('\\', '/');
                const hurts = actor.filter(r => r.name === 'entity_status' && r.data.entityStatus === 2);
                const move = actor.filter(r => ['rel_entity_move', 'entity_move_look', 'entity_teleport'].includes(r.name));
                const ownTicks = tickRows.filter(r => r.label === label && r.t >= start && r.t <= end);
                const relay = relayRows.filter(r => r.label === label && r.type === 'delivery' && r.receivedAt >= start && r.receivedAt <= end);
                const shots = ['hud_all_off.png', ...spec.enabled.map(n => `hud_after_${n.toLowerCase()}.png`)];
                const checks = {
                    frozenPlan: truth.seed === spec.seed && truth.split === spec.split &&
                        JSON.stringify(truth.scenario) === JSON.stringify(spec) && !truth.pilot,
                    inputProtocol: truth.inputProtocol === 'actor-view-controls-v2',
                    independentJumps: spec.scenarioId !== 'L13' || truth.independentJumpSchedule?.length >= 12,
                    moduleSettings: JSON.stringify(truth.requestedEnabled) === JSON.stringify(spec.enabled) &&
                        Object.entries(spec.settings).every(([name, settings]) => Object.entries(settings).every(([k, v]) =>
                            JSON.stringify(truth.fullModuleSettings?.[name]?.settings?.[k]) === JSON.stringify(v))),
                    localLaunch: launch?.target?.host === '127.0.0.1' && launch.target.port > 0 &&
                        path.resolve(launch.cwd).startsWith(path.join(root, 'output/anticheat-lab/mod-real/client-game')) &&
                        !launch.arguments.some(a => a.includes('vapetest.selftest')),
                    joined: serverLog.includes('LabActor joined the game'),
                    input: input.length > 10 && input.every(r => r.ok && Number.isFinite(r.t)),
                    focusChecked: input.some(r => r.command === 'focus'),
                    noCheatJumpInput: !spec.enabled.length || !input.some(r => r.command === 'key' && r.vk === 0x20 && r.down),
                    toggleLog: truth.toggles?.length === spec.enabled.length && truth.toggles.every(r => r.enabled && Number.isFinite(r.t)),
                    screenshots: shots.every(name => fs.existsSync(path.join(directory, name))),
                    hudConfirmed: reviews[key]?.status === 'confirmed',
                    recording: header?.source === 'live' && header.player === 'LabActor' && target?.ids.has(Number(truth.actorId)),
                    hurts: hurts.length >= 12, movement: move.length > 10,
                    swings: actor.some(r => r.name === 'animation' && r.data.animation === 0),
                    ticks: ownTicks.length >= 20,
                    actorAndObserverRelay: relay.some(r => r.owner === 'actor') && relay.some(r => r.owner === 'observer'),
                    activeDuration: end - start >= spec.activeMs
                };
                const invalidReasons = [...(truth.invalidReasons || []), ...Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)];
                const entry = { id: spec.id, scenario: spec.scenarioId, split: spec.split, run: runName, attempt: attemptName,
                    directory, valid: invalidReasons.length === 0, invalidReasons, checks,
                    evidence: { hurts: hurts.length, movements: move.length, ticks: ownTicks.length,
                        observerVelocities: actor.filter(r => r.name === 'entity_velocity').length } };
                attempts.push(entry);
                if (entry.valid && !selected.has(spec.id)) selected.set(spec.id, {
                    id: spec.id, scenario: spec.scenarioId, split: spec.split, effectExpected: spec.effectExpected,
                    directory: run, trialDirectory: directory, recorderFile: truth.recorderFile, observerPacketFile: truth.observerPacketFile,
                    actorId: truth.actorId, startedAt: truth.cheatStartAt || start, activeEndAt: end,
                    recorderSha256: sha(fs.readFileSync(recordFile)), groundTruthSha256: sha(fs.readFileSync(truthFile)),
                    observerSha256: sha(fs.readFileSync(path.join(run, truth.observerPacketFile))) });
            }
        }
    }
    const missing = plan.trials.filter(s => !selected.has(s.id)).map(s => s.id);
    const evidence = { schema: 1, generatedAt: new Date().toISOString(), planSha256: sha(fs.readFileSync(planFile)),
        planned: plan.trials.length, valid: selected.size, complete: !missing.length, missing, attempts,
        rows: plan.trials.map(s => selected.get(s.id)).filter(Boolean) };
    write('FULL_EVIDENCE.json', evidence);
    console.log(JSON.stringify({ planned: evidence.planned, valid: evidence.valid, missing: missing.length,
        bySplit: Object.fromEntries(['calibration', 'evaluation'].map(s => [s, evidence.rows.filter(r => r.split === s).length])) }));
    return evidence;
}
function selectedRows(evidence, requestedSplit) {
    const selected = evidence.rows.filter(r => !requestedSplit || r.split === requestedSplit);
    const plan = read(path.join(base, 'FULL_PLAN.json')).trials.filter(r => !requestedSplit || r.split === requestedSplit);
    assert.strictEqual(selected.length, plan.length, `Incomplete ${requestedSplit || 'full'} validated recordings`);
    return selected;
}
function replayOne(trial, thresholds, includeBaseline = true) {
    const file = path.join(trial.directory, trial.recorderFile);
    assert.strictEqual(sha(fs.readFileSync(file)), trial.recorderSha256);
    const records = rows(file), flags = [], opportunities = [];
    // Display identity comes exclusively from observer tab/spawn/snapshot data.
    // Ground truth is used only by the result callbacks/scoring after detection.
    const observerUuids = uuidNameMap(records), observerNames = new Map();
    for (const record of records) if (record.k === 'spawn' || record.k === 'snap') {
        const name = entityName(record, observerUuids);
        if (name) observerNames.set(Number(record.id), name);
    }
    const detector = createJumpResetDetector({ thresholds, nameOf: id => observerNames.get(Number(id)) || null,
        onFlag: flag => { if (Number(flag.entityId) === Number(trial.actorId)) flags.push({ family: 'JumpReset', ...flag }); },
        onOpportunity: e => { if (e.entityId === trial.actorId && e.velocityAt >= trial.startedAt && e.velocityAt <= trial.activeEndAt) opportunities.push(e); } });
    for (const record of records) detector.observeRecord(record);
    const baseline = includeBaseline ? analysis.replayTrial(trial,
        path.join(root, 'output/anticheat-lab/mod-real/overnight/baseline-source/src/detect')).flags : [];
    return { id: trial.id, scenario: trial.scenario, effectExpected: trial.effectExpected,
        flags: [...baseline, ...flags], jumpFlags: flags, opportunities, status: detector.getStatus().find(s => s.name === 'LabActor') || null };
}
function calibrate() {
    assert(!fs.existsSync(path.join(base, 'FROZEN_CANDIDATE.json')), 'Candidate is already frozen; no retuning from evaluation');
    const protocol = read(path.join(base, 'LOOK_PROTOCOL_ADDENDUM.json'));
    assert(protocol.decidedBeforeFullCaptures && protocol.passed, 'A validated pre-capture feature protocol is required');
    for (const [name, expected] of Object.entries(protocol.sourceHashes))
        assert.strictEqual(sha(fs.readFileSync(path.join(__dirname, name))), expected, `Pre-capture feature changed: ${name}`);
    assert.strictEqual(sha(fs.readFileSync(path.join(base, 'CALIBRATION_SEARCH_PLAN.json'))), protocol.searchPlanSha256,
        'Pre-capture calibration search plan changed');
    const evidence = read(path.join(base, 'FULL_EVIDENCE.json')), selected = selectedRows(evidence, 'calibration');
    const calibrationEvidenceFile = path.join(base, 'CALIBRATION_EVIDENCE.json');
    assert(!fs.existsSync(calibrationEvidenceFile), 'Calibration evidence already archived; investigate rather than silently replacing it');
    fs.copyFileSync(path.join(base, 'FULL_EVIDENCE.json'), calibrationEvidenceFile, fs.constants.COPYFILE_EXCL);
    const grid = [];
    // Search recorded before opening any evaluation results. Prefer no false
    // alerts in calibration, then sensitivity, then the stricter tied threshold.
    const searchPlan = read(path.join(base, 'CALIBRATION_SEARCH_PLAN.json'));
    for (const minOpportunities of searchPlan.minOpportunities) for (const minHitFraction of searchPlan.minHitFraction)
        for (const minHits of searchPlan.minHits) {
            if (minHits > minOpportunities) continue;
            const cfg = { ...DEFAULTS, minOpportunities, minHitFraction, minHits };
            const details = selected.map(r => replayOne(r, cfg, false));
            const s = stats.variantStats(selected, details, 'JumpReset');
            grid.push({ thresholds: cfg, tp: s.targetAny.k, fp: s.falseTarget.k, sensitivity: s.targetAny,
                falseFlags: s.falseTarget });
        }
    const acceptable = grid.filter(r => r.fp === 0).sort((a, b) => b.tp - a.tp ||
        b.thresholds.minHitFraction - a.thresholds.minHitFraction || b.thresholds.minHits - a.thresholds.minHits ||
        b.thresholds.minOpportunities - a.thresholds.minOpportunities);
    write('CALIBRATION_SEARCH.json', { generatedAt: new Date().toISOString(), calibrationIds: selected.map(r => r.id),
        evaluationUsed: false, searchPlanSha256: sha(fs.readFileSync(path.join(base, 'CALIBRATION_SEARCH_PLAN.json'))),
        objective: 'zero calibration false flags, maximum TP, stricter tie break', grid });
    assert(acceptable.length, 'No zero-FP calibration candidate. Raw search results retained; do not claim reliability.');
    const winner = acceptable[0];
    const frozen = { schema: 1, frozenAt: new Date().toISOString(), thresholds: winner.thresholds,
        calibration: winner, evidenceSha256: sha(fs.readFileSync(calibrationEvidenceFile)), calibrationEvidenceFile,
        calibrationIds: selected.map(r => r.id), sourceHashes: Object.fromEntries(['jump_reset_candidate.js', 'jump_reset_observer_features.js']
            .map(name => [name, sha(fs.readFileSync(path.join(__dirname, name)))])), tier: 'possible',
        caveat: 'Legal jump timing can produce the same observer packets; never a confirmed verdict.' };
    write('FROZEN_CANDIDATE.json', frozen, true); console.log(JSON.stringify(frozen));
}
function report() {
    const evidence = read(path.join(base, split === 'calibration' ? 'CALIBRATION_EVIDENCE.json' : 'FULL_EVIDENCE.json')),
        selected = selectedRows(evidence, split);
    const frozen = read(path.join(base, 'FROZEN_CANDIDATE.json'));
    assert.strictEqual(sha(fs.readFileSync(frozen.calibrationEvidenceFile)), frozen.evidenceSha256, 'Archived calibration evidence changed');
    for (const [name, hash] of Object.entries(frozen.sourceHashes)) assert.strictEqual(sha(fs.readFileSync(path.join(__dirname, name))), hash);
    const result = { generatedAt: new Date().toISOString(), split: split || 'all', frozen,
        variants: {}, invalidAttempts: evidence.attempts.filter(a => !a.valid && (!split || a.split === split)) };
    for (const [name, cfg] of Object.entries({ PILOT_BASELINE: DEFAULTS, CALIBRATED: frozen.thresholds })) {
        const details = selected.map(r => replayOne(r, cfg));
        const overall = stats.variantStats(selected, details, 'JumpReset');
        const scenarios = Object.fromEntries([...new Set(selected.map(r => r.scenario))].map(id =>
            [id, stats.variantStats(selected.filter(r => r.scenario === id), details, 'JumpReset')]));
        const bySplit = Object.fromEntries(['calibration', 'evaluation'].filter(s => selected.some(r => r.split === s)).map(s =>
            [s, stats.variantStats(selected.filter(r => r.split === s), details, 'JumpReset')]));
        result.variants[name] = { overall, scenarios, bySplit, trials: details };
    }
    const ids = selected.filter((r, i) => !!result.variants.PILOT_BASELINE.trials[i].jumpFlags.length !==
        !!result.variants.CALIBRATED.trials[i].jumpFlags.length).map(r => r.id);
    let oldOnly = 0, newOnly = 0;
    selected.forEach((r, i) => { const a = !!result.variants.PILOT_BASELINE.trials[i].jumpFlags.length,
        b = !!result.variants.CALIBRATED.trials[i].jumpFlags.length; if (a && !b) oldOnly++; if (b && !a) newOnly++; });
    result.paired = { differences: ids, oldOnly, newOnly, p: stats.exactMcNemar(oldOnly, newOnly) };
    const sharedTiming = selected.filter(r => r.effectExpected).flatMap(trial => {
        const first = variant => result.variants[variant].trials.find(r => r.id === trial.id).jumpFlags
            .filter(f => f.at >= trial.startedAt).sort((a, b) => a.at - b.at)[0];
        const initial = first('PILOT_BASELINE'), calibrated = first('CALIBRATED');
        return initial && calibrated ? [{ id: trial.id, initialAt: initial.at, calibratedAt: calibrated.at,
            deltaSeconds: (calibrated.at - initial.at) / 1000 }] : [];
    });
    result.paired.sharedTiming = { calibratedMinusInitialSeconds: stats.distribution(sharedTiming.map(r => r.deltaSeconds)),
        trials: sharedTiming };
    const suffix = split ? `_${split.toUpperCase()}` : '';
    write(`FULL_RESULTS${suffix}.json`, result);
    const text = ['# Real-client Jump Reset evaluation', '',
        `Validated trials: ${selected.length}. Split: ${split || 'calibration and independent evaluation, shown separately'}. Pilots excluded.`, '',
        'Only Possible pattern alerts are emitted; confirmed detection is 0. Manual jumps can be indistinguishable from this automation.', '',
        'Initial thresholds and calibrated thresholds use the same frozen damage-motion feature pipeline. This baseline is a prototype comparison, not a previous production Jump Reset detector.', '',
        '| Scenario | n | Initial thresholds: detection / false flags | Calibrated: detection / false flags |', '| --- | ---: | --- | --- |'];
    for (const id of Object.keys(result.variants.CALIBRATED.scenarios)) {
        const a = result.variants.PILOT_BASELINE.scenarios[id], b = result.variants.CALIBRATED.scenarios[id];
        const rate = s => stats.rateText(id.startsWith('L') ? s.falseAnyDetector : s.targetAny);
        text.push(`| ${id} | ${b.n} | ${rate(a)} | ${rate(b)} |`);
    }
    for (const [name, value] of Object.entries(result.variants)) for (const [which, s] of Object.entries(value.bySplit)) {
        text.push('', `## ${name}: ${which}`, '',
            `Jump Reset detection: ${stats.rateText(s.targetAny)}. Confirmed: ${stats.rateText(s.targetConfirmed)}.`,
            `False flags from any detector: ${stats.rateText(s.falseAnyDetector)}. Jump Reset false flags: ${stats.rateText(s.falseTarget)}.`,
            `Any-detector accuracy: ${stats.rateText(s.accuracyAnyDetector)}; precision: ${stats.rateText(s.precision)}; recall: ${stats.rateText(s.recall)}.`,
            `F1: ${s.f1.value.toFixed(3)} (Wilson-bound envelope ${s.f1.low.toFixed(3)}–${s.f1.high.toFixed(3)}, not a separate 95% F1 interval).`,
            `Time to first flag, detected cheat trials only: ${stats.timeText(s.timeToFlagSeconds)}.`,
            `Other detector flags: ${s.unexpected.map(r => r.id).join(', ') || 'none'}.`,
            `Missed trials: ${value.trials.filter(r => selected.find(t => t.id === r.id).split === which && r.effectExpected && !r.jumpFlags.length).map(r => r.id).join(', ') || 'none'}.`);
    }
    text.push('', '## Comparison and limits', '',
        `Baseline-only ${oldOnly}; calibrated-only ${newOnly}; exact two-sided McNemar p=${result.paired.p.toPrecision(5)}. Verdict differences: ${ids.join(', ') || 'none'}.`,
        `Paired first-flag delay on commonly detected cheat trials (calibrated minus initial): ${stats.timeText(result.paired.sharedTiming.calibratedMinusInitialSeconds)}. The overall medians use different detected subsets.`,
        'The calibration grid used calibration recordings only. Its candidate was frozen before evaluation scoring. Evaluation is reported separately; pooled results are descriptive.',
        'This is a Vape-based Forge port, not Vape itself; see the [Jump Reset fidelity audit](MOD_FIDELITY.md) and [broader mod audit](../MOD_FIDELITY.md). Inputs are scripted on a vanilla 1.8.9 loopback server, not human Bed Wars or Hypixel. One Windows machine. Java Random inside the read-only mod is unseeded.',
        'Victim knockback velocity is generally not exposed to the observer. Detection therefore uses damage and visible trajectories, with clock and landing gates. Skillful legal jumps can look identical; low-chance presets and missing trajectories can be missed.',
        'All velocity records and pure look records are ignored uniformly because live and recorded shapes differ. These protocols were fixed before full captures; see the [trajectory addendum](TRAJECTORY_PROTOCOL_ADDENDUM.json) and [look addendum](LOOK_PROTOCOL_ADDENDUM.json). These scores are offline observer replays; production live parity is verified separately.',
        'Zero false flags in a finite scripted set is not a guarantee for real players. No automatic punishment is justified by these pattern alerts.', '',
        '## Invalid attempts', '', ...result.invalidAttempts.map(a => `- ${a.id} ${a.run}/${a.attempt}: ${a.invalidReasons.join(', ')}`), '',
        `Raw per-trial callbacks, opportunities and comparisons: [FULL_RESULTS${suffix}.json](FULL_RESULTS${suffix}.json).`, '');
    fs.writeFileSync(path.join(base, `REPORT${suffix}.md`), text.join('\n'));
    console.log(JSON.stringify({ split: split || 'all', trials: selected.length,
        baseline: result.variants.PILOT_BASELINE.overall.targetAny, calibrated: result.variants.CALIBRATED.overall.targetAny,
        falseFlags: result.variants.CALIBRATED.overall.falseAnyDetector }));
}
if (action === 'prepare-search') {
    assert(!fs.existsSync(path.join(base, 'FROZEN_CANDIDATE.json')));
    assert(!fs.readdirSync(base).some(n => /^full-\d+$/.test(n)), 'Prepare the search before full Jump Reset captures');
    write('CALIBRATION_SEARCH_PLAN.json', { createdAt: new Date().toISOString(),
        decidedBeforeFullCaptures: true, evaluationUsed: false,
        minOpportunities: [8,10,12], minHitFraction: [0.25,0.4,0.55,0.6,0.7,0.8,0.9,0.95], minHits: [3,5,7,9,10],
        rationale: 'Measure low-chance sensitivity and the false-positive tradeoff, instead of searching only near the strict pilot preset.',
        objective: 'Zero calibration false flags, then maximum cheat trials detected; stricter thresholds break ties.' }, true);
    console.log('Jump Reset search plan frozen before full captures.');
}
else if (action === 'validate') validate();
else if (action === 'calibrate') calibrate();
else if (action === 'report') report();
else throw new Error('Usage: node jump_reset_analysis.js validate|calibrate|report [--split=calibration|evaluation]');
