'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createReminderAccountStore, createRememberedReminders, REFRESH_INTERVAL_MS } = require('../../src/reminders/rememberedAccount');

async function run() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-reminder-accounts-'));
    try {
        let now = Date.parse('2026-09-09T12:00:00Z');
        const alice = 'a'.repeat(32), bob = 'b'.repeat(32);
        const store = createReminderAccountStore(directory, () => now);
        const settings = { keys: { hypixel: 'test-key' }, features: {} };
        let calls = 0, fail = false, resolveFetch = null;
        const payload = (uuid, dust = 270) => ({ success: true, player: {
            uuid, displayname: uuid === alice ? 'Alice' : 'Bob',
            stats: { Bedwars: { slumber: {
                minion: { ender_dust: dust },
                quest: { lastCompleted: { 'Npc Bucky': now } }
            } } }
        } });
        const reminders = createRememberedReminders({
            store, getSettings: () => settings, now: () => now,
            fetchPlayer: async uuid => {
                calls++;
                if (fail) throw new Error('offline');
                if (resolveFetch) return new Promise(resolve => { resolveFetch.resolve = resolve; });
                return payload(uuid);
            }
        });
        await reminders.refresh();
        assert.strictEqual(calls, 0, 'no account must not make an API request');
        assert(reminders.getStatus().enderDust.error.includes('Connect Minecraft once'));
        store.remember(alice, 'Alice');
        await reminders.refresh();
        assert.strictEqual(calls, 1, 'one player request refreshes both reminders with alerts disabled');
        assert.strictEqual(reminders.getStatus().enderDust.enderDust, 270);
        assert.strictEqual(reminders.getStatus().slumberDailyRewards.readyCount, 0);
        await reminders.refresh();
        assert.strictEqual(calls, 1, 'background polling respects the five-minute interval');

        const restartedStore = createReminderAccountStore(directory, () => now);
        assert.strictEqual(restartedStore.selected().uuid, alice, 'last account survives restart');
        now += 24 * 60 * 60 * 1000;
        assert.strictEqual(reminders.getStatus().slumberDailyRewards.readyCount, 1, 'saved daily rewards reset while disconnected');
        settings.features.apiKillSwitchEnabled = true;
        await reminders.refresh({ force: true });
        assert.strictEqual(calls, 1, 'manual refresh respects the API kill switch');
        settings.features.apiKillSwitchEnabled = false;
        settings.keys.hypixel = '';
        await reminders.refresh({ force: true });
        assert.strictEqual(calls, 1, 'missing keys do not trigger requests');
        settings.keys.hypixel = 'test-key';

        fail = true;
        await reminders.refresh();
        assert.strictEqual(reminders.getStatus().enderDust.enderDust, 270, 'failed refresh retains readings');
        assert(reminders.getStatus().slumberDailyRewards.error.includes('offline'));
        await reminders.refresh();
        assert.strictEqual(calls, 2, 'failure retries are paced too');
        fail = false;
        now += REFRESH_INTERVAL_MS;
        resolveFetch = {};
        const pending = reminders.refresh();
        const duplicate = reminders.refresh({ force: true });
        assert.strictEqual(calls, 3, 'concurrent refreshes share a request');
        store.remember(bob, 'Bob');
        assert.strictEqual(reminders.getStatus().enderDust.enderDust, null, 'account switch never shows the previous account’s dust');
        resolveFetch.resolve(payload(alice));
        await Promise.all([pending, duplicate]);
        assert.strictEqual(store.selected().uuid, bob, 'late responses never switch the remembered account');
        assert.strictEqual(reminders.getStatus().enderDust.enderDust, null);
        resolveFetch = null;
        await reminders.refresh();
        assert.strictEqual(reminders.getStatus().enderDust.profileName, 'Bob');
        store.observe(bob, payload(bob, -300), now + 50);
        assert.strictEqual(reminders.getStatus().enderDust.enderDust, 0, 'negative counters clear saved full-minion readings');
        assert.strictEqual(restartedStore.reading(bob).enderDust.enderDust, 0, 'cleared dust survives reloading the account store');
        store.observe(bob, payload(bob, 0), now + 100);
        store.observe(bob, payload(bob, 300), now);
        assert.strictEqual(store.reading(bob).enderDust.enderDust, 0, 'older in-flight responses cannot undo collection');
        store.observe(bob, { player: {} }, now + 200);
        assert.strictEqual(store.reading(bob).enderDust.enderDust, 0, 'partial responses preserve valid readings');
        store.observe(bob, payload(alice, 300), now + 200);
        assert.strictEqual(store.reading(bob).enderDust.enderDust, 0, 'mismatched player payloads are ignored');
        assert.strictEqual(store.remember('../../escape', 'Invalid'), null);
        console.log('Remembered account reminder tests passed.');
    } finally {
        assert.strictEqual(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert(path.basename(directory).startsWith('fury-reminder-accounts-'));
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
