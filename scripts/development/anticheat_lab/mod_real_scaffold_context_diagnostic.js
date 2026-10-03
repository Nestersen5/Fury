'use strict';
// Observer-only ablation: keep all recordings and never alter trial validity.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../..');
const base = path.join(root, 'output/anticheat-lab/mod-real/scaffold');
const read = file => JSON.parse(fs.readFileSync(file));
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const { createScaffoldDetector } = require(path.join(root, 'src/detect/scaffoldDetector'));
const audit = read(path.join(base, 'LIVE_REPLAY_AUDIT.json'));
const results = [];
for (const row of audit.divergences) {
    const run = path.join(base, row.run);
    const truth = read(path.join(run, row.id, row.attempt, 'ground-truth.json'));
    const records = lines(path.join(run, truth.recorderFile));
    const packets = lines(path.join(run, truth.observerPacketFile));
    function replay(includeSnapshots) {
        const flags = [], notes = [];
        const detector = createScaffoldDetector({ onFlag: f => flags.push(f), log: s => notes.push(s) });
        for (const r of records) if (includeSnapshots || r.k !== 'snap') detector.observeRecord(r);
        return { flags: flags.filter(f => f.entityId === truth.actorId),
            notes: notes.filter(s => s.includes('LabActor')), status: detector.getStatus() };
    }
    results.push({ id: row.id, actorId: truth.actorId, recordingStart: records[0]?.t,
        snapshot: records.filter(r => r.k === 'snap' && r.id === truth.actorId),
        actorAbsolutePackets: packets.filter(p => p.data?.entityId === truth.actorId &&
            ['named_entity_spawn', 'entity_teleport'].includes(p.name)).map(p => ({ t: p.t, name: p.name,
                x: p.data.x / 32, y: p.data.y / 32, z: p.data.z / 32 })),
        recorded: replay(true), withoutSnapshots: replay(false), originalLive: row.live });
}
const out = { generatedAt: new Date().toISOString(), explanation: 'Removing recorder snapshots tests initial position context; this diagnostic neither scores nor excludes trials.', results };
fs.writeFileSync(path.join(base, 'LIVE_CONTEXT_DIAGNOSTIC.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({ id: r.id, snapshot: r.snapshot,
    recordedFlags: r.recorded.flags.length, withoutSnapshotsFlags: r.withoutSnapshots.flags.length,
    liveFlags: r.originalLive.length, actorAbsolutePackets: r.actorAbsolutePackets })), null, 2));
