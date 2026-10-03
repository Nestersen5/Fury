'use strict';

const HOUR = 60 * 60 * 1000;
const KEY_LIFETIME = 48 * HOUR;
const WARNING_WINDOW = 3 * HOUR;
const URGENT_INTERVAL = 5 * 60 * 1000;
const SNOOZE_DURATION = 24 * HOUR;

function keySavedAt(meta = {}) {
    const precise = Number(meta.hypixelSavedAt);
    if (Number.isFinite(precise) && precise > 0) return precise;
    // Older Fury keys have a local, minute-resolution timestamp. Preserve it;
    // loading or saving unrelated settings must not grant another 48 hours.
    const legacy = Date.parse(String(meta.hypixelUpdatedAt || '').replace(' ', 'T'));
    return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
}

function getHypixelKeyReminderStatus(config = {}, now = Date.now()) {
    const savedAt = keySavedAt(config.keyMeta);
    const configured = Boolean(String(config.keys?.hypixel || '').trim());
    const expiresAt = configured && savedAt ? savedAt + KEY_LIFETIME : 0;
    const remaining = expiresAt - now;
    const phase = !configured ? 'missing' : !expiresAt ? 'unknown'
        : remaining <= 0 ? 'expired' : remaining < HOUR ? 'urgent'
            : remaining <= WARNING_WINDOW ? 'soon' : 'ready';
    const snooze = Number(config.keyMeta?.hypixelSnoozedUntil);
    const snoozedUntil = configured && Number.isFinite(snooze) ? Math.max(0, snooze) : 0;
    return { phase, expiresAt, snoozedUntil, snoozed: snoozedUntil > now };
}

function reminderMessage(status, now = Date.now()) {
    if (status.phase === 'missing') return 'Add a Hypixel API key to enable expiry reminders.';
    if (status.phase === 'unknown') return 'Key age is unknown. Enter a new key to start the 48-hour reminder.';
    if (status.phase === 'expired') return 'Your Hypixel API key has reached its 48-hour expiry. Refresh it to keep API features working.';
    const minutes = Math.max(1, Math.ceil((status.expiresAt - now) / 60000));
    const time = minutes >= 60 && minutes % 60 === 0
        ? `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`
        : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    return `Your Hypixel API key expires in ${time}. Refresh it before it expires.`;
}

function nextReminderAt(status, delivery = {}, now = Date.now()) {
    if (!status.expiresAt) return null;
    if (status.snoozed) return status.snoozedUntil;
    if (status.phase === 'ready') return status.expiresAt - WARNING_WINDOW;
    const interval = status.phase === 'urgent' ? URGENT_INTERVAL : HOUR;
    const lastAt = Number(delivery.lastAt) || 0;
    const continues = delivery.phase === status.phase || (status.phase === 'urgent' && delivery.phase === 'soon');
    let next = !continues || !lastAt ? now : Math.max(now, lastAt + interval);
    // Cross phase boundaries even if the preceding reminder was just sent.
    if (status.phase === 'soon') next = Math.min(next, status.expiresAt - HOUR + 1);
    if (status.phase === 'urgent') next = Math.min(next, status.expiresAt);
    return next;
}

// One timer per connected player. Due work waits for a safe lobby event rather
// than polling while a match is active. The proxy owns the delivery store.
function createHypixelKeyReminder(options) {
    const now = options.now || Date.now;
    const schedule = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    let timer = null;
    let stopped = false;
    let config = options.getConfig();
    function clear() { if (timer !== null) cancel(timer); timer = null; }
    function check() {
        clear();
        if (stopped) return;
        const at = now();
        const status = getHypixelKeyReminderStatus(config, at);
        const delivery = options.store.get(config.keys?.hypixel, status.expiresAt);
        let next = nextReminderAt(status, delivery, at);
        if (next === null) return;
        if (next <= at) {
            if (!options.canNotify()) return;
            options.notify(status, reminderMessage(status, at));
            const sent = { phase: status.phase, lastAt: at };
            options.store.set(config.keys?.hypixel, status.expiresAt, sent);
            next = nextReminderAt(status, sent, at);
        }
        timer = schedule(check, Math.min(0x7fffffff, Math.max(1, next - at)));
        timer?.unref?.();
    }
    return {
        check,
        reload() { if (!stopped) { config = options.getConfig(); check(); } },
        stop() { stopped = true; clear(); }
    };
}

module.exports = { HOUR, KEY_LIFETIME, WARNING_WINDOW, URGENT_INTERVAL, SNOOZE_DURATION,
    keySavedAt, getHypixelKeyReminderStatus, reminderMessage, nextReminderAt, createHypixelKeyReminder };
