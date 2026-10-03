'use strict';
// Summarize frozen real-client evidence and full-fidelity offline detector callbacks.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');
const read = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const partDir = part => part === 'scaffold' ? path.join(outputRoot, 'scaffold') : outputRoot;
const pct = x => `${(100 * x).toFixed(1)}%`;
const fmt = x => Number.isFinite(x) ? x.toFixed(2) : 'n/a';
function wilson(k, n) {
    if (!n) return { k, n, p: null, low: null, high: null };
    const z = 1.95996398454, p = k / n, den = 1 + z*z/n;
    const mid = (p + z*z/(2*n))/den;
    const half = z*Math.sqrt(p*(1-p)/n + z*z/(4*n*n))/den;
    return { k, n, p, low: Math.max(0, mid-half), high: Math.min(1, mid+half) };
}
function rateText(r) { return r.n ? `${r.k}/${r.n} (${pct(r.p)}; Wilson 95% ${pct(r.low)}–${pct(r.high)})` : '0/0 (n/a)'; }
function distribution(values) {
    if (!values.length) return { n: 0, median: null, mean: null, p90: null };
    const sorted = [...values].sort((a,b) => a-b), middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return { n: values.length, median, mean: values.reduce((a,b)=>a+b,0)/values.length,
        p90: sorted[Math.ceil(sorted.length * 0.9) - 1] };
}
function timeText(d, unit = 's') { return d.n ? `n=${d.n}; median ${fmt(d.median)}${unit}, mean ${fmt(d.mean)}${unit}, p90 ${fmt(d.p90)}${unit}` : 'n=0; n/a'; }
function f1(p, r) { return p+r ? 2*p*r/(p+r) : 0; }
function exactMcNemar(oldOnly, newOnly) {
    const n = oldOnly + newOnly;
    if (!n) return 1;
    let term = Math.pow(0.5, n), sum = term;
    for (let k=1; k<=Math.min(oldOnly,newOnly); k++) { term *= (n-k+1)/k; sum += term; }
    return Math.min(1, 2*sum);
}
function variantStats(trials, detail, targetFamily) {
    const joined = trials.map(trial => ({ trial, result: detail.find(row => row.id === trial.id) }));
    assert(joined.every(row => row.result));
    const positives = joined.filter(row => row.trial.effectExpected);
    const negatives = joined.filter(row => !row.trial.effectExpected);
    const trialFlags = row => row.result.flags.filter(flag => !row.trial.effectExpected || flag.at >= row.trial.startedAt);
    const target = row => trialFlags(row).filter(flag => flag.family === targetFamily);
    const anyTarget = row => target(row).length > 0;
    const anyDetector = row => trialFlags(row).length > 0;
    const confirmed = row => target(row).some(flag => flag.tier === 'confirmed');
    const tp = positives.filter(anyTarget).length, fp = negatives.filter(anyDetector).length;
    const precision = wilson(tp, tp + fp), recall = wilson(tp, positives.length);
    const f1Bounds = { value: f1(precision.p || 0, recall.p || 0),
        low: f1(precision.low || 0, recall.low || 0), high: f1(precision.high || 0, recall.high || 0) };
    const firstTimes = positives.map(row => {
        const first = target(row).sort((a,b)=>a.at-b.at)[0];
        return first ? (first.at - row.trial.startedAt)/1000 : null;
    }).filter(Number.isFinite);
    const firstBlocks = targetFamily === 'Scaffold' ? positives.map(row => {
        const first = target(row).sort((a,b)=>a.at-b.at)[0];
        return first ? row.trial.acceptedPlacementTimes.filter(t => t <= first.at).length : null;
    }).filter(Number.isFinite) : [];
    const firstWeights = targetFamily === 'Scaffold' ? positives.map(row => {
        const first = target(row).sort((a,b)=>a.at-b.at)[0];
        return first ? first.weight : null;
    }).filter(Number.isFinite) : [];
    const tier = { possibleOnly: positives.filter(row => target(row).length && !confirmed(row)).length,
        confirmed: positives.filter(confirmed).length, missed: positives.filter(row => !anyTarget(row)).length };
    const familyCounts = {};
    for (const row of positives) for (const family of new Set(target(row).flatMap(flag =>
        targetFamily === 'Scaffold' ? flag.strikes?.flatMap(strike => strike.parts?.map(part => part.family) || []) || [] :
            flag.evidence?.map(item => item.group) || []))) familyCounts[family] = (familyCounts[family] || 0) + 1;
    const profiles = { godbridge: 0, telly: 0, trialsWithGodbridge: 0, trialsWithTelly: 0 };
    const nearMisses = [];
    for (const row of joined) {
        const profile = row.result.status?.profiles || {};
        profiles.godbridge += profile.godbridge || 0; profiles.telly += profile.telly || 0;
        if (profile.godbridge) profiles.trialsWithGodbridge++;
        if (profile.telly) profiles.trialsWithTelly++;
        if (targetFamily === 'Scaffold' && !anyTarget(row) && (row.result.peakScaffold?.weight || 0) >= 2)
            nearMisses.push({ id: row.trial.id, weight: row.result.peakScaffold.weight,
                at: row.result.peakScaffold.at, strikes: row.result.peakScaffold.strikes,
                evidence: row.result.peakScaffold.evidence });
    }
    return {
        n: joined.length, cheatN: positives.length, legitN: negatives.length,
        targetAny: wilson(tp, positives.length), targetConfirmed: wilson(tier.confirmed, positives.length),
        anyDetectorCheat: wilson(positives.filter(anyDetector).length, positives.length),
        falseAnyDetector: wilson(fp, negatives.length), falseTarget: wilson(negatives.filter(anyTarget).length, negatives.length),
        accuracyAnyDetector: wilson(positives.filter(anyDetector).length + negatives.filter(row => !anyDetector(row)).length, joined.length),
        precision, recall, f1: f1Bounds, tier, timeToFlagSeconds: distribution(firstTimes),
        blocksBeforeFlag: distribution(firstBlocks), weightAtFirstFlag: distribution(firstWeights),
        evidenceFamilies: familyCounts, profiles, nearMisses,
        unexpected: joined.filter(row => row.result.flags.some(flag => flag.family !== targetFamily)).map(row =>
            ({ id: row.trial.id, flags: row.result.flags.filter(flag => flag.family !== targetFamily) })),
        preCheatFlags: positives.filter(row => row.result.flags.some(flag => flag.at < row.trial.startedAt)).map(row =>
            ({ id: row.trial.id, flags: row.result.flags.filter(flag => flag.at < row.trial.startedAt) }))
    };
}
function summarize(part) {
    const base = partDir(part), evidence = read(path.join(base, 'FULL_EVIDENCE.json')),
        detail = read(path.join(base, 'FULL_REPLAY_DETAILS.json'));
    assert(evidence.complete && evidence.rows.length === evidence.planned);
    const target = part === 'scaffold' ? 'Scaffold' : 'Autoblock';
    const scenarioIds = [...new Set(evidence.rows.map(row => row.scenario))].sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
    const stats = {};
    for (const variant of ['OLD','NEW']) {
        stats[variant] = { overall: variantStats(evidence.rows, detail.variants[variant], target), scenarios: {},
            scenarioVsPooledLegit: {} };
        for (const scenario of scenarioIds) stats[variant].scenarios[scenario] = variantStats(
            evidence.rows.filter(row => row.scenario === scenario), detail.variants[variant], target);
        for (const scenario of scenarioIds.filter(id => !id.startsWith('L')))
            stats[variant].scenarioVsPooledLegit[scenario] = variantStats(evidence.rows.filter(row =>
                row.scenario === scenario || !row.effectExpected), detail.variants[variant], target);
    }
    const diff = [];
    for (const trial of evidence.rows) {
        const old = detail.variants.OLD.find(row => row.id === trial.id), now = detail.variants.NEW.find(row => row.id === trial.id);
        const eligible = flag => !trial.effectExpected || flag.at >= trial.startedAt;
        const oldTarget = old.flags.some(flag => eligible(flag) && flag.family === target),
            newTarget = now.flags.some(flag => eligible(flag) && flag.family === target);
        const oldAny = old.flags.some(eligible), newAny = now.flags.some(eligible);
        if (oldTarget !== newTarget || oldAny !== newAny) diff.push({ id: trial.id, scenario: trial.scenario,
            oldTarget, newTarget, oldAny, newAny, oldFlags: old.flags, newFlags: now.flags });
    }
    const oldOnly = diff.filter(row => row.oldTarget && !row.newTarget).length;
    const newOnly = diff.filter(row => !row.oldTarget && row.newTarget).length;
    const pair = { oldOnly, newOnly, concordant: evidence.rows.length - oldOnly - newOnly,
        mcnemarExactTwoSidedP: exactMcNemar(oldOnly, newOnly), differences: diff };
    const live = [];
    const traceCache = new Map();
    for (const trial of evidence.rows) {
        if (!traceCache.has(trial.run)) traceCache.set(trial.run, lines(path.join(base, trial.run, 'fury-profile/lab-detector-trace.jsonl')));
        const offline = detail.variants.NEW.find(row => row.id === trial.id);
        const callbacks = traceCache.get(trial.run).filter(row => row.kind === 'flag' &&
            Number(row.flag?.entityId) === Number(trial.actorId) && row.observedAt >= offline.recordingStartAt &&
            row.observedAt <= offline.recordingEndAt).map(row => ({ family: row.family, flag: row.flag }));
        const normalize = event => JSON.stringify({ family: event.family, tier: event.flag.tier, at: event.flag.at,
            evidence: event.flag.evidence, weight: event.flag.weight, strikes: event.flag.strikes });
        const observed = callbacks.map(normalize).sort(), replayed = offline.flags.map(flag =>
            normalize({ family: flag.family, flag })).sort();
        live.push({ id: trial.id, matched: JSON.stringify(observed) === JSON.stringify(replayed),
            live: callbacks, offline: offline.flags });
    }
    const result = { schema: 1, part, generatedAt: new Date().toISOString(), stats, pair,
        liveReplay: { matched: live.filter(row => row.matched).length, total: live.length,
            divergences: live.filter(row => !row.matched) },
        trials: evidence.rows.map(trial => ({ ...trial, old: detail.variants.OLD.find(row => row.id === trial.id),
            new: detail.variants.NEW.find(row => row.id === trial.id) })),
        invalidAttempts: evidence.attempts.filter(row => !row.valid),
        metricNotes: ['Rates are per scripted trial on this one local machine.',
            'Wilson intervals apply to binomial rates. F1 uses an envelope derived from Wilson precision and recall bounds; it is not itself a Wilson interval.',
            'Precision uses target-detector positive flags and any-detector false flags, a conservative definition.',
            'Time to first flag uses target-detector callbacks on detected cheat trials only.'] };
    fs.writeFileSync(path.join(base, 'FULL_RESULTS.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
}
function rateLine(id, old, now, legit) {
    const fmtCell = s => legit ? `${rateText(s.falseAnyDetector)}; target ${rateText(s.falseTarget)}` :
        `${rateText(s.targetAny)}; confirmed ${rateText(s.targetConfirmed)}`;
    return `| ${id} | ${old.n} | ${fmtCell(old)} | ${fmtCell(now)} |`;
}
function writeReport(part) {
    const base = partDir(part), result = summarize(part), { stats, pair } = result;
    const target = part === 'scaffold' ? 'Scaffold' : 'Autoblock';
    const scenarios = Object.keys(stats.NEW.scenarios).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const linesOut = [];
    linesOut.push(`# Real-client ${target} measurement`, '',
        `Valid full trials: ${result.trials.length}; invalid or superseded attempts: ${result.invalidAttempts.length}. Pilots are excluded.`,
        '', '| Scenario | n | OLD | NEW |', '| --- | ---: | --- | --- |');
    for (const id of scenarios) linesOut.push(rateLine(id, stats.OLD.scenarios[id], stats.NEW.scenarios[id], id.startsWith('L')));
    linesOut.push(rateLine('Overall', stats.OLD.overall, stats.NEW.overall, false), '',
        'The overall row combines cheat and legitimate trials; its detection denominator is the cheat trials.',
        '', '## Per-scenario precision, recall and time', '',
        'Each cheat scenario is classified against the same pooled legitimate control set. Its recall uses only that scenario. Controls have no positive labels, so precision and F1 are not defined for a control alone.',
        '', '| Cheat scenario | OLD precision / recall / F1 | NEW precision / recall / F1 | OLD time to first flag | NEW time to first flag |',
        '| --- | --- | --- | --- | --- |');
    for (const id of scenarios.filter(id => !id.startsWith('L'))) {
        const old = stats.OLD.scenarioVsPooledLegit[id], now = stats.NEW.scenarioVsPooledLegit[id];
        const metric = s => `${rateText(s.precision)} / ${rateText(s.recall)} / ${fmt(s.f1.value)} [${fmt(s.f1.low)}, ${fmt(s.f1.high)}]`;
        linesOut.push(`| ${id} | ${metric(old)} | ${metric(now)} | ${timeText(stats.OLD.scenarios[id].timeToFlagSeconds)} | ${timeText(stats.NEW.scenarios[id].timeToFlagSeconds)} |`);
    }
    for (const variant of ['OLD','NEW']) {
        const s = stats[variant].overall;
        linesOut.push('', `## ${variant} aggregate`, '',
            `Cheat detection: ${rateText(s.targetAny)} any tier; ${rateText(s.targetConfirmed)} confirmed.`,
            `Legitimate false flags from any detector: ${rateText(s.falseAnyDetector)}. ${target} false flags: ${rateText(s.falseTarget)}.`,
            `Any-detector trial accuracy: ${rateText(s.accuracyAnyDetector)}. Precision ${rateText(s.precision)}; recall ${rateText(s.recall)}; F1 ${fmt(s.f1.value)} (Wilson-bound envelope ${fmt(s.f1.low)}–${fmt(s.f1.high)}).`,
            `Time to first ${target} flag on detected cheat trials: ${timeText(s.timeToFlagSeconds)}.`,
            `Tier breakdown on cheat trials: possible only ${s.tier.possibleOnly}, confirmed ${s.tier.confirmed}, missed ${s.tier.missed}.`,
            `Evidence families at flags: ${JSON.stringify(s.evidenceFamilies)}.`);
        if (part === 'scaffold') linesOut.push(
            `Blocks accepted before first Scaffold flag: ${timeText(s.blocksBeforeFlag, ' blocks')}.`,
            `Total weight at first Scaffold flag: ${timeText(s.weightAtFirstFlag, ' weight')}.`,
            `Shadow profiles: GodBridge ${s.profiles.godbridge} hits on ${s.profiles.trialsWithGodbridge} trials; TellyBridge ${s.profiles.telly} hits on ${s.profiles.trialsWithTelly} trials.`,
            `Near misses (weight >= 2 without flag): ${s.nearMisses.length}; full evidence in FULL_RESULTS.json.`);
    }
    if (part === 'scaffold') {
        linesOut.push('', '## Scaffold modes and shadow profiles', '',
            '| Scenario | NEW detection | Time to flag | Blocks before flag | Weight at flag | Shadow GodBridge / TellyBridge hits | Near misses |',
            '| --- | --- | --- | --- | --- | --- | ---: |');
        for (const id of scenarios) {
            const s = stats.NEW.scenarios[id];
            linesOut.push(`| ${id} | ${id.startsWith('L') ? rateText(s.falseAnyDetector) + ' false flags' : rateText(s.targetAny)} | ${timeText(s.timeToFlagSeconds)} | ${timeText(s.blocksBeforeFlag, ' blocks')} | ${timeText(s.weightAtFirstFlag, ' weight')} | ${s.profiles.godbridge} / ${s.profiles.telly} | ${s.nearMisses.length} |`);
        }
        const near = stats.NEW.overall.nearMisses;
        linesOut.push('', '### Near-miss evidence', '',
            near.length ? near.map(row => `- ${row.id}: weight ${row.weight}, ${row.strikes} strikes; ${row.evidence.join(' | ') || 'no strike log retained'}`).join('\n') : 'None.');
    }
    linesOut.push('', '## Paired comparison', '',
        `Target-family discordance: OLD-only ${pair.oldOnly}, NEW-only ${pair.newOnly}; exact two-sided McNemar p=${fmt(pair.mcnemarExactTwoSidedP)}.`,
        `Verdict differences (${pair.differences.length}): ${pair.differences.map(row => row.id).join(', ') || 'none'}. Full flags for each are in FULL_RESULTS.json.`,
        '', '## Live callback check', '',
        `NEW offline replay matched ${result.liveReplay.matched}/${result.liveReplay.total} live detector callback streams by tier, timestamp, evidence, weight and strikes.`,
        result.liveReplay.divergences.length ? `Divergences: ${result.liveReplay.divergences.map(row => row.id).join(', ')}. Details are in FULL_RESULTS.json.` : 'No divergences observed.',
        '', '## Other detector flags', '');
    for (const variant of ['OLD','NEW']) linesOut.push(`${variant}: ${stats[variant].overall.unexpected.length} trials with a non-${target} flag; IDs: ${stats[variant].overall.unexpected.map(row => row.id).join(', ') || 'none'}.`);
    linesOut.push('', '## Invalid attempts', '',
        result.invalidAttempts.length ? result.invalidAttempts.map(row => `- ${row.id} ${row.run}/${row.attempt}: ${row.invalidReasons.join(', ')}`).join('\n') : 'None.',
        '', '## Limits and follow-up proposals', '',
        `This is the Vape-based Client Enhancer port, not Vape itself. See [MOD_FIDELITY.md](${part === 'scaffold' ? '../' : ''}MOD_FIDELITY.md) for settings, timing and packet-order differences. Vape BlockHit Lag, Manual, Predict and Auto modes are absent from the mod and were not tested.`,
        'Input was scripted rather than human play. The server was vanilla 1.8.9, not Hypixel. All processes ran on one Windows machine through loopback relays. These rates describe this frozen local workload and may differ in live Bed Wars.',
        'Detector thresholds were not tuned from these results. Any proposed change requires a separately frozen calibration set and new held-out validation.',
        '', 'Raw per-trial verdicts and evidence are in [FULL_RESULTS.json](FULL_RESULTS.json), [FULL_EVIDENCE.json](FULL_EVIDENCE.json), and the linked trial directories.', '');
    if (part === 'scaffold') linesOut.splice(linesOut.findIndex(line=>line==='## Limits and follow-up proposals'),0,
        '## Earlier Mineflayer result', '',
        'The earlier held-out Mineflayer lab reported 0/50 for Scaffold Legit and 0/50 for GodBridge. This run uses the actual Forge client, its mouse/key handling and packet order; any difference reflects the changed actor and scenario mix, not a detector edit.');
    fs.writeFileSync(path.join(base, 'REPORT.md'), linesOut.join('\n'));
    console.log(JSON.stringify({ part, trials: result.trials.length, liveMatches: result.liveReplay.matched,
        old: stats.OLD.overall.targetAny, now: stats.NEW.overall.targetAny }));
}
const part = process.argv[2];
assert(['autoblock','scaffold'].includes(part), 'Usage: node mod_real_report.js autoblock|scaffold');
writeReport(part);
