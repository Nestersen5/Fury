'use strict';

// Unit tests + corpus shadow-verification for the scaffold detector.
// The corpus gate is the contract: ZERO flags on legit-labeled recordings.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createScaffoldDetector } = require('../../src/detect/scaffoldDetector.js');
const { loadRecording, resolveTarget } = require('../../src/recorder/recordingAnalysis.js');

// A cheater is flagged once (POSSIBLE or CONFIRMED) or twice (POSSIBLE,
// then one upgrade to CONFIRMED) - never more.
function assertFlagged(flags, message) {
    assert.ok(flags.length === 1 || flags.length === 2, `${message} (got ${flags.length} flags)`);
    if (flags.length === 2) {
        assert.strictEqual(flags[0].tier, 'possible', message);
        assert.strictEqual(flags[1].tier, 'confirmed', message);
    }
}

function makeDetector(flags) {
    return createScaffoldDetector({ onFlag: f => flags.push(f) });
}

// ---- synthetic: legit fast STRAIGHT bridge (8/2s = legit ceiling, swings, looking down) ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 1, name: 'LegitGuy', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250; // 8 blocks / 2s - the legit straight ceiling
        d.observeRecord({ k: 'mvl', t, id: 1, dx: 32, dy: 0, dz: 0, pitch: 55 }); // 55 raw ~ 77deg down
        d.observeRecord({ k: 'anim', t: t + 20, id: 1, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assert.strictEqual(flags.length, 0, 'legit-ceiling straight bridging must not flag');
}

// ---- synthetic: legit fast DIAGONAL bridge (10/2s = legit diag ceiling) ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 11, name: 'LegitDiag', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 50; i++) {
        const t = 1000 + i * 200; // 10 blocks / 2s along a 45deg path
        d.observeRecord({ k: 'mvl', t, id: 11, dx: 16, dy: 0, dz: 16, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 20, id: 11, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 30, x: Math.floor(i / 2), y: 64, z: Math.ceil(i / 2), b: 35 });
    }
    assert.strictEqual(flags.length, 0, 'legit-ceiling diagonal bridging must not flag');
}

// ---- synthetic: straight scaffold at 10/2s (over legit straight max 8) ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 12, name: 'StraightCheat', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 60; i++) {
        const t = 1000 + i * 200; // 10 blocks / 2s STRAIGHT - blatant for this direction
        d.observeRecord({ k: 'mvl', t, id: 12, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 20, id: 12, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assertFlagged(flags, 'blatant STRAIGHT rate must flag under direction-aware thresholds');
    assert.ok(flags[0].reason.includes('straight'), flags[0].reason);
}

// ---- synthetic: silent scaffold (no swings) at legit speed ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 2, name: 'SilentCheater', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250; // 8 blocks / 2s - not even fast
        d.observeRecord({ k: 'mvl', t, id: 2, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
        // no swings at all
    }
    assertFlagged(flags, 'silent placement must flag');
    assert.ok(flags[0].reason.includes('silent placement'), flags[0].reason);
    assert.strictEqual(flags[0].name, 'SilentCheater');
}

// ---- synthetic: forward-pitch scaffold (looking ahead while bridging) ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 3, name: 'KeepYUser', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 3, dx: 32, dy: 0, dz: 0, pitch: 10 }); // 10 raw ~ 14deg: looking ahead
        d.observeRecord({ k: 'anim', t: t + 20, id: 3, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    // pitch strike (weight 2) per burst, needs accumulation across >=4s
    assertFlagged(flags, 'forward-pitch bridging must flag after repeated bursts');
    assert.ok(flags[0].reason.includes('looking ahead'), flags[0].reason);
}

// ---- synthetic: blatant rate (14 blocks / 2s) with swings, looking down ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 4, name: 'FastCheater', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 60; i++) {
        const t = 1000 + i * 140; // ~14 blocks / 2s
        d.observeRecord({ k: 'mvl', t, id: 4, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 10, id: 4, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 20, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assertFlagged(flags, 'blatant placement rate must flag');
    assert.ok(flags[0].reason.includes('blocks/2s'), flags[0].reason);
}

// ---- synthetic: falling clutch spam must not strike ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 5, name: 'Clutcher', x: 0, y: 90, z: 0 });
    for (let i = 0; i < 12; i++) {
        const t = 1000 + i * 100;
        d.observeRecord({ k: 'mv', t, id: 5, dx: 0, dy: -32, dz: 0 }); // free fall
        d.observeRecord({ k: 'blk', t: t + 10, x: 0, y: 88 - i, z: 0, b: 35 });
    }
    assert.strictEqual(flags.length, 0, 'falling clutch must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'falling clutch must not even strike');
}

// ---- synthetic: contested attribution (two players near the block) is skipped ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 6, name: 'CheaterNearby', x: 0, y: 65, z: 0 });
    d.observeRecord({ k: 'snap', t: 0, id: 7, name: 'Innocent', x: 1, y: 65, z: 1 });
    for (let i = 0; i < 30; i++) {
        const t = 1000 + i * 150;
        d.observeRecord({ k: 'mvl', t, id: 6, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'mvl', t, id: 7, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'blk', t: t + 20, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assert.strictEqual(flags.length, 0, 'ambiguous attribution must not flag anyone');
}

// ---- sneak rhythm: metronomic human double-shift must not strike ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 15, name: 'HumanDoubleShift', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 15, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 10, id: 15, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 20, x: i + 1, y: 64, z: 0, b: 35 });
        // consistent double-shift: sneak on at +50, off at +150, every cycle
        d.observeRecord({ k: 'meta', t: t + 50, id: 15, m: [{ key: 0, value: 2 }] });
        d.observeRecord({ k: 'meta', t: t + 150, id: 15, m: [{ key: 0, value: 0 }] });
    }
    assert.strictEqual(flags.length, 0, 'metronomic human sneak rhythm must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'metronomic sneak rhythm must not strike');
}

// ---- sneak rhythm: randomized "humanized" double-shift (cheat) must flag ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 16, name: 'JitterScaffold', x: 0, y: 65, z: 0 });
    // Placements at the legit diag ceiling with swings and normal pitch -
    // invisible to every other rule - but sneak re-gaps are randomized.
    // Events interleaved chronologically like a real packet stream.
    const jitter = [80, 400, 120, 360]; // CV ~0.6, like the recorded cheats
    const events = [];
    for (let i = 0; i < 60; i++) {
        const t = 1000 + i * 250;
        events.push({ k: 'mvl', t, id: 16, dx: 32, dy: 0, dz: 0, pitch: 55 });
        events.push({ k: 'anim', t: t + 10, id: 16, a: 0 });
        events.push({ k: 'blk', t: t + 20, x: i + 1, y: 64, z: 0, b: 35 });
    }
    let sneakCursor = 1000;
    for (let k = 0; k < 40; k++) {
        events.push({ k: 'meta', t: sneakCursor, id: 16, m: [{ key: 0, value: 2 }] });
        events.push({ k: 'meta', t: sneakCursor + 100, id: 16, m: [{ key: 0, value: 0 }] });
        sneakCursor += 100 + jitter[k % 4];
    }
    events.sort((a, b) => a.t - b.t);
    events.forEach(e => d.observeRecord(e));
    assertFlagged(flags, 'randomized sneak rhythm at legit speed must flag');
    assert.ok(flags[0].reason.includes('double-shift rhythm'), flags[0].reason);
}

// ---- double-shift corrections: legit diag (1 sneak cycle per 2 blocks)
// ---- must not strike; corrective cycle per placement must flag ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 17, name: 'LegitDiagShift', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 17, dx: 16, dy: 0, dz: 16, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 10, id: 17, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 20, x: Math.floor(i / 2), y: 64, z: Math.ceil(i / 2), b: 35 });
        // one sneak cycle per TWO placements - the legit diag pattern
        if (i % 2 === 0) {
            d.observeRecord({ k: 'meta', t: t + 100, id: 17, m: [{ key: 0, value: 2 }] });
            d.observeRecord({ k: 'meta', t: t + 200, id: 17, m: [{ key: 0, value: 0 }] });
        }
    }
    assert.strictEqual(flags.length, 0, 'legit one-shift-per-two-blocks must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'legit diag sneak pattern must not strike');
}
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 18, name: 'DoubleShifter', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 18, dx: 16, dy: 0, dz: 16, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 10, id: 18, a: 0 });
        // TWO corrective sneak cycles inside every placement interval,
        // with consistent timing (so the rhythm-CV rule stays silent and
        // only the double-shift rule can fire)
        d.observeRecord({ k: 'meta', t: t + 40, id: 18, m: [{ key: 0, value: 2 }] });
        d.observeRecord({ k: 'meta', t: t + 90, id: 18, m: [{ key: 0, value: 0 }] });
        d.observeRecord({ k: 'meta', t: t + 140, id: 18, m: [{ key: 0, value: 2 }] });
        d.observeRecord({ k: 'meta', t: t + 190, id: 18, m: [{ key: 0, value: 0 }] });
        d.observeRecord({ k: 'blk', t: t + 230, x: Math.floor(i / 2), y: 64, z: Math.ceil(i / 2), b: 35 });
    }
    assertFlagged(flags, 'double-shift corrections must flag');
    assert.ok(flags[0].reason.includes('double-shift corrections'), flags[0].reason);
}

// ---- irregular straight cadence: reactive scaffold at sub-ceiling speed ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 20, name: 'WobblyScaffold', x: 0, y: 65, z: 0 });
    // ~7-8 blocks/2s straight with wobbly placement timing (CV ~0.45),
    // swings present, looking down - only cadence can catch this
    const wobble = [120, 420, 180, 390, 150, 340];
    let t = 1000;
    for (let i = 0; i < 50; i++) {
        d.observeRecord({ k: 'mvl', t, id: 20, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 10, id: 20, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 20, x: i + 1, y: 64, z: 0, b: 35 });
        t += wobble[i % wobble.length];
    }
    assertFlagged(flags, 'wobbly straight cadence must flag (via accumulated w1 strikes)');
    assert.ok(flags[0].reason.includes('irregular straight cadence'), flags[0].reason);
}

// ---- FP guard (field reports): metronomic pause-and-go bridging - place a
// ---- few blocks, brief pause, continue - must not trigger the cadence rule ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 23, name: 'PauseAndGo', x: 0, y: 65, z: 0 });
    let t = 1000;
    let x = 0;
    for (let run = 0; run < 12; run++) {
        for (let i = 0; i < 5; i++) {
            d.observeRecord({ k: 'mvl', t, id: 23, dx: 32, dy: 0, dz: 0, pitch: 55 });
            d.observeRecord({ k: 'anim', t: t + 10, id: 23, a: 0 });
            d.observeRecord({ k: 'blk', t: t + 20, x: ++x, y: 64, z: 0, b: 35 });
            t += 250; // perfectly metronomic while placing
        }
        // brief pause between runs (checking surroundings), keeps moving
        d.observeRecord({ k: 'mvl', t, id: 23, dx: 16, dy: 0, dz: 0, pitch: 40 });
        t += 900;
    }
    assert.strictEqual(flags.length, 0, 'pause-and-go bridging must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'pause-and-go bridging must not even strike');
}

// ---- far placement: robotic extended-reach scaffold must flag ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 22, name: 'FarPlacer', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 50; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 22, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 10, id: 22, a: 0 });
        // block consistently ~3 blocks ahead of the player's position
        d.observeRecord({ k: 'blk', t: t + 20, x: i + 4, y: 64, z: 0, b: 35 });
    }
    assertFlagged(flags, 'robotic far placement must flag');
    assert.ok(flags[0].reason.includes('blocks ahead'), flags[0].reason);
}

// ---- FP guard: wobbly cadence on a DIAGONAL bridge (legit diag is
// ---- naturally irregular) must not trigger the cadence strike ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 21, name: 'WobblyDiagLegit', x: 0, y: 65, z: 0 });
    const wobble = [120, 420, 180, 390, 150, 340];
    let t = 1000;
    for (let i = 0; i < 50; i++) {
        d.observeRecord({ k: 'mvl', t, id: 21, dx: 16, dy: 0, dz: 16, pitch: 55 });
        d.observeRecord({ k: 'anim', t: t + 10, id: 21, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 20, x: Math.floor(i / 2), y: 64, z: Math.ceil(i / 2), b: 35 });
        t += wobble[i % wobble.length];
    }
    assert.strictEqual(flags.length, 0, 'irregular diagonal cadence is normal and must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'irregular diagonal cadence must not strike');
}

// ---- FP guard (field report): slow noob diagonal bridging with panicked
// ---- messy sneaking, then falling - must produce ZERO strikes ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 19, name: 'NervousNoob', x: 0, y: 65, z: 0 });
    // ~1 block per 1.2s, jittery sneak spam between placements (2-3 cycles,
    // irregular timing), tiny hesitant movement steps
    const panic = [70, 320, 140, 480, 90, 260];
    let p = 0;
    for (let i = 0; i < 15; i++) {
        const t = 1000 + i * 1200;
        d.observeRecord({ k: 'mvl', t, id: 19, dx: 8, dy: 0, dz: 8, pitch: 55 });
        d.observeRecord({ k: 'mvl', t: t + 400, id: 19, dx: 8, dy: 0, dz: 8, pitch: 60 });
        d.observeRecord({ k: 'anim', t: t + 20, id: 19, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 40, x: Math.floor(i / 2), y: 64, z: Math.ceil(i / 2), b: 35 });
        // panic sneaking: 3 messy cycles per placement interval
        let cursor = t + 100;
        for (let s = 0; s < 3; s++) {
            d.observeRecord({ k: 'meta', t: cursor, id: 19, m: [{ key: 0, value: 2 }] });
            cursor += 60 + panic[p++ % panic.length];
            d.observeRecord({ k: 'meta', t: cursor, id: 19, m: [{ key: 0, value: 0 }] });
            cursor += panic[p++ % panic.length];
        }
    }
    // then they mess up and fall off
    for (let j = 0; j < 10; j++) {
        d.observeRecord({ k: 'mv', t: 19200 + j * 100, id: 19, dx: 0, dy: -32, dz: 0 });
    }
    assert.strictEqual(flags.length, 0, 'struggling noob must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'struggling noob must not even strike');
}

// ---- FP guard: running while placing BODY-LEVEL blocks (wall/shield) at
// ---- low pitch - not floor bridging, must not even strike ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 13, name: 'WallRunner', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 200;
        d.observeRecord({ k: 'mvl', t, id: 13, dx: 32, dy: 0, dz: 0, pitch: 5 }); // looking ahead
        d.observeRecord({ k: 'anim', t: t + 10, id: 13, a: 0 });
        // blocks at body level (same y as feet and one above) - a wall, not a floor
        d.observeRecord({ k: 'blk', t: t + 20, x: i + 1, y: 65 + (i % 2), z: 0, b: 35 });
    }
    assert.strictEqual(flags.length, 0, 'body-level placements while running must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'body-level placements must not even strike');
}

// ---- FP guard: floor placements while running at MODERATE pitch (~42deg,
// ---- e.g. legit front-face bridge extension) - below the 35deg strike bar ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 14, name: 'FrontPlacer', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250; // 8 floor blocks / 2s at legit ceiling
        d.observeRecord({ k: 'mvl', t, id: 14, dx: 32, dy: 0, dz: 0, pitch: 30 }); // 30 raw ~ 42deg
        d.observeRecord({ k: 'anim', t: t + 10, id: 14, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 20, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assert.strictEqual(flags.length, 0, 'moderate-pitch floor placing must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'moderate-pitch floor placing must not strike');
}

// ---- replay actor naming: uuid+name arrives via tab BEFORE the detector
// ---- is enabled (replay join), tab entry then removed - name must stick ----
{
    const flags = [];
    let enabled = false;
    const d = createScaffoldDetector({ onFlag: f => flags.push(f), isEnabled: () => enabled });
    // While disabled: replay adds actor to tab, spawns the NPC, removes tab.
    d.observeRecord({ k: 'tab', t: 100, named: [{ uuid: 'AB-CD', name: 'ReplayCheater' }] });
    d.observeRecord({ k: 'spawn', t: 150, id: 9, uuid: 'ab-cd', name: null, x: 0, y: 65 * 32, z: 0 });
    enabled = true;
    d.observeRecord({ k: 'snap', t: 900, id: 9, name: null, x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 9, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 }); // silent
    }
    assertFlagged(flags, 'silent scaffold should flag');
    assert.strictEqual(flags[0].name, 'ReplayCheater', 'flag must carry the name captured from the transient tab add');
}

// ---- replay mode: clean 1x playback allows detection ----
{
    // Clean 1x: world age advances ~20/s -> silent scaffold flags.
    const flags = [];
    const d = createScaffoldDetector({ onFlag: f => flags.push(f), requireCleanPlayback: () => true });
    d.observeRecord({ k: 'snap', t: 0, id: 8, name: null, x: 0, y: 65, z: 0 });
    let age = 0;
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        if (i % 4 === 0) d.observeRecord({ k: 'time', t, age: (age += 20) });
        d.observeRecord({ k: 'mvl', t, id: 8, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assertFlagged(flags, 'silent scaffold at clean 1x replay must flag');
}
{
    // 2x speed: world age advances ~40/s -> evaluation suspended, no flag.
    const flags = [];
    const d = createScaffoldDetector({ onFlag: f => flags.push(f), requireCleanPlayback: () => true });
    d.observeRecord({ k: 'snap', t: 0, id: 8, name: null, x: 0, y: 65, z: 0 });
    let age = 0;
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        if (i % 4 === 0) d.observeRecord({ k: 'time', t, age: (age += 40) });
        d.observeRecord({ k: 'mvl', t, id: 8, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assert.strictEqual(flags.length, 0, '2x playback must suspend detection');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, '2x playback must not even strike');
}
{
    // No time updates at all (paused/unknown): suspended.
    const flags = [];
    const d = createScaffoldDetector({ onFlag: f => flags.push(f), requireCleanPlayback: () => true });
    d.observeRecord({ k: 'snap', t: 0, id: 8, name: null, x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 8, dx: 32, dy: 0, dz: 0, pitch: 55 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assert.strictEqual(flags.length, 0, 'missing tick data must suspend detection');
}

// ---- shadow: Vape GodBridge profile (flat, unsneaked, pitch parked on the
// ---- 80deg target = raw 56) is counted but must never add strike weight ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 30, name: 'GodBridgeLike', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250; // legit-ceiling straight rate, swings present
        d.observeRecord({ k: 'mvl', t, id: 30, dx: 32, dy: 0, dz: 0, pitch: 56, yaw: 32 });
        d.observeRecord({ k: 'anim', t: t + 20, id: 30, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    const row = d.getStatus().find(r => r.name === 'GodBridgeLike');
    assert.ok(row && row.profiles.godbridge > 0, 'GodBridge-like bursts should be counted');
    assert.strictEqual(row.strikes, 0, 'shadow profiles must not strike');
    assert.strictEqual(flags.length, 0, 'shadow profiles must not flag');
}

// ---- shadow: GodBridge profile must not match sneak bridging or a
// ---- wandering pitch ----
{
    const d = makeDetector([]);
    d.observeRecord({ k: 'snap', t: 0, id: 31, name: 'SneakBridger', x: 0, y: 65, z: 0 });
    d.observeRecord({ k: 'snap', t: 0, id: 32, name: 'WanderingAim', x: 50, y: 65, z: 0 });
    for (let i = 0; i < 40; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'meta', t: t - 100, id: 31, m: [{ key: 0, value: 2 }] });
        d.observeRecord({ k: 'meta', t: t - 20, id: 31, m: [{ key: 0, value: 0 }] });
        d.observeRecord({ k: 'mvl', t, id: 31, dx: 32, dy: 0, dz: 0, pitch: 56, yaw: 32 });
        d.observeRecord({ k: 'anim', t: t + 20, id: 31, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
        d.observeRecord({ k: 'mvl', t: t + 5, id: 32, dx: 32, dy: 0, dz: 0, pitch: 50 + (i % 4) * 3, yaw: 32 });
        d.observeRecord({ k: 'anim', t: t + 25, id: 32, a: 0 });
    }
    // Wandering-aim placements go far from the sneak bridger (x offset 50).
    for (let i = 0; i < 40; i++) {
        d.observeRecord({ k: 'blk', t: 1000 + i * 250 + 35, x: 50 + i + 1, y: 64, z: 0, b: 35 });
    }
    assert.ok(!d.getStatus().some(r => r.profiles.godbridge > 0), 'sneaking or wandering pitch is not GodBridge-like');
}

// ---- shadow: Vape TellyBridge profile (sprint-jumping, unsneaked, steep aim) ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 33, name: 'TellyLike', x: 0, y: 65, z: 0 });
    d.observeRecord({ k: 'meta', t: 10, id: 33, m: [{ key: 0, value: 8 }] }); // sprinting
    const jumpDy = [20, 12, 6, 0, -6, -12, -20]; // ~1.2 block arc in 1/32 units
    for (let i = 0; i < 42; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 33, dx: 32, dy: jumpDy[i % jumpDy.length], dz: 0, pitch: 62, yaw: 32 });
        d.observeRecord({ k: 'anim', t: t + 20, id: 33, a: 0 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 63, z: 0, b: 35 });
    }
    const row = d.getStatus().find(r => r.name === 'TellyLike');
    assert.ok(row && row.profiles.telly > 0, 'TellyBridge-like bursts should be counted');
    assert.strictEqual(row.strikes, 0, 'shadow profiles must not strike');
    assert.strictEqual(flags.length, 0, 'shadow profiles must not flag');
}

// ---- FP guard: legit staircase bridging (4 flat, jump + step-up block,
// ---- flat again) - the step-up block and the longer sneak gap across the
// ---- jump are technique, not scaffold ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 40, name: 'StairBridger', x: 0.5, y: 65, z: 0.5 });
    let t = 1000;
    let x = 0;
    let floor = 64;
    for (let run = 0; run < 16; run++) {
        for (let k = 0; k < 4; k++) {
            d.observeRecord({ k: 'meta', t: t - 120, id: 40, m: [{ key: 0, value: 2 }] });
            d.observeRecord({ k: 'meta', t: t - 20, id: 40, m: [{ key: 0, value: 0 }] });
            d.observeRecord({ k: 'mvl', t, id: 40, dx: 32, dy: 0, dz: 0, pitch: 56 });
            x += 1;
            d.observeRecord({ k: 'anim', t: t - 10, id: 40, a: 0 });
            d.observeRecord({ k: 'blk', t, x, y: floor, z: 0, b: 35 });
            t += 250;
        }
        d.observeRecord({ k: 'mvl', t, id: 40, dx: 0, dy: 40, dz: 0, pitch: 56 }); // jump
        t += 120; // step-up block placed quickly from the jump
        d.observeRecord({ k: 'anim', t: t - 10, id: 40, a: 0 });
        d.observeRecord({ k: 'blk', t, x, y: floor + 1, z: 0, b: 35 });
        d.observeRecord({ k: 'mvl', t: t + 1, id: 40, dx: 0, dy: -8, dz: 0, pitch: 56 }); // land
        floor += 1;
        t += 250;
    }
    assert.strictEqual(flags.length, 0, 'legit staircase bridging must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'legit staircase bridging must not strike');
}

// ---- staircase does not hide silent scaffold: level blocks placed with
// ---- no swings still flag ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 41, name: 'SilentStairs', x: 0.5, y: 65, z: 0.5 });
    let t = 1000;
    let x = 0;
    let floor = 64;
    for (let run = 0; run < 12; run++) {
        for (let k = 0; k < 5; k++) {
            d.observeRecord({ k: 'mvl', t, id: 41, dx: 32, dy: 0, dz: 0, pitch: 56 });
            x += 1;
            d.observeRecord({ k: 'blk', t, x, y: floor, z: 0, b: 35 });
            t += 200;
        }
        d.observeRecord({ k: 'mvl', t, id: 41, dx: 0, dy: 40, dz: 0, pitch: 56 });
        t += 100;
        d.observeRecord({ k: 'blk', t, x, y: floor + 1, z: 0, b: 35 });
        d.observeRecord({ k: 'mvl', t: t + 1, id: 41, dx: 0, dy: -8, dz: 0, pitch: 56 });
        floor += 1;
        t += 200;
    }
    assertFlagged(flags, 'silent staircase scaffold must still flag');
}

// ---- rule H: sneak lands with the click. Legit crouches ~100ms (2 ticks)
// ---- before placing; edge-sneak automation crouches the same tick ----
function sneakBridge(id, name, sneakLeadMs, blocks = 60) {
    const leadAt = typeof sneakLeadMs === "function" ? sneakLeadMs : () => sneakLeadMs;
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id, name, x: 0.5, y: 65, z: 0.5 });
    for (let i = 0; i < blocks; i++) {
        const t = 1000 + i * 300; // ~6.7 blocks/2s, well under the rate ceiling
        d.observeRecord({ k: 'meta', t: t - leadAt(i), id, m: [{ key: 0, value: 2 }] });
        d.observeRecord({ k: 'mvl', t, id, dx: 32, dy: 0, dz: 0, pitch: 56 });
        d.observeRecord({ k: 'anim', t: t - 5, id, a: 0 });
        d.observeRecord({ k: 'blk', t, x: i + 1, y: 64, z: 0, b: 35 });
        d.observeRecord({ k: 'meta', t: t + 50, id, m: [{ key: 0, value: 0 }] });
    }
    return { flags, d };
}
{
    const { flags, d } = sneakBridge(50, 'LegitCrouch', 100);
    assert.strictEqual(flags.length, 0, 'crouching 2 ticks before placing is legit');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'legit sneak lead must not strike');
}
{
    const { flags } = sneakBridge(51, 'EdgeSneakBot', 0);
    assertFlagged(flags, 'sneak landing with the click must flag');
    assert.ok(flags[0].reason.includes('sneak lands with the click'), flags[0].reason);
}

{
    // A short bridge at 60% sneak-at-click (6 of ~10) is a plausible legit
    // fluke (~5% at the legit 30% rate) - the luck test must not strike.
    // (Sustained 60% over a long bridge is NOT a fluke and does strike.)
    const { flags, d } = sneakBridge(52, 'Borderline', i => (i % 5 < 3 ? 0 : 100), 12);
    assert.strictEqual(flags.length, 0, '60% sneak-at-click must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, '60% sneak-at-click must not strike');
}

// ---- tiers: CONFIRMED needs hard evidence sustained across bridges, or
// ---- strong evidence from two independent groups ----
{
    // Sneak lands with the click on every block for ~18s: hard (fluke
    // chance < 1 in a million) and sustained -> straight to CONFIRMED.
    const { flags } = sneakBridge(60, 'TierBot', 0);
    assert.strictEqual(flags.length, 1, 'overwhelming evidence flags once');
    assert.strictEqual(flags[0].tier, 'confirmed', 'sustained hard sneak-lead evidence is CONFIRMED');
}
{
    // Randomized sneak rhythm: strong but only one group (sneak) -> POSSIBLE.
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 61, name: 'RhythmOnly', x: 0, y: 65, z: 0 });
    const offGaps = [60, 420, 90, 380, 150, 460, 70, 300, 200, 510];
    let t = 1000;
    for (let i = 0; i < 60; i++) {
        d.observeRecord({ k: 'meta', t: t - 150, id: 61, m: [{ key: 0, value: 2 }] });
        d.observeRecord({ k: 'mvl', t, id: 61, dx: 32, dy: 0, dz: 0, pitch: 56 });
        d.observeRecord({ k: 'anim', t: t - 5, id: 61, a: 0 });
        d.observeRecord({ k: 'blk', t, x: i + 1, y: 64, z: 0, b: 35 });
        d.observeRecord({ k: 'meta', t: t + 20, id: 61, m: [{ key: 0, value: 0 }] });
        t += 170 + offGaps[i % offGaps.length];
    }
    if (flags.length) {
        assert.ok(flags.every(f => f.tier === 'possible'), 'sneak-only evidence must stay POSSIBLE');
    }
}
{
    // Sustained silent bridging (15s, 0% swings): hard evidence repeated
    // across bursts >= 4s apart -> upgrades to CONFIRMED.
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 62, name: 'SilentLong', x: 0, y: 65, z: 0 });
    for (let i = 0; i < 60; i++) {
        const t = 1000 + i * 250;
        d.observeRecord({ k: 'mvl', t, id: 62, dx: 32, dy: 0, dz: 0, pitch: 56 });
        d.observeRecord({ k: 'blk', t: t + 30, x: i + 1, y: 64, z: 0, b: 35 });
    }
    assertFlagged(flags, 'sustained silent bridging must flag');
    assert.strictEqual(flags[flags.length - 1].tier, 'confirmed', 'sustained silent bridging is CONFIRMED');
}

// ---- strikes expire: two short silent episodes minutes apart must not
// ---- add up to a flag; the same two within one stretch of play do ----
function twoEpisodes(gapMs) {
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 70, name: 'Episodes', x: 0, y: 65, z: 0 });
    let x = 0;
    [1000, 1000 + gapMs].forEach(start => {
        for (let i = 0; i < 8; i++) { // 8 silent blocks -> one weight-2 strike
            const t = start + i * 250;
            d.observeRecord({ k: 'mvl', t, id: 70, dx: 32, dy: 0, dz: 0, pitch: 56 });
            x += 1;
            d.observeRecord({ k: 'blk', t: t + 30, x, y: 64, z: 0, b: 35 });
        }
    });
    return flags;
}
assert.strictEqual(twoEpisodes(180_000).length, 0, 'strikes 3 minutes apart must not combine');
assert.strictEqual(twoEpisodes(20_000).length, 1, 'strikes within one stretch of play still combine');

// ---- FP guard (field report, BowSpammerr): running forward and throwing
// ---- quick pairs of blocks down 2-3 ahead at changing heights, mostly
// ---- without a matching swing, is not bridging and must not strike ----
{
    const flags = [];
    const d = makeDetector(flags);
    d.observeRecord({ k: 'snap', t: 0, id: 80, name: 'FrontPlacer', x: 0.5, y: 66, z: 0.5 });
    const hop = [10, 8, 4, 0, -4, -8, -10];
    let t = 1000;
    let px = 0.5;
    let step = 0;
    for (let c = 0; c < 14; c++) {
        for (let k = 0; k < 4; k++) {
            d.observeRecord({ k: 'mvl', t, id: 80, dx: 12, dy: hop[step++ % hop.length], dz: 0, pitch: 25 });
            px += 12 / 32;
            t += 50;
        }
        const cx = Math.floor(px) + 2;
        const level = c % 2 ? 65 : 64;
        [[cx, level, 0], [cx + 1, level, 1]].forEach(([x, y, z], j) => {
            if (c % 6 === 0 && j === 0) d.observeRecord({ k: 'anim', t: t - 5, id: 80, a: 0 });
            d.observeRecord({ k: 'blk', t, x, y, z, b: 35 });
            t += 50;
        });
    }
    assert.strictEqual(flags.length, 0, 'front-placing while running must not flag');
    assert.strictEqual(d.getStatus().filter(row => row.strikes > 0).length, 0, 'front-placing while running must not strike');
}

console.log('Scaffold detector unit tests passed.');

// ---- corpus shadow run ----
const dir = path.join(__dirname, '..', '..', 'recordings');
if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
    let legitViolations = 0;
    console.log('\nCorpus shadow run:');
    for (const file of files) {
        const records = loadRecording(path.join(dir, file));
        const header = records.find(r => r.k === 'header') || {};
        const label = header.label || '?';
        const flags = [];
        const detector = createScaffoldDetector({ onFlag: f => flags.push(f) });
        records.forEach(r => detector.observeRecord(r));
        const strikes = detector.getStatus().filter(row => row.strikes > 0);
        const isLegit = label.startsWith('legit') || label === 'fidelitytest';

        // The legit label describes the RECORDED player, not everyone in the
        // game - a flag on the labeled target is a hard false positive; a
        // flag on some other entity in the same game is unknown ground
        // truth and gets surfaced for manual review instead.
        const target = resolveTarget(records, { player: header.player });
        const targetFlags = flags.filter(f => target.ids.has(Number(f.entityId)));
        const otherFlags = flags.filter(f => !target.ids.has(Number(f.entityId)));

        const flagText = flags.length
            ? flags.map(f => `${f.name} [${f.tier}]: ${f.reason}`).join("; ")
            : (strikes.length ? `no flag (strikes: ${strikes.map(s => `${s.name} w${s.weight}`).join(', ')})` : 'clean');
        let verdict;
        if (isLegit) {
            if (targetFlags.length) verdict = 'FALSE POSITIVE!';
            else if (otherFlags.length) verdict = 'ok+review';
            else verdict = 'ok';
        } else {
            verdict = flags.length ? 'DETECTED' : 'missed';
        }
        if (isLegit && targetFlags.length) legitViolations += 1;
        console.log(`  [${verdict.padEnd(15)}] ${label.padEnd(22)} ${file}`);
        if (flags.length || strikes.length) console.log(`      ${flagText}`);
        if (isLegit && otherFlags.length) {
            console.log('      ^ flag is on a DIFFERENT player than the labeled one - rewatch the replay to classify them');
        }
    }
    assert.strictEqual(legitViolations, 0, 'detector must produce ZERO flags on the labeled players of legit recordings');
    console.log('\nShadow gate passed: zero flags on labeled legit players.');
} else {
    console.log('(no recordings/ directory - corpus shadow run skipped)');
}
