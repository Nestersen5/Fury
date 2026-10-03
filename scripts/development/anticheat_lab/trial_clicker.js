'use strict';
const { delay } = require('./lab');
const { gamePhysics } = require('./game_clock');
const { entityAtCursor } = require('./interactions');
const { CombatInput } = require('./combat_input');
const { ClickCadence } = require('./clicks');
const { ClickJitter } = require('./click_jitter');
const { JavaRandom } = require('./random');

async function clickerTrial(lab, spec) {
    await lab.configureConditions({ label: 'setup', seed: spec.seed });
    const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
    await lab.commands(['clear LabActor', 'effect LabActor clear', 'fill 5 64 -1 5 66 1 stone',
        'tp LabActor 2.5 64 0.5', 'tp LabOpponent 4.5 64 0.5', 'effect LabOpponent 10 1000 10 true']);
    await delay(250);
    await lab.configureConditions({ ...spec.conditions, label: spec.id, seed: spec.seed });
    await delay(700);
    await lab.startRecording(spec.id);
    await lab.commands(['replaceitem entity LabActor slot.hotbar.0 wooden_sword 1', 'replaceitem entity LabActor slot.hotbar.1 wooden_axe 1']);
    await delay(2 * (spec.conditions.actor.latencyMs || 0) + 150);
    bot.setQuickBarSlot(0);
    const target = bot.players.LabOpponent.entity;
    await bot.lookAt(target.position.offset(0, 1, 0));
    const input = new CombatInput({ targetAtCursor: () => entityAtCursor(bot), attack: entity => bot.attack(entity),
        swing: () => bot.swingArm(), beginUse: () => {}, endUse: () => {}, canUse: () => false });
    const cadence = new ClickCadence({ mode: spec.mode || 'normal', seed: spec.seed, min: spec.cps[0], max: spec.cps[1] });
    const jitter = spec.jitter ? new ClickJitter(cadence.rng, spec.sensitivity) : null;
    const manualRng = new JavaRandom(spec.seed);
    const outgoing = [], events = [], frames = [], unsupported = [];
    const originalWrite = bot._client.write;
    bot._client.write = function (name, data) {
        if (['arm_animation', 'use_entity', 'held_item_slot'].includes(name)) outgoing.push({ t: Date.now(), name, data });
        return originalWrite.call(this, name, data);
    };
    bot.on('labUnsupportedState', state => unsupported.push(state));
    const startedAt = Date.now();
    let active = false, activationStarted = 0, lastAimPeriod = -1;
    const elapsed = () => Date.now() - startedAt;
    const physicalHeld = () => !spec.releaseActivation || elapsed() % 3200 >= 650;
    const pre = () => {
        jitter?.tick();
        const period = Math.floor(elapsed() / 1000);
        if (period !== lastAimPeriod) {
            lastAimPeriod = period;
            if (spec.targetLoss && period % 4 === 2) bot.look(0.4, -0.1);
            else bot.lookAt(target.position.offset(0, 1, 0));
        }
        if (spec.limitItems) bot.setQuickBarSlot(elapsed() % 3500 < 700 ? 1 : 0);
    };
    const sample = () => input.tick();
    const render = () => {
        if (!jitter) return;
        const e = bot.entity, updated = jitter.render(180 - e.yaw * 180 / Math.PI, -e.pitch * 180 / Math.PI);
        e.yaw = (180 - updated.yaw) * Math.PI / 180; e.pitch = -updated.pitch * Math.PI / 180;
        if (updated.yawDelta || updated.pitchDelta) frames.push({ t: Date.now(), ...updated });
    };
    bot.on('labBeforeTick', pre); bot.on('labInputTick', sample); bot.on('labRenderFrame', render);
    let deferred = 0, gated = 0;
    try {
        while (elapsed() < spec.durationMs) {
            const held = !spec.holdToClick || physicalHeld();
            if (!held) { active = false; input.setAttack(false); gated++; await delay(5); continue; }
            if (!active) { active = true; activationStarted = Date.now(); }
            if (Date.now() - activationStarted < 50 || (spec.limitItems && !bot.heldItem?.name.endsWith('_sword'))) {
                gated++; await delay(5); continue;
            }
            let cycle;
            if (spec.enabled) cycle = cadence.cycle(1700000000000 + elapsed());
            else {
                // An independent scripted input distribution, not evidence of human behavior.
                const cps = spec.cps[0] + (spec.cps[1] - spec.cps[0]) * manualRng.nextDouble();
                const interval = Math.max(45, Math.round(1000 / cps * (0.85 + 0.3 * manualRng.nextDouble())));
                const holdMs = Math.round(interval * (0.25 + 0.3 * manualRng.nextDouble()));
                cycle = { holdMs, releaseMs: interval - holdMs, workerPauseMs: 0, cycleMs: interval };
            }
            // In the visible source trigger deferral happens after cadence/hold RNG sampling.
            if (spec.enabled && spec.trigger && !entityAtCursor(bot)) { deferred++; await delay(5); continue; }
            events.push({ t: Date.now(), ...cycle });
            input.setAttack(true); jitter?.press();
            await delay(cycle.holdMs); input.setAttack(false);
            await delay(cycle.releaseMs + cycle.workerPauseMs);
        }
        input.setAttack(false); await delay(100);
    } finally {
        bot.removeListener('labBeforeTick', pre); bot.removeListener('labInputTick', sample); bot.removeListener('labRenderFrame', render);
        input.finish(); bot._client.write = originalWrite;
        await delay(900); await lab.stopRecording();
    }
    return { startedAt, activeEnd: Date.now() - 900, endedAt: Date.now(), actorId: bot.entity.id, opponentId: target.id,
        enabledModules: spec.enabled ? [{ module: 'AutoClicker', mode: spec.mode, settings: spec }] : [],
        labelKind: spec.enabled ? 'source-derived independent module' : 'scripted legitimate input control',
        effectExpected: spec.enabled, input: input.stats, events, outgoing, jitterFrames: frames, deferred, gated, unsupported,
        validity: { actualCrosshairAttacks: input.stats.attacks >= 2, noUnsupportedState: unsupported.length === 0,
            noSchedulerOverrun: bot.labClock.discardedTicks === 0 },
        limitations: ['No native OS input injector or original entropy; deterministic independent hold RNG and virtual epoch.',
            'Break-blocks/GUI/input-owner interactions are not supported in this combat scenario.',
            'Render cadence is headless and uses elapsed scheduling; no visual animation equivalence claim.',
            'Periodic aim correction and slot changes are shared scripted fixture controls.'] };
}
module.exports = { clickerTrial };
