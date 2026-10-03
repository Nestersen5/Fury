'use strict';
// One arena correction used by both the original full study and fresh tests.
const assert = require('assert');
module.exports = function adaptScaffoldArena(source) {
    function replaceOnce(before, after) {
        assert.strictEqual(source.split(before).length, 2, 'Arena adaptation anchor changed: ' + before.slice(0, 60));
        source = source.replace(before, after);
    }
    replaceOnce("            'fill 0 79 -2 43 82 2 air',", "            'fill 0 79 -16 63 84 48 air',");
    replaceOnce("            'tp LabOpponent 8.5 64 8.5', 'gamemode 0 LabActor',",
        "            'tp LabOpponent 1.5 64 8.5', 'gamemode 0 LabActor',");
    replaceOnce('        await lab.start();', `        await lab.start();
        await lab.commands(['tp LabOpponent 0.5 64 8.5', ...Array.from({ length: 8 }, (_, n) =>
            'fill 4 ' + (n * 8) + ' -16 63 ' + (n * 8 + 7) + ' 48 air')]);
        const arenaAddendum = path.join(outputRoot, 'scaffold/ARENA_PROTOCOL_ADDENDUM.json');
        if (!fs.existsSync(arenaAddendum)) fs.writeFileSync(arenaAddendum, JSON.stringify({
            createdAt: new Date().toISOString(), decidedBeforeFullCaptures: true, detectorVerdictsUsed: false,
            voidGap: { x: [4,63], y: [0,63], z: [-16,48] },
            restoredCourse: { x: [0,63], y: [79,84], z: [-16,48] },
            previousAcceptedPlacementsRemovedEachTrial: true,
            reason: 'The earlier narrow restoration left diagonal blocks, and an existing floor remained below the gap.'
        }, null, 2), { flag: 'wx' });`);
    replaceOnce('        await setupTrial(lab, spec);', `        if (lab.modRealArenaPlaced?.length) await lab.commands(lab.modRealArenaPlaced.map(p =>
            'setblock ' + p.x + ' ' + p.y + ' ' + p.z + ' air'));
        lab.modRealArenaPlaced = [];
        await setupTrial(lab, spec);`);
    assert(source.includes('const placed = rows.filter(row => row.t >= activeStart && row.t <= truth.activeEndAt &&'),
        'Accepted placements must already be restricted to active play');
    replaceOnce('        truth.observerEvidence = { actorPacketCounts: counts, acceptedPlacements: placed.length,',
        '        lab.modRealArenaPlaced = placed.map(row => row.data.location);\n        truth.observerEvidence = { actorPacketCounts: counts, acceptedPlacements: placed.length,');
    // Keep the real observer in tracking range during long bridges. Its own
    // creative position is sent through the real proxy; actor motion is read
    // solely from received packets. No detector verdict is used for following.
    const playStart = source.indexOf('async function scaffoldPlay(');
    const playEnd = source.indexOf('\nasync function fullTrial(', playStart);
    assert(playStart > 0 && playEnd > playStart);
    let play = source.slice(playStart, playEnd);
    assert.strictEqual(play.split('    while (Date.now() < end) {').length, 3);
    play = play.replace('    const id = spec.scenarioId;', `    const id = spec.scenarioId;
    const actorId = lab.opponent.players.LabActor?.entity?.id;
    assert(Number.isInteger(actorId), 'Actor identity required for observer following');
    let position = null, lastFollowAt = 0;
    const update = (data, meta) => {
        if (data.entityId !== actorId) return;
        if (meta.name === 'named_entity_spawn' || meta.name === 'entity_teleport')
            position = { x: data.x / 32, y: data.y / 32, z: data.z / 32 };
        else if (position && (meta.name === 'rel_entity_move' || meta.name === 'entity_move_look')) {
            position.x += data.dX / 32; position.y += data.dY / 32; position.z += data.dZ / 32;
        }
    };
    for (const packet of lab.rawPackets) update(packet.data, { name: packet.name });
    lab.observer.on('packet', update);
    truth.observerFollowing = [];
    const followObserver = () => {
        const t = Date.now();
        if (!position || t - lastFollowAt < 1500 || position.y < 70) return;
        lastFollowAt = t;
        const next = { x: position.x + 8, y: position.y + 5, z: position.z - 8, onGround: false };
        lab.observer.write('position', next);
        truth.observerFollowing.push({ t, actor: { ...position }, observer: next });
    };
    try {`);
    play = play.replaceAll('    while (Date.now() < end) {', '    while (Date.now() < end) {\n        followObserver();');
    const closing = play.lastIndexOf('\n}');
    assert(closing > 0);
    play = play.slice(0, closing) + `\n    } finally { lab.observer.removeListener('packet', update); }` + play.slice(closing);
    source = source.slice(0, playStart) + play + source.slice(playEnd);
    return source;
};
