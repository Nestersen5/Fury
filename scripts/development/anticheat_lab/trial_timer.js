'use strict';
const assert = require('assert');
const { delay } = require('./lab');
const { gamePhysics } = require('./game_clock');

async function timerTrial(lab, spec) {
    await lab.configureConditions({ label: 'setup', seed: spec.seed });
    const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
    const unsupported = [], corrections = [];
    bot.on('labUnsupportedState', state => unsupported.push(state));
    await lab.commands(['effect LabActor clear', 'clear LabActor', 'tp LabActor -5.5 64 -5.5',
        ...(spec.potion ? [`effect LabActor ${spec.potion.id} 60 ${spec.potion.amplifier} true`] : [])]);
    await delay(300);
    await bot.look(-Math.PI / 2, 0);
    await lab.configureConditions({ ...spec.conditions, label: spec.id, seed: spec.seed });
    await delay(700);
    await lab.startRecording(spec.id);
    const positions = [], outgoing = [];
    const originalWrite = bot._client.write;
    bot._client.write = function (name, data) {
        if (['flying', 'position', 'look', 'position_look', 'entity_action'].includes(name)) outgoing.push({ t: Date.now(), name, data: { ...data } });
        return originalWrite.call(this, name, data);
    };
    const corrected = packet => corrections.push({ t: Date.now(), packet });
    bot._client.on('position', corrected);
    let east = true, turns = 0;
    const pre = () => {
        const x = bot.entity.position.x;
        if (east && x > 23) { east = false; turns++; bot.look(Math.PI / 2, 0); }
        else if (!east && x < -8) { east = true; turns++; bot.look(-Math.PI / 2, 0); }
    };
    const post = event => positions.push({ ...event, position: bot.entity.position.clone(), grounded: bot.entity.onGround });
    bot.on('labBeforeTick', pre); bot.on('labPostPlayerTick', post);
    const startedAt = Date.now(), start = bot.entity.position.clone();
    try {
        bot.labClock.setSpeed(spec.speed);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', spec.movement.includes('sprint'));
        bot.setControlState('jump', spec.movement.includes('jump'));
        bot.setControlState('sneak', spec.movement === 'sneak');
        await delay(spec.durationMs);
    } finally {
        bot.clearControlStates(); bot.labClock.setSpeed(1);
        bot.removeListener('labBeforeTick', pre); bot.removeListener('labPostPlayerTick', post);
        await delay(900);
        bot._client.removeListener('position', corrected); bot._client.write = originalWrite;
        await lab.stopRecording();
    }
    const activeEnd = positions.at(-1)?.t || startedAt;
    const pathDistance = positions.reduce((sum, row, index) => sum + row.position.distanceTo(index ? positions[index - 1].position : start), 0);
    const ticksExpected = (activeEnd - startedAt) * Math.fround(spec.speed) / 50;
    const validity = { hadMotion: pathDistance > 0.1, noUnsupportedState: unsupported.length === 0,
        stayedOnArena: positions.every(row => row.position.y >= 63.999 && row.position.y < 70),
        noSchedulerOverrun: bot.labClock.discardedTicks === 0, clockScaled: Math.abs(positions.length - ticksExpected) <= 3 };
    const result = { startedAt, activeEnd, endedAt: Date.now(), actorId: bot.entity.id, start,
        seed: spec.seed, enabledModules: spec.enabled ? [{ module: 'Timer', speed: spec.speed }] : [],
        effectExpected: spec.enabled && spec.speed !== 1,
        labelKind: spec.enabled ? 'source-derived independent module' : 'scripted legitimate mechanic control',
        engine: 'independent game_clock.js + pinned prismarine-physics',
        limitations: ['On-foot survival only; no rendered animation equivalence claim.',
            'Monotonic clock assumes wall/high-resolution clock ratio 1; no clock-jump experiments.',
            'Scripted boundary turns are instantaneous; no aim detector conclusions.'],
        pathDistance, simulatedTicks: positions.length, ticksExpected, turns, unsupported,
        corrections, validity, positions, outgoing };
    // Return invalid evidence too. The runner writes it before rejecting the trial.
    return result;
}
module.exports = { timerTrial };
