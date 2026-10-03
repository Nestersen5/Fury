'use strict';
// Real, unmodified Forge JumpReset versus scripted legal controls. Observer
// packets remain the only detector input; input/state logs are ground truth.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveTarget } = require('../../../src/recorder/recordingAnalysis');
const { eventually } = require('../../smoke_packaged_app');
const h = require('./mod_real_night_helpers');
const base = path.join(h.root, 'output/anticheat-lab/mod-real/jump-reset');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const scenarios = [
    { scenarioId: 'J1', description: 'JumpReset 100% chance, 100% accuracy', chance: 100, accuracy: [100, 100] },
    { scenarioId: 'J2', description: 'JumpReset default 40% chance, 40–60% accuracy', chance: 40, accuracy: [40, 60] },
    { scenarioId: 'J3', description: 'JumpReset 70% chance, 80–100% accuracy', chance: 70, accuracy: [80, 100] },
    { scenarioId: 'J4', description: 'JumpReset 100% with face-to-face targeting gate', chance: 100, accuracy: [100, 100], targeting: true },
    { scenarioId: 'L12', description: 'No jump input, ordinary knockback', input: 'none' },
    { scenarioId: 'L13', description: 'Independent random jump input', input: 'random' },
    { scenarioId: 'L14', description: 'Scripted delayed response to observed damage', input: 'reactive' },
    { scenarioId: 'L15', description: 'Scripted anticipatory skilled jump timing; legitimate input boundary', input: 'anticipatory' }
];

function plan(pilot) {
    fs.mkdirSync(base, { recursive: true });
    const file = path.join(base, pilot ? 'PILOT_PLAN.json' : 'FULL_PLAN.json');
    if (fs.existsSync(file)) return json(file);
    const seed = pilot ? 29092917 : 29092971;
    const random = h.rng(seed), trials = [];
    for (const scenario of scenarios) for (let number = 1; number <= (pilot ? 1 : 40); number++) {
        const cheat = scenario.chance !== undefined;
        const slow = number % 7 === 0;
        const settings = cheat ? { JumpReset: { Chance: scenario.chance,
            Accuracy: { low: scenario.accuracy[0], high: scenario.accuracy[1] },
            'Only when targeting': !!scenario.targeting, 'Water check': true } } : {};
        trials.push({ ...scenario, id: `${scenario.scenarioId.toLowerCase()}_${String(number).padStart(3, '0')}`,
            number, seed: Math.floor(random() * 0xffffffff), pilot,
            split: pilot ? 'pilot' : number <= 20 ? 'calibration' : 'evaluation',
            enabled: cheat ? ['JumpReset'] : [], settings, effectExpected: cheat,
            activeMs: 22000, transport: {
                actor: { latencyMs: 12 + Math.floor(random() * 85), jitterMs: 3 + Math.floor(random() * 30) },
                observer: { latencyMs: 5 + Math.floor(random() * 15), jitterMs: 2 + Math.floor(random() * 14) },
                server: { minimumMs: slow ? 80 : 0, jitterMs: slow ? 10 : 0 }
            } });
    }
    for (let i = trials.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [trials[i], trials[j]] = [trials[j], trials[i]];
    }
    const result = { schema: 1, createdAt: new Date().toISOString(), seed, trials,
        caveats: ['The port has its own unseeded Java RNG; only inputs/network conditions are seeded.',
            'Anticipatory controls deliberately challenge separation from legal skilled play.',
            'A module-on trial with no visible effect is a miss, not discarded for detector failure.'] };
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    return result;
}

async function play(lab, session, spec, truth, trialDir) {
    const random = h.rng(spec.seed), driver = session.driver;
    const inputProtocol = 'actor-view-controls-v2';
    truth.inputProtocol = inputProtocol;
    const scheduleRandom = h.rng(spec.seed ^ 0x4a1257), scheduled = [];
    const playStart = Date.now();
    if (spec.input === 'random') {
        let at = playStart + 300 + Math.floor(scheduleRandom() * 500);
        while (at < playStart + spec.activeMs) {
            scheduled.push({ at, down: true });
            scheduled.push({ at: at + 110 + Math.floor(scheduleRandom() * 71), down: false });
            at += 900 + Math.floor(scheduleRandom() * 901);
        }
    }
    truth.independentJumpSchedule = scheduled;
    let nextInput = 0;
    const wait = async ms => {
        const deadline = Date.now() + ms;
        while (nextInput < scheduled.length && scheduled[nextInput].at <= deadline) {
            const event = scheduled[nextInput++];
            await h.delay(Math.max(0, event.at - Date.now()));
            await driver.action('key', { vk: h.controls.SPACE, down: event.down });
        }
        await h.delay(Math.max(0, deadline - Date.now()));
    };
    const botLog = path.join(trialDir, 'opponent-input.jsonl');
    const log = row => fs.appendFileSync(botLog, JSON.stringify({ t: Date.now(), ...row }) + '\n');
    const follow = setInterval(() => {
        const actor = lab.opponent.players.LabActor?.entity;
        if (!actor || !lab.opponent.entity) return;
        const distance = lab.opponent.entity.position.distanceTo(actor.position);
        lab.opponent.lookAt(actor.position.offset(0, 1.4, 0), true).catch(() => {});
        lab.opponent.setControlState('forward', distance > 1.6 && distance < 20);
        lab.opponent.setControlState('back', distance < 1.1);
    }, 100);
    const end = Date.now() + spec.activeMs;
    let attacks = 0;
    try {
        // Genuine damage/velocity, rather than command-injected velocity.
        while (Date.now() < end) {
            const actor = lab.opponent.players.LabActor?.entity;
            if (!actor) throw new Error('Opponent cannot see the real actor');
            await driver.action('key', { vk: h.controls.W, down: true });
            await wait(160 + Math.floor(random() * 100));
            await driver.action('key', { vk: h.controls.W, down: false });
            const distance = lab.opponent.entity.position.distanceTo(actor.position);
            if (distance > 3.0) { await wait(120); continue; }
            await lab.opponent.lookAt(actor.position.offset(0, 1.4, 0), true);
            const attackedAt = Date.now();
            const anticipating = spec.input === 'anticipatory';
            const offset = anticipating ? spec.transport.actor.latencyMs - 35 + Math.floor(random() * 91) : 0;
            if (anticipating && offset < 0) {
                await driver.action('key', { vk: h.controls.SPACE, down: true });
                await wait(-offset);
            }
            log({ command: 'attack', actorEntityId: actor.id, distance, number: ++attacks });
            lab.opponent.attack(actor);
            if (anticipating) {
                if (offset >= 0) { await wait(offset); await driver.action('key', { vk: h.controls.SPACE, down: true }); }
                await wait(75 + Math.floor(random() * 35));
                await driver.action('key', { vk: h.controls.SPACE, down: false });
            } else if (spec.input === 'reactive') {
                const deadline = Date.now() + 350;
                let hurt;
                while (Date.now() < deadline && !hurt) {
                    hurt = lab.rawPackets.slice(-300).find(row =>
                        row.t >= attackedAt && row.name === 'entity_status' &&
                        row.data.entityId === actor.id && row.data.entityStatus === 2);
                    if (!hurt) await wait(15);
                }
                if (hurt) {
                    await wait(Math.max(0, spec.transport.actor.latencyMs - spec.transport.observer.latencyMs)
                        + 110 + Math.floor(random() * 160));
                    await driver.tap(h.controls.SPACE, 80 + Math.floor(random() * 35));
                }
            }
            await driver.action('mouse', { button: 'left', down: true });
            await wait(55 + Math.floor(random() * 50));
            await driver.action('mouse', { button: 'left', down: false });
            await wait(450 + Math.floor(random() * 220));
        }
    } finally {
        clearInterval(follow);
        lab.opponent.clearControlStates();
        await driver.action('key', { vk: h.controls.SPACE, down: false });
        await driver.action('key', { vk: h.controls.W, down: false });
    }
    truth.botAttackAttempts = attacks;
}

async function trial(lab, spec, attempt, runDir) {
    const directory = path.join(runDir, spec.id, `attempt-${String(attempt).padStart(3, '0')}`);
    fs.mkdirSync(directory, { recursive: true });
    const label = `${spec.id}_a${String(attempt).padStart(2, '0')}`;
    const truth = { id: spec.id, scenarioId: spec.scenarioId, pilot: spec.pilot, split: spec.split,
        scenario: spec, seed: spec.seed, requestedEnabled: spec.enabled, toggles: [], invalidReasons: [],
        startedAt: Date.now(), harnessSha256: sha(fs.readFileSync(__filename)),
        launcherAdapterSha256: sha(fs.readFileSync(path.join(__dirname, 'mod_real_night_helpers.js'))),
        inputDriverSha256: sha(fs.readFileSync(path.join(__dirname, 'mod_real_input.py'))) };
    let session, recording = false;
    try {
        h.checkHashes();
        truth.condition = await lab.configureConditions({ label, seed: spec.seed, ...spec.transport });
        session = await h.launchClient(lab, spec, directory);
        truth.fullModuleSettings = session.settings.config;
        await session.driver.action('respawn_click'); await h.delay(700);
        await lab.startRecording(label); recording = true;
        await lab.commands(['clear LabActor', 'clear LabOpponent', 'effect LabActor clear', 'effect LabOpponent clear',
            'gamemode 1 LabActor', 'gamemode 1 LabOpponent', 'tp LabActor 1.5 64 0.5 -90 0',
            'tp LabOpponent 3.5 64 0.5 90 0', 'tp LabObserver 12.5 70 -8.5',
            'gamemode 0 LabActor', 'gamemode 0 LabOpponent',
            'effect LabActor 21 9999 24 true', 'effect LabActor 10 9999 8 true',
            'effect LabOpponent 21 9999 24 true', 'effect LabOpponent 10 9999 8 true']);
        await session.driver.action('focus');
        await session.driver.tap(h.controls.ONE);
        await session.driver.tap(h.controls.E); await session.driver.tap(h.controls.ESC);
        await h.delay(6200);
        await session.driver.action('shot', { path: path.join(directory, 'hud_all_off.png') });
        for (const module of spec.enabled) {
            const down = await session.driver.action('key', { vk: h.vk[module], down: true });
            await h.delay(90); await session.driver.action('key', { vk: h.vk[module], down: false });
            truth.toggles.push({ t: down.t, module, enabled: true, keyVk: h.vk[module] });
            await h.delay(220);
            await session.driver.action('shot', { path: path.join(directory, `hud_after_${module.toLowerCase()}.png`) });
        }
        truth.cheatStartAt = spec.enabled.length ? Date.now() : null;
        truth.controlStartAt = Date.now();
        await play(lab, session, spec, truth, directory);
        truth.activeEndAt = Date.now(); await h.delay(1200);
        await lab.stopRecording(); recording = false;
        const recorderDirectory = path.join(lab.profile, 'recordings');
        const name = fs.readdirSync(recorderDirectory).find(name => name.endsWith(`_${label}.jsonl`));
        assert(name, 'Fury observer recording missing');
        truth.recorderFile = path.join('fury-profile', 'recordings', name);
        truth.observerPacketFile = `${label}.observer-packets.jsonl`;
        const target = resolveTarget(lines(path.join(recorderDirectory, name)), { player: 'LabActor' });
        assert(target.ids.size, 'Actor identity missing'); truth.actorId = [...target.ids].at(-1);
        const rows = lines(path.join(runDir, truth.observerPacketFile));
        const actor = rows.filter(row => row.data?.entityId === truth.actorId &&
            row.t >= truth.controlStartAt && row.t <= truth.activeEndAt);
        const counts = {};
        for (const row of actor) counts[row.name] = (counts[row.name] || 0) + 1;
        const hurts = actor.filter(row => row.name === 'entity_status' && row.data.entityStatus === 2);
        const velocities = actor.filter(row => row.name === 'entity_velocity');
        truth.observerEvidence = { actorPacketCounts: counts, hurts: hurts.length,
            velocities: velocities.length, sampleVelocities: velocities.slice(0, 8),
            serverDeaths: lab.server.output.includes('LabActor was slain') };
        if (hurts.length < 12) truth.invalidReasons.push('Fewer than 12 accepted observer hurt events');
        // Vanilla sends knockback velocity to the victim; this observer did
        // not receive S12 in the pilot. Preserve that absence as a limitation.
        // Validity uses accepted damage and movement, independent of a flag.
        truth.observerEvidence.velocityVisibility = velocities.length ? 'observed' : 'not exposed to observer';
        if (!counts.rel_entity_move && !counts.entity_move_look) truth.invalidReasons.push('No relative actor movement');
        if (!counts.animation) truth.invalidReasons.push('No actor swings');
        const input = lines(path.join(directory, 'input.jsonl'));
        if (input.some(row => !row.ok)) truth.invalidReasons.push('Focus/input failure');
        if (spec.enabled.length && input.some(row => row.command === 'key' && row.vk === h.controls.SPACE && row.down))
            truth.invalidReasons.push('Jump injected during cheat-only trial');
        truth.moduleState = 'pending HUD screenshot review';
    } catch (error) { truth.invalidReasons.push(error.message); truth.errorStack = error.stack; }
    finally {
        if (recording) try { await lab.stopRecording(); } catch (error) { truth.invalidReasons.push(error.message); }
        truth.endedAt = Date.now(); truth.automatedValid = !truth.invalidReasons.length;
        fs.writeFileSync(path.join(directory, 'ground-truth.json'), JSON.stringify(truth, null, 2) + '\n');
        await h.stopClient(session); await h.delay(1200);
    }
    return truth;
}

async function main() {
    h.checkHashes();
    const args = process.argv.slice(2), pilot = args.includes('--pilot');
    const frozen = plan(pilot);
    if (args.includes('--plan-only')) { console.log(JSON.stringify({ pilot, planned: frozen.trials.length })); return; }
    if (!pilot) {
        const inputAddendum = path.join(base, 'INPUT_PROTOCOL_ADDENDUM.json');
        if (!fs.existsSync(inputAddendum)) fs.writeFileSync(inputAddendum, JSON.stringify({
            createdAt: new Date().toISOString(), protocol: 'actor-view-controls-v2', decidedBeforeFullCaptures: true,
            planSeedsOrderLabelsSettingsUnchanged: true, detectorVerdictsUsedForValidity: false,
            L13: 'Independent seeded absolute-time Space schedule, 900–1800 ms spacing, 110–180 ms hold; never triggered by damage or attack.',
            L14: 'Observer hurt plus actor/observer relay base-delay difference, then 110–269 ms human reaction.',
            L15: 'Planned bot attack plus actor relay base delay and seeded −35..55 ms anticipatory error; no damage-event trigger.',
            reason: 'Control fidelity audit: the first pilot random jumps were attack-conditioned, and its anticipatory timing did not account for actor relay delay.'
        }, null, 2), { flag: 'wx' });
        const validationFile = path.join(base, 'CONTROL_PROTOCOL_PILOTS_VALIDATED.json');
        if (!fs.existsSync(validationFile)) {
            for (const id of ['l13_001', 'l14_001', 'l15_001']) {
                let done = false;
                for (const runName of fs.readdirSync(base).filter(n => /^pilot-\d+$/.test(n))) {
                    const directory = path.join(base, runName, id); if (!fs.existsSync(directory)) continue;
                    for (const attempt of fs.readdirSync(directory)) {
                        const file = path.join(directory, attempt, 'ground-truth.json');
                        if (fs.existsSync(file)) { const t = json(file); if (t.automatedValid && t.inputProtocol === 'actor-view-controls-v2') done = true; }
                    }
                }
                if (done) continue;
                const child = require('child_process').spawn(process.execPath, [__filename, '--pilot', `--force=${id}`],
                    { cwd: h.root, windowsHide: true, stdio: 'inherit' });
                const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
                assert.strictEqual(code, 0, 'Corrected control pilot failed');
            }
            console.log('Waiting for independent HUD/input/evidence review of corrected control pilots');
            while (!fs.existsSync(validationFile)) {
                if (fs.existsSync(path.join(base, '../overnight/STOP_AFTER_TRIAL'))) return;
                await h.delay(5000);
            }
        }
    }
    const limit = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] || frozen.trials.length);
    const force = args.find(a => a.startsWith('--force='))?.split('=')[1];
    const split = args.find(a => a.startsWith('--split='))?.split('=')[1];
    const completed = new Set();
    for (const runName of fs.readdirSync(base).filter(n => n.startsWith(pilot ? 'pilot-' : 'full-'))) {
        const run = path.join(base, runName);
        for (const spec of frozen.trials) {
            const dir = path.join(run, spec.id); if (!fs.existsSync(dir)) continue;
            for (const attempt of fs.readdirSync(dir)) {
                const file = path.join(dir, attempt, 'ground-truth.json');
                if (fs.existsSync(file) && json(file).automatedValid) completed.add(spec.id);
            }
        }
    }
    const selected = frozen.trials.filter(s => (!force || s.id === force) && (!split || s.split === split) &&
        (force || !completed.has(s.id))).slice(0, limit);
    if (!selected.length) { console.log('All selected JumpReset trials captured'); return; }
    const runDir = path.join(base, `${pilot ? 'pilot' : 'full'}-${Date.now()}`);
    const lab = new h.Lab(runDir, { traceDetectors: true });
    const summary = [];
    try {
        await lab.start();
        const offset = lab.server.outputTotal;
        lab.actor.quit(); lab.actor._client?.socket?.destroy();
        lab.bots = lab.bots.filter(bot => bot !== lab.actor);
        await eventually(() => assert(lab.serverOutputSince(offset).includes('LabActor left the game')), 'Remove setup actor');
        lab.actor = null;
        for (const spec of selected) for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`JumpReset ${spec.id} ${spec.split} attempt ${attempt} starting`);
            const result = await trial(lab, spec, attempt, runDir);
            const row = { id: spec.id, valid: result.automatedValid, invalidReasons: result.invalidReasons,
                evidence: result.observerEvidence };
            summary.push(row); fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
            console.log(JSON.stringify(row)); if (result.automatedValid) break;
        }
    } finally { await lab.close(); h.checkHashes(); }
    console.log(`JUMP_RESET_RUN=${runDir}`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { plan, scenarios };
