'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, root } = require('./lab');
const { ClickCadence } = require('./clicks');
const { CombatInput } = require('./combat_input');

async function runPilot(lab, mode, seed, durationMs = 8000) {
    await lab.replaceActor();
    const bot = lab.actor;
    await lab.commands(['clear LabActor', 'fill 5 64 -1 5 66 1 stone',
        'tp LabActor 2.5 64 0.5', 'tp LabOpponent 4.5 64 0.5',
        'effect LabOpponent 10 1000 10 true']);
    await delay(300);
    const label = `autoclicker_${mode.replace('+', 'plus')}_pilot`;
    await lab.startRecording(label);
    await lab.commands(['replaceitem entity LabActor slot.hotbar.0 wooden_sword 1']);
    await bot.equip(bot.inventory.items().find(item => item.name === 'wooden_sword'), 'hand');
    const opponent = bot.players.LabOpponent?.entity;
    assert(opponent, 'Opponent visible');
    await bot.lookAt(opponent.position.offset(0, 1, 0), true);
    const cadence = new ClickCadence({ mode, seed });
    const input = new CombatInput({ targetAtCursor: () => bot.entityAtCursor(3),
        attack: target => bot.attack(target), swing: () => bot.swingArm(),
        beginUse: () => bot.activateItem(), endUse: () => bot.deactivateItem() });
    const events = [], outgoing = [];
    const originalWrite = bot._client.write;
    bot._client.write = function (name, data) {
        if (['arm_animation', 'use_entity', 'block_dig', 'block_place'].includes(name)) outgoing.push({ t: Date.now(), name, data });
        return originalWrite.call(this, name, data);
    };
    const tick = () => input.tick();
    bot.on('physicsTick', tick);
    const startedAt = Date.now();
    const packetStart = lab.rawPackets.length;
    const chatStart = lab.messages.length;
    try {
        await delay(50); // Source click activation delay.
        while (Date.now() - startedAt < durationMs) {
            const cycle = cadence.cycle(1700000000000 + Date.now() - startedAt);
            events.push({ t: Date.now(), ...cycle });
            input.setAttack(true);
            await delay(cycle.holdMs);
            input.setAttack(false);
            await delay(cycle.releaseMs + cycle.workerPauseMs);
        }
        input.setAttack(false);
        await delay(150);
    } finally {
        bot.removeListener('physicsTick', tick);
        input.finish();
        bot._client.write = originalWrite;
        await lab.stopRecording();
    }
    const packets = lab.rawPackets.slice(packetStart);
    const swings = packets.filter(p => p.name === 'animation' && p.data.entityId === bot.entity.id && p.data.animation === 0).length;
    const hurts = packets.filter(p => p.name === 'entity_status' && p.data.entityId === lab.opponent.entity.id && p.data.entityStatus === 2).length;
    const result = { kind: 'actual local gameplay pilot; excluded from calibration/evaluation trial counts',
        scenario: 'stationary sword combat, independent AutoClicker', mode, settings: { minCps: 6, maxCps: 13, jitter: false },
        seed, durationMs, startedAt, endedAt: Date.now(), actorId: bot.entity.id, opponentId: lab.opponent.entity.id,
        implementation: { cadence: 'independent source-derived model', input: 'independent sampled 1.8 combat input',
            limitations: ['Mineflayer physics event samples input after movement simulation',
                'Native OS input injection and source render-frame jitter are not emulated',
                'Fresh unseeded hold RNG replaced by a deterministic separate stream',
                'Virtual timing epoch used for reproducible time salt; live scheduling jitter remains'] },
        input: input.stats, observerSwings: swings, observerHurtStatuses: hurts,
        flags: lab.messages.slice(chatStart).filter(row => row.message.includes('Possibly') || row.message.includes('CONFIRMED')),
        events, outgoing };
    fs.writeFileSync(path.join(lab.directory, `${label}.ground-truth.json`), JSON.stringify(result, null, 2) + '\n');
    assert(input.stats.attacks >= 20, 'Pilot must perform real crosshair attacks');
    assert(swings >= 20, 'Observer must receive real actor swings');
    assert(hurts > 0, 'Server must accept attacks and send damage status to observer');
    console.log(JSON.stringify({ mode, attacks: input.stats.attacks, swings, hurts, label }));
    return result;
}

async function main() {
    const lab = new Lab(process.argv[2] || path.join(root, `output/anticheat-lab/runs/clicker-pilot-${Date.now()}`));
    try {
        await lab.start();
        const results = [];
        for (const [i, mode] of ['normal', 'extra', 'extra+'].entries()) results.push(await runPilot(lab, mode, 421 + i));
        fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify({
            scope: 'Three pilots only. No 100-trial calibration/evaluation claim.',
            modes: results.map(r => ({ mode: r.mode, input: r.input, swings: r.observerSwings, hurtStatuses: r.observerHurtStatuses })),
            errors: lab.errors }, null, 2) + '\n');
        assert.deepStrictEqual(lab.errors, []);
        console.log(`Pilot results: ${lab.directory}`);
    } finally { await lab.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runPilot };
