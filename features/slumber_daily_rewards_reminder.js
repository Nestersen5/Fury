'use strict';

const DAILY_REWARD_TIME_ZONE = 'America/New_York';
const DAILY_REWARD_RESET_HOUR = 0;
const SUPPORTED_DAILY_NPC_NAMES = new Map([
    ['arcadeplayer', 'Npc Arcade Player'],
    ['blacksmithapprentice', 'Npc Blacksmith Apprentice'],
    ['bucky', 'Npc Bucky'],
    ['electricianrussel', 'Npc Electrician Russel'],
    ['generaldaku', 'Npc General Daku'],
    ['gizzymoonpowder', 'Npc Gizzy Moonpowder'],
    ['laundry', 'Npc Laundry'],
    ['laundrygal', 'Npc Laundry Gal'],
    ['lesterbrody', 'Npc Lester Brody'],
    ['oasis', 'Npc Oasis'],
    ['mastermeyer', 'Npc Master Meyer']
]);

const easternDateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DAILY_REWARD_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
});

function finiteTimestamp(value) {
    const nested = value && typeof value === 'object'
        ? (value.timestamp ?? value.completedAt ?? value.lastCompleted ?? value.at)
        : value;
    if (nested === null || nested === undefined || nested === '') return null;

    let timestamp = typeof nested === 'string' && !/^\d+(?:\.\d+)?$/.test(nested.trim())
        ? Date.parse(nested)
        : Number(nested);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    // Hypixel timestamps are milliseconds, but accepting second timestamps
    // keeps the parser friendly to exported/older API recordings.
    if (timestamp < 100_000_000_000) timestamp *= 1000;
    return Math.round(timestamp);
}

function easternDateParts(timestamp = Date.now()) {
    const parts = Object.fromEntries(easternDateFormatter.formatToParts(new Date(timestamp))
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]));
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second
    };
}

function easternLocalTimestamp(year, month, day, hour = DAILY_REWARD_RESET_HOUR, minute = 0, second = 0) {
    const localTarget = Date.UTC(year, month - 1, day, hour, minute, second);
    let candidate = localTarget;
    // Resolve a wall-clock Eastern time to UTC. Midnight is outside the DST
    // transition hour; repeating also makes the conversion
    // robust when the current offset differs from the target date's offset.
    for (let pass = 0; pass < 3; pass += 1) {
        const current = easternDateParts(candidate);
        const renderedAsUtc = Date.UTC(
            current.year,
            current.month - 1,
            current.day,
            current.hour,
            current.minute,
            current.second
        );
        candidate += localTarget - renderedAsUtc;
    }
    return candidate;
}

function easternCalendarDate(year, month, day, offsetDays = 0) {
    const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function getDailyRewardResetWindow(timestamp = Date.now()) {
    const now = Number(timestamp);
    const current = easternDateParts(now);
    const todayResetAt = easternLocalTimestamp(current.year, current.month, current.day);
    const resetDate = now >= todayResetAt
        ? easternCalendarDate(current.year, current.month, current.day)
        : easternCalendarDate(current.year, current.month, current.day, -1);
    const nextDate = now >= todayResetAt
        ? easternCalendarDate(current.year, current.month, current.day, 1)
        : easternCalendarDate(current.year, current.month, current.day);
    return {
        currentResetAt: easternLocalTimestamp(resetDate.year, resetDate.month, resetDate.day),
        nextResetAt: easternLocalTimestamp(nextDate.year, nextDate.month, nextDate.day),
        timeZone: DAILY_REWARD_TIME_ZONE,
        resetHour: DAILY_REWARD_RESET_HOUR
    };
}

function supportedNpcName(value) {
    const key = String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase().replace(/^npc/, '');
    return SUPPORTED_DAILY_NPC_NAMES.get(key) || null;
}

function getLastCompletedMap(raw = {}) {
    const player = raw?.player || raw;
    return player?.stats?.Bedwars?.slumber?.quest?.lastCompleted
        ?? player?.stats?.BedWars?.slumber?.quest?.lastCompleted
        ?? player?.slumber?.quest?.lastCompleted
        ?? null;
}

function extractSlumberDailyRewards(raw = {}) {
    const lastCompleted = getLastCompletedMap(raw);
    if (!lastCompleted || typeof lastCompleted !== 'object' || Array.isArray(lastCompleted)) return null;

    const rewards = Object.entries(lastCompleted)
        .map(([npc, completedAt]) => {
            const name = supportedNpcName(npc);
            return {
                npc: name,
                key: String(npc),
                lastCompletedAt: finiteTimestamp(completedAt)
            };
        })
        .filter(reward => reward.npc && reward.lastCompletedAt !== null)
        .sort((left, right) => left.npc.localeCompare(right.npc));

    if (!rewards.length) return null;
    return {
        profileName: String((raw?.player || raw)?.displayname || '').trim() || 'Player data',
        rewards
    };
}

function formatRemainingTime(milliseconds) {
    const totalMinutes = Math.max(0, Math.ceil(Number(milliseconds) / 60_000));
    if (totalMinutes <= 0) return 'Ready now';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function calculateDailyRewardStatuses(rewards = [], timestamp = Date.now()) {
    const window = getDailyRewardResetWindow(timestamp);
    return {
        ...window,
        rewards: rewards.map(reward => {
            const available = reward.lastCompletedAt < window.currentResetAt;
            const availableAt = available ? window.currentResetAt : window.nextResetAt;
            return {
                ...reward,
                available,
                availableAt,
                remainingMs: Math.max(0, availableAt - Number(timestamp)),
                remainingText: available ? 'Ready' : formatRemainingTime(availableAt - Number(timestamp))
            };
        })
    };
}

function createSlumberDailyRewardsReminder(options = {}) {
    const {
        getEnabled = () => false,
        isApiAvailable = () => false,
        getOwnUuid = async () => null,
        fetchPlayer = async () => null,
        getSavedReading = () => null,
        sendChat = () => {},
        logger = console,
        now = () => Date.now()
    } = options;

    let inFlight = false;
    let waitForData = false;
    let lastReadyNoticeResetAt = 0;
    const saved = getSavedReading();
    let status = {
        profileName: saved?.profileName || '',
        rewards: Array.isArray(saved?.rewards) ? saved.rewards : [],
        lastCheckedAt: saved?.lastCheckedAt || 0,
        error: ''
    };

    function snapshot() {
        const calculated = calculateDailyRewardStatuses(status.rewards, now());
        return {
            enabled: Boolean(getEnabled()),
            profileName: status.profileName,
            rewards: calculated.rewards,
            readyCount: calculated.rewards.filter(reward => reward.available).length,
            currentResetAt: calculated.currentResetAt,
            nextResetAt: calculated.nextResetAt,
            timeZone: calculated.timeZone,
            resetHour: calculated.resetHour,
            lastCheckedAt: status.lastCheckedAt,
            error: status.error
        };
    }

    function sendManualStatus() {
        const current = snapshot();
        if (!current.rewards.length) {
            sendChat('§6§lFury Daily §8» §eNo Slumber NPC daily-reward data has been received for your account yet.');
            return current;
        }

        sendChat('§6§lFury Daily Rewards §8» §7Slumber NPC daily reward status');
        current.rewards.forEach(reward => {
            const availability = reward.available
                ? '§a§lREADY'
                : `§c§lCOMPLETED §8| §f${reward.remainingText} §7left`;
            sendChat(`§8• §e${reward.npc} §8» ${availability}`);
        });
        return current;
    }

    function notifyIfDue({ manual = false, deferUntilData = false } = {}) {
        const current = snapshot();
        if (manual) return sendManualStatus();
        if (!current.enabled) {
            waitForData = false;
            return current;
        }
        if (!current.rewards.length) {
            if (deferUntilData) waitForData = true;
            return current;
        }

        const ready = current.rewards.filter(reward => reward.available);
        if (!ready.length || lastReadyNoticeResetAt === current.currentResetAt) return current;

        lastReadyNoticeResetAt = current.currentResetAt;
        const names = ready.map(reward => `§f${reward.npc}`).join('§7, ');
        sendChat(`§6§lFury Daily §8» §aReady to claim: ${names}§a.`);
        return current;
    }

    function observePlayerData(raw) {
        const reading = extractSlumberDailyRewards(raw);
        if (!reading) return snapshot();
        status.lastCheckedAt = now();
        status.error = '';
        status.profileName = reading?.profileName || '';
        status.rewards = reading?.rewards || [];
        if (waitForData) {
            waitForData = false;
            notifyIfDue();
        }
        return snapshot();
    }

    async function checkNow({ manual = false } = {}) {
        if (!isApiAvailable() || inFlight) return snapshot();
        inFlight = true;
        try {
            const uuid = await getOwnUuid();
            if (!uuid) {
                status.error = 'Your Minecraft UUID is not available yet.';
                return manual ? sendManualStatus() : snapshot();
            }
            const raw = await fetchPlayer(uuid);
            observePlayerData(raw);
            return notifyIfDue({ manual });
        } catch (error) {
            status.error = error?.message || 'Hypixel player lookup failed.';
            logger.warn?.('[Slumber Daily Reminder] Player lookup failed:', status.error);
            return manual ? sendManualStatus() : snapshot();
        } finally {
            inFlight = false;
        }
    }

    function onGameplayMilestone() {
        return notifyIfDue({ deferUntilData: true });
    }

    function refreshSettings() {
        if (!getEnabled()) waitForData = false;
        return snapshot();
    }

    function stop() {
        waitForData = false;
    }

    return {
        checkNow,
        observePlayerData,
        onGameplayMilestone,
        refreshSettings,
        stop,
        showStatus: sendManualStatus,
        getStatus: snapshot
    };
}

module.exports = {
    DAILY_REWARD_TIME_ZONE,
    DAILY_REWARD_RESET_HOUR,
    SUPPORTED_DAILY_NPC_NAMES,
    easternDateParts,
    getDailyRewardResetWindow,
    extractSlumberDailyRewards,
    formatRemainingTime,
    calculateDailyRewardStatuses,
    createSlumberDailyRewardsReminder
};
