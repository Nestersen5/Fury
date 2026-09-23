'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPacketRecorder } = require('../../src/recorder/packetRecorder.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-test-'));

let fakeNow = 1_000_000;
const uuidNames = new Map([['uuid-cheater', 'SusPlayer']]);

// Synchronous stream stand-in so the test can read files back immediately
// (the real recorder uses fs.createWriteStream, which flushes async).
const syncWriteStream = (file) => ({
    write: (chunk) => fs.appendFileSync(file, chunk),
    end: () => {},
    on: () => {}
});

const recorder = createPacketRecorder({
    dir,
    now: () => fakeNow,
    createWriteStream: syncWriteStream,
    getUuidMappedName: (uuid) => uuidNames.get(uuid) || null,
    snapshotEntities: () => [
        { entityId: 7, name: 'Bystander', x: 1, y: 65, z: 2 }
    ]
});

// Inactive recorder is a no-op and must not throw.
assert.strictEqual(recorder.isActive(), false);
recorder.observe({ entityId: 7 }, { name: 'animation' });
recorder.observeOwn({ x: 1, y: 2, z: 3 }, { name: 'position' });

// Start validation.
assert.strictEqual(recorder.start({ player: 'bad name!', label: 'reach' }).ok, false);
assert.strictEqual(recorder.start({ player: 'SusPlayer', label: '###' }).ok, false);

const started = recorder.start({
    player: 'SusPlayer',
    label: 'AutoBlock',
    source: 'live',
    meta: { account: 'Me', gameMode: 'BEDWARS' }
});
assert.strictEqual(started.ok, true);
assert.strictEqual(started.label, 'autoblock');
assert.ok(started.file.endsWith('.jsonl'));
assert.strictEqual(recorder.isActive(), true);
assert.strictEqual(recorder.start({ player: 'susplayer', label: 'reach' }).reason, 'already-recording');

// Feed a scene: spawn resolves the name via uuid, then movement/combat packets.
fakeNow += 50;
recorder.observe({ entityId: 42, playerUUID: 'uuid-cheater', x: 320, y: 2080, z: -640, yaw: 10, pitch: 0 }, { name: 'named_entity_spawn' });
fakeNow += 50;
recorder.observe({ entityId: 42, dX: 4, dY: 0, dZ: 2, onGround: true }, { name: 'rel_entity_move' });
recorder.observe({ entityId: 42, animation: 0 }, { name: 'animation' });
recorder.observe({ entityId: 42, metadata: [{ key: 0, value: 0x10 }] }, { name: 'entity_metadata' });
recorder.observe({ entityId: 42, entityStatus: 2 }, { name: 'entity_status' });
recorder.observe({ location: { x: 10, y: 66, z: 20 }, type: 35 }, { name: 'block_change' });
recorder.observe({ chunkX: 0, chunkZ: 1, records: [{ horizontalPos: 5, y: 66, blockId: 35 }] }, { name: 'multi_block_change' });
recorder.observe({ age: [0, 12345], time: [0, 6000] }, { name: 'update_time' });
recorder.observe({ x: 12.5, y: 66, z: 20.5, radius: 3, affectedBlockOffsets: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }] }, { name: 'explosion' });
recorder.observe({ message: JSON.stringify({ text: 'BED DESTRUCTION > Red Bed was destroyed by SusPlayer!' }), position: 0 }, { name: 'chat' });
recorder.observe({ action: 2, data: [{ UUID: 'uuid-cheater', ping: 42 }] }, { name: 'player_info' });
recorder.observe({ action: 4, data: [{ UUID: 'uuid-leaver-1' }, { UUID: 'uuid-leaver-2' }] }, { name: 'player_info' });
recorder.observe({ team: 'red', mode: 3, prefix: '§cR §c', players: ['SusPlayer', 'Bystander'] }, { name: 'scoreboard_team' });
recorder.observeOwn({ x: 100, y: 65, z: 100, onGround: true }, { name: 'position' });
// Non-whitelisted packet types are ignored.
recorder.observe({ foo: 1 }, { name: 'map_chunk' });

fakeNow += 100;
const summary = recorder.stop('SUSPLAYER');
assert.strictEqual(summary.ok, true);
assert.strictEqual(summary.player, 'SusPlayer');
assert.ok(summary.events > 0);
assert.strictEqual(recorder.isActive(), false);
assert.strictEqual(recorder.stop('SusPlayer').ok, false);

const lines = fs.readFileSync(summary.file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

const header = lines[0];
assert.strictEqual(header.k, 'header');
assert.strictEqual(header.player, 'SusPlayer');
assert.strictEqual(header.label, 'autoblock');
assert.strictEqual(header.source, 'live');
assert.strictEqual(header.gameMode, 'BEDWARS');

const snap = lines.find(l => l.k === 'snap');
assert.strictEqual(snap.name, 'Bystander');
assert.strictEqual(snap.id, 7);

const spawn = lines.find(l => l.k === 'spawn');
assert.strictEqual(spawn.id, 42);
assert.strictEqual(spawn.name, 'SusPlayer');

const kinds = lines.map(l => l.k);
['mv', 'anim', 'meta', 'st', 'blk', 'mblk', 'boom', 'time', 'chat', 'tab', 'own'].forEach(kind => {
    assert.ok(kinds.includes(kind), `expected a ${kind} record`);
});

const tab = lines.find(l => l.k === 'tab');
assert.strictEqual(tab.pings[0].ping, 42);
assert.strictEqual(tab.a, 2, 'tab records should carry the player_info action');

const tabRemove = lines.find(l => l.k === 'tab' && l.a === 4);
assert.deepStrictEqual(tabRemove.uuids, ['uuid-leaver-1', 'uuid-leaver-2'], 'remove_player uuids should be recorded');

const team = lines.find(l => l.k === 'team');
assert.strictEqual(team.team, 'red');
assert.strictEqual(team.mode, 3);
assert.deepStrictEqual(team.players, ['SusPlayer', 'Bystander']);

const boom = lines.find(l => l.k === 'boom');
assert.strictEqual(boom.blocks.length, 2);
assert.strictEqual(boom.blocks[0].y, 1);

const time = lines.find(l => l.k === 'time');
assert.strictEqual(time.age, 12345);

const meta = lines.find(l => l.k === 'meta');
assert.strictEqual(meta.m[0].key, 0);
assert.strictEqual(meta.m[0].value, 0x10);

const footer = lines[lines.length - 1];
assert.strictEqual(footer.k, 'footer');
assert.strictEqual(footer.reason, 'manual');

// map_chunk must not appear.
assert.ok(!kinds.includes('map_chunk'));
assert.ok(!lines.some(l => l.foo === 1));

// Event cap auto-stops the session.
const capped = createPacketRecorder({
    dir,
    now: () => fakeNow,
    maxEvents: 5,
    createWriteStream: syncWriteStream,
    getUuidMappedName: () => null,
    snapshotEntities: () => []
});
capped.start({ player: 'CapTest', label: 'reach' });
for (let i = 0; i < 20; i++) {
    capped.observe({ entityId: 1, animation: 0 }, { name: 'animation' });
}
assert.strictEqual(capped.isActive(), false, 'session should auto-stop at event cap');

// stopAll closes everything.
const multi = createPacketRecorder({ dir, now: () => fakeNow, createWriteStream: syncWriteStream, getUuidMappedName: () => null, snapshotEntities: () => [] });
multi.start({ player: 'PlayerOne', label: 'scaffold' });
multi.start({ player: 'PlayerTwo', label: 'blink', source: 'replay' });
assert.strictEqual(multi.status().length, 2);
assert.strictEqual(multi.status().find(s => s.player === 'PlayerTwo').source, 'replay');
const stopped = multi.stopAll('disconnect');
assert.strictEqual(stopped.length, 2);
assert.strictEqual(multi.isActive(), false);

// Ring buffer + clip: pre-command packets survive into the clip file.
const buf = createPacketRecorder({ dir, now: () => fakeNow, createWriteStream: syncWriteStream, getUuidMappedName: () => null, snapshotEntities: () => [] });
assert.strictEqual(buf.clip({ player: 'Toggler', label: 'aimassist' }).reason, 'buffer-off');
assert.strictEqual(buf.mark('snap').ok, false, 'mark requires an active recording');

const bufInfo = buf.setBuffering(true, 30);
assert.strictEqual(bufInfo.buffering, true);
assert.strictEqual(bufInfo.bufferSeconds, 30);

// Events land in the ring even with no session active.
buf.observe({ entityId: 9, animation: 0 }, { name: 'animation' });
fakeNow += 1000;
buf.observe({ entityId: 9, dX: 8, dY: 0, dZ: 0, onGround: true }, { name: 'rel_entity_move' });
assert.strictEqual(buf.isActive(), false);
assert.strictEqual(buf.getBufferInfo().bufferedEvents, 2);

// Old events are evicted past the window.
fakeNow += 31_000;
buf.observe({ entityId: 9, entityStatus: 2 }, { name: 'entity_status' });
assert.strictEqual(buf.getBufferInfo().bufferedEvents, 1, 'ring should evict events older than the window');

fakeNow += 500;
buf.observe({ entityId: 9, animation: 0 }, { name: 'animation' });
const clipped = buf.clip({ player: 'Toggler', label: 'aimassist' });
assert.strictEqual(clipped.ok, true);
assert.strictEqual(clipped.buffered, 2);

// Live packets continue into the clip session, and mark works now.
buf.observe({ entityId: 9, animation: 0 }, { name: 'animation' });
assert.strictEqual(buf.mark('blatant snap').ok, true);
const clipSummary = buf.stop('Toggler');
assert.strictEqual(clipSummary.ok, true);

const clipLines = fs.readFileSync(clipSummary.file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
assert.strictEqual(clipLines[0].k, 'header');
const clipKinds = clipLines.map(l => l.k);
assert.ok(clipKinds.includes('clipstart'), 'clip file should mark where buffered history ends');
assert.ok(clipKinds.includes('mark'), 'mark line should be in the clip file');
assert.strictEqual(clipLines.find(l => l.k === 'mark').note, 'blatant snap');
const clipStartIndex = clipKinds.indexOf('clipstart');
const bufferedAnims = clipLines.slice(0, clipStartIndex).filter(l => l.k === 'st' || l.k === 'anim');
assert.strictEqual(bufferedAnims.length, 2, 'both ring events should precede clipstart');

// Turning the buffer off empties the ring.
buf.setBuffering(false);
assert.strictEqual(buf.getBufferInfo().bufferedEvents, 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log('Packet recorder tests passed.');
