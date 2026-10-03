'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
// Capture before loading the behavior modules or awaiting server startup.
// Files edited while another worker starts cannot relabel its loaded source.
const initialSources = new Map(fs.readdirSync(__dirname).filter(name => name.endsWith('.js'))
    .map(name => [name, fs.readFileSync(path.join(__dirname, name))]));
const initialRuntimeLock = fs.readFileSync(path.join(__dirname, 'runtime/package-lock.json'));
const { Lab, root } = require('./lab');
const { timerTrial } = require('./trial_timer');
const { clickerTrial } = require('./trial_clicker');
const { blockhitPilot } = require('./pilot_blockhit');
const { fastplacePilot } = require('./pilot_fastplace');
const { blinkPilot } = require('./pilot_blink');
const { scaffoldPilot } = require('./pilot_scaffold_legit');
const { automaticPilot } = require('./pilot_scaffold_automatic');
const { ladderTrial } = require('./pilot_legit_ladder');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

async function main() {
    const planFile = path.resolve(process.argv[2]);
    const worker = Number(process.argv[3] || 0), workers = Number(process.argv[4] || 1);
    assert(Number.isInteger(workers) && workers >= 1 && workers <= 4 && worker >= 0 && worker < workers);
    const planBytes = fs.readFileSync(planFile), plan = JSON.parse(planBytes);
    const directory = path.resolve(process.argv[5] || path.join(root, `output/anticheat-lab/runs/${plan.name}-worker${worker}-${Date.now()}`));
    const selectionFile = process.argv[6] ? path.resolve(process.argv[6]) : null;
    const selectionBytes = selectionFile ? fs.readFileSync(selectionFile) : null;
    const selection = selectionBytes ? JSON.parse(selectionBytes) : null;
    if (selection) assert.strictEqual(selection.planSha256, sha(planBytes), 'Selection belongs to frozen plan');
    const selected = selection ? new Set(selection.includeIds) : null;
    const specs = plan.trials.filter((spec, index) => index % workers === worker && (!selected || selected.has(spec.id)));
    assert(specs.length > 0, 'No unperformed selected trials');
    if (plan.name === 'ladder-v1') assert.strictEqual(workers, 2, plan.workerPolicy);
    const lab = new Lab(directory, plan.setup || {}), outcomes = [];
    try {
        await lab.start();
        fs.writeFileSync(path.join(directory, 'plan.json'), planBytes);
        if (selectionBytes) fs.writeFileSync(path.join(directory, 'selection.json'), selectionBytes);
        const snapshot = path.join(directory, 'client-source'); fs.mkdirSync(snapshot);
        const hashes = {};
        for (const [name, bytes] of initialSources) {
            fs.writeFileSync(path.join(snapshot, name), bytes); hashes[name] = sha(bytes);
        }
        fs.writeFileSync(path.join(directory, 'campaign.json'), JSON.stringify({ planFile, planSha256: sha(planBytes), worker, workers,
            assignedTrials: specs.length, selectionFile, selectionSha256: selectionBytes ? sha(selectionBytes) : null,
            sourceHashes: hashes, runtimeLockSha256: sha(initialRuntimeLock),
            splitPolicy: 'Do not use evaluation recordings for tuning; evaluate them after detector changes are frozen.' }, null, 2));
        for (const spec of specs) {
            const errorsBefore = lab.errors.length;
            let result, failure = null;
            try {
                if (spec.scenario === 'timer' || spec.scenario === 'legit_movement') result = await timerTrial(lab, spec);
                else if (spec.scenario.startsWith('clicker_') || spec.scenario === 'legit_clicking') result = await clickerTrial(lab, spec);
                else if (spec.scenario.startsWith('blockhit_') || spec.scenario.startsWith('legit_blockhit')) result = await blockhitPilot(lab, spec.mode, spec.seed, { ...spec, campaign: true });
                else if (spec.scenario.startsWith('fastplace_') || ['legit_heldplace', 'legit_manualplace'].includes(spec.scenario)) result = await fastplacePilot(lab, { ...spec, campaign: true }, spec.index);
                else if (spec.scenario.startsWith('blink_') || spec.scenario.startsWith('legit_jumpcombat')) result = await blinkPilot(lab, { ...spec, campaign: true }, spec.index);
                else if (spec.scenario.includes('godbridge')) result = await automaticPilot(lab, { ...spec, campaign: true }, spec.index);
                else if (spec.scenario === 'scaffold_legit' || spec.scenario === 'legit_sneakbridge') result = await scaffoldPilot(lab, { ...spec, campaign: true }, spec.index);
                else if (spec.scenario.startsWith('legit_ladder_')) result = await ladderTrial(lab, { ...spec, campaign: true });
                else throw new Error(`Unimplemented scenario ${spec.scenario}`);
            } catch (error) { failure = { message: error.message, stack: error.stack }; }
            const rawFile = path.join(directory, `${spec.id}.observer-packets.jsonl`);
            const recorderDirectory = path.join(lab.profile, 'recordings');
            const candidates = fs.existsSync(recorderDirectory) ? fs.readdirSync(recorderDirectory).filter(name => name.endsWith(`_${spec.id}.jsonl`)) : [];
            const recorderFile = candidates.length === 1 ? path.join(recorderDirectory, candidates[0]) : null;
            const rawBytes = fs.existsSync(rawFile) ? fs.readFileSync(rawFile) : Buffer.alloc(0);
            const raw = rawBytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse);
            const observerMoves = result ? raw.filter(r => r.data.entityId === result.actorId && /entity_move|entity_teleport/.test(r.name)).length : 0;
            if (result) {
                if (spec.scenario === 'timer' || spec.scenario === 'legit_movement') result.validity.observerReceivedMovement = observerMoves >= 2;
                else if (spec.scenario.startsWith('clicker_') || spec.scenario === 'legit_clicking' || spec.scenario.includes('blockhit')) {
                    const swings = raw.filter(r => r.name === 'animation' && r.data.entityId === result.actorId && r.data.animation === 0).length;
                    const hurts = raw.filter(r => r.name === 'entity_status' && r.data.entityId === result.opponentId && r.data.entityStatus === 2).length;
                    result.observerCombat = { swings, hurts };
                    if (!spec.scenario.includes('blockhit')) result.validity.observerReceivedCombat = swings >= 2 && hurts >= 1;
                }
                Object.assign(result.validity, { noClientErrors: lab.errors.length === errorsBefore, recordingPresent: Boolean(recorderFile) });
            }
            const valid = !failure && result && Object.values(result.validity).every(Boolean);
            const evidence = { spec, valid: Boolean(valid), failure, groundTruth: result,
                observerMoves, observerPackets: raw.length, observerSha256: sha(rawBytes),
                recorderFile: recorderFile ? path.relative(directory, recorderFile) : null,
                recorderSha256: recorderFile ? sha(fs.readFileSync(recorderFile)) : null,
                errors: lab.errors.slice(errorsBefore) };
            const truthPath = path.join(directory, `${spec.id}.ground-truth.json`);
            fs.writeFileSync(truthPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
            const outcome = { id: spec.id, scenario: spec.scenario, split: spec.split, valid: Boolean(valid),
                truthFile: path.basename(truthPath), groundTruthSha256: sha(fs.readFileSync(truthPath)), observerMoves,
                validity: result?.validity || null, failure: failure?.message || null };
            outcomes.push(outcome);
            fs.appendFileSync(path.join(directory, 'outcomes.jsonl'), JSON.stringify(outcome) + '\n');
            console.log(JSON.stringify({ completed: outcomes.length, assigned: specs.length, ...outcome }));
            if (!valid) throw new Error(`Invalid trial ${spec.id}; preserved all evidence and stopped for diagnosis`);
            if (fs.existsSync(path.join(directory, 'stop-after-current'))) {
                console.log('Requested local campaign checkpoint reached; closing owned lab.'); break;
            }
        }
    } finally {
        await lab.close();
        if (fs.existsSync(directory)) fs.writeFileSync(path.join(directory, 'campaign-result.json'), JSON.stringify({
            assigned: specs.length, performed: outcomes.length, valid: outcomes.filter(r => r.valid).length,
            complete: outcomes.length === specs.length && outcomes.every(r => r.valid), errors: lab.errors }, null, 2));
    }
    console.log(`Campaign worker complete: ${directory}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
