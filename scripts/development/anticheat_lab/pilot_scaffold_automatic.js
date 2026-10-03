'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, Vec3, root } = require('./lab');
const { gamePhysics } = require('./game_clock');
const { PlaceInput, placeStoneAtCursor, blockAtCursor } = require('./interactions');
const { GodBridge } = require('./scaffold_godbridge');
const { TellyBridge } = require('./scaffold_tellybridge');
const { angles, setAngles } = require('./scaffold_rotation');
const { vectors } = require('./scaffold_core');

async function automaticPilot(lab, spec, index) {
    if (spec.campaign) await lab.configureConditions({ label: 'setup', seed: spec.seed });
    const bot = await lab.replaceActor({ plugins: { physics: gamePhysics }, labFrameMs: spec.renderFrameMs ?? 8,
        labVanillaFactors: spec.vanillaMovementFactors === true });
    bot.physicsEnabled = false;
    const d = spec.initialDirection ?? 6, [dx, dz] = vectors[d];
    const point = (x, y, z) => new Vec3(0.5 + (x - 0.5) * dx - (z - 0.5) * dz, y, 0.5 + (x - 0.5) * dz + (z - 0.5) * dx);
    const start = point(3.5, 80, 0.5), platform = [point(0.5, 79, -0.5).floored(), point(3.5, 79, 1.5).floored()];
    await lab.commands(['clear LabActor', 'effect LabActor clear', 'gamemode 1 LabActor',
        `tp LabActor ${start.x} 80 ${start.z}`, 'tp LabObserver 10.5 86 10.5', 'tp LabOpponent 0.5 64 8.5']);
    await bot.waitForChunksToLoad();
    await lab.commands(['fill -40 79 -40 40 82 40 air', 'fill -40 83 -40 40 86 40 air',
        `fill ${platform[0].x} 79 ${platform[0].z} ${platform[1].x} 79 ${platform[1].z} stone`,
        `tp LabActor ${start.x} 80 ${start.z}`, 'gamemode 0 LabActor']);
    bot.physicsEnabled = true;
    await delay(300);
    const label = spec.campaign ? spec.id : `${spec.mode}_${index}_pilot`;
    await lab.startRecording(label);
    await lab.commands([`replaceitem entity LabActor slot.hotbar.0 stone ${spec.stackCount ?? 64}`,
        `replaceitem entity LabActor slot.hotbar.1 stone ${spec.secondStackCount ?? 64}`]);
    bot.setQuickBarSlot(0); await delay(100);
    const placements = [], states = [], requests = [], unsupported = [], sourceListenerErrors = [];
    const input = new PlaceInput({ use: () => { const p = placeStoneAtCursor(bot); if (p) placements.push(p); } });
    const Controller = spec.mode === 'godbridge' ? GodBridge : TellyBridge;
    const controller = new Controller(bot, input, { seed: 941 + index, ...spec });
    controller.physical = { back: true, use: true };
    let endBlock = 3, activationAt = null, maxX = start.x, maxProgress = 3.5;
    const originalWrite = bot._client.write;
    bot._client.write = function (name, data) {
        if (['block_place', 'entity_action', 'position_look', 'look'].includes(name)) requests.push({ t: Date.now(), name, data });
        return originalWrite.call(this, name, data);
    };
    const fixture = () => {
        if (controller.pending()) {
            for (const p of placements) if (p.destination.y === 79) {
                const x = p.destination.x + 0.5, z = p.destination.z + 0.5;
                const localZ = 0.5 - (x - 0.5) * dz + (z - 0.5) * dx;
                if (Math.floor(localZ) === 0) endBlock = Math.max(endBlock, Math.floor(0.5 + (x - 0.5) * dx + (z - 0.5) * dz));
            }
            const p = bot.entity.position, progress = 0.5 + (p.x - 0.5) * dx + (p.z - 0.5) * dz;
            if (progress > endBlock + 1.015) bot.lookAt(point(endBlock + 1, 79.55, 0.5));
            else setAngles(bot, ({ 6: 90, 8: 270, 7: 180, 5: 0 })[d], 83);
            controller.restore();
        }
        if (activationAt && spec.turn) {
            const elapsed = Date.now() - activationAt;
            controller.physical[spec.turn] = elapsed >= 1500 && elapsed < 4500;
        }
    };
    const sample = () => {
        if (!controller.pending() && activationAt === null) activationAt = Date.now();
        maxX = Math.max(maxX, bot.entity.position.x);
        maxProgress = Math.max(maxProgress, 0.5 + (bot.entity.position.x - 0.5) * dx + (bot.entity.position.z - 0.5) * dz);
        const hit = blockAtCursor(bot);
        states.push({ t: Date.now(), position: bot.entity.position.clone(), velocity: bot.entity.velocity.clone(), rotation: angles(bot),
            controls: Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].map(k => [k, bot.getControlState(k)])),
            grounded: bot.entity.onGround, pending: controller.pending(), rotationOwned: controller.rotationOwned,
            direction: controller.direction, task: controller.task ? { target: controller.task.target, completed: controller.task.completed,
                remaining: controller.task.remaining } : null, active: controller.bridgingActive, level: controller.level,
            path: controller.path?.map(p => p.slice()), target: controller.target, targetRotation: controller.rotation.controller?.target,
            ray: hit ? { position: hit.position, face: hit.face } : null, heldCount: controller.blockCount() });
    };
    bot.on('labUnsupportedState', state => unsupported.push(state));
    bot.on('labSourceListenerError', event => sourceListenerErrors.push(event));
    if (spec.campaign) {
        // Keep the ordinary/manual fixture inactive while transport settles.
        await lab.configureConditions({ ...spec.conditions, label: spec.id, seed: spec.seed }); await delay(700);
    }
    bot.on('labBeforeTick', fixture); controller.attach(); bot.on('labPostPlayerTick', sample);
    const startedAt = Date.now(), discarded = bot.labClock.discardedTicks;
    let activeEnd;
    try { await delay(spec.durationMs ?? 10000); }
    finally {
        activeEnd = Date.now();
        controller.detach(); bot.removeListener('labBeforeTick', fixture); bot.removeListener('labPostPlayerTick', sample);
        bot._client.write = originalWrite;
        await delay(spec.campaign ? 1200 : 500); await lab.stopRecording();
    }
    const packets = fs.readFileSync(path.join(lab.directory, `${label}.observer-packets.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
    const accepted = new Set(packets.filter(p => p.name === 'block_change' && p.data.type === 16 && p.data.location.y >= 79)
        .map(p => `${p.data.location.x},${p.data.location.y},${p.data.location.z}`)).size;
    const acceptedAfterActivation = packets.filter(p => p.t > activationAt && p.name === 'block_change' && p.data.type === 16
        && p.data.location.y >= 79).length;
    const result = { kind: spec.campaign ? 'Frozen-plan automatic Scaffold gameplay trial' : 'Automatic Scaffold development pilot; excluded from campaign counts',
        spec, startedAt, activeEnd, endedAt: Date.now(),
        actorId: bot.entity.id, activationAt, accepted, acceptedAfterActivation, predicted: placements.length, maxX, maxProgress,
        minY: Math.min(...states.map(s => s.position.y)), maxY: Math.max(...states.map(s => s.position.y)),
        schedulerDiscarded: bot.labClock.discardedTicks - discarded, unsupported, sourceListenerErrors, states, placements, requests,
        effectExpected: !spec.pitchCheck || (spec.pitchThreshold ?? 45) <= 80,
        validity: { actualActivation: Boolean(activationAt), actualBridgeEffects: acceptedAfterActivation >= 3 && maxProgress > 7,
            noUnsupportedState: unsupported.length === 0, noSchedulerOverrun: bot.labClock.discardedTicks === discarded },
        limitations: ['Manual activation uses scripted ordinary aim and held use; thereafter only the independent module supplies movement/rotation.',
            'Headless prismarine collision/input integration is not byte-identical to vanilla; render schedule is 8ms nominal.',
            'Stone only. Source listener order with equal priority and native patches remains an equivalence limit.'] };
    if (!spec.campaign) fs.writeFileSync(path.join(lab.directory, `${label}.ground-truth.json`), JSON.stringify(result, null, 2));
    if (spec.campaign) return result;
    console.log(JSON.stringify({ spec, activationAt, accepted, acceptedAfterActivation, maxProgress, minY: result.minY, maxY: result.maxY }));
    assert(activationAt && acceptedAfterActivation >= 4 && maxProgress > 8, 'Require activation and actual automatic bridge traversal');
    assert(result.minY >= 79.99, 'Automatic bridge actor must not fall');
    assert(result.schedulerDiscarded === 0 && unsupported.length === 0 && lab.errors.length === 0);
    return result;
}
async function main() {
    const lab = new Lab(process.argv[2] || path.join(root, `output/anticheat-lab/runs/scaffold-auto-pilot-${Date.now()}`));
    try {
        await lab.start(); const results = [];
        const snapshot = path.join(lab.directory, 'client-source'); fs.mkdirSync(snapshot);
        for (const file of fs.readdirSync(__dirname).filter(file => file.endsWith('.js'))) fs.copyFileSync(path.join(__dirname, file), path.join(snapshot, file));
        const specs = process.argv[3]?.endsWith('.json') ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
            : (process.argv[3] ? [process.argv[3]] : ['godbridge', 'tellybridge']).map(mode => ({ mode }));
        for (const [index, spec] of specs.entries()) {
            try {
                const { activationAt, accepted, maxProgress, minY, maxY } = await automaticPilot(lab, spec, index);
                results.push({ spec, valid: true, activationAt, accepted, maxProgress, minY, maxY });
            } catch (error) { results.push({ spec, valid: false, error: error.message }); console.error(`${spec.mode} pilot ${index}: ${error.message}`); }
            fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify(results, null, 2));
        }
        assert(results.every(result => result.valid), 'Some automatic Scaffold pilots failed; evidence retained');
    } finally { await lab.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { automaticPilot };
