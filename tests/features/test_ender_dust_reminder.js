'use strict';

const assert = require('assert');
const {
    MINION_ENDER_DUST_CAPACITY,
    extractEnderDustMinion,
    createEnderDustReminder
} = require('../../features/ender_dust_reminder.js');

const ownUuid = '0123456789abcdef0123456789abcdef';
const playerPayload = dust => ({
    player: {
        displayname: 'FuryUser',
        stats: {
            Bedwars: {
                slumber: {
                    minion: { ender_dust: dust }
                }
            }
        }
    }
});

const extracted = extractEnderDustMinion(playerPayload(250));
assert.deepStrictEqual(extracted, {
    enderDust: 250,
    capacity: MINION_ENDER_DUST_CAPACITY,
    profileName: 'FuryUser'
}, 'the normal Player API response should expose Slumber Minion dust');
assert.strictEqual(extractEnderDustMinion(playerPayload(0)).enderDust, 0, 'zero Ender Dust must remain a valid reading');
assert.strictEqual(extractEnderDustMinion(playerPayload(-300)).enderDust, 0, 'negative dust counters must clear an old full reading');
assert.strictEqual(extractEnderDustMinion(playerPayload('-12')).enderDust, 0, 'numeric negative strings also represent no collectible dust');
for (const value of [null, undefined, '', 'invalid', Infinity, NaN]) {
    assert.strictEqual(extractEnderDustMinion(playerPayload(value)), null, 'missing or invalid dust remains unknown');
}
assert.strictEqual(
    extractEnderDustMinion({ player: { slumber: { minion: { ender_dust: 7 } } } }).enderDust,
    7,
    'older root-level Slumber payloads should remain readable'
);
assert.strictEqual(extractEnderDustMinion({ player: {} }), null, 'missing Slumber data should not produce a reminder value');

async function run() {
    let enabled = true;
    let threshold = 250;
    let now = 1000;
    let dust = 250;
    const notices = [];
    let savedReading = null;
    const reminder = createEnderDustReminder({
        getEnabled: () => enabled,
        getThreshold: () => threshold,
        isApiAvailable: () => true,
        getOwnUuid: async () => ownUuid,
        fetchPlayer: async () => playerPayload(dust),
        getSavedReading: () => savedReading,
        saveReading: reading => { savedReading = reading; },
        sendChat: line => notices.push(line),
        logger: { warn() {} },
        now: () => now,
        reminderCooldownMs: 2 * 60 * 60 * 1000
    });

    await reminder.checkNow();
    assert.strictEqual(notices.length, 1, 'a threshold-reaching amount should alert immediately');
    assert(reminder.getStatus().enderDust === 250, 'status should retain the fetched dust value');
    assert.deepStrictEqual(savedReading, {
        enderDust: 250,
        capacity: 300,
        profileName: 'FuryUser',
        lastCheckedAt: now
    }, 'each valid self reading should be saved for the next proxy session');

    now += 10 * 60 * 1000;
    await reminder.checkNow();
    assert.strictEqual(notices.length, 1, 'manual refreshes before the cooldown must not spam alerts');

    dust = 120;
    now += 10 * 60 * 1000;
    await reminder.checkNow();
    assert.strictEqual(reminder.getStatus().lastAlertAt, 0, 'collecting below the threshold should re-arm the alert');

    dust = 251;
    now += 10 * 60 * 1000;
    await reminder.checkNow();
    assert.strictEqual(notices.length, 2, 'a new collection cycle should alert again immediately');

    enabled = false;
    dust = 300;
    now += 3 * 60 * 60 * 1000;
    await reminder.checkNow();
    assert.strictEqual(notices.length, 2, 'disabled reminders must never send chat messages');
    await reminder.checkNow({ force: true, notify: false });
    assert.strictEqual(reminder.getStatus().enderDust, 300, 'a launcher-triggered live check should work while alerts are disabled');
    assert.strictEqual(notices.length, 2, 'a launcher-triggered live check must not create a chat alert');

    threshold = 300;
    assert.strictEqual(reminder.refreshSettings().threshold, 300, 'the configured threshold should be reflected in status');

    const eventNotices = [];
    const eventReminder = createEnderDustReminder({
        getEnabled: () => true,
        getThreshold: () => 250,
        sendChat: line => eventNotices.push(line),
        now: () => now,
        reminderCooldownMs: 2 * 60 * 60 * 1000
    });
    eventReminder.observePlayerData(playerPayload(260));
    assert.strictEqual(eventNotices.length, 0, 'receiving self Player API data should update status without immediately spamming chat');
    eventReminder.onGameplayMilestone();
    assert.strictEqual(eventNotices.length, 1, 'a BedWars lobby or game-finish milestone should announce an already-full-enough minion');

    const waitingNotices = [];
    const waitingReminder = createEnderDustReminder({
        getEnabled: () => true,
        getThreshold: () => 250,
        sendChat: line => waitingNotices.push(line),
        now: () => now
    });
    waitingReminder.onGameplayMilestone();
    assert.strictEqual(waitingNotices.length, 0, 'a milestone without self data should wait quietly for the next own Player API response');
    waitingReminder.observePlayerData(playerPayload(280));
    assert.strictEqual(waitingNotices.length, 1, 'the next self Player API response should fulfill a waiting milestone reminder');

    const restoredReminder = createEnderDustReminder({
        getSavedReading: () => savedReading,
        now: () => now
    });
    assert.strictEqual(restoredReminder.getStatus().enderDust, 300, 'the last saved Ender Dust amount should survive a proxy restart');
    assert.strictEqual(restoredReminder.getStatus().profileName, 'FuryUser', 'the saved reading should keep its own-account label');

    let pollingDust = 90;
    const pollingNotices = [];
    const scheduledIntervals = [];
    let pollCallback = null;
    const pollingReminder = createEnderDustReminder({
        getEnabled: () => true,
        getThreshold: () => 250,
        isApiAvailable: () => true,
        getOwnUuid: async () => ownUuid,
        fetchPlayer: async () => playerPayload(pollingDust),
        sendChat: line => pollingNotices.push(line),
        logger: { warn() {} },
        now: () => now,
        setIntervalFn: (callback, interval) => {
            pollCallback = callback;
            scheduledIntervals.push(interval);
            return { unref() {} };
        },
        clearIntervalFn: () => {}
    });
    await pollingReminder.start();
    assert.deepStrictEqual(scheduledIntervals, [15 * 60 * 1000], 'enabled reminders should poll the Player API every fifteen minutes');
    assert.strictEqual(pollingNotices.length, 0, 'a below-threshold startup reading must not alert');
    pollingDust = 300;
    pollCallback();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(pollingNotices.length, 1, 'a polling refresh must alert after the minion reaches full storage');
    pollingReminder.stop();
    const lobbyNotices = [];
    let lobbyDust = 300;
    let lobbyFetches = 0;
    let lobbyFailure = false;
    const lobbyReminder = createEnderDustReminder({
        getEnabled: () => enabled,
        isApiAvailable: () => true,
        getOwnUuid: async () => ownUuid,
        fetchPlayer: async () => {
            lobbyFetches++;
            if (lobbyFailure) throw new Error('offline');
            return playerPayload(lobbyDust);
        },
        sendChat: line => lobbyNotices.push(line),
        logger: { warn() {} }, now: () => now
    });
    enabled = true;
    await lobbyReminder.onLobbyJoin('lobby:1');
    await lobbyReminder.onLobbyJoin('lobby:1');
    assert.strictEqual(lobbyFetches, 1, 'repeated scoreboard updates in one lobby do not refetch');
    await lobbyReminder.onLobbyJoin('lobby:2');
    assert.strictEqual(lobbyNotices.length, 2, 'every new lobby bypasses the two-hour cooldown');
    lobbyDust = -300;
    await lobbyReminder.onLobbyJoin('lobby:3');
    assert.strictEqual(lobbyNotices.length, 2, 'freshly collected dust stops lobby reminders');
    assert.strictEqual(lobbyReminder.getStatus().enderDust, 0, 'negative collection readings replace the previous full amount');
    assert.strictEqual(lobbyReminder.getStatus().lastAlertAt, 0, 'negative collection readings re-arm the next collection cycle');
    lobbyDust = 300;
    await lobbyReminder.onLobbyJoin('lobby:4');
    assert.strictEqual(lobbyNotices.length, 3, 'the next collection cycle alerts again');
    lobbyFailure = true;
    await lobbyReminder.onLobbyJoin('lobby:5');
    assert.strictEqual(lobbyNotices.length, 3, 'failed refreshes do not repeat stale collection alerts');
    enabled = false;
    await lobbyReminder.onLobbyJoin('lobby:6');
    assert.strictEqual(lobbyFetches, 5, 'disabled lobby alerts do not fetch');
    let resolveSlowFetch;
    const slowNotices = [];
    const slowReminder = createEnderDustReminder({
        getEnabled: () => true, isApiAvailable: () => true,
        getOwnUuid: async () => ownUuid,
        fetchPlayer: () => new Promise(resolve => { resolveSlowFetch = resolve; }),
        sendChat: line => slowNotices.push(line)
    });
    const firstLobby = slowReminder.onLobbyJoin('slow:1');
    const nextLobby = slowReminder.onLobbyJoin('slow:2');
    await new Promise(resolve => setImmediate(resolve));
    resolveSlowFetch(playerPayload(300));
    await Promise.all([firstLobby, nextLobby]);
    assert.strictEqual(slowNotices.length, 1, 'a delayed lookup alerts only in the latest lobby');
    const disconnectedLobby = slowReminder.onLobbyJoin('slow:3');
    await new Promise(resolve => setImmediate(resolve));
    slowReminder.stop();
    resolveSlowFetch(playerPayload(300));
    await disconnectedLobby;
    assert.strictEqual(slowNotices.length, 1, 'disconnect cancels a pending lobby alert');
    console.log('Ender Dust reminder tests passed.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
