'use strict';
const assert = require('assert');
module.exports = source => {
    const before = '                const checks = {';
    assert.strictEqual(source.split(before).length, 2);
    return source.replace(before, `                const airClicks = truth.intentionalAirClicks || [];
                const observedAirClicks = airClicks.filter(click => packets.some(p => {
                    if (p.data?.entityId !== truth.actorId || !Number.isFinite(p.data?.pitch) ||
                        p.t < click.startedAt || p.t > click.endedAt) return false;
                    let pitch = (p.data.pitch & 255) * 360 / 256;
                    if (pitch > 180) pitch -= 360;
                    return pitch >= -90 && pitch < 35;
                }));
                const checks = {
                    intentionalMisplacedClicks: part !== 'scaffold' || spec.scenarioId !== 'L10' ||
                        (airClicks.length >= 3 && observedAirClicks.length >= 3 && spec.enabled.length === 0),`);
};
