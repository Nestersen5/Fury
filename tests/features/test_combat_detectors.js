'use strict';

// Unit tests + corpus shadow run for the Autoblock and Stasis detectors.
// The corpus gate is the contract: ZERO flags on players in legit-labeled
// recordings (Stasis is replayed over live recordings only, as in the
// proxy).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAutoblockDetector } = require('../../src/detect/autoblockDetector.js');
const { createStasisDetector } = require('../../src/detect/stasisDetector.js');
const { packetToRecord } = require('../../src/detect/detectorShared.js');
const { loadRecording, resolveTarget } = require('../../src/recorder/recordingAnalysis.js');

const DIAMOND_SWORD = 276;
const BOW = 261;
const BLOCKING = 0x10;

function autoblock(flags) {
    const detector = createAutoblockDetector({ onFlag: f => flags.push(f) });
    let nextClock = -2000;
    // These original behavior fixtures assume normal server timing. Supply
    // ordinary world-age packets so the timing guard is tested in that context.
    return { ...detector, observeRecord(record) {
        while (nextClock <= record.t) {
            detector.observeRecord({ k: 'time', t: nextClock, age: 1000 + nextClock / 50 });
            nextClock += 1000;
        }
        detector.observeRecord(record);
    } };
}

// ---- autoblock: legit block-hitting releases before every swing ----
{
    const flags = [];
    const d = autoblock(flags);
    d.observeRecord({ k: 'eq', t: 0, id: 1, slot: 0, item: DIAMOND_SWORD });
    for (let i = 0; i < 60; i++) {
        const t = 1000 + i * 150;
        d.observeRecord({ k: 'meta', t: t - 50, id: 1, m: [{ key: 0, value: 0 }] }); // release a tick before
        d.observeRecord({ k: 'anim', t, id: 1, a: 0 });
        d.observeRecord({ k: 'meta', t: t + 5, id: 1, m: [{ key: 0, value: BLOCKING }] }); // re-block
    }
    assert.strictEqual(flags.length, 0, 'legit block-hitting must not flag');
}

// ---- autoblock: occasional jitter (1 in 10 swings) must not flag ----
{
    const flags = [];
    const d = autoblock(flags);
    d.observeRecord({ k: 'eq', t: 0, id: 2, slot: 0, item: DIAMOND_SWORD });
    for (let i = 0; i < 80; i++) {
        const t = 1000 + i * 150;
        const jitter = i % 10 === 0;
        if (!jitter) d.observeRecord({ k: 'meta', t: t - 50, id: 2, m: [{ key: 0, value: 0 }] });
        d.observeRecord({ k: 'anim', t, id: 2, a: 0 });
        d.observeRecord({ k: 'meta', t: t + 5, id: 2, m: [{ key: 0, value: BLOCKING }] });
    }
    assert.strictEqual(flags.length, 0, '10% swings-while-blocking is legit network jitter');
}

// ---- autoblock: swinging with blocking held the whole time flags, and
// ---- sustained evidence upgrades to CONFIRMED ----
{
    const flags = [];
    const d = autoblock(flags);
    d.observeRecord({ k: 'eq', t: 0, id: 3, slot: 0, item: DIAMOND_SWORD });
    d.observeRecord({ k: 'meta', t: 500, id: 3, m: [{ key: 0, value: BLOCKING }] });
    for (let i = 0; i < 100; i++) {
        d.observeRecord({ k: 'anim', t: 1000 + i * 100, id: 3, a: 0 });
    }
    assert.ok(flags.length >= 1 && flags.length <= 2, `autoblock must flag (got ${flags.length})`);
    assert.strictEqual(flags[flags.length - 1].tier, 'confirmed', 'sustained autoblock is CONFIRMED');
    assert.strictEqual(flags[0].cheat, 'Autoblock');
    assert.ok(flags[0].evidence[0].reason.includes('swinging while blocking'), flags[0].evidence[0].reason);
}

// ---- autoblock: only sword swings count (drawing a bow is not blocking) ----
{
    const flags = [];
    const d = autoblock(flags);
    d.observeRecord({ k: 'eq', t: 0, id: 4, slot: 0, item: BOW });
    d.observeRecord({ k: 'meta', t: 500, id: 4, m: [{ key: 0, value: BLOCKING }] });
    for (let i = 0; i < 100; i++) d.observeRecord({ k: 'anim', t: 1000 + i * 100, id: 4, a: 0 });
    assert.strictEqual(flags.length, 0, 'non-sword swings are ignored');
}

// ---- autoblock movement helpers: rel moves every tick along x ----
// dx is in protocol 1/32-block units: 9 = 0.28 blocks/tick, sprint speed.
function moveFor(d, id, start, ms, dxAt) {
    for (let t = start; t < start + ms; t += 50) d.observeRecord({ k: 'mv', t, id, dx: dxAt(t), dy: 0, dz: 0, g: true });
    return start + ms;
}
function useItem(d, id, t, on) {
    d.observeRecord({ k: 'meta', t, id, m: [{ key: 0, value: on ? BLOCKING : 0 }] });
}

// ---- autoblock: running at sprint speed with the server's use flag stuck
// ---- on (NoItemRelease / NoSlowdown) flags, sustained -> CONFIRMED ----
{
    const flags = [];
    const d = autoblock(flags);
    d.observeRecord({ k: 'eq', t: 0, id: 20, slot: 0, item: DIAMOND_SWORD });
    useItem(d, 20, 1000, true);
    moveFor(d, 20, 1000, 10_000, () => 9);
    assert.ok(flags.length >= 1, 'sprinting while the use flag is on must flag');
    assert.strictEqual(flags[0].tier, 'possible');
    assert.strictEqual(flags[0].evidence[0].group, 'Movement');
    assert.ok(flags[0].evidence[0].reason.includes('blocks/s while blocking'), flags[0].evidence[0].reason);
    assert.strictEqual(flags[flags.length - 1].tier, 'confirmed', 'sustained over >= 4s of one use is CONFIRMED');
}

// ---- autoblock: two separate fast uses within 60s -> CONFIRMED ----
{
    const flags = [];
    const d = autoblock(flags);
    useItem(d, 21, 1000, true);
    let t = moveFor(d, 21, 1000, 3600, () => 9);
    useItem(d, 21, t, false);
    t = moveFor(d, 21, t, 3000, () => 9);
    useItem(d, 21, t, true);
    moveFor(d, 21, t, 3600, () => 9);
    moveFor(d, 21, t + 3600, 1100, () => 0); // idle until the next clock update certifies
    assert.deepStrictEqual(flags.map(f => f.tier), ['possible', 'confirmed']);
}

// ---- autoblock: legit block-walking (input x0.2, ~0.9 blocks/s) ----
{
    const flags = [];
    const d = autoblock(flags);
    d.observeRecord({ k: 'eq', t: 0, id: 22, slot: 0, item: DIAMOND_SWORD });
    useItem(d, 22, 1000, true);
    moveFor(d, 22, 1000, 20_000, t => (t / 50) % 2 ? 1 : 2);
    assert.strictEqual(flags.length, 0, 'walking while blocking at vanilla speed must not flag');
}

// ---- autoblock: sprinting into a block keeps momentum only briefly ----
{
    const flags = [];
    const d = autoblock(flags);
    let t = moveFor(d, 23, 0, 2000, () => 9);
    useItem(d, 23, t, true);
    let v = 9;
    t = moveFor(d, 23, t, 1000, () => { v = Math.max(1.5, v * 0.546); return Math.round(v); });
    moveFor(d, 23, t, 10_000, s => (s / 50) % 2 ? 1 : 2);
    assert.strictEqual(flags.length, 0, 'decaying sprint momentum at the start of a block must not flag');
}

// ---- autoblock: big knockback (e.g. fireball) while blocking is excused ----
// Damage every 3s launches the player ~0.75 blocks/tick, decaying x0.91 in
// the air; afterwards they block-walk. Without the 1.5s damage grace the
// launch alone averages > 3.5 blocks/s over 2s.
{
    const flags = [];
    const d = autoblock(flags);
    useItem(d, 24, 1000, true);
    for (let hit = 2000; hit < 20_000; hit += 3000) {
        d.observeRecord({ k: 'st', t: hit, id: 24, s: 2 });
        let v = 26;
        moveFor(d, 24, hit, 3000, t => t - hit < 1000 ? Math.round(v *= 0.91) + 1 : (t / 50) % 2 ? 1 : 2);
    }
    assert.strictEqual(flags.length, 0, 'movement within 1.5s of damage must not count');
}

// ---- autoblock: a teleport (e.g. ender pearl) is not movement ----
{
    const flags = [];
    const d = autoblock(flags);
    useItem(d, 25, 1000, true);
    for (let t = 1000; t < 12_000; t += 50) {
        if (t % 1000 === 0) d.observeRecord({ k: 'tp', t, id: 25, x: t, y: 64 * 32, z: 0, g: true });
        else d.observeRecord({ k: 'mv', t, id: 25, dx: 1, dy: 0, dz: 0, g: true });
    }
    assert.strictEqual(flags.length, 0, 'teleports must restart the movement window');
}

// ---- autoblock timing: a bad interval drops only its own evidence ----
function clocked(flags, intervals) {
    // intervals: ms per 20 ticks, one entry per world-age update after t=0.
    const d = createAutoblockDetector({ onFlag: f => flags.push(f) });
    let t = 0, age = 1000;
    d.observeRecord({ k: 'time', t, age });
    const clock = intervals.map(ms => ({ t: t += ms, age: age += 20 }));
    return { d, clock };
}
{
    // Healthy, healthy, 5 blocked swings, one slow (100ms/tick) interval with
    // no swings, two healthy intervals to re-establish timing, 5 more swings.
    const flags = [];
    const { d, clock } = clocked(flags, [1000, 1000, 1000, 2000, 1000, 1000, 1000, 1000]);
    d.observeRecord({ k: 'eq', t: 0, id: 30, slot: 0, item: DIAMOND_SWORD });
    d.observeRecord({ k: 'meta', t: 100, id: 30, m: [{ key: 0, value: BLOCKING }] });
    const swingTimes = [2100, 2300, 2500, 2700, 2900, 7100, 7300, 7500, 7700, 7900];
    const events = [...clock.map(c => ({ k: 'time', ...c })), ...swingTimes.map(t => ({ k: 'anim', t, id: 30, a: 0 }))]
        .sort((a, b) => a.t - b.t);
    events.forEach(r => d.observeRecord(r));
    assert.strictEqual(flags.length, 1, 'swings certified before a slow interval must survive it');
    assert.ok(flags[0].evidence[0].reason.includes('10/10'), flags[0].evidence[0].reason);
}
{
    // Swings inside a slow interval are dropped even though timing was ready.
    const flags = [];
    const { d, clock } = clocked(flags, [1000, 1000, 2000, 1000, 1000]);
    d.observeRecord({ k: 'eq', t: 0, id: 31, slot: 0, item: DIAMOND_SWORD });
    d.observeRecord({ k: 'meta', t: 100, id: 31, m: [{ key: 0, value: BLOCKING }] });
    const events = [...clock.map(c => ({ k: 'time', ...c })),
        ...Array.from({ length: 12 }, (_, i) => ({ k: 'anim', t: 2100 + i * 150, id: 31, a: 0 }))].sort((a, b) => a.t - b.t);
    events.forEach(r => d.observeRecord(r));
    assert.strictEqual(flags.length, 0, 'evidence from an unhealthy interval must not count');
}

// ---- live conversion supplies damage status for the knockback grace ----
assert.deepStrictEqual(packetToRecord('entity_status', { entityId: 7, entityStatus: 2 }, 5),
    { k: 'st', t: 5, id: 7, s: 2 });

// ---- stasis helpers: a player runs, then freezes mid-air ----
const AIR_Y = 70 + 13 / 32; // off the 1/16 grid: not standing on anything
function stasis(flags) {
    return createStasisDetector({ onFlag: f => flags.push(f) });
}
// Runs 1s, freezes `freezeMs` at an off-grid height with swings at the given
// offsets into the freeze, then resumes. Returns the resume time.
function runAndFreeze(d, id, start, { freezeMs = 800, swingsAt = [200, 400, 600], y = AIR_Y, knockback = false } = {}) {
    let t = start;
    for (let i = 0; i < 10; i++) {
        d.observeRecord({ k: 'mv', t, id, dx: 8, dy: 0, dz: 0, g: false });
        t += 100;
    }
    d.observeRecord({ k: 'tp', t, id, x: 40 * 32, y: Math.round(y * 32), z: 0, g: false });
    if (knockback) d.observeRecord({ k: 'vel', t: t + 10, id });
    const frozenAt = t;
    swingsAt.forEach(offset => d.observeRecord({ k: 'anim', t: frozenAt + offset, id, a: 0 }));
    t = frozenAt + freezeMs;
    d.observeRecord({ k: 'mv', t, id, dx: 64, dy: -20, dz: 0, g: false }); // flush jump
    return t + 100;
}
function spawnPlayer(d, id, t) {
    d.observeRecord({ k: 'spawn', t, id, x: 0, y: 70 * 32, z: 0 });
}

// ---- stasis: repeated freezes while acting -> POSSIBLE (never more) ----
{
    const flags = [];
    const d = stasis(flags);
    spawnPlayer(d, 10, 0);
    let t = runAndFreeze(d, 10, 1000);
    t = runAndFreeze(d, 10, t + 2000);
    t = runAndFreeze(d, 10, t + 2000);
    runAndFreeze(d, 10, t + 2000);
    assert.strictEqual(flags.length, 1, 'repeated mid-air freezes while acting flag once');
    assert.strictEqual(flags[0].tier, 'possible', 'stasis is POSSIBLE only (uncalibrated)');
    assert.strictEqual(flags[0].cheat, 'Stasis');
}

// ---- stasis: one freeze alone does not flag ----
{
    const flags = [];
    const d = stasis(flags);
    spawnPlayer(d, 11, 0);
    runAndFreeze(d, 11, 1000);
    assert.strictEqual(flags.length, 0, 'a single freeze must not flag');
}

// ---- stasis: lag delivers the actions WITH the resume, not during ----
{
    const flags = [];
    const d = stasis(flags);
    spawnPlayer(d, 12, 0);
    let t = 1000;
    for (let n = 0; n < 4; n++) t = runAndFreeze(d, 12, t, { swingsAt: [760, 770, 780] }) + 2000;
    assert.strictEqual(flags.length, 0, 'lag spikes (actions arrive at the end) must not flag');
}

// ---- stasis: standing on a block (on-grid height) is not mid-air ----
{
    const flags = [];
    const d = stasis(flags);
    spawnPlayer(d, 13, 0);
    let t = 1000;
    for (let n = 0; n < 4; n++) t = runAndFreeze(d, 13, t, { y: 70 + 9 / 16 }) + 2000; // e.g. on a bed
    assert.strictEqual(flags.length, 0, 'standing still on a block while fighting must not flag');
}

// ---- stasis: knockback right before the freeze is excluded ----
{
    const flags = [];
    const d = stasis(flags);
    spawnPlayer(d, 14, 0);
    let t = 1000;
    for (let n = 0; n < 4; n++) t = runAndFreeze(d, 14, t, { knockback: true }) + 2000;
    assert.strictEqual(flags.length, 0, 'freezes right after knockback must not flag');
}

// ---- stasis: a ladder next to the player (e.g. a Pop-up Tower) excludes ----
{
    const flags = [];
    const d = stasis(flags);
    spawnPlayer(d, 15, 0);
    d.observeRecord({ k: 'blk', t: 500, x: 40, y: 70, z: 0, b: 65 << 4 }); // ladder at the freeze spot
    let t = 1000;
    for (let n = 0; n < 4; n++) t = runAndFreeze(d, 15, t) + 2000;
    assert.strictEqual(flags.length, 0, 'hanging on a ladder must not flag');
}

// ---- stasis: idle entities that never moved (shop NPCs) are ignored ----
{
    const flags = [];
    const d = stasis(flags);
    spawnPlayer(d, 16, 0);
    d.observeRecord({ k: 'tp', t: 100, id: 16, x: 0, y: Math.round(AIR_Y * 32), z: 0, g: false });
    for (let i = 0; i < 50; i++) d.observeRecord({ k: 'anim', t: 1000 + i * 300, id: 16, a: 0 });
    d.observeRecord({ k: 'mv', t: 20_000, id: 16, dx: 1, dy: 0, dz: 0, g: false });
    assert.strictEqual(flags.length, 0, 'stationary NPC swinging must not flag');
}

console.log('Autoblock/Stasis detector unit tests passed.');

// ---- corpus shadow run ----
const dir = path.join(__dirname, '..', '..', 'recordings');
if (fs.existsSync(dir)) {
    let legitViolations = 0;
    console.log('\nCorpus shadow run (autoblock: all recordings; stasis: live only):');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
        const records = loadRecording(path.join(dir, file));
        const header = records.find(r => r.k === 'header') || {};
        const label = header.label || '?';
        const flags = [];
        const detectors = [createAutoblockDetector({ onFlag: f => flags.push(f) })];
        if (header.source === 'live') detectors.push(createStasisDetector({ onFlag: f => flags.push(f) }));
        records.forEach(r => detectors.forEach(detector => detector.observeRecord(r)));
        const isLegit = label.startsWith('legit') || label === 'fidelitytest';
        const target = resolveTarget(records, { player: header.player });
        const targetFlags = flags.filter(f => target.ids.has(Number(f.entityId)));
        if (isLegit && targetFlags.length) legitViolations += 1;
        if (flags.length) {
            console.log(`  [${isLegit && targetFlags.length ? 'FALSE POSITIVE!' : 'flag'}] ${label} ${file}`);
            flags.forEach(f => console.log(`      ${f.name} ${f.cheat}/${f.tier}: ${f.evidence.map(e => e.reason).join(' | ')}`));
        }
    }
    assert.strictEqual(legitViolations, 0, 'detectors must produce ZERO flags on the labeled players of legit recordings');
    console.log('Shadow gate passed: zero flags on labeled legit players.');
} else {
    console.log('(no recordings/ directory - corpus shadow run skipped)');
}
