'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createStasisDetector } = require('../../src/detect/stasisDetector');
const { createAutoblockDetector } = require('../../src/detect/autoblockDetector');
const { packetToRecord } = require('../../src/detect/detectorShared');
const { resolveTarget } = require('../../src/recorder/recordingAnalysis');
const fixture = name => path.join(__dirname, 'fixtures/anticheat_lab', name);
{
    const records = fs.readFileSync(fixture('legit_jumpcombat_grounded.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const target = resolveTarget(records, { player: 'LabActor' });
    for (const retainGrounded of [true, false]) {
        const flags = [], detector = createStasisDetector({ onFlag: flag => flags.push(flag) });
        for (const record of records) detector.observeRecord(retainGrounded ? record : { ...record, g: undefined });
        assert.strictEqual(flags.filter(f => target.ids.has(f.entityId)).length, retainGrounded ? 0 : 1,
            'Explicit grounded state must veto off-grid reconstructed height; removing it reproduces the real false flag');
    }
    const positive = fs.readFileSync(fixture('blink_movement_positive.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const positiveTarget = resolveTarget(positive, { player: 'LabActor' }), flags = [];
    const detector = createStasisDetector({ onFlag: f => flags.push(f) });
    for (const record of positive) detector.observeRecord(record);
    assert(flags.some(f => positiveTarget.ids.has(f.entityId) && f.tier === 'possible'), 'Real airborne movement Blink remains detectable');
    console.log('Real grounded jump/combat regression and airborne Blink positive passed.');
}
const records = fs.readFileSync(fixture('legit_ladder_blockchange.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const raw = JSON.parse(fs.readFileSync(fixture('ladder_multi_block_change.json'), 'utf8'));
const target = resolveTarget(records, { player: 'LabActor' });
assert.strictEqual(target.ids.size, 1);
let movements = 0, swings = 0, usedLiveConversion = false;
const flags = [], detector = createStasisDetector({ onFlag: flag => flags.push(flag) });
for (const record of records) {
    if (target.ids.has(record.id) && ['mv', 'mvl', 'tp'].includes(record.k)) movements++;
    if (target.ids.has(record.id) && record.k === 'anim') swings++;
    if (record.k === 'mblk' && record.r.some(block => block.b >> 4 === 65)) {
        const converted = packetToRecord(raw.name, raw.data, record.t);
        assert(converted, 'Live multi-block packet must reach the detector');
        detector.observeRecord(converted); usedLiveConversion = true;
    } else detector.observeRecord(record);
}
assert(usedLiveConversion && movements >= 20 && swings >= 20, 'Replay actual ladder movement and actions');
assert.strictEqual(flags.filter(flag => target.ids.has(flag.entityId)).length, 0, 'Real legitimate ladder pauses must not flag after observer receives ladders');
// Ablate metadata in a separate diagnostic replay to isolate the climbable
// guard from the sneak guard. This transformed trace is not new gameplay data.
for (const retainBlocks of [true, false]) {
    const ablationFlags = [], ablation = createStasisDetector({ onFlag: flag => ablationFlags.push(flag) });
    for (const record of records) {
        if (record.k === 'meta' || (!retainBlocks && ['blk', 'mblk'].includes(record.k))) continue;
        ablation.observeRecord(record.k === 'mblk' ? packetToRecord(raw.name, raw.data, record.t) : record);
    }
    assert.strictEqual(ablationFlags.filter(flag => target.ids.has(flag.entityId)).length, retainBlocks ? 0 : 1,
        'Live multi-block conversion must independently supply the ladder exclusion');
}
{
    const preexisting = fs.readFileSync(fixture('legit_ladder_preexisting.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const target = resolveTarget(preexisting, { player: 'LabActor' }), flags = [];
    const detector = createStasisDetector({ onFlag: flag => flags.push(flag) });
    assert(preexisting.some(record => record.k === 'meta' && record.m.some(entry => entry.key === 0 && (entry.value & 2))), 'Observer saw legitimate sneak input');
    for (const record of preexisting) detector.observeRecord(record);
    assert.strictEqual(flags.filter(flag => target.ids.has(flag.entityId)).length, 0, 'Pre-existing ladder pause is ambiguous while sneaking and must not flag');
}
console.log('Real observer ladder regressions passed, including initial chunk and live multi-block cases.');
{
    const records = fs.readFileSync(fixture('legit_defensive_blockhit_slowticks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const target = resolveTarget(records, { player: 'LabActor' }), flags = [];
    const detector = createAutoblockDetector({ onFlag: flag => flags.push(flag) });
    let clockPackets = 0;
    for (const record of records) {
        if (record.k === 'time') {
            const converted = packetToRecord('update_time', { age: [0, record.age] }, record.t);
            assert.strictEqual(converted.age, record.age); detector.observeRecord(converted); clockPackets++;
        } else detector.observeRecord(record);
    }
    assert(clockPackets >= 3 && records.filter(r => r.k === 'anim' && target.ids.has(r.id)).length >= 20);
    assert.strictEqual(flags.filter(f => target.ids.has(f.entityId)).length, 0,
        'Real legal blockhitting with slow server ticks must not become confirmed Autoblock');
    assert.strictEqual(packetToRecord('update_time', { age: [1, -1] }, 0).age, 8589934591, 'Protocol low word is unsigned');
    console.log('Real defensive blockhitting timing regression passed.');
}
{
    const records = fs.readFileSync(fixture('blockhit_lag_normal.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const target = resolveTarget(records, { player: 'LabActor' });
    for (const retainTiming of [true, false]) {
        const flags = [], detector = createAutoblockDetector({ onFlag: flag => flags.push(flag) });
        for (const record of records) if (retainTiming || record.k !== 'time') detector.observeRecord(record);
        if (retainTiming) assert(flags.some(f => target.ids.has(f.entityId) && f.tier === 'confirmed'),
            'Server-accepted source-derived Lag must remain detectable with normal observer timing');
        else assert.strictEqual(flags.length, 0, 'Missing clock context cannot certify blocking evidence');
    }
    console.log('Real BlockHit Lag positive and missing-timing ablation passed.');
}
{
    const records = fs.readFileSync(fixture('legit_defensive_blockhit_jitter.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const target = resolveTarget(records, { player: 'LabActor' }), flags = [];
    const detector = createAutoblockDetector({ onFlag: flag => flags.push(flag) });
    for (const record of records) detector.observeRecord(record);
    assert(records.filter(r => r.k === 'anim' && target.ids.has(r.id)).length >= 30);
    assert.strictEqual(flags.filter(f => target.ids.has(f.entityId)).length, 0,
        'Correlated jitter in real legitimate blockhitting must not be mistaken for a sustained block pattern');
    console.log('Real defensive blockhitting jitter regression passed.');
}
