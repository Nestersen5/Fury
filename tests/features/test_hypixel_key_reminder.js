'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HOUR, KEY_LIFETIME, SNOOZE_DURATION, getHypixelKeyReminderStatus: status,
    nextReminderAt, createHypixelKeyReminder } = require('../../src/reminders/hypixelKeyReminder');
const { createHypixelKeyDeliveryStore } = require('../../src/reminders/hypixelKeyDeliveryStore');
const { createApiKeyCommandHandler, sendHypixelKeyReminder } = require('../../features/api_key_commands');

const saved = Date.parse('2026-10-03T12:00:00Z');
let clock = saved;
let config = { keys: { hypixel: 'fixture-only-key' }, keyMeta: { hypixelSavedAt: saved } };
const expiry = saved + KEY_LIFETIME;
assert.strictEqual(status({}, saved).phase, 'missing');
assert.strictEqual(status({ keys: config.keys }, saved).phase, 'unknown');
assert.strictEqual(status(config, saved).expiresAt, expiry);
assert.strictEqual(status(config, expiry - 3 * HOUR - 1).phase, 'ready');
assert.strictEqual(status(config, expiry - 3 * HOUR).phase, 'soon');
assert.strictEqual(status(config, expiry - HOUR).phase, 'soon');
assert.strictEqual(status(config, expiry - HOUR + 1).phase, 'urgent');
assert.strictEqual(status(config, expiry).phase, 'expired');
const legacy = { keys: config.keys, keyMeta: { hypixelUpdatedAt: '2026-10-03 14:00' } };
assert.strictEqual(status(legacy, saved).expiresAt, new Date(2026, 9, 3, 14, 0).getTime() + KEY_LIFETIME);
assert.strictEqual(status({ ...legacy, keyMeta: { hypixelUpdatedAt: 'bad timestamp' } }, saved).phase, 'unknown');

let canNotify = true;
let stoppedTimerCount = 0;
const sent = [];
let timer = null;
let record = {};
const store = {
    get: (key, expiresAt) => record.key === key && record.expiresAt === expiresAt ? record : {},
    set: (key, expiresAt, value) => { record = { key, expiresAt, ...value }; }
};
const options = {
    now: () => clock, getConfig: () => structuredClone(config), store,
    canNotify: () => canNotify,
    notify: (state, text) => sent.push({ at: clock, phase: state.phase, text }),
    setTimeout: (fn, delay) => { timer = { fn, at: clock + delay }; return timer; },
    clearTimeout: () => { stoppedTimerCount++; timer = null; }
};
function tick(at) {
    while (timer && timer.at <= at) {
        clock = timer.at;
        const fn = timer.fn;
        timer = null;
        fn();
    }
    clock = at;
}

const reminder = createHypixelKeyReminder(options);
reminder.check();
assert.strictEqual(timer.at, expiry - 3 * HOUR);
tick(expiry - 3 * HOUR);
assert.strictEqual(sent.length, 1);
reminder.check();
reminder.reload();
assert.strictEqual(sent.length, 1, 'duplicate lobby/settings events must not repeat a message');
tick(expiry - 2 * HOUR);
assert.strictEqual(sent.length, 2);
tick(expiry - HOUR);
assert.strictEqual(sent.length, 3);
tick(expiry - HOUR + 1);
assert.strictEqual(sent.length, 3, 'crossing into the final hour must not immediately duplicate the hourly warning');
assert.strictEqual(timer.at, expiry - HOUR + 5 * 60000);
tick(timer.at - 1);
assert.strictEqual(sent.length, 3);
tick(clock + 1);
assert.strictEqual(sent.length, 4);
assert.strictEqual(sent.at(-1).phase, 'urgent');
canNotify = false;
tick(clock + 5 * 60000);
assert.strictEqual(timer, null, 'do not poll while notification is deferred by gameplay');
const before = sent.length;
tick(expiry + 10 * 60000);
assert.strictEqual(sent.length, before);
canNotify = true;
reminder.check();
assert.strictEqual(sent.at(-1).phase, 'expired');
assert.strictEqual(timer.at, clock + HOUR);

config.keyMeta.hypixelSnoozedUntil = clock + SNOOZE_DURATION;
reminder.reload();
assert.strictEqual(timer.at, config.keyMeta.hypixelSnoozedUntil);
tick(timer.at - 1);
assert.strictEqual(sent.length, before + 1);
tick(clock + 1);
assert.strictEqual(sent.length, before + 2, 'expiry messages resume after the snooze');
reminder.stop();
assert.strictEqual(timer, null);
const reconnected = createHypixelKeyReminder(options);
reconnected.check();
assert.strictEqual(sent.length, before + 2, 'reconnecting must preserve the delivery cooldown');
assert.strictEqual(timer.at, clock + HOUR);

config = { keys: { hypixel: 'replacement-fixture' }, keyMeta: { hypixelSavedAt: clock } };
reconnected.reload();
assert.strictEqual(timer.at, clock + KEY_LIFETIME - 3 * HOUR);
config.keys.hypixel = '';
reconnected.reload();
assert.strictEqual(timer, null, 'clearing the key cancels its deadline');
reconnected.stop();
reconnected.reload();
assert.strictEqual(timer, null);
assert(stoppedTimerCount > 0);

// A late hourly reminder must not delay entering the final-hour phase.
const late = expiry - HOUR - 1000;
assert.strictEqual(nextReminderAt(status({ ...config, keys: { hypixel: 'key' }, keyMeta: { hypixelSavedAt: saved } }, late),
    { phase: 'soon', lastAt: late }, late), expiry - HOUR + 1);

const chatMessages = [];
sendHypixelKeyReminder({}, (_, message) => chatMessages.push(message), { phase: 'urgent', expiresAt: Date.now() + 60000 });
const actions = chatMessages[0].extra.filter(part => part.clickEvent).map(part => part.clickEvent);
assert.deepStrictEqual(actions, [
    { action: 'open_url', value: 'https://developer.hypixel.net/dashboard/' },
    { action: 'suggest_command', value: '/apikey hypixel ' },
    { action: 'run_command', value: '/apikey snooze' }
]);
assert(!JSON.stringify(chatMessages).includes('fixture-only-key'));
let snoozedKey = null;
let reloads = 0;
const handler = createApiKeyCommandHandler({
    getKeys: () => ({ hypixel: 'command-fixture' }),
    snoozeHypixelKeyReminder: key => { snoozedKey = key; },
    onReminderChanged: () => reloads++,
    sendChat: (_, text) => chatMessages.push(text)
});
handler({}, ['/apikey', 'snooze']);
assert.strictEqual(snoozedKey, 'command-fixture');
assert.strictEqual(reloads, 1);
assert(chatMessages.at(-1).includes('24 hours'));

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-key-reminder-'));
    try {
        const file = path.join(directory, 'delivery.json');
        const persistent = createHypixelKeyDeliveryStore(file);
        persistent.set('secret-test-value', expiry, { lastAt: saved, phase: 'soon' });
        persistent.set('secret-test-value', expiry, { lastAt: saved + HOUR, phase: 'urgent' });
        await persistent.flush();
        assert(!fs.readFileSync(file, 'utf8').includes('secret-test-value'));
        const restored = createHypixelKeyDeliveryStore(file);
        assert.strictEqual(restored.get('secret-test-value', expiry).lastAt, saved + HOUR);
        assert.deepStrictEqual(restored.get('replacement', expiry), {});
        assert.deepStrictEqual(restored.get('secret-test-value', expiry + 1), {});
        fs.writeFileSync(file, 'invalid json');
        assert.deepStrictEqual(createHypixelKeyDeliveryStore(file).get('key', expiry), {});
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    console.log('Hypixel key reminder timing, deferral, snooze, actions and persistence passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
