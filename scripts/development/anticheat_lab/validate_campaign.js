'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const assert = require('assert');
const { campaignStatus } = require('./campaign_status');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const summary = values => {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    return { n: values.length, min: values[0], median: values[Math.floor(values.length / 2)],
        p95: values[Math.ceil(values.length * 0.95) - 1], max: values.at(-1),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length };
};
async function readLines(file, consume) {
    const reader = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of reader) if (line.trim()) consume(JSON.parse(line));
}
async function validate(planFile, directories, output, exclusionsFile = null) {
    const planBytes = fs.readFileSync(planFile), plan = JSON.parse(planBytes), planHash = sha(planBytes);
    const expected = new Map(plan.trials.map(spec => [spec.id, spec])), seen = new Map();
    const sources = [], errors = [];
    const exclusions = exclusionsFile ? JSON.parse(fs.readFileSync(exclusionsFile, 'utf8')) : null;
    if (exclusions) assert.strictEqual(exclusions.planSha256, planHash);
    const excluded = [];
    for (const directory of directories) {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'campaign.json')));
        assert.strictEqual(manifest.planSha256, planHash, 'Worker used the same frozen plan');
        const result = campaignStatus(directory);
        if (result.errors.length) errors.push(`${directory}: worker errors: ${result.errors.join('; ')}`);
        // A clean checkpoint can be completed by another directory. Completeness
        // is determined from unique valid frozen-plan IDs across all workers.
        sources.push({ directory: path.resolve(directory), sourceHashes: manifest.sourceHashes, result });
        const local = new Map();
        await readLines(path.join(directory, 'outcomes.jsonl'), outcome => {
            const exclusion = exclusions?.excluded.find(row => path.resolve(row.directory) === path.resolve(directory) && row.id === outcome.id);
            if (exclusion) {
                assert.strictEqual(exclusion.groundTruthSha256, outcome.groundTruthSha256);
                assert.strictEqual(sha(fs.readFileSync(path.join(directory, outcome.truthFile))), outcome.groundTruthSha256);
                excluded.push(exclusion); return;
            }
            assert(!seen.has(outcome.id), `Duplicate trial ${outcome.id}`);
            assert(expected.has(outcome.id), `Unplanned trial ${outcome.id}`);
            assert(outcome.valid, `Invalid trial ${outcome.id}`);
            const truthBytes = fs.readFileSync(path.join(directory, outcome.truthFile));
            assert.strictEqual(sha(truthBytes), outcome.groundTruthSha256, 'Ground truth remains immutable');
            const truth = JSON.parse(truthBytes);
            assert.deepStrictEqual(truth.spec, expected.get(outcome.id), 'Executed settings match plan');
            const raw = fs.readFileSync(path.join(directory, `${outcome.id}.observer-packets.jsonl`));
            assert.strictEqual(sha(raw), truth.observerSha256, 'Observer evidence remains immutable');
            const recorded = fs.readFileSync(path.join(directory, truth.recorderFile));
            assert.strictEqual(sha(recorded), truth.recorderSha256, 'Fury recording remains immutable');
            const ground = truth.groundTruth;
            const row = { id: outcome.id, scenario: truth.spec.scenario, split: truth.spec.split,
                directory: path.resolve(directory), truthFile: outcome.truthFile,
                recorderFile: truth.recorderFile, groundTruthSha256: outcome.groundTruthSha256,
                observerSha256: truth.observerSha256, recorderSha256: truth.recorderSha256,
                startedAt: ground.startedAt, activeEnd: ground.activeEnd || ground.endedAt,
                effectExpected: ground.effectExpected, observerPackets: truth.observerPackets,
                observerMoves: truth.observerMoves, validity: ground.validity,
                tickIntervals: [], tickWork: [], transport: {} };
            seen.set(row.id, row); local.set(row.id, row);
        });
        await readLines(path.join(directory, 'server-ticks.jsonl'), tick => {
            const row = local.get(tick.label);
            if (row && tick.t >= row.startedAt && tick.t <= row.activeEnd) {
                row.tickIntervals.push(tick.intervalMs); row.tickWork.push(tick.workMs);
            }
        });
        await readLines(path.join(directory, 'transport.jsonl'), event => {
            const row = local.get(event.label);
            if (!row || event.type !== 'delivery' || event.receivedAt < row.startedAt || event.receivedAt > row.activeEnd) return;
            const key = `${event.owner}.${event.direction}`;
            const values = row.transport[key] ||= { actual: [], requested: [], bytes: 0 };
            values.actual.push(event.actualDelayMs); values.requested.push(event.requestedDelayMs); values.bytes += event.bytes;
        });
    }
    for (const id of expected.keys()) if (!seen.has(id)) errors.push(`Missing planned trial ${id}`);
    const counts = {}, rows = [];
    for (const row of seen.values()) {
        if (row.tickIntervals.length < 20) errors.push(`${row.id}: insufficient actual server tick measurements`);
        if (!row.transport['actor.upstream'] || !row.transport['observer.downstream']) errors.push(`${row.id}: missing realized traffic measurements`);
        const group = counts[row.scenario] ||= { calibration: 0, evaluation: 0, total: 0, noCheatEffectExpected: 0 };
        group[row.split]++; group.total++; if (row.effectExpected === false) group.noCheatEffectExpected++;
        row.serverTickIntervalMs = summary(row.tickIntervals); row.serverTickWorkMs = summary(row.tickWork);
        delete row.tickIntervals; delete row.tickWork;
        for (const [key, values] of Object.entries(row.transport)) row.transport[key] = {
            actualDelayMs: summary(values.actual), requestedDelayMs: summary(values.requested), bytes: values.bytes };
        rows.push(row);
    }
    const report = { schema: 1, createdAt: new Date().toISOString(), planFile: path.resolve(planFile), planSha256: planHash,
        complete: errors.length === 0 && seen.size === expected.size, expected: expected.size, performed: seen.size,
        counts, errors, exclusionsFile, excluded, scope: 'Evidence integrity and experimental conditions only; no held-out detector verdicts read.', sources, rows };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output: path.resolve(output), complete: report.complete, expected: report.expected, performed: report.performed, counts, errors }, null, 2));
    assert(report.complete, 'Campaign evidence validation failed');
    return report;
}
if (require.main === module) {
    const [planFile, output, ...argumentsAfter] = process.argv.slice(2);
    const exclusionsArg = argumentsAfter.find(arg => arg.startsWith('--exclusions='));
    const directories = argumentsAfter.filter(arg => !arg.startsWith('--exclusions='));
    if (!planFile || !output || !directories.length) throw new Error('Usage: validate_campaign.js plan.json output.json runDir...');
    validate(planFile, directories, output, exclusionsArg?.slice('--exclusions='.length)).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { validate };
