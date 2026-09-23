'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    normalizeEffectPacket,
    buildFingerprint,
    similarity
} = require('../../src/cosmetics/effectFingerprint.js');
const { createEffectLibrary } = require('../../src/cosmetics/effectLibrary.js');
const { createEffectRecorder } = require('../../src/cosmetics/effectRecorder.js');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function testFingerprinting() {
    // Packet normalization: coordinate scaling per packet family.
    const particle = normalizeEffectPacket('world_particles', { particleId: 15, particles: 40, x: 10.5, y: 65, z: -3 }, 1000);
    assert.strictEqual(particle.key, 'p:15');
    assert.strictEqual(particle.n, 40);
    assert.strictEqual(particle.x, 10.5);

    const sound = normalizeEffectPacket('named_sound_effect', { soundName: 'mob.wither.death', pitch: 63, x: 80, y: 520, z: -24 }, 1000);
    assert.strictEqual(sound.key, 's:mob.wither.death@63');
    assert.strictEqual(sound.x, 10, 'sound coords are fixed-point /8');

    const lightning = normalizeEffectPacket('spawn_entity_weather', { type: 1, x: 320, y: 2048, z: 0 }, 1000);
    assert.strictEqual(lightning.key, 'w:1');
    assert.strictEqual(lightning.x, 10, 'entity coords are fixed-point /32');

    assert.strictEqual(normalizeEffectPacket('chat', {}, 1000), null, 'non-effect packets normalize to null');

    // Deterministic effects fingerprint identically; different effects don't.
    function tornadoRecords(baseT) {
        const records = [];
        for (let i = 0; i < 10; i += 1) {
            records.push({ t: baseT + i * 100, key: 'p:15', n: 30, x: 10, y: 65 + i * 0.5, z: 10 });
        }
        records.push({ t: baseT + 50, key: 's:mob.enderdragon.growl@63', n: 1, x: 10, y: 65, z: 10 });
        return records;
    }
    function lightningRecords(baseT) {
        return [
            { t: baseT, key: 'w:1', n: 1, x: 10, y: 65, z: 10 },
            { t: baseT + 20, key: 's:ambient.weather.thunder@63', n: 1, x: 10, y: 65, z: 10 }
        ];
    }

    const tornadoA = buildFingerprint(tornadoRecords(1000), [], 1000);
    const tornadoB = buildFingerprint(tornadoRecords(50_000), [], 50_000);
    const lightningFp = buildFingerprint(lightningRecords(1000), [], 1000);

    assert(similarity(tornadoA, tornadoB) > 0.99, 'the same effect at different times should fingerprint identically');
    assert(similarity(tornadoA, lightningFp) < 0.3, 'different effects should not match');

    // Background subtraction: ambient combat noise must not poison the match.
    const effect = [
        { t: 1000, key: 'w:1', n: 1, x: 10, y: 65, z: 10 },
        { t: 1020, key: 's:ambient.weather.thunder@63', n: 1, x: 10, y: 65, z: 10 }
    ];
    const noise = [];
    for (let i = 0; i < 20; i += 1) {
        noise.push({ t: 1000 + i * 100, key: 'p:9', n: 8, x: 10, y: 65, z: 10 }); // ongoing fire/crit spam
    }
    const background = [];
    for (let i = 0; i < 10; i += 1) {
        background.push({ t: -200 + i * 100, key: 'p:9', n: 8, x: 10, y: 65, z: 10 });
    }

    const clean = buildFingerprint(effect, [], 1000);
    const noisy = buildFingerprint([...effect, ...noise], background, 1000);
    const noisyWithoutSubtraction = buildFingerprint([...effect, ...noise], [], 1000);

    assert(similarity(clean, noisy) > similarity(clean, noisyWithoutSubtraction), 'subtracting background should improve the match');
    assert(similarity(clean, noisy) > 0.8, 'the effect should still be recognizable through ambient noise');
}

async function testLibrary() {
    const tmpFile = path.join(os.tmpdir(), `cosmeticfx-test-${Date.now()}.json`);
    try {
        const library = createEffectLibrary({ file: tmpFile, logger: { error: () => {} } });
        const fingerprintA = { counts: { 'w:1|0': 1, 's:thunder@63|0': 1 }, height: 0, radius: 0, total: 2 };
        const fingerprintB = { counts: { 'p:15|0': 300, 'p:15|1': 200 }, height: 5, radius: 2, total: 500 };

        // Classification never creates entries.
        assert.strictEqual(library.classify(fingerprintA, 'final_kill'), null, 'empty library classifies to null');
        assert.strictEqual(library.stats().total, 0, 'classify must not create entries');

        // Deliberate recording creates a labeled exemplar.
        const entry = library.addExemplar(fingerprintA, 'final_kill', 'Lightning Strike');
        assert.strictEqual(entry.label, 'Lightning Strike');
        assert.strictEqual(entry.samples, 1);

        const matched = library.classify(fingerprintA, 'final_kill');
        assert(matched.matched, 'a recorded effect should classify as matched');
        assert.strictEqual(matched.entry.label, 'Lightning Strike');

        const unmatched = library.classify(fingerprintB, 'final_kill');
        assert(!unmatched.matched, 'a very different fingerprint should not reach the threshold');
        assert.strictEqual(library.stats().total, 1, 'unmatched classification must not store anything');

        // Kinds are separate namespaces.
        assert.strictEqual(library.classify(fingerprintA, 'bed_break'), null, 'no bed_break entries yet');

        // Re-recording the same label replaces the sample.
        const rerecorded = library.addExemplar(fingerprintB, 'final_kill', 'lightning strike');
        assert.strictEqual(rerecorded.id, entry.id, 'labels are case-insensitive for re-recording');
        assert.strictEqual(rerecorded.samples, 2);
        assert(library.classify(fingerprintB, 'final_kill').matched, 'the replaced fingerprint is now the exemplar');

        // Sighting counter + settings + persistence round-trip.
        library.recordSighting(rerecorded);
        library.setSetting('notify', true);
        await library.saveNow();
        const reloaded = createEffectLibrary({ file: tmpFile, logger: { error: () => {} } });
        const rematch = reloaded.classify(fingerprintB, 'final_kill');
        assert(rematch.matched, 'exemplars survive a reload');
        assert.strictEqual(rematch.entry.seen, 1, 'the seen counter persists');
        assert.strictEqual(reloaded.getSetting('notify', false), true, 'settings persist across reloads');
        assert.strictEqual(reloaded.getSetting('missing', 'fallback'), 'fallback', 'unset settings fall back');

        // Removal.
        assert(reloaded.removeEntry('Lightning Strike'), 'entries can be removed by label');
        assert.strictEqual(reloaded.stats().total, 0);
    } finally {
        fs.rmSync(tmpFile, { force: true });
    }
}

async function testRecorder() {
    const tmpFile = path.join(os.tmpdir(), `cosmeticfx-recorder-test-${Date.now()}.json`);
    const messages = [];
    const library = createEffectLibrary({ file: tmpFile, logger: { error: () => {} } });
    const positions = new Map([['Victim1', { x: 100, y: 65, z: 100 }]]);
    const recorder = createEffectRecorder({
        sendChat: message => messages.push(message),
        library,
        resolvePlayerPosition: name => positions.get(name) || null,
        captureWindowMs: 80 // keep the test fast; production uses 2500ms
    });

    try {
        function playLightningAt(x, z) {
            recorder.observeServerPacket({ type: 1, x: x * 32, y: 65 * 32, z: z * 32 }, { name: 'spawn_entity_weather' });
            recorder.observeServerPacket({ soundName: 'ambient.weather.thunder', pitch: 63, x: x * 8, y: 65 * 8, z: z * 8 }, { name: 'named_sound_effect' });
            for (let i = 0; i < 4; i += 1) {
                recorder.observeServerPacket({ particleId: 26, particles: 12, x, y: 65 + i, z }, { name: 'world_particles' });
            }
        }
        function triggerFinalKill() {
            recorder.observeChatLine('Victim1 was thundered by KillerGuy. FINAL KILL!');
            playLightningAt(100, 100);
        }

        // 0. Notifications default OFF: detections are silent out of the box.
        triggerFinalKill();
        await sleep(250);
        assert.strictEqual(messages.length, 0, 'detection chat must be opt-in (silent by default)');
        assert.strictEqual(library.stats().total, 0, 'nothing stored either');

        // 1. Live game with notify on, unknown effect: reported, NOT stored.
        recorder.handleCommand(null, ['/cosmeticfx', 'notify', 'on']);
        triggerFinalKill();
        await sleep(250);
        assert(messages.some(message => message.includes('unrecognized')), 'unknown effects are reported as unrecognized');
        assert.strictEqual(library.stats().total, 0, 'live games must never auto-record');

        // 2. Armed recording: /cosmeticfx record Thunderstorm -> next capture stored.
        recorder.handleCommand(null, ['/cosmeticfx', 'record', 'Thunderstorm']);
        assert(messages.some(message => message.includes('Armed')), 'arming should confirm');
        triggerFinalKill();
        await sleep(250);
        assert(messages.some(message => message.includes('Recorded') && message.includes('Thunderstorm')), 'the armed capture is stored under the given name');
        assert.strictEqual(library.stats().total, 1);

        // 3. The same effect in a later game now classifies by name.
        triggerFinalKill();
        await sleep(250);
        assert(messages.some(message => message.includes('Thunderstorm') && message.includes('match')), 'the recorded effect is recognized in live play');

        // 4. Notifications off: detections are silent (and skipped entirely).
        recorder.handleCommand(null, ['/cosmeticfx', 'notify', 'off']);
        const before = messages.length;
        triggerFinalKill();
        await sleep(250);
        assert.strictEqual(messages.length, before, 'notify off should silence detection output');

        // 5. Armed recording still works while notifications are off.
        recorder.handleCommand(null, ['/cosmeticfx', 'record', 'Thunder Bed']);
        recorder.observeServerPacket({ location: { x: 200, y: 70, z: 200 }, type: 0 }, { name: 'block_change' });
        recorder.observeChatLine('BED DESTRUCTION > Red Bed was destroyed by BedEater!');
        playLightningAt(200, 200);
        await sleep(250);
        assert(messages.some(message => message.includes('Recorded') && message.includes('Thunder Bed')), 'recording works with notifications off (bed break kind)');
        assert.strictEqual(library.list('bed_break').length, 1, 'the bed sample is stored under the bed_break kind');

        // 6. Recording with no effect nearby stays armed.
        recorder.handleCommand(null, ['/cosmeticfx', 'notify', 'on']);
        recorder.handleCommand(null, ['/cosmeticfx', 'record', 'GhostEffect']);
        recorder.observeChatLine('Victim1 was thundered by KillerGuy. FINAL KILL!');
        // no packets played near the victim this time
        await sleep(250);
        assert(messages.some(message => message.includes('still armed')), 'an empty capture keeps recording armed');
        recorder.handleCommand(null, ['/cosmeticfx', 'record', 'cancel']);
        assert(messages.some(message => message.includes('disarmed')), 'recording can be cancelled');
    } finally {
        recorder.dispose();
        library.dispose();
        await sleep(50);
        fs.rmSync(tmpFile, { force: true });
    }
}

(async () => {
    testFingerprinting();
    await testLibrary();
    await testRecorder();
    console.log('test_cosmetic_effects.js: all assertions passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
