'use strict';

const fs = require('fs');
const path = require('path');
const { extractEnderDustMinion } = require('../../features/ender_dust_reminder');
const { extractSlumberDailyRewards, calculateDailyRewardStatuses } = require('../../features/slumber_daily_rewards_reminder');
const { normalizeGamblerGeorgeReminderState } = require('../../features/gambler_george_reminder');

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const normalizeUuid = value => {
    const uuid = String(value || '').replace(/-/g, '').toLowerCase();
    return /^[a-f0-9]{32}$/.test(uuid) ? uuid : null;
};

// Small, account-scoped records shared by the launcher and proxy. Never store
// credentials or a full player response, and never change selection on refresh.
function createReminderAccountStore(directory, now = Date.now) {
    function read(file) {
        try { return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')); }
        catch { return null; }
    }
    function write(file, value) {
        fs.mkdirSync(directory, { recursive: true });
        const target = path.join(directory, file);
        const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
            fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
            fs.renameSync(temporary, target);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }
    function selected() {
        const account = read('account.json');
        const uuid = normalizeUuid(account?.uuid);
        return uuid ? { ...account, uuid } : null;
    }
    function remember(uuid, name) {
        uuid = normalizeUuid(uuid);
        if (!uuid) return null;
        const account = { uuid, name: String(name || '').trim(), lastUsedAt: now() };
        write('account.json', account);
        return account;
    }
    function reading(uuid = selected()?.uuid) {
        uuid = normalizeUuid(uuid);
        return uuid ? read(`${uuid}.json`) : null;
    }
    function observe(uuid, raw, checkedAt = now()) {
        uuid = normalizeUuid(uuid);
        if (!uuid) return null;
        const player = raw?.player || raw;
        if (!player || (player.uuid && normalizeUuid(player.uuid) !== uuid)) return null;
        const dust = extractEnderDustMinion(raw);
        const daily = extractSlumberDailyRewards(raw);
        const previous = reading(uuid) || {};
        if ((!dust && !daily) || previous.lastCheckedAt > checkedAt) return previous;
        const next = {
            ...previous, uuid, lastCheckedAt: checkedAt,
            ...(dust ? { enderDust: { ...dust, lastCheckedAt: checkedAt } } : {}),
            ...(daily ? { slumberDailyRewards: { ...daily, lastCheckedAt: checkedAt } } : {})
        };
        write(`${uuid}.json`, next);
        return next;
    }
    function george(uuid) {
        uuid = normalizeUuid(uuid);
        return uuid ? read(`george-${uuid}.json`) : null;
    }
    function saveGeorge(uuid, state, name = '') {
        uuid = normalizeUuid(uuid);
        if (!uuid) return null;
        const next = { ...normalizeGamblerGeorgeReminderState(state), accountUuid: uuid,
            profileName: String(name || ''), lastCheckedAt: now() };
        write(`george-${uuid}.json`, next);
        return next;
    }
    return { selected, remember, reading, observe, george, saveGeorge };
}

function createRememberedReminders({ store, getSettings, fetchPlayer, getAccount = () => store.selected(), now = Date.now }) {
    const attempts = new Map();
    const errors = new Map();
    const pending = new Map();

    function setRefreshError(message, uuid = getAccount()?.uuid) {
        if (!uuid) return;
        if (message) errors.set(uuid, { message, at: now() });
        else errors.delete(uuid);
    }

    function getStatus(account = getAccount()) {
        const saved = account?.uuid ? store.reading(account.uuid) : null;
        const settings = getSettings();
        const failure = errors.get(account?.uuid);
        const error = !account?.uuid ? 'Connect Minecraft once so Fury can remember your account.'
            : settings.features?.apiKillSwitchEnabled ? 'API requests are paused. Showing saved readings.'
            : !settings.keys?.hypixel ? 'Add a Hypixel API key to refresh this account.'
            : failure && !(saved?.lastCheckedAt > failure.at) ? failure.message : '';
        const common = { profileName: account?.name || '', error, accountUuid: account?.uuid || null };
        const daily = saved?.slumberDailyRewards;
        const george = account?.uuid ? store.george(account.uuid) : null;
        const georgeState = normalizeGamblerGeorgeReminderState(george);
        const cooldownRemainingMs = Math.max(0, (georgeState.cooldownUntil || 0) - now());
        const calculated = calculateDailyRewardStatuses(Array.isArray(daily?.rewards) ? daily.rewards : [], now());
        return {
            account,
            gamblerGeorge: {
                ...georgeState, ...common,
                lastCheckedAt: george?.lastCheckedAt || 0,
                known: Boolean(george), requiredWins: 2,
                enabled: Boolean(settings.features?.gamblerGeorgeReminderEnabled),
                autoGamblerEnabled: Boolean(settings.features?.autoGamblerEnabled),
                paused: !settings.features?.autoGamblerEnabled,
                cooldownRemainingMs, onCooldown: cooldownRemainingMs > 0
            },
            enderDust: {
                ...common, enderDust: null, capacity: 300, lastCheckedAt: 0,
                ...saved?.enderDust,
                enabled: Boolean(settings.features?.enderDustReminderEnabled),
                threshold: settings.features?.enderDustReminderThreshold || 250
            },
            slumberDailyRewards: {
                ...common, ...daily, ...calculated,
                lastCheckedAt: daily?.lastCheckedAt || 0,
                readyCount: calculated.rewards.filter(reward => reward.available).length,
                enabled: Boolean(settings.features?.slumberDailyRewardsReminderEnabled)
            }
        };
    }

    async function refresh({ force = false, account = getAccount() } = {}) {
        const settings = getSettings();
        if (!account?.uuid || settings.features?.apiKillSwitchEnabled || !settings.keys?.hypixel) return getStatus(account);
        if (pending.has(account.uuid)) return pending.get(account.uuid);
        const previous = Math.max(attempts.get(account.uuid) || 0, store.reading(account.uuid)?.lastCheckedAt || 0);
        if (!force && previous && now() - previous < REFRESH_INTERVAL_MS) return getStatus(account);
        const checkedAt = now();
        attempts.set(account.uuid, checkedAt);
        const request = (async () => {
            try {
                const raw = await fetchPlayer(account.uuid);
                if (raw?.success === false || !raw?.player || (raw.player.uuid && normalizeUuid(raw.player.uuid) !== account.uuid)) {
                    throw new Error('Hypixel did not return this account’s player data.');
                }
                store.observe(account.uuid, raw, checkedAt);
                setRefreshError('', account.uuid);
            } catch (error) {
                setRefreshError(`Could not refresh: ${error?.message || 'Hypixel unavailable'}. Showing saved readings.`, account.uuid);
            } finally {
                pending.delete(account.uuid);
            }
            return getStatus(account);
        })();
        pending.set(account.uuid, request);
        return request;
    }
    return { getStatus, refresh, setRefreshError };
}

module.exports = { createReminderAccountStore, createRememberedReminders, REFRESH_INTERVAL_MS, normalizeUuid };
