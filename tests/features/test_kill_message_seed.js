'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKillMessages, DEFAULT_KILL_MESSAGE_PATTERNS } = require('../../src/cosmetics/killMessages');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-kill-message-seed-'));
const personalFile = path.join(tempDirectory, 'user-data', 'kill_message_patterns.json');
const seedPath = path.join(REPOSITORY_ROOT, 'assets', 'kill-message-patterns.json');
const originalSeed = fs.readFileSync(seedPath, 'utf8');
const seed = JSON.parse(originalSeed);
const makeEngine = () => createKillMessages({
    sendChat() {},
    stripAnsi: value => String(value).replace(/\u00a7[0-9a-fk-or]/gi, ''),
    killMessagePatternsFile: personalFile,
    getDenickKillMessageNames: () => seed.map(pattern => pattern.name),
    denickCosmeticApiValue: (_type, name) => seed.find(pattern => pattern.name === name)?.apiValue || `killmessages_${name.toLowerCase()}`
});

try {
    assert.strictEqual(seed.length, 32, 'portable releases retain the existing 32 cosmetic templates');
    const engine = makeEngine();
    engine.ensureDefaultKillMessagePatterns();
    assert.strictEqual(fs.existsSync(personalFile), false, 'loading defaults needs no writes to the app or user data');
    assert.strictEqual(Object.keys(engine.loadKillMessagePatternStore().patterns).length, 32);
    assert.ok(Object.isFrozen(DEFAULT_KILL_MESSAGE_PATTERNS));

    for (const pattern of seed) {
        assert.deepStrictEqual(Object.keys(pattern).sort(), ['apiValue', 'key', 'lines', 'name']);
        for (const line of pattern.lines) {
            assert.ok(line.includes('ExampleKiller'), 'every shipped line uses the generic killer');
            assert.ok(line.startsWith('ExampleVictim') || line.startsWith('Green Bed'), 'every shipped victim is generic');
            assert.ok(!/#(?!1\b)/.test(line), 'capture-specific player counters are removed');
            const liveLine = line.replaceAll('ExampleVictim', 'TestVictim').replaceAll('ExampleKiller', 'TestKiller').replaceAll('#1', '#12,345');
            assert.strictEqual(engine.killMessagePatternSignature(line), engine.killMessagePatternSignature(liveLine),
                `${pattern.key} must match arbitrary players rather than the example identity`);
            assert.strictEqual(engine.detectKillMessageOwner(liveLine), 'TestKiller', `${pattern.key} owner`);
        }
        const liveRegular = pattern.lines[0].replaceAll('ExampleVictim', 'TestVictim').replaceAll('ExampleKiller', 'TestKiller');
        assert.strictEqual(engine.detectKillMessageCosmeticFromChat(liveRegular)?.key, pattern.key, `${pattern.key} works before any capture`);
    }

    engine.finalizeKillMessageCapture({
        client: {}, key: 'woofwoof', name: 'Woof Woof',
        lines: seed.find(pattern => pattern.key === 'woofwoof').lines.map(line => line.replaceAll('ExampleKiller', 'LocalPlayer'))
    });
    const saved = JSON.parse(fs.readFileSync(personalFile, 'utf8'));
    assert.deepStrictEqual(Object.keys(saved.patterns), ['woofwoof'], 'recording saves personal overrides only');
    const restarted = makeEngine();
    restarted.ensureDefaultKillMessagePatterns();
    const loaded = restarted.loadKillMessagePatternStore();
    assert.strictEqual(Object.keys(loaded.patterns).length, 32, 'saved captures retain other bundled defaults');
    assert.ok(loaded.patterns.woofwoof.samples[0].text.includes('LocalPlayer'), 'recorded overrides survive restart');
    assert.strictEqual(restarted.detectKillMessageCosmetic('TestVictim was melted by TestKiller.')?.key, 'fire');
    assert.strictEqual(fs.readFileSync(seedPath, 'utf8'), originalSeed, 'the shipped seed stays unchanged');

    fs.writeFileSync(personalFile, '{invalid json');
    const recovery = makeEngine();
    assert.strictEqual(Object.keys(recovery.loadKillMessagePatternStore().patterns).length, 32, 'damaged personal data does not disable defaults');
    console.log('Kill message seed tests passed.');
} finally {
    const resolvedTemp = path.resolve(tempDirectory);
    assert.strictEqual(path.dirname(resolvedTemp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolvedTemp).startsWith('fury-kill-message-seed-'));
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
}
