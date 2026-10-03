'use strict';
// Independent seed set. Reuse the original evidence checks and replay engine,
// score calibration and evaluation separately, and retain all three families.
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('assert'), crypto = require('crypto');
const { stats } = require('./overnight_analysis_modules');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'output/anticheat-lab/mod-real');
const [action, part, ...args] = process.argv.slice(2);
const fresh = path.resolve(args.find(a => a.startsWith('--base='))?.slice(7) || path.join(output, 'improvements/fresh'));
assert(['autoblock', 'scaffold'].includes(part));
const base = part === 'scaffold' ? path.join(fresh, part) : fresh;
const requestedSplit = args.find(a => a.startsWith('--split='))?.split('=')[1];
const tag = args.find(a => a.startsWith('--tag='))?.slice(6) || '';
assert(!tag || /^[a-z][a-z0-9_-]{0,40}$/i.test(tag));
assert(!requestedSplit || ['calibration', 'evaluation'].includes(requestedSplit));
const baseline = path.join(output, 'overnight/baseline-source/src/detect');
const candidate = path.resolve(args.find(a => a.startsWith('--candidate='))?.slice(12) ||
    path.join(output, 'improvements/movement-clock-candidate'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const sourceFile = path.join(__dirname, 'mod_real_analysis.js');
let source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
source = require('./adapt_scaffold_context_validation')(source);
source = require('./adapt_scaffold_careful_validation')(source);
function replaceOnce(before, after) {
    assert.strictEqual(source.split(before).length, 2, 'Follow-up analysis anchor changed: ' + before.slice(0, 50));
    source = source.replace(before, after);
}
replaceOnce("const outputRoot = path.join(root, 'output/anticheat-lab/mod-real');", `const outputRoot = ${JSON.stringify(fresh)};`);
replaceOnce("    OLD: path.join(root, 'output/anticheat-lab/autoblock-v2/baseline-detectors'),\n    NEW: path.join(root, 'src/detect')",
    `    OLD: ${JSON.stringify(baseline)},\n    NEW: ${JSON.stringify(candidate)}`);
replaceOnce("scenario: spec.scenarioId, split: 'evaluation',", 'scenario: spec.scenarioId, split: spec.split,');
replaceOnce('JSON.stringify(truth.requestedEnabled) === JSON.stringify(spec.enabled),',
    'JSON.stringify(truth.requestedEnabled) === JSON.stringify(spec.enabled) &&\n                        truth.scenario.split === spec.split && JSON.stringify(truth.scenario.settings) === JSON.stringify(spec.settings),');
const checkStart = source.indexOf('function checkHashes() {'), checkEnd = source.indexOf('\nfunction buildEvidence(', checkStart);
assert(checkStart > 0 && checkEnd > checkStart);
source = source.slice(0, checkStart) + `function checkHashes() {
    const manifest = readJson(${JSON.stringify(path.join(output, 'overnight/start-manifest.json'))});
    for (const name of ['autoblockDetector.js','scaffoldDetector.js','detectorShared.js','stasisDetector.js'])
        assert.strictEqual(sha(fs.readFileSync(path.join(detectorDirs.OLD, name))), manifest.sourceHashes['src/detect/' + name]);
}
` + source.slice(checkEnd);
source = source.slice(0, source.indexOf('const [action, part] = process.argv.slice(2);')) +
    '\nmodule.exports = { buildEvidence, replayTrial, detectorDirs, checkHashes };\n';
const compiled = new Module(sourceFile, module); compiled.filename = sourceFile;
compiled.paths = Module._nodeModulePaths(__dirname); compiled._compile(source, sourceFile);
const engine = compiled.exports;

function score() {
    assert(requestedSplit, 'Score an explicit calibration or evaluation split');
    const plan = read(path.join(base, `FULL_PLAN_${part}.json`));
    const evidence = read(path.join(base, 'FULL_EVIDENCE.json'));
    const selected = evidence.rows.filter(r => r.split === requestedSplit);
    const wanted = plan.trials.filter(r => r.split === requestedSplit);
    assert.strictEqual(selected.length, wanted.length, `Incomplete validated ${requestedSplit} evidence`);
    engine.checkHashes();
    const frozenFile = path.join(output, 'improvements/fresh/FROZEN_DECISION.json');
    const frozen = fs.existsSync(frozenFile) ? read(frozenFile) : null;
    if (requestedSplit === 'evaluation') {
        assert(frozen, 'Freeze the follow-up candidate decision before evaluating held-out clips');
        assert.strictEqual(path.resolve(frozen.candidateDirectory), candidate);
        for (const [file, sha256] of Object.entries(frozen.sourceHashes)) assert.strictEqual(hash(path.join(candidate, file)), sha256);
    }
    const details = {};
    for (const [name, directory] of Object.entries({ BASELINE: baseline, CANDIDATE: candidate })) {
        details[name] = selected.map(r => ({ id: r.id, scenario: r.scenario, effectExpected: r.effectExpected,
            ...engine.replayTrial(r, directory) }));
    }
    const target = part === 'scaffold' ? 'Scaffold' : 'Autoblock', summaries = {};
    for (const name of Object.keys(details)) summaries[name] = {
        overall: stats.variantStats(selected, details[name], target),
        scenarios: Object.fromEntries([...new Set(selected.map(r => r.scenario))].map(s =>
            [s, stats.variantStats(selected.filter(r => r.scenario === s), details[name], target)]))
    };
    const differences = [];
    for (const trial of selected) {
        const a = details.BASELINE.find(r => r.id === trial.id), b = details.CANDIDATE.find(r => r.id === trial.id);
        const verdict = row => row.flags.some(f => f.family === target && (!trial.effectExpected || f.at >= trial.startedAt));
        if (verdict(a) !== verdict(b)) differences.push({ id: trial.id, baseline: verdict(a), candidate: verdict(b), baselineFlags: a.flags, candidateFlags: b.flags });
    }
    const oldOnly = differences.filter(r => r.baseline && !r.candidate).length, newOnly = differences.filter(r => !r.baseline && r.candidate).length;
    const result = { generatedAt: new Date().toISOString(), part, split: requestedSplit,
        baselineMeaning: 'Pinned NEW detector at the start of the overnight task, not archived OLD',
        candidateDirectory: candidate, candidateHashes: Object.fromEntries(fs.readdirSync(candidate).filter(n => n.endsWith('.js')).map(n => [n, hash(path.join(candidate, n))])),
        evidenceSha256: hash(path.join(base, 'FULL_EVIDENCE.json')), summaries, trials: selected, details,
        paired: { oldOnly, newOnly, exactMcNemarP: stats.exactMcNemar(oldOnly, newOnly), differences },
        invalidAttempts: evidence.attempts.filter(r => !r.valid) };
    const prefix = tag ? tag.toUpperCase() + '_' : '';
    const file = `${prefix}${requestedSplit.toUpperCase()}_RESULTS.json`; write(path.join(base, file), result);
    const table = ['# Fresh independent detector comparison', '',
        `Part: ${part}. Split: ${requestedSplit}. Validated trials: ${selected.length}.`,
        'BASELINE means the pinned NEW detector from the beginning of the night. It is distinct from the archived OLD detector in the original measurement.', '',
        '| Scenario | n | BASELINE detection / false flags | CANDIDATE detection / false flags |', '| --- | ---: | --- | --- |'];
    for (const id of Object.keys(summaries.BASELINE.scenarios)) {
        const a = summaries.BASELINE.scenarios[id], b = summaries.CANDIDATE.scenarios[id];
        table.push(`| ${id} | ${b.n} | ${stats.rateText(id.startsWith('L') ? a.falseAnyDetector : a.targetAny)} | ${stats.rateText(id.startsWith('L') ? b.falseAnyDetector : b.targetAny)} |`);
    }
    for (const [name, summary] of Object.entries(summaries)) {
        const s = summary.overall;
        table.push('', `## ${name}`, '', `Detection: ${stats.rateText(s.targetAny)}; confirmed: ${stats.rateText(s.targetConfirmed)}.`,
            `Any-detector false flags: ${stats.rateText(s.falseAnyDetector)}. Any-detector accuracy: ${stats.rateText(s.accuracyAnyDetector)}.`,
            `Precision: ${stats.rateText(s.precision)}; recall: ${stats.rateText(s.recall)}; F1 ${s.f1.value.toFixed(3)} (Wilson-bound envelope ${s.f1.low.toFixed(3)}–${s.f1.high.toFixed(3)}, not a separate confidence interval).`,
            `Time to first flag, detected cheats only: ${stats.timeText(s.timeToFlagSeconds)}.`,
            `Evidence families: ${JSON.stringify(s.evidenceFamilies)}. Other detector flags: ${s.unexpected.map(r => r.id).join(', ') || 'none'}.`);
        if (part === 'scaffold') table.push(`Blocks before flag: ${stats.timeText(s.blocksBeforeFlag, ' blocks')}. Shadow profiles: ${JSON.stringify(s.profiles)}. Near misses: ${s.nearMisses.length}.`);
    }
    table.push('', '## Paired change', '', `Baseline-only ${oldOnly}; candidate-only ${newOnly}; exact McNemar p=${result.paired.exactMcNemarP.toPrecision(6)}. Changed IDs: ${differences.map(r => r.id).join(', ') || 'none'}.`,
        '', '## Limits', '',
        'Calibration and evaluation use separate seeds/trials; the candidate is frozen before evaluation scoring. This remains a scripted Forge port on a vanilla loopback server, one PC, not actual Vape or human Hypixel play. Small samples have wide Wilson intervals.',
        'Fresh ninja controls use seeded 80–129 ms sneak releases, wider than the original 35–44 ms controller. C2 calibration uses Sprint on; C2 evaluation uses Sprint off. All actual module settings and injected input timestamps are retained per trial.',
        `Raw per-trial comparisons: [${file}](${file}).`, '');
    fs.writeFileSync(path.join(base, `${prefix}${requestedSplit.toUpperCase()}_REPORT.md`), table.join('\n'));
    console.log(JSON.stringify({ part, split: requestedSplit, trials: selected.length, baseline: summaries.BASELINE.overall.targetAny,
        candidate: summaries.CANDIDATE.overall.targetAny, falseFlags: summaries.CANDIDATE.overall.falseAnyDetector, paired: { oldOnly, newOnly, p: result.paired.exactMcNemarP } }));
}
if (action === 'validate') engine.buildEvidence(part);
else if (action === 'score') score();
else throw new Error('Usage: node mod_real_followup_analysis.js validate|score autoblock|scaffold --split=calibration|evaluation [--candidate=DIR]');
