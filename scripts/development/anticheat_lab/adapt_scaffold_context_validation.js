'use strict';
const assert = require('assert');
module.exports = source => {
    const before = '                const checks = {';
    assert.strictEqual(source.split(before).length, 2, 'Observer context validation anchor changed');
    return source.replace(before, `                const expectedPose = spec.scenarioId === 'L11' ? [0.5,64,0.5] : [3.5,80,0.5];
                const context = truth.positionContext;
                const contextPacket = part === 'scaffold' && packets.find(p => p.name === 'entity_teleport' &&
                    p.t === context?.observerTeleport?.t && p.data?.entityId === truth.actorId &&
                    p.data.x / 32 === expectedPose[0] && p.data.y / 32 === expectedPose[1] && p.data.z / 32 === expectedPose[2]);
                const checks = {
                    enabledStartingPosition: part !== 'scaffold' || (context?.protocol === 'enabled-position-v1' &&
                        context.scoringEnabledBeforeTeleport === true && !!contextPacket &&
                        contextPacket.t >= context.startedAt && contextPacket.t < activeStart &&
                        truth.observerFollowingActorId === truth.actorId),`);
};
