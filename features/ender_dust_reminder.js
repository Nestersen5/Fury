'use strict';

const MINION_ENDER_DUST_CAPACITY = 300;
const DEFAULT_ENDER_DUST_THRESHOLD = 250;
const DEFAULT_REMINDER_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const DEFAULT_REMINDER_POLL_INTERVAL_MS = 15 * 60 * 1000;

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function extractEnderDustMinion(raw = {}) {
    // Slumber Minion is currently nested under BedWars in the Player API.
    // Keep the former root-level path as a compatibility fallback for older
    // cached/recorded payloads.
    const player = raw?.player || raw;
    const rawDust = (
        player?.stats?.Bedwars?.slumber?.minion?.ender_dust
        ?? player?.stats?.BedWars?.slumber?.minion?.ender_dust
        ?? player?.slumber?.minion?.ender_dust
    );
    if (rawDust === null || rawDust === undefined || rawDust === '') return null;
    const dust = Number(rawDust);
    if (!Number.isFinite(dust)) return null;
    return {
        // Negative counters occur in Player API payloads. They represent no
        // collectible dust, not a missing reading: retaining the old amount
        // here would keep a previously full minion's reminder active.
        enderDust: Math.max(0, dust),
        capacity: MINION_ENDER_DUST_CAPACITY,
        profileName: String(player?.displayname || '').trim() || 'Player data'
    };
}

function normalizeSavedReading(raw = {}) {
    const enderDust = numberOrNull(raw?.enderDust);
    if (enderDust === null || enderDust > MINION_ENDER_DUST_CAPACITY) return null;
    const lastCheckedAt = Number(raw?.lastCheckedAt);
    return {
        enderDust,
        capacity: MINION_ENDER_DUST_CAPACITY,
        profileName: String(raw?.profileName || '').trim() || 'Player data',
        lastCheckedAt: Number.isFinite(lastCheckedAt) && lastCheckedAt > 0 ? Math.round(lastCheckedAt) : 0
    };
}

function createEnderDustReminder(options = {}) {
    const {
        getEnabled = () => false,
        getThreshold = () => DEFAULT_ENDER_DUST_THRESHOLD,
        isApiAvailable = () => false,
        getOwnUuid = async () => null,
        fetchPlayer = async () => null,
        getSavedReading = () => null,
        saveReading = () => {},
        sendChat = () => {},
        logger = console,
        now = () => Date.now(),
        reminderCooldownMs = DEFAULT_REMINDER_COOLDOWN_MS,
        reminderPollIntervalMs = DEFAULT_REMINDER_POLL_INTERVAL_MS,
        setIntervalFn = setInterval,
        clearIntervalFn = clearInterval
    } = options;

    let inFlight = null;
    let lastLobbyKey = null;
    let lobbyGeneration = 0;
    let lobbyRefreshPending = false;
    let repeatWhenDataArrives = false;
    let stopped = false;
    let lastAlertAt = 0;
    let remindWhenDataArrives = false;
    let pollTimer = null;
    let hasLiveReading = false;
    const savedReading = normalizeSavedReading(getSavedReading());
    let status = {
        enabled: Boolean(getEnabled()),
        threshold: DEFAULT_ENDER_DUST_THRESHOLD,
        enderDust: savedReading?.enderDust ?? null,
        capacity: savedReading?.capacity ?? MINION_ENDER_DUST_CAPACITY,
        profileName: savedReading?.profileName || '',
        lastCheckedAt: savedReading?.lastCheckedAt || 0,
        lastAlertAt: 0,
        error: ''
    };

    function threshold() {
        const value = Math.round(Number(getThreshold()));
        return Number.isFinite(value)
            ? Math.max(1, Math.min(MINION_ENDER_DUST_CAPACITY, value))
            : DEFAULT_ENDER_DUST_THRESHOLD;
    }

    function pollInterval() {
        const value = Math.round(Number(reminderPollIntervalMs));
        return Number.isFinite(value)
            ? Math.max(60_000, value)
            : DEFAULT_REMINDER_POLL_INTERVAL_MS;
    }

    function snapshot() {
        return { ...status, enabled: Boolean(getEnabled()), threshold: threshold() };
    }

    function resetAlertWhenCollected() {
        const amount = numberOrNull(status.enderDust);
        if (amount !== null && amount < status.threshold) {
            lastAlertAt = 0;
            status.lastAlertAt = 0;
        }
    }

    function notifyIfDue({ manual = false, waitForData = false, repeat = false } = {}) {
        status.enabled = Boolean(getEnabled());
        status.threshold = threshold();
        if (!status.enabled || stopped) {
            remindWhenDataArrives = false;
            return snapshot();
        }
        if (lobbyRefreshPending && !manual) return snapshot();

        const amount = numberOrNull(status.enderDust);
        if (amount === null) {
            if (waitForData) remindWhenDataArrives = true;
            if (manual) sendChat('§b§lFury Reminder §8» §eNo Slumber Minion data has been received for your account yet.');
            return snapshot();
        }

        resetAlertWhenCollected();
        if (amount < status.threshold) {
            if (manual) sendChat(`§b§lFury Reminder §8» §7Slumber Minion: §f${amount}§7/§f${status.capacity} §7Ender Dust.`);
            return snapshot();
        }

        const alertDue = repeat || !lastAlertAt || now() - lastAlertAt >= reminderCooldownMs;
        if (alertDue) {
            lastAlertAt = now();
            status.lastAlertAt = lastAlertAt;
            sendChat(`§b§lFury Reminder §8» §dSlumber Minion has §f${amount}§d/§f${status.capacity} §dEnder Dust. §aCollect it soon!`);
        } else if (manual) {
            sendChat(`§b§lFury Reminder §8» §7Slumber Minion: §f${amount}§7/§f${status.capacity} §7Ender Dust. §eReminder is already active.`);
        }
        return snapshot();
    }

    function observePlayerData(raw) {
        const reading = extractEnderDustMinion(raw);
        status.error = '';
        if (!reading) {
            // A partial/API-variant response must not erase a previous valid
            // self reading: the launcher deliberately retains that value over
            // proxy restarts until a newer amount is received.
            return snapshot();
        }

        status.enderDust = reading.enderDust;
        status.capacity = reading.capacity;
        status.profileName = reading.profileName;
        status.lastCheckedAt = now();
        status.threshold = threshold();
        hasLiveReading = true;
        try {
            saveReading({
                enderDust: status.enderDust,
                capacity: status.capacity,
                profileName: status.profileName,
                lastCheckedAt: status.lastCheckedAt
            });
        } catch (error) {
            logger.warn?.('[Ender Dust Reminder] Could not save the latest reading:', error?.message || error);
        }
        resetAlertWhenCollected();

        if (repeatWhenDataArrives && !lobbyRefreshPending) {
            repeatWhenDataArrives = false;
            remindWhenDataArrives = false;
            notifyIfDue({ repeat: true });
        } else if (remindWhenDataArrives) {
            remindWhenDataArrives = false;
            notifyIfDue();
        }
        return snapshot();
    }

    async function performCheck({ manual = false, notify = true, force = false } = {}) {
        status.enabled = Boolean(getEnabled());
        status.threshold = threshold();
        if ((!status.enabled && !force) || !isApiAvailable()) return snapshot();

        try {
            const uuid = await getOwnUuid();
            if (!uuid) {
                status.error = 'Your Minecraft UUID is not available yet.';
                return snapshot();
            }
            const raw = await fetchPlayer(uuid);
            const reading = observePlayerData(raw);
            if (reading.enderDust === null && manual) {
                sendChat('§b§lFury Reminder §8» §eNo Slumber Minion data was available in your Hypixel player response.');
                return reading;
            }
            return notify ? notifyIfDue({ manual }) : snapshot();
        } catch (error) {
            status.error = error?.message || 'Hypixel player lookup failed.';
            logger.warn?.('[Ender Dust Reminder] Player lookup failed:', status.error);
            return snapshot();
        }
    }

    function checkNow(options = {}) {
        if (inFlight) return inFlight;
        inFlight = performCheck(options).finally(() => { inFlight = null; });
        return inFlight;
    }

    async function onLobbyJoin(key) {
        if (stopped || !getEnabled() || key === lastLobbyKey) return snapshot();
        lastLobbyKey = key;
        const generation = ++lobbyGeneration;
        lobbyRefreshPending = true;
        // Refresh first: a value from the previous lobby may predate collection.
        await checkNow({ notify: false });
        if (generation !== lobbyGeneration) return snapshot();
        lobbyRefreshPending = false;
        if (status.error) return snapshot();
        if (!hasLiveReading) {
            repeatWhenDataArrives = true;
            return snapshot();
        }
        return notifyIfDue({ repeat: true });
    }

    function onLobbyLeave() {
        lobbyGeneration += 1;
        lastLobbyKey = null;
        lobbyRefreshPending = false;
        repeatWhenDataArrives = false;
    }

    function onGameplayMilestone() {
        // A persisted reading is useful for launcher status after a restart,
        // but it is not current enough to decide whether the player should be
        // alerted. Fetch once so a previously low saved value cannot hide a
        // newly-full minion.
        if (!hasLiveReading) {
            const snapshot = notifyIfDue({ waitForData: true });
            void checkNow();
            return snapshot;
        }
        return notifyIfDue({ waitForData: true });
    }

    function start() {
        stopped = false;
        if (pollTimer !== null || !getEnabled()) return Promise.resolve(snapshot());
        pollTimer = setIntervalFn(() => {
            void checkNow();
        }, pollInterval());
        // Timers must not keep a short-lived proxy/test process open on their
        // own. Browser-compatible timers simply do not expose unref().
        pollTimer?.unref?.();
        return checkNow({ notify: false });
    }

    function stop() {
        stopped = true;
        onLobbyLeave();
        remindWhenDataArrives = false;
        if (pollTimer !== null) {
            clearIntervalFn(pollTimer);
            pollTimer = null;
        }
    }

    function refreshSettings() {
        status.enabled = Boolean(getEnabled());
        status.threshold = threshold();
        resetAlertWhenCollected();
        if (!status.enabled) stop();
        else if (pollTimer === null) void start();
        return snapshot();
    }

    return {
        start,
        stop,
        checkNow,
        observePlayerData,
        onGameplayMilestone,
        onLobbyJoin,
        onLobbyLeave,
        refreshSettings,
        getStatus: snapshot
    };
}

module.exports = {
    MINION_ENDER_DUST_CAPACITY,
    DEFAULT_ENDER_DUST_THRESHOLD,
    DEFAULT_REMINDER_COOLDOWN_MS,
    DEFAULT_REMINDER_POLL_INTERVAL_MS,
    extractEnderDustMinion,
    createEnderDustReminder
};
