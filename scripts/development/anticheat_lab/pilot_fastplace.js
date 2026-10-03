'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, Vec3, root } = require('./lab');
const { gamePhysics } = require('./game_clock');
const { PlaceInput, placeStoneAtCursor, blockAtCursor } = require('./interactions');

async function fastplacePilot(lab, spec, index) {
    if (spec.campaign) await lab.configureConditions({ label: 'setup', seed: spec.seed });
    const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
    await lab.commands(['clear LabActor', 'effect LabActor clear', 'tp LabOpponent 10.5 64 0.5',
        'fill -4 64 -4 4 69 4 air', 'tp LabActor 0.5 64 0.5']);
    await delay(300);
    const label = spec.campaign ? spec.id : `${spec.enabled ? 'fastplace' : 'legit_place'}_${spec.kind}_${spec.mode}_${spec.delay}_pilot`;
    await lab.startRecording(label);
    const item = spec.kind === 'block' ? 'stone' : 'snowball', count = spec.kind === 'block' ? 64 : 16;
    await lab.commands(Array.from({ length: 9 }, (_, slot) => `replaceitem entity LabActor slot.hotbar.${slot} ${item} ${count}`));
    bot.setQuickBarSlot(0);
    await delay(150);
    const predicted = [], requests = [], selection = [];
    const originalWrite = bot._client.write;
    bot._client.write = function (name, data) {
        if (['block_place', 'arm_animation', 'held_item_slot'].includes(name)) requests.push({ t: Date.now(), name, data });
        return originalWrite.call(this, name, data);
    };
    const candidates = [];
    for (let y = 63; y <= 66; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
        if (x === 0 && z === 0) continue;
        candidates.push(new Vec3(x, y, z));
    }
    candidates.sort((a, b) => a.y - b.y || (b.x * b.x + b.z * b.z) - (a.x * a.x + a.z * a.z));
    function selectNext() {
        for (const position of candidates) {
            const support = bot.blockAt(position), destination = bot.blockAt(position.offset(0, 1, 0));
            if (!support || support.type === 0 || destination?.type !== 0) continue;
            bot.lookAt(position.offset(0.5, 1, 0.5));
            const hit = blockAtCursor(bot);
            if (hit && hit.position.equals(position) && hit.face === 1) { selection.push({ t: Date.now(), support: position }); return true; }
        }
        return false;
    }
    const input = new PlaceInput({ heldItem: () => spec.kind, use: () => {
        if (spec.kind === 'block') {
            const result = placeStoneAtCursor(bot); if (result) predicted.push(result);
        } else if (bot.heldItem?.count > 0) {
            bot.activateItem(); bot.heldItem.count--; // Vanilla projectile consumption prediction; server inventory updates remain authoritative.
            predicted.push({ t: Date.now(), projectile: item });
        }
    } });
    let tick = 0, nextManualAt = 0;
    const pre = () => {
        if (!bot.heldItem || bot.heldItem.count <= 0) {
            const next = bot.inventory.slots.slice(36, 45).findIndex(stack => stack?.name === item && stack.count > 0);
            if (next >= 0) bot.setQuickBarSlot(next);
        }
        if (spec.kind === 'block') selectNext();
        else bot.look(-Math.PI / 2, 0.15);
        input.preTickFastPlace(spec);
        tick++;
        if (spec.campaign) {
            const released = spec.releaseWindow && tick % 60 >= 40;
            input.held = !spec.noInput && !spec.manualCps && !released;
            if (!spec.noInput && spec.manualCps && !released && Date.now() >= nextManualAt) {
                input.press(); nextManualAt = Date.now() + 1000 / spec.manualCps;
            }
        }
    };
    const sample = () => input.tick();
    if (spec.campaign) {
        await lab.configureConditions({ ...spec.conditions, label: spec.id, seed: spec.seed });
        await delay(700);
    }
    bot.on('labBeforeTick', pre); bot.on('labInputTick', sample);
    const startedAt = Date.now(), discarded = bot.labClock.discardedTicks; input.held = true;
    let activeEnd;
    try { await delay(spec.durationMs ?? 4000); }
    finally {
        activeEnd = Date.now();
        input.held = false; bot.removeListener('labBeforeTick', pre); bot.removeListener('labInputTick', sample);
        bot._client.write = originalWrite;
        await delay(spec.campaign ? 1200 : 500); await lab.stopRecording();
    }
    const packets = fs.readFileSync(path.join(lab.directory, `${label}.observer-packets.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
    const placements = new Set(packets.filter(p => p.name === 'block_change' && p.data.type === 16 && p.data.location.y >= 64)
        .map(p => `${p.data.location.x},${p.data.location.y},${p.data.location.z}`)).size;
    const projectiles = new Set(packets.filter(p => p.name === 'spawn_entity' && p.data.type === 61).map(p => p.data.entityId)).size;
    const matches = spec.mode === 'all' || (spec.mode === 'blocks' && spec.kind === 'block') || (spec.mode === 'projectiles' && spec.kind === 'projectile');
    const result = { kind: spec.campaign ? 'Frozen-plan real gameplay trial' : 'Real gameplay pilot, excluded from trial counts', spec, seed: spec.seed ?? 421 + index,
        startedAt, activeEnd, endedAt: Date.now(), actorId: bot.entity.id, inputAttempts: input.attempts,
        effectExpected: !!spec.enabled && spec.delay < 4 && matches && !spec.noInput && !spec.useClaimed,
        predictedActions: predicted.length, serverAcceptedBlocks: placements, observerSnowballSpawns: projectiles,
        limitation: 'Block prediction supports full stone only; aim/slot selection are shared scripted fixture inputs, not additional cheat modules.',
        predicted, requests, selection,
        validity: { acceptedGameEffects: spec.noInput ? placements === 0 && projectiles === 0 : (spec.kind === 'block' ? placements >= 5 : projectiles >= 5),
            noSchedulerOverrun: bot.labClock.discardedTicks === discarded } };
    if (!spec.campaign) fs.writeFileSync(path.join(lab.directory, `${label}.ground-truth.json`), JSON.stringify(result, null, 2));
    if (spec.campaign) return result;
    assert(spec.kind === 'block' ? placements >= 10 : projectiles >= 10, 'Require many server-accepted real uses');
    if (spec.enabled && spec.delay <= 1 && (spec.mode === 'all' || (spec.mode === 'blocks' && spec.kind === 'block') || (spec.mode === 'projectiles' && spec.kind === 'projectile'))) {
        assert(input.attempts >= 70, 'Accelerated use sampling actually occurred');
        assert(spec.kind === 'block' ? placements > 30 : projectiles > 50, 'Fast use resulted in actual gameplay effects');
    }
    console.log(JSON.stringify({ spec, attempts: input.attempts, predicted: predicted.length, placements, projectiles }));
    return result;
}
async function main() {
    const lab = new Lab(process.argv[2] || path.join(root, `output/anticheat-lab/runs/fastplace-pilot-${Date.now()}`));
    try {
        await lab.start(); const results = [];
        const specs = [
            { enabled: false, kind: 'block', mode: 'all', delay: 4 },
            { enabled: true, kind: 'block', mode: 'all', delay: 1 },
            { enabled: true, kind: 'block', mode: 'blocks', delay: 0 },
            { enabled: true, kind: 'block', mode: 'blocks', delay: 2 },
            { enabled: true, kind: 'block', mode: 'projectiles', delay: 0 },
            { enabled: false, kind: 'projectile', mode: 'all', delay: 4 },
            { enabled: true, kind: 'projectile', mode: 'all', delay: 1 },
            { enabled: true, kind: 'projectile', mode: 'projectiles', delay: 0 },
            { enabled: true, kind: 'projectile', mode: 'blocks', delay: 0 }
        ];
        for (const [index, spec] of specs.entries()) results.push(await fastplacePilot(lab, spec, index));
        assert.deepStrictEqual(lab.errors, []);
        fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify(results.map(({ spec, inputAttempts, predictedActions, serverAcceptedBlocks, observerSnowballSpawns }) =>
            ({ spec, inputAttempts, predictedActions, serverAcceptedBlocks, observerSnowballSpawns })), null, 2));
        console.log(`Verified FastPlace pilots: ${lab.directory}`);
    } finally { await lab.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fastplacePilot };
