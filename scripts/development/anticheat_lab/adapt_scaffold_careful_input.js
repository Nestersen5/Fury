'use strict';
// Deliberately aim into air between careful placements. No module or detector
// input is used. Split motion across frames so Windows cursor clipping cannot
// truncate a large relative movement before Minecraft recenters the cursor.
const assert = require('assert');
module.exports = source => {
    const before = "        if (id === 'L10' && steps % 5 === 1) await driver.action('move', { dx: Math.floor(rand()*11)-5, dy: Math.floor(rand()*7)-3 });";
    assert.strictEqual(source.split(before).length, 2, 'Careful input adaptation anchor changed');
    return source.replace(before, `        if (id === 'L10' && steps % 5 === 1) {
            const startedAt = Date.now();
            await driver.action('mouse', { button: 'right', down: false });
            for (let step = 0; step < 4; step++) {
                await driver.action('move', { dx: 0, dy: -150 });
                await delay(35);
            }
            await delay(270);
            await driver.mouseTap('right', 90 + Math.floor(rand()*41));
            for (let step = 0; step < 4; step++) {
                await driver.action('move', { dx: step === 3 ? Math.floor(rand()*11)-5 : 0, dy: 150 });
                await delay(35);
            }
            await driver.action('mouse', { button: 'right', down: true });
            (truth.intentionalAirClicks ||= []).push({ startedAt, endedAt: Date.now(),
                raisedAimPixels: 600, motionSteps: 4, motionStepWaitMs: 35,
                cooldownWaitMs: 270, modules: 'all OFF' });
        }`);
};
