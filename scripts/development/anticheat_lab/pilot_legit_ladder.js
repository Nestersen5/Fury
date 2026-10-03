'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, root } = require('./lab');
const { gamePhysics } = require('./game_clock');
const { angles, setAngles } = require('./scaffold_rotation');
const ladder = ['fill 3 64 0 3 78 0 stone', 'fill 2 64 0 2 78 0 ladder 4'];
async function ladderTrial(lab, spec = {}) {
            const known = !!spec.known;
            if (spec.campaign) await lab.configureConditions({ label: 'setup', seed: spec.seed });
            const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
            await lab.commands(['clear LabActor', 'effect LabActor clear', `tp LabActor 2.7 ${spec.startY ?? 64} 0.5`, 'tp LabOpponent 0.5 64 7.5']);
            bot.setControlState('sneak', true);
            await delay(300);
            const label = spec.campaign ? spec.id : `legit_ladder_${known ? 'blockchange' : 'preexisting'}_pilot`;
            const messageOffset = lab.messages.length;
            await lab.startRecording(label);
            if (known) await lab.commands(['fill 2 64 0 2 78 0 air', ...ladder]);
            const states = [], episodes = [], originalWrite = bot._client.write, outgoing = [];
            bot._client.write = function (name, data) {
                if (['position', 'position_look', 'look', 'flying', 'arm_animation', 'entity_action'].includes(name)) outgoing.push({ t: Date.now(), name, data });
                return originalWrite.call(this, name, data);
            };
            let tick = 0;
            const after = () => {
                if (tick++ % (spec.attackEveryTicks ?? 3) === 0) bot.swingArm(); // ordinary empty crosshair clicks
                states.push({ t: Date.now(), position: bot.entity.position.clone(), velocity: bot.entity.velocity.clone(),
                    blockAtFeet: bot.blockAt(bot.entity.position)?.name, rotation: angles(bot), grounded: bot.entity.onGround });
            };
            if (spec.campaign) { await lab.configureConditions({ ...spec.conditions, label, seed: spec.seed }); await delay(700); }
            bot.on('labPostPlayerTick', after);
            const startedAt = Date.now(), discarded = bot.labClock.discardedTicks;
            let activeEnd;
            try {
                for (let i = 0; i < (spec.episodes ?? 10); i++) {
                    setAngles(bot, -90, spec.pitch ?? 0); bot.setControlState('sneak', false); bot.setControlState('forward', true);
                    await bot.waitForTicks((spec.climbTicks ?? 3) + (i + (spec.phase ?? 0)) % 3);
                    bot.setControlState('forward', false); bot.setControlState('sneak', true);
                    await bot.waitForTicks(4);
                    episodes.push({ t: Date.now(), position: bot.entity.position.clone(), roundedY32: Math.floor(bot.entity.position.y * 32) });
                    await delay(spec.holdMs ?? 800);
                }
            } finally {
                activeEnd = Date.now();
                bot.removeListener('labPostPlayerTick', after); bot._client.write = originalWrite; bot.clearControlStates();
                await delay(spec.campaign ? 1200 : 600); await lab.stopRecording();
            }
            const packets = fs.readFileSync(path.join(lab.directory, `${label}.observer-packets.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
            const swings = packets.filter(p => p.name === 'animation' && p.data.entityId === bot.entity.id && p.data.animation === 0).length;
            const changes = packets.reduce((count, p) => count + (p.name === 'block_change' && (p.data.type >> 4) === 65 ? 1
                : p.name === 'multi_block_change' ? p.data.records.filter(b => (b.blockId >> 4) === 65).length : 0), 0);
            const result = { kind: spec.campaign ? 'Frozen-plan legitimate ladder gameplay trial; no cheat enabled' : 'Legitimate real ladder development control; no cheat enabled',
                known, label, actorId: bot.entity.id, effectExpected: false,
                startedAt, activeEnd, endedAt: Date.now(), episodes, states, outgoing, observerSwings: swings, observerLadderChanges: changes,
                observerMessages: lab.messages.slice(messageOffset),
                validity: { actualLadderContact: states.length > 20 && states.every(s => s.blockAtFeet === 'ladder'),
                    actualClimbing: episodes.at(-1).position.y - episodes[0].position.y > 0.5, observerReceivedActions: swings >= 4,
                    expectedWorldContext: known ? changes >= 10 : changes === 0, noSchedulerOverrun: bot.labClock.discardedTicks === discarded },
                limitation: 'Scripted ordinary movement/sneak/empty-click inputs on real ladders; pinned headless physics, not human-population data.' };
            if (spec.campaign) return result;
            fs.writeFileSync(path.join(lab.directory, `${label}.ground-truth.json`), JSON.stringify(result, null, 2));
            assert(Object.values(result.validity).every(Boolean), 'Actual legitimate climbing and observer effects required');
            console.log(JSON.stringify({ label, swings, changes, heights: episodes.map(e => e.position.y) }));
            return result;
}
async function run() {
    const directory = process.argv[2] || path.join(root, `output/anticheat-lab/runs/legit-ladder-pilot-${Date.now()}`);
    const lab = new Lab(directory, { preObserverCommands: ladder });
    try {
        await lab.start(); const outcomes = [];
        for (const known of [false, true]) {
            const result = await ladderTrial(lab, { known });
            outcomes.push({ label: result.label, valid: true, actorId: result.actorId, swings: result.observerSwings,
                changes: result.observerLadderChanges, heights: result.episodes.map(e => e.position.y) });
        }
        fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify(outcomes, null, 2));
    } finally { await lab.close(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { ladderTrial, ladder };
