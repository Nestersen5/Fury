'use strict';
// Follow-up-only fix for live/replay position context. The original campaign
// remains unchanged. Feed genuine server teleport packets while scoring is on.
const assert = require('assert');
module.exports = function adaptContext(source) {
    function replaceOnce(before, after) {
        assert.strictEqual(source.split(before).length, 2, 'Context adaptation anchor changed');
        source = source.replace(before, after);
    }
    replaceOnce("        await driver.action('focus');\n        await delay(1500);", `        await driver.action('focus');
        for (const vk of [controls.W, controls.A, controls.S, controls.D, controls.SPACE, controls.SHIFT, controls.CTRL])
            await driver.action('key', { vk, down: false });
        for (const button of ['left','right']) await driver.action('mouse', { button, down: false });
        await delay(1500);`);
    replaceOnce("        await lab.command('/anticheat on', /Anticheat/);", `        await lab.command('/anticheat on', /Anticheat/);
        const contextStartedAt = Date.now();
        const start = spec.scenarioId === 'L11'
            ? { x: 0.5, y: 64, z: 0.5, yaw: 0, pitch: 90 }
            : { x: 3.5, y: 80, z: 0.5, yaw: ['S2','L8'].includes(spec.scenarioId) ? 135 : 90, pitch: 80 };
        await lab.commands(['gamemode 1 LabActor',
            'tp LabActor ' + (start.x - 8) + ' ' + start.y + ' ' + start.z + ' ' + start.yaw + ' ' + start.pitch]);
        await delay(350);
        await lab.commands(['tp LabActor ' + start.x + ' ' + start.y + ' ' + start.z + ' ' + start.yaw + ' ' + start.pitch,
            'gamemode 0 LabActor']);
        await delay(700);
        const absolute = lab.rawPackets.filter(p => p.t >= contextStartedAt && p.name === 'entity_teleport' &&
            p.data.x / 32 === start.x && p.data.y / 32 === start.y && p.data.z / 32 === start.z).at(-1);
        assert(absolute, 'Observer must see the actual starting-position teleport while detection is enabled');
        truth.positionContext = { protocol: 'enabled-position-v1', startedAt: contextStartedAt,
            observerTeleport: absolute, scoringEnabledBeforeTeleport: true };`);
    replaceOnce('    const actorId = lab.opponent.players.LabActor?.entity?.id;', `    const actorUuid = lab.opponent.players.LabActor?.uuid;
    const observedSpawn = actorUuid ? lab.rawPackets.filter(p => p.name === 'named_entity_spawn' &&
        String(p.data.playerUUID || p.data.UUID || p.data.uuid).toLowerCase() === String(actorUuid).toLowerCase()).at(-1) : null;
    const actorId = lab.opponent.players.LabActor?.entity?.id ?? truth.positionContext?.observerTeleport?.data?.entityId ?? observedSpawn?.data.entityId;
    truth.observerFollowingActorId = actorId;`);
    replaceOnce('        truth.actorId = [...target.ids].at(-1);', `        truth.actorId = [...target.ids].at(-1);
        assert.strictEqual(truth.positionContext?.observerTeleport?.data.entityId, truth.actorId,
            'Position context must belong to the recorded actor');
        assert.strictEqual(truth.observerFollowingActorId, truth.actorId, 'Observer must follow the recorded actor');`);
    return source;
};
