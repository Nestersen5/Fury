'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, root } = require('./lab');
const { gamePhysics } = require('./game_clock');
const { entityAtCursor } = require('./interactions');
const { CombatInput } = require('./combat_input');
const { BlockHit } = require('./blockhit');
const { BlockHitLagBuffer } = require('./packet_behaviors');
const { ClickCadence } = require('./clicks');

async function blockhitPilot(lab, mode, seed, options = {}) {
    await lab.configureConditions({ label: 'setup', seed });
    const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
    await lab.commands(['clear LabActor', 'effect LabActor clear', 'fill 5 64 -1 5 66 1 stone',
        'fill 1 64 -1 1 66 1 stone', 'tp LabActor 2.5 64 0.5', 'tp LabOpponent 4.5 64 0.5',
        'effect LabOpponent 10 1000 10 true', 'effect LabActor 10 1000 10 true']);
    await delay(300);
    const label = options.id || `${mode === 'legit' ? 'legit_blockhit' : 'blockhit_' + mode}_pilot`;
    if (options.conditions) { await lab.configureConditions({ ...options.conditions, label, seed }); await delay(700); }
    await lab.startRecording(label);
    await lab.commands(['replaceitem entity LabActor slot.hotbar.0 wooden_sword 1']);
    await delay(2 * (options.conditions?.actor?.latencyMs || 0) + 100);
    await bot.equip(bot.inventory.items().find(item => item.name === 'wooden_sword'), 'hand');
    const target = bot.players.LabOpponent.entity;
    await bot.lookAt(target.position.offset(0, 1, 0));
    let blocks = 0, releases = 0, ownHurt = 0, targetHurt = 0;
    const input = new CombatInput({ targetAtCursor: () => entityAtCursor(bot),
        attack: entity => bot.attack(entity), swing: () => bot.swingArm(),
        beginUse: () => { blocks++; bot.activateItem(); }, endUse: () => { releases++; bot.deactivateItem(); } });
    const lag = new BlockHitLagBuffer({ seed, minDelay: options.lagDelay?.[0] ?? 50, maxDelay: options.lagDelay?.[1] ?? 100 });
    const controller = mode === 'legit' ? null : new BlockHit({ mode: mode === 'auto_paired' ? 'auto' : mode,
        seed, input, lag, requireMouse: options.requireMouse ?? false,
        chanceMin: options.chance?.[0] ?? 70, chanceMax: options.chance?.[1] ?? 90 });
    const context = () => ({ now: Date.now(), player: true, sword: bot.heldItem?.name.endsWith('_sword'),
        physicalUse: options.physicalUse || false, physicalAttack: input.attackHeld,
        target: target.position.distanceTo(bot.entity.position) <= (mode === 'lag' ? options.targetDistance ?? 5 : 5),
        crosshair: entityAtCursor(bot)?.id === target.id, ownHurt, targetHurt, expectedHurt: 0,
        gui: false, focused: true, clickerActive: mode === 'auto_paired' });
    const outgoing = [], delivered = [], transitions = [], originalWrite = bot._client.write;
    const deliver = (name, data) => { delivered.push({ t: Date.now(), name, data }); return originalWrite.call(bot._client, name, data); };
    bot._client.write = function (name, data) {
        const copy = { ...data }; outgoing.push({ t: Date.now(), name, data: copy });
        if (mode !== 'lag') return deliver(name, copy);
        const buffered = lag.buffering;
        lag.outgoing(name, copy, deliver, { now: Date.now(), targetPresent: context().target,
            holdingSword: context().sword, eligible: name !== 'keep_alive' });
        if (buffered && !lag.buffering) controller.flushed();
    };
    const hurt = packet => {
        if (packet.entityStatus !== 2) return;
        if (packet.entityId === bot.entity.id) ownHurt = 10;
        if (packet.entityId === target.id) targetHurt = 10;
    };
    bot._client.on('entity_status', hurt);
    const mouse = [];
    const pre = () => controller?.preTick(context());
    const sample = () => {
        for (const event of mouse.splice(0)) {
            if (event.button === 'attack') {
                input.setAttack(event.down);
                if (event.down) controller?.mouseAttack(context());
            } else input.setUse(event.down);
        }
        input.tick();
        transitions.push({ t: Date.now(), using: input.using, pressed: controller?.blocking || false, ownHurt, targetHurt });
    };
    const post = () => {
        ownHurt = Math.max(0, ownHurt - 1); targetHurt = Math.max(0, targetHurt - 1);
        controller?.livingUpdate(context(), true);
    };
    bot.on('labBeforeTick', pre); bot.on('labInputTick', sample); bot.on('labPostPlayerTick', post);
    const startedAt = Date.now(), durationMs = options.durationMs || 8000;
    const cadence = new ClickCadence({ seed, mode: 'normal', min: options.cps || 6, max: options.cps || 13 });
    let opponentTimer = null;
    if (options.opponentActive) opponentTimer = setInterval(() => {
        lab.opponent.lookAt(bot.entity.position.offset(0, 1, 0), true);
        const victim = entityAtCursor(lab.opponent);
        if (victim?.id === bot.entity.id) lab.opponent.attack(victim);
    }, options.opponentIntervalMs || 650);
    try {
        while (Date.now() - startedAt < durationMs) {
            const cycle = mode === 'legit' && options.defensiveHoldMs ? { holdMs: options.defensiveHoldMs,
                releaseMs: options.defensiveReleaseMs ?? 50, workerPauseMs: 0 }
                : mode === 'auto_paired' ? cadence.cycle(1700000000000 + Date.now() - startedAt)
                : { holdMs: options.cps ? Math.floor(400 / options.cps) : 60,
                    releaseMs: options.cps ? Math.floor(600 / options.cps) : 105, workerPauseMs: 0 };
            mouse.push({ button: 'attack', down: true });
            const paired = mode === 'legit' || (mode === 'auto_paired' && controller.shouldBlock(context()));
            if (paired) mouse.push({ button: 'use', down: true });
            await delay(cycle.holdMs);
            if (paired) mouse.push({ button: 'use', down: false });
            mouse.push({ button: 'attack', down: false });
            await delay(cycle.releaseMs + cycle.workerPauseMs);
        }
        await delay(150);
    } finally {
        clearInterval(opponentTimer);
        bot.removeListener('labBeforeTick', pre); bot.removeListener('labInputTick', sample); bot.removeListener('labPostPlayerTick', post);
        controller?.finish(); input.finish(); lag.finishTrial();
        bot._client.write = originalWrite; bot._client.removeListener('entity_status', hurt);
        await delay(900); await lab.stopRecording();
    }
    const packets = fs.readFileSync(path.join(lab.directory, `${label}.observer-packets.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
    const swings = packets.filter(p => p.name === 'animation' && p.data.entityId === bot.entity.id && p.data.animation === 0).length;
    const hurts = packets.filter(p => p.name === 'entity_status' && p.data.entityId === target.id && p.data.entityStatus === 2).length;
    const blockMetadata = packets.filter(p => p.name === 'entity_metadata' && p.data.entityId === bot.entity.id
        && p.data.metadata.some(entry => entry.key === 0 && (entry.value & 16))).length;
    const result = { scope: options.campaign ? 'Frozen-plan actual local gameplay trial' : 'Pilot only; excluded from calibration/evaluation counts', mode, seed,
        settings: { defensiveHoldMs: options.defensiveHoldMs ?? null, defensiveReleaseMs: options.defensiveReleaseMs ?? null,
            requireMouse: options.requireMouse ?? false, physicalUse: options.physicalUse || false,
            ignoreManual: true, chance: options.chance || [70, 90], lagDelay: options.lagDelay || [50, 100] },
        enabledModules: mode === 'legit' ? [] : mode === 'auto_paired' ? ['BlockHit Auto', 'AutoClicker Normal'] : ['BlockHit ' + mode],
        startedAt, endedAt: Date.now(), actorId: bot.entity.id, opponentId: target.id,
        limitations: ['Physical-use-held cases start with the physical button held and the game key cleared, modeling activation after GUI/focus reset; native OS hook equivalence unverified.',
            'Headless input sampling replaces original native Windows messages.',
            'Only visible Java timing-tracker initialization is modeled (E=0).',
            'Auto standalone has no visible source block trigger; paired case explicitly enables AutoClicker.'],
        effectExpected: mode !== 'legit' && mode !== 'auto' && (!options.requireMouse || options.physicalUse)
            && (options.chance?.[1] !== 0 || mode !== 'manual') && (mode !== 'lag' || options.targetDistance !== 0),
        effectObserved: blocks > 0, input: input.stats, blocks, releases, swings, hurts, blockMetadata, outgoing, delivered, transitions,
        validity: { requestedRealCombat: input.stats.attackRequests >= 5,
            acceptedGameEffects: (swings >= 2 && hurts >= 1) || blockMetadata >= 2,
            noSchedulerOverrun: bot.labClock.discardedTicks === 0 } };
    if (!options.campaign) {
        fs.writeFileSync(path.join(lab.directory, `${label}.ground-truth.json`), JSON.stringify(result, null, 2));
        assert(input.stats.attacks >= 5 && swings >= 5 && hurts >= 2, 'Accepted real combat required');
        if (mode !== 'auto') assert(blocks > 2 && blockMetadata > 0, 'Observer must see actual blocking');
        else assert.strictEqual(blocks, 0, 'Standalone Auto must not invent blocking');
        console.log(JSON.stringify({ mode, attacks: input.stats.attacks, blocks, swings, hurts, blockMetadata }));
    }
    return result;
}
async function main() {
    const lab = new Lab(process.argv[2] || path.join(root, `output/anticheat-lab/runs/blockhit-pilot-${Date.now()}`));
    try {
        await lab.start(); const results = [];
        const specs = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
            : ['legit', 'manual', 'predict', 'auto', 'auto_paired', 'lag'].map(mode => ({ mode }));
        for (const [index, spec] of specs.entries()) results.push(await blockhitPilot(lab, spec.mode, 421 + index, spec));
        assert.deepStrictEqual(lab.errors, []);
        fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify(results.map(r => ({ mode: r.mode, attacks: r.input.attacks, blocks: r.blocks,
            swings: r.swings, hurts: r.hurts, blockMetadata: r.blockMetadata })), null, 2));
        console.log(`Verified BlockHit pilots: ${lab.directory}`);
    } finally { await lab.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { blockhitPilot };
