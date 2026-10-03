'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, root } = require('./lab');
const { gamePhysics } = require('./game_clock');
const { entityAtCursor } = require('./interactions');
const { CombatInput } = require('./combat_input');
const { BlinkBuffer } = require('./packet_behaviors');
const { attachBlink } = require('./packet_bridge');

async function blinkPilot(lab, spec, index) {
    if (spec.campaign) await lab.configureConditions({ label: 'setup', seed: spec.seed });
    const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
    await lab.commands(['clear LabActor', 'effect LabActor clear', 'fill 5 64 -1 5 66 1 stone',
        'tp LabActor 2.5 64 0.5', 'tp LabOpponent 4.5 64 0.5', 'effect LabOpponent 10 1000 10 true']);
    await delay(300);
    const label = spec.campaign ? spec.id : `blink_${spec.type}_${spec.direction}_${spec.autoSend ? 'auto' : 'manual'}_pilot`;
    await lab.startRecording(label);
    await lab.commands(['replaceitem entity LabActor slot.hotbar.0 wooden_sword 1']);
    await bot.equip(bot.inventory.items().find(item => item.name === 'wooden_sword'), 'hand');
    const target = bot.players.LabOpponent.entity;
    const input = new CombatInput({ targetAtCursor: () => entityAtCursor(bot), attack: entity => bot.attack(entity),
        swing: () => bot.swingArm(), beginUse: () => {}, endUse: () => {}, canUse: () => false });
    const blink = new BlinkBuffer(spec), trace = [], episodes = [], queueSamples = [];
    const detach = attachBlink(bot._client, blink, row => trace.push(row));
    let tick = 0;
    const sample = () => {
        bot.lookAt(target.position.offset(0, 1, 0));
        input.setAttack(tick++ % (spec.attackEveryTicks ?? 3) === 0);
        input.tick();
        queueSamples.push({ t: Date.now(), queued: blink.queue.length, enabled: blink.enabled });
    };
    if (spec.campaign) {
        await lab.configureConditions({ ...spec.conditions, label: spec.id, seed: spec.seed });
        await delay(700);
    }
    bot.on('labInputTick', sample);
    if (spec.sneak) bot.setControlState('sneak', true);
    const startedAt = Date.now(), discarded = bot.labClock.discardedTicks;
    let activeEnd;
    try {
        for (let episode = 0; episode < (spec.episodes ?? 3); episode++) {
            await bot.waitForTicks(5);
            bot.setControlState('jump', true);
            await bot.waitForTicks(spec.freezeAfterTicks ?? (4 + (index % 2)));
            bot.setControlState('jump', false);
            const entry = { startedAt: Date.now(), localPosition: bot.entity.position.clone() };
            if (spec.enabled !== false) blink.enable();
            await delay(spec.holdMs ?? (spec.autoSend ? 1700 : 1200));
            entry.queuedAtEnd = blink.queue.length; entry.enabledAtEnd = blink.enabled;
            blink.disable(); entry.endedAt = Date.now(); episodes.push(entry);
            await delay(spec.releaseMs ?? 450);
        }
        await delay(200);
    } finally {
        activeEnd = Date.now();
        bot.removeListener('labInputTick', sample); input.finish(); bot.clearControlStates(); detach();
        await delay(spec.campaign ? 1200 : 350); await lab.stopRecording();
    }
    const packets = fs.readFileSync(path.join(lab.directory, `${label}.observer-packets.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
    const swings = packets.filter(p => p.name === 'animation' && p.data.entityId === bot.entity.id && p.data.animation === 0).length;
    const hurts = packets.filter(p => p.name === 'entity_status' && p.data.entityId === target.id && p.data.entityStatus === 2).length;
    const moves = packets.filter(p => p.data.entityId === bot.entity.id && /entity_move|entity_teleport/.test(p.name)).length;
    const requestedMovement = trace.filter(r => r.phase === 'requested' && r.direction === 'outgoing' && ['position', 'position_look', 'look', 'flying'].includes(r.name)).length;
    const deliveredMovement = trace.filter(r => r.phase === 'delivered' && r.direction === 'outgoing' && ['position', 'position_look', 'look', 'flying'].includes(r.name)).length;
    const movementSequence = phase => trace.filter(r => r.phase === phase && r.direction === 'outgoing'
        && ['position', 'position_look', 'look', 'flying'].includes(r.name)).map(r => ({ name: r.name, data: r.data }));
    const result = { kind: spec.campaign ? 'Frozen-plan real gameplay trial' : 'Real gameplay pilot, excluded from trial counts', sourceIdentity: 'Blink; candidate for requested Stasis, not verified name equivalence',
        spec, startedAt, activeEnd, endedAt: Date.now(), actorId: bot.entity.id, opponentId: target.id, episodes, queueSamples,
        effectExpected: spec.enabled !== false && (!spec.autoSend || spec.threshold !== 1),
        attacks: input.stats.attacks, observerSwings: swings, observerHurts: hurts, observerMoves: moves,
        requestedMovement, deliveredMovement, trace,
        validity: { acceptedGameEffects: swings >= 5 && hurts >= 1 && moves >= 4,
            allMovementDelivered: requestedMovement === deliveredMovement,
            movementContentsAndOrderPreserved: JSON.stringify(movementSequence('requested')) === JSON.stringify(movementSequence('delivered')),
            noSchedulerOverrun: bot.labClock.discardedTicks === discarded },
        limitations: ['Scripted ordinary attack inputs and target tracking are shared fixture controls.',
            'No original native packet dispatch executed; independent ordered queue uses owned protocol callbacks.'] };
    if (!spec.campaign) fs.writeFileSync(path.join(lab.directory, `${label}.ground-truth.json`), JSON.stringify(result, null, 2));
    if (spec.campaign) return result;
    assert(swings >= 5 && hurts >= 2 && moves >= 4, 'Server-accepted combat and movement required');
    assert.strictEqual(requestedMovement, deliveredMovement, 'All held movement must eventually be delivered exactly once');
    assert(episodes.every(e => e.queuedAtEnd > 0), 'Every episode must actually choke packets');
    console.log(JSON.stringify({ spec, swings, hurts, moves, queued: episodes.map(e => e.queuedAtEnd) }));
    return result;
}
async function main() {
    const lab = new Lab(process.argv[2] || path.join(root, `output/anticheat-lab/runs/blink-pilot-${Date.now()}`));
    try {
        await lab.start(); const results = [];
        const specs = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
            : ['movement', 'all'].flatMap(type => ['outgoing', 'both'].flatMap(direction => [false, true].map(autoSend => ({ type, direction, autoSend, threshold: 20 }))));
        for (const spec of specs) {
            results.push(await blinkPilot(lab, spec, results.length));
        }
        assert.deepStrictEqual(lab.errors, []);
        fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify(results.map(({ spec, observerSwings, observerHurts, observerMoves, requestedMovement, deliveredMovement }) =>
            ({ spec, observerSwings, observerHurts, observerMoves, requestedMovement, deliveredMovement })), null, 2));
        console.log(`Verified Blink pilots: ${lab.directory}`);
    } finally { await lab.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { blinkPilot };
