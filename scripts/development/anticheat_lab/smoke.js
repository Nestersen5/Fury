'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, Vec3, root } = require('./lab');

async function main() {
    const directory = path.resolve(process.argv[2] || path.join(root, `output/anticheat-lab/runs/smoke-${Date.now()}`));
    const lab = new Lab(directory);
    try {
        await lab.start();
        await lab.commands(['replaceitem entity LabActor slot.hotbar.0 stone 64']);
        await lab.actor.equip(lab.actor.inventory.items().find(item => item.name === 'stone'), 'hand');
        await lab.startRecording('legit_lab_smoke');
        const ground = lab.actor.blockAt(new Vec3(2, 63, 0));
        assert(ground && ground.type !== 0, 'Real loaded support block');
        await lab.actor.placeBlock(ground, new Vec3(0, 1, 0));
        await lab.actor.look(Math.PI / 2, 0, true);
        lab.actor.setControlState('forward', true);
        await delay(1500);
        lab.actor.clearControlStates();
        await delay(300);
        await lab.stopRecording();
        const actorId = lab.actor.entity.id;
        const observedMoves = lab.rawPackets.filter(r => r.data.entityId === actorId && /entity_move|entity_teleport/.test(r.name)).length;
        const placed = lab.rawPackets.some(r => r.name === 'block_change' && r.data.location.x === 2
            && r.data.location.y === 64 && r.data.location.z === 0 && r.data.type !== 0);
        assert(observedMoves > 3, 'Observer received actual actor movement through Fury');
        assert(placed, 'Observer received server-accepted block placement through Fury');
        const result = { scope: 'infrastructure smoke only; no cheat calibration trials', actorId, observedMoves,
            serverAcceptedPlacementObserved: placed, errors: lab.errors, directory };
        fs.writeFileSync(path.join(directory, 'smoke-result.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result, null, 2));
    } finally { await lab.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
