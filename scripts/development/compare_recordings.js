'use strict';

// Replay-fidelity comparison for /recordcheat recordings.
//
// Usage:
//   node scripts/development/compare_recordings.js <live.jsonl> <replay.jsonl> <player>
//   node scripts/development/compare_recordings.js <live.jsonl> <replay.jsonl> <player> --live-id N --replay-id M
//   node scripts/development/compare_recordings.js inspect <file.jsonl>
//
// Hypixel replays spawn the visible actors as separate NPC entities with
// null names, while a named placeholder idles elsewhere. When the name
// lookup fails on one side, the tool auto-matches the actor by position:
// it is the same game, so the same player stands at the same coordinates.
// Use `inspect` to eyeball per-entity activity, or the --*-id overrides
// to force specific entity ids.

const {
    loadRecording,
    uuidNameMap,
    entityName,
    firstPositions,
    entityActivity,
    cameraProximity,
    findIdsByName,
    matchByPosition,
    quantiles,
    gaps,
    dedupTimes,
    usingItemFlag
} = require('../../src/recorder/recordingAnalysis.js');

function analyze(records, playerIds) {
    const isTracked = (r) => playerIds.has(Number(r.id));
    const stats = {
        totalRecords: records.length,
        durationMs: null,
        moves: [],
        looks: 0,
        heads: 0,
        teleports: 0,
        swings: [],
        hurt: 0,
        velocity: 0,
        metadataUpdates: 0,
        blockingToggles: 0,
        equipment: 0,
        blockChanges: 0,
        multiBlockRecords: 0,
        explosions: 0,
        chatLines: 0,
        pingSamples: 0,
        timeUpdates: [],
        ownMoves: 0
    };

    const timestamps = records.map(r => r.t).filter(Number.isFinite);
    if (timestamps.length >= 2) stats.durationMs = timestamps[timestamps.length - 1] - timestamps[0];

    let lastBlocking = null;
    for (const r of records) {
        switch (r.k) {
            case 'mv':
            case 'mvl':
                if (isTracked(r)) stats.moves.push(r.t);
                break;
            case 'look':
                if (isTracked(r)) stats.looks += 1;
                break;
            case 'head':
                if (isTracked(r)) stats.heads += 1;
                break;
            case 'tp':
                if (isTracked(r)) stats.teleports += 1;
                break;
            case 'anim':
                if (isTracked(r) && Number(r.a) === 0) stats.swings.push(r.t);
                break;
            case 'st':
                if (isTracked(r) && Number(r.s) === 2) stats.hurt += 1;
                break;
            case 'vel':
                if (isTracked(r)) stats.velocity += 1;
                break;
            case 'meta':
                if (isTracked(r)) {
                    stats.metadataUpdates += 1;
                    const blocking = usingItemFlag(r.m);
                    if (blocking !== null) {
                        if (lastBlocking !== null && blocking !== lastBlocking) stats.blockingToggles += 1;
                        lastBlocking = blocking;
                    }
                }
                break;
            case 'eq':
                if (isTracked(r)) stats.equipment += 1;
                break;
            case 'blk':
                stats.blockChanges += 1;
                break;
            case 'mblk':
                stats.multiBlockRecords += (r.r || []).length;
                break;
            case 'boom':
                stats.explosions += 1;
                break;
            case 'chat':
                stats.chatLines += 1;
                break;
            case 'ping':
                stats.pingSamples += (r.players || []).length;
                break;
            case 'tab':
                stats.pingSamples += (r.pings || []).length;
                break;
            case 'time':
                if (Number.isFinite(r.age)) stats.timeUpdates.push({ t: r.t, age: r.age });
                break;
            case 'own':
                stats.ownMoves += 1;
                break;
        }
    }
    return stats;
}

function tickRate(timeUpdates) {
    if (timeUpdates.length < 2) return null;
    const first = timeUpdates[0];
    const last = timeUpdates[timeUpdates.length - 1];
    const wallSeconds = (last.t - first.t) / 1000;
    if (wallSeconds <= 0) return null;
    return (last.age - first.age) / wallSeconds;
}

function fmt(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    return Number(value).toFixed(digits);
}

function compareRow(label, a, b, tolerancePct = 8) {
    const numA = Number(a);
    const numB = Number(b);
    let verdict = '';
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
        if (numA === 0 && numB === 0) verdict = 'both empty';
        else if (numA === 0 || numB === 0) verdict = 'MISSING in one';
        else {
            const diff = Math.abs(numA - numB) / Math.max(numA, numB) * 100;
            verdict = diff <= tolerancePct ? `OK (${diff.toFixed(1)}% diff)` : `DIFF ${diff.toFixed(1)}%`;
        }
    }
    console.log(
        `  ${label.padEnd(28)} ${String(a ?? '-').padStart(10)} ${String(b ?? '-').padStart(10)}  ${verdict}`
    );
}

function inspectFile(file) {
    const records = loadRecording(file);
    const activity = entityActivity(records);
    const positions = firstPositions(records);
    const proximity = cameraProximity(records);
    const rows = [...activity.values()]
        .sort((x, y) => (y.moves + y.anims) - (x.moves + x.anims))
        .slice(0, 15);
    console.log(`\n${file}`);
    console.log(`${'entity'.padEnd(9)} ${'name'.padEnd(18)} ${'moves'.padStart(6)} ${'anims'.padStart(6)} ${'metas'.padStart(6)} ${'cam dist'.padStart(9)}  first position`);
    console.log('-'.repeat(88));
    rows.forEach(row => {
        const pos = positions.get(row.id);
        const posText = pos ? `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})` : '-';
        const dist = proximity.get(row.id);
        const distText = Number.isFinite(dist) ? dist.toFixed(1) : '-';
        console.log(
            `${String(row.id).padEnd(9)} ${String(row.name || 'null').padEnd(18)} ${String(row.moves).padStart(6)} ${String(row.anims).padStart(6)} ${String(row.metas).padStart(6)} ${distText.padStart(9)}  ${posText}`
        );
    });
    console.log('\nUnnamed actors with high activity are replay NPCs. The one with the');
    console.log('smallest cam dist is the player your camera was following - in a labeled');
    console.log('replay clip, that is your target.');
}

function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--live-id') flags.liveId = Number(argv[++i]);
        else if (argv[i] === '--replay-id') flags.replayId = Number(argv[++i]);
        else positional.push(argv[i]);
    }
    return { positional, flags };
}

function main() {
    const { positional, flags } = parseArgs(process.argv.slice(2));

    if (positional[0] === 'inspect') {
        if (!positional[1]) {
            console.log('Usage: node scripts/development/compare_recordings.js inspect <file.jsonl>');
            process.exit(1);
        }
        inspectFile(positional[1]);
        return;
    }

    const [liveFile, replayFile, player] = positional;
    if (!liveFile || !replayFile || !player) {
        console.log('Usage: node scripts/development/compare_recordings.js <live.jsonl> <replay.jsonl> <player> [--live-id N] [--replay-id M]');
        console.log('       node scripts/development/compare_recordings.js inspect <file.jsonl>');
        process.exit(1);
    }

    const live = loadRecording(liveFile);
    const replay = loadRecording(replayFile);

    let liveIds = Number.isFinite(flags.liveId) ? new Set([flags.liveId]) : findIdsByName(live, player);
    let replayIds = Number.isFinite(flags.replayId) ? new Set([flags.replayId]) : findIdsByName(replay, player);

    // Replay actors are usually unnamed NPCs - match them by position instead:
    // same game, so the actor stands where the live player stood.
    let replayMatchNote = '';
    if (liveIds.size > 0 && replayIds.size > 0 && !Number.isFinite(flags.replayId)) {
        const livePositions = firstPositions(live);
        const refPos = [...liveIds].map(id => livePositions.get(id)).find(Boolean);
        const actorIds = matchByPosition(replay, refPos);
        const named = new Set(replayIds);
        actorIds.forEach(id => {
            if (!named.has(id)) {
                replayIds.add(id);
                replayMatchNote += `${replayMatchNote ? ', ' : ''}${id}`;
            }
        });
    } else if (liveIds.size > 0 && replayIds.size === 0) {
        const livePositions = firstPositions(live);
        const refPos = [...liveIds].map(id => livePositions.get(id)).find(Boolean);
        replayIds = matchByPosition(replay, refPos);
        replayMatchNote = [...replayIds].join(', ');
    }

    console.log(`\nPlayer: ${player}`);
    console.log(`  live entity ids:   ${[...liveIds].join(', ') || 'NOT FOUND'}`);
    console.log(`  replay entity ids: ${[...replayIds].join(', ') || 'NOT FOUND'}${replayMatchNote ? ` (position-matched: ${replayMatchNote})` : ''}`);

    if (liveIds.size === 0 || replayIds.size === 0) {
        console.log('\nPlayer not found in one of the recordings.');
        const names = (records) => {
            const uuidNames = uuidNameMap(records);
            const set = new Set();
            records.forEach(r => {
                if (r.k === 'spawn' || r.k === 'snap') {
                    const name = entityName(r, uuidNames);
                    if (name) set.add(name);
                }
            });
            return [...set].sort();
        };
        console.log(`  names in live:   ${names(live).join(', ') || '(none)'}`);
        console.log(`  names in replay: ${names(replay).join(', ') || '(none)'}`);
        console.log('\nNotes:');
        console.log('  - You cannot track YOURSELF live: your own client never receives entity');
        console.log('    packets about you. Pick another player.');
        console.log('  - Run `node scripts/development/compare_recordings.js inspect <file>` to see per-entity activity,');
        console.log('    then force ids with --live-id / --replay-id.');
        process.exit(2);
    }

    const a = analyze(live, liveIds);
    const b = analyze(replay, replayIds);

    const liveTps = tickRate(a.timeUpdates);
    const replayTps = tickRate(b.timeUpdates);
    const liveSwingsDeduped = dedupTimes(a.swings);
    const replaySwingsDeduped = dedupTimes(b.swings);

    console.log(`\n${'signal'.padEnd(30)} ${'live'.padStart(10)} ${'replay'.padStart(10)}`);
    console.log('-'.repeat(72));
    compareRow('duration (s)', fmt(a.durationMs / 1000, 1), fmt(b.durationMs / 1000, 1), 15);
    compareRow('tick rate (age/s)', fmt(liveTps, 2), fmt(replayTps, 2), 10);
    compareRow('move packets', a.moves.length, b.moves.length);
    compareRow('look-only packets', a.looks, b.looks, 25);
    compareRow('head rotations', a.heads, b.heads, 25);
    compareRow('teleports', a.teleports, b.teleports, 25);
    compareRow('arm swings (raw)', a.swings.length, b.swings.length, 8);
    compareRow('arm swings (deduped)', liveSwingsDeduped.length, replaySwingsDeduped.length, 8);
    compareRow('hurt events', a.hurt, b.hurt);
    compareRow('velocity packets', a.velocity, b.velocity, 25);
    compareRow('metadata updates', a.metadataUpdates, b.metadataUpdates, 25);
    compareRow('blocking-state toggles', a.blockingToggles, b.blockingToggles);
    compareRow('equipment changes', a.equipment, b.equipment, 15);
    compareRow('block changes (world)', a.blockChanges, b.blockChanges);
    compareRow('multi-block records', a.multiBlockRecords, b.multiBlockRecords, 25);
    compareRow('explosions (world)', a.explosions, b.explosions);
    compareRow('chat lines', a.chatLines, b.chatLines, 20);
    compareRow('ping samples', a.pingSamples, b.pingSamples, 100);

    const [mvP50a, mvP90a, mvMaxA] = quantiles(gaps(a.moves));
    const [mvP50b, mvP90b, mvMaxB] = quantiles(gaps(b.moves));
    console.log('\nMove-packet inter-arrival gaps (ms) - the blink/lag-range signal:');
    console.log(`  live:   p50=${fmt(mvP50a)} p90=${fmt(mvP90a)} max=${fmt(mvMaxA)}`);
    console.log(`  replay: p50=${fmt(mvP50b)} p90=${fmt(mvP90b)} max=${fmt(mvMaxB)}`);

    const [swP50a] = quantiles(gaps(liveSwingsDeduped), [0.5]);
    const [swP50b] = quantiles(gaps(replaySwingsDeduped), [0.5]);
    console.log('\nInter-swing median after dedup (ms) - the autoclicker/CPS signal:');
    console.log(`  live:   ${fmt(swP50a)}    replay: ${fmt(swP50b)}`);

    console.log('\nInterpretation:');
    console.log('  - deduped swings/toggles/blocks should match near-exactly if the replay is faithful.');
    console.log('  - raw swings may run ~2x in replays (duplicated animation packets) - use deduped.');
    console.log('  - timing (gaps, tick rate) only comparable when the replay ran at 1x speed.');
    console.log('  - ping samples and chat counts differ in replays by design - not a failure.');
    console.log('  - chat count in replays is inflated by the "Playing mm:ss" action bar.');
}

main();
