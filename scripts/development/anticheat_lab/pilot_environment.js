'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Lab, delay, root } = require('./lab');
const { gamePhysics } = require('./game_clock');

async function main() {
    const lab = new Lab(process.argv[2] || path.join(root, `output/anticheat-lab/runs/environment-pilot-${Date.now()}`));
    const results = [];
    try {
        await lab.start();
        const cases = [
            { speed: 1, label: 'legit_clock_pilot', actor: {}, observer: {}, server: {} },
            { speed: 1.07, label: 'timer_subtle_pilot', actor: { latencyMs: 35, jitterMs: 10 }, observer: { latencyMs: 20, jitterMs: 5 }, server: { minimumMs: 50, jitterMs: 15 } },
            { speed: 0.1, label: 'timer_slow_pilot', actor: {}, observer: {}, server: { minimumMs: 67, jitterMs: 12 } },
            { speed: 2, label: 'timer_fast_pilot', actor: { latencyMs: 100, jitterMs: 30 }, observer: { latencyMs: 75, jitterMs: 20 }, server: { minimumMs: 60, jitterMs: 15 } }
        ];
        for (const [index, scenario] of cases.entries()) {
            await lab.configureConditions({ label: 'setup', seed: index, actor: {}, observer: {}, server: {} });
            const bot = await lab.replaceActor({ plugins: { physics: gamePhysics } });
            bot.on('labUnsupportedState', state => lab.errors.push(`unsupported actor state: ${state}`));
            await lab.commands(['tp LabActor 0.5 64 0.5']);
            await delay(500);
            await bot.look(-Math.PI / 2, 0);
            await lab.configureConditions({ ...scenario, seed: 1000 + index });
            await delay(1000);
            await lab.startRecording(scenario.label);
            const positions = [], tick = () => positions.push({ t: Date.now(), position: bot.entity.position.clone(), grounded: bot.entity.onGround });
            bot.on('labPostPlayerTick', tick);
            bot.labClock.setSpeed(scenario.speed);
            const start = bot.entity.position.clone(), startedAt = Date.now(), rawStart = lab.rawPackets.length;
            bot.setControlState('forward', true);
            await delay(4000);
            bot.clearControlStates();
            const end = bot.entity.position.clone(), endedAt = Date.now();
            bot.labClock.setSpeed(1);
            bot.removeListener('labPostPlayerTick', tick);
            await delay(1000);
            await lab.stopRecording();
            const observerMoves = lab.rawPackets.slice(rawStart).filter(row => row.data.entityId === bot.entity.id && /entity_move|entity_teleport/.test(row.name)).length;
            const result = { ...scenario, seed: 1000 + index, kind: 'environment/clock pilot, excluded from trial counts',
                actorId: bot.entity.id, startedAt, endedAt, start, end, distance: end.distanceTo(start),
                simulatedTicks: positions.length, discardedTicks: bot.labClock.discardedTicks, observerMoves, positions };
            fs.writeFileSync(path.join(lab.directory, `${scenario.label}.ground-truth.json`), JSON.stringify(result, null, 2));
            assert(result.distance > 0.5, 'Real movement at every clock speed');
            assert(Math.abs(end.y - 64) < 0.001, 'Flat-ground comparison stays on the arena');
            assert(observerMoves > 2, 'Server relayed actor movement');
            assert(Math.abs(positions.length - 80 * scenario.speed) <= 3, 'Actual simulation tick count scales with timer speed');
            assert.strictEqual(result.discardedTicks, 0, 'No scheduler overrun');
            results.push(result);
            console.log(JSON.stringify({ label: scenario.label, ticks: result.simulatedTicks, distance: result.distance, observerMoves }));
        }
    } finally { await lab.close(); }
    const ticks = fs.readFileSync(path.join(lab.directory, 'server-ticks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    for (const result of results) {
        const values = ticks.filter(row => row.label === result.label && row.t >= result.startedAt && row.t <= result.endedAt);
        assert(values.length > 20, 'Actual server tick measurements required');
        result.serverMeasured = { ticks: values.length, meanIntervalMs: values.reduce((sum, r) => sum + r.intervalMs, 0) / values.length,
            minIntervalMs: Math.min(...values.map(r => r.intervalMs)), maxIntervalMs: Math.max(...values.map(r => r.intervalMs)) };
        delete result.positions;
    }
    assert(results.find(r => r.label === 'timer_slow_pilot').serverMeasured.meanIntervalMs > 55, 'Server tick variation actually applied');
    assert.deepStrictEqual(lab.errors, []);
    fs.writeFileSync(path.join(lab.directory, 'pilot-result.json'), JSON.stringify({ results, errors: lab.errors }, null, 2));
    console.log(`Verified environment pilots: ${lab.directory}`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
