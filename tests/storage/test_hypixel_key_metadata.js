'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-key-metadata-'));
const previous = process.env.FURY_DATA_DIR;
process.env.FURY_DATA_DIR = directory;
const config = require('../../app_config');
const { KEY_LIFETIME, SNOOZE_DURATION, getHypixelKeyReminderStatus } = require('../../src/reminders/hypixelKeyReminder');
const realNow = Date.now;
let clock = Date.parse('2026-10-03T12:00:00Z');
Date.now = () => clock;
try {
    config.saveKeys({ hypixel: 'first-fixture', urchin: 'other-provider' });
    const first = config.loadKeyState();
    assert.strictEqual(first.keyMeta.hypixelSavedAt, clock);
    assert.strictEqual(getHypixelKeyReminderStatus(first, clock).expiresAt, clock + KEY_LIFETIME);
    clock += 10000;
    config.snoozeHypixelKeyReminder('first-fixture');
    assert.strictEqual(config.loadKeyMeta().hypixelSnoozedUntil, clock + SNOOZE_DURATION);
    config.saveKeys({ hypixel: 'first-fixture' });
    assert.deepStrictEqual(config.loadKeyMeta(), { ...first.keyMeta, hypixelSnoozedUntil: clock + SNOOZE_DURATION });
    config.saveKeys({ aurora: 'different-provider' });
    assert.strictEqual(config.loadKeyMeta().hypixelSavedAt, first.keyMeta.hypixelSavedAt);
    config.saveKeys({ hypixel: 'second-fixture' });
    assert.strictEqual(config.loadKeyMeta().hypixelSavedAt, clock);
    assert.strictEqual(config.loadKeyMeta().hypixelSnoozedUntil, 0);
    assert.throws(() => config.snoozeHypixelKeyReminder('first-fixture'), /key changed/);
    assert.strictEqual(config.loadKeys().urchin, 'other-provider');
    config.saveKeys({ hypixel: '' });
    assert.deepStrictEqual(config.loadKeyMeta(), config.defaults.keyMeta);
    assert.throws(() => config.snoozeHypixelKeyReminder(''), /key changed/);
    fs.writeFileSync(config.paths.keys, 'Hypixel API key: legacy-fixture\nHypixel API key updated: 2026-10-01 10:00\n');
    config.saveKeys({ urchin: 'unrelated' });
    assert.strictEqual(config.loadKeyMeta().hypixelSavedAt, 0);
    assert.strictEqual(config.loadKeyMeta().hypixelUpdatedAt, '2026-10-01 10:00');
    fs.writeFileSync(config.paths.keys, 'untracked-key\nurchin-fixture\n');
    config.saveKeys({ hypixel: 'untracked-key' });
    assert.strictEqual(getHypixelKeyReminderStatus(config.loadKeyState()).phase, 'unknown');
    console.log('Hypixel key metadata migration, replacement and snooze persistence passed.');
} finally {
    Date.now = realNow;
    if (previous === undefined) delete process.env.FURY_DATA_DIR; else process.env.FURY_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
}
