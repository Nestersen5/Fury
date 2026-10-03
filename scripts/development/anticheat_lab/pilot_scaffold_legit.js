'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, Vec3, root } = require('./lab');
const { gamePhysics } = require('./game_clock');
const { PlaceInput, placeStoneAtCursor } = require('./interactions');
const { LegitScaffold, edgeBox, hasCollision } = require('./scaffold_legit');

async function scaffoldPilot(lab, spec, index) {
    if (spec.campaign) await lab.configureConditions({ label: 'setup', seed: spec.seed });
    const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
    await lab.commands(['clear LabActor', 'effect LabActor clear', 'gamemode 1 LabActor',
        'tp LabActor 3.5 80 0.5', 'tp LabObserver 5.5 84 -10.5', 'tp LabOpponent 0.5 64 8.5',
        'fill 0 79 -1 30 80 1 air', 'fill 0 79 -1 3 79 1 stone', 'gamemode 0 LabActor']);
    await delay(300);
    const label = spec.campaign ? spec.id : `${spec.enabled ? 'scaffold_legit' : 'legit_sneakbridge'}_${index}_pilot`;
    await lab.startRecording(label);
    await lab.commands(['replaceitem entity LabActor slot.hotbar.0 stone 64']);
    bot.setQuickBarSlot(0); await delay(100);
    let endBlock = 3, wasSneaking = spec.physicalSneak, maxX = bot.entity.position.x;
    const controller = spec.enabled ? new LegitScaffold({ seed: spec.seed ?? (421 + index), ...spec }) : null;
    const context = () => ({ now: Date.now(), gui: false, physicalSneak: spec.physicalSneak, onLadder: false,
        pitch: -bot.entity.pitch * 180 / Math.PI, canActivate: true, forward: -1, grounded: bot.entity.onGround,
        wasSneaking, hasProjectedCollision: hasCollision(bot, edgeBox(bot)) });
    const placements = [], states = [], requests = [];
    const originalWrite = bot._client.write;
    bot._client.write = function (name, data) {
        if (['block_place', 'entity_action', 'arm_animation'].includes(name)) requests.push({ t: Date.now(), name, data });
        return originalWrite.call(this, name, data);
    };
    const input = new PlaceInput({ use: () => {
        const placed = placeStoneAtCursor(bot);
        if (placed) { placements.push(placed); if (placed.destination.y === 79 && placed.destination.z === 0) endBlock = Math.max(endBlock, placed.destination.x); }
    } });
    const aim = () => {
        if (bot.entity.position.x > endBlock + 1.015) bot.lookAt(new Vec3(endBlock + 1, 79.55, 0.5));
        else bot.look(Math.PI / 2, -83 * Math.PI / 180);
    };
    const sample = () => input.tick();
    const prePlayer = () => {
        const c = context(), requested = controller?.before(c);
        if (requested !== null && requested !== undefined) bot.setControlState('sneak', requested);
        wasSneaking = bot.getControlState('sneak');
        states.push({ t: c.now, position: bot.entity.position.clone(), projectedCollision: c.hasProjectedCollision,
            sneak: wasSneaking, delay: controller?.delay, grounded: c.grounded });
        maxX = Math.max(maxX, bot.entity.position.x);
    };
    const post = () => {
        const restore = controller?.after(context());
        if (restore !== null && restore !== undefined) bot.setControlState('sneak', restore);
    };
    if (spec.campaign) {
        await lab.configureConditions({ ...spec.conditions, label: spec.id, seed: spec.seed }); await delay(700);
    }
    bot.on('labBeforeTick', aim); bot.on('labInputTick', sample); bot.on('labPrePlayerTick', prePlayer); bot.on('labPostPlayerTick', post);
    const startedAt = Date.now(), discarded = bot.labClock.discardedTicks;
    let activeEnd;
    bot.setControlState('sneak', spec.physicalSneak); bot.setControlState('back', true); input.held = true;
    try { await delay(spec.durationMs ?? 8000); }
    finally {
        activeEnd = Date.now();
        input.held = false; bot.clearControlStates();
        bot.removeListener('labBeforeTick', aim); bot.removeListener('labInputTick', sample);
        bot.removeListener('labPrePlayerTick', prePlayer); bot.removeListener('labPostPlayerTick', post);
        bot._client.write = originalWrite;
        await delay(spec.campaign ? 1200 : 300); await lab.stopRecording();
    }
    const packets = fs.readFileSync(path.join(lab.directory, `${label}.observer-packets.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
    const accepted = new Set(packets.filter(p => p.name === 'block_change' && p.data.type === 16 && p.data.location.y === 79 && p.data.location.x >= 4)
        .map(p => `${p.data.location.x},${p.data.location.y},${p.data.location.z}`)).size;
    const sneakMetadata = packets.filter(p => p.name === 'entity_metadata' && p.data.entityId === bot.entity.id
        && p.data.metadata.some(entry => entry.key === 0 && (entry.value & 2))).length;
    const result = { kind: spec.campaign ? 'Frozen-plan real bridge gameplay trial' : 'Real bridge pilot, excluded from trial counts',
        spec, startedAt, activeEnd, endedAt: Date.now(), actorId: bot.entity.id,
        serverAcceptedBridgeBlocks: accepted, predictedBlocks: placements.length, sneakMetadata, maxX,
        minY: Math.min(...states.map(s => s.position.y)), states, placements, requests, effectExpected: !!spec.enabled,
        validity: { actualBridgeEffects: accepted >= 3 && maxX > 7, stayedOnBridge: states.every(s => s.position.y >= 79.99),
            observerSawSneaking: sneakMetadata > 0, noSchedulerOverrun: bot.labClock.discardedTicks === discarded },
        limitations: ['Normal held-use input and aim are fixture controls; Legit itself only changes sneaking.',
            'Collision integration uses pinned prismarine-physics, whose edge clamp is not byte-identical to vanilla.',
            'Stone, straight +X route only in these pilots; other modes/settings require separate coverage.'] };
    if (!spec.campaign) fs.writeFileSync(path.join(lab.directory, `${label}.ground-truth.json`), JSON.stringify(result, null, 2));
    if (spec.campaign) return result;
    assert(accepted >= 4 && maxX > 7, 'Actual bridge extension and traversal required');
    assert(result.minY >= 79.99, 'Actor stayed on the bridge');
    assert(sneakMetadata > 0, 'Observer saw real sneak metadata');
    console.log(JSON.stringify({ spec, accepted, predicted: placements.length, maxX, sneakMetadata, minY: result.minY }));
    return result;
}
async function main() {
    const lab = new Lab(process.argv[2] || path.join(root, `output/anticheat-lab/runs/scaffold-legit-pilot-${Date.now()}`));
    try {
        await lab.start(); const results = [];
        const specs = [
            { enabled: false, physicalSneak: true },
            { enabled: true, physicalSneak: false, minDelay: 100, maxDelay: 200 },
            { enabled: true, physicalSneak: false, minDelay: 0, maxDelay: 0 },
            { enabled: true, physicalSneak: true, requireSneak: true, minDelay: 100, maxDelay: 200 },
            { enabled: true, physicalSneak: false, minDelay: 500, maxDelay: 500 }
        ];
        for (const [index, spec] of specs.entries()) results.push(await scaffoldPilot(lab, spec, index));
        assert.deepStrictEqual(lab.errors, []);
        fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify(results.map(({ spec, serverAcceptedBridgeBlocks, maxX, minY }) =>
            ({ spec, serverAcceptedBridgeBlocks, maxX, minY })), null, 2));
        console.log(`Verified Scaffold Legit pilots: ${lab.directory}`);
    } finally { await lab.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { scaffoldPilot };
