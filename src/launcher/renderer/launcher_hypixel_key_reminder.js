'use strict';

const { getHypixelKeyReminderStatus } = require('../../reminders/hypixelKeyReminder');

function mount({ document, invoke, openExternal, refresh, setStatus }) {
    const summary = document.getElementById('hypixel-key-reminder-summary');
    const status = document.getElementById('hypixel-key-reminder-status');
    const expiry = document.getElementById('hypixel-key-reminder-expiry');
    const snooze = document.getElementById('hypixel-key-snooze');
    const dashboard = document.getElementById('hypixel-key-dashboard');
    let key = '';
    let signature = '';
    let pending = false;
    let latest = {};

    function update(settings) {
        latest = settings;
        key = settings.keys?.hypixel || '';
        const reminder = getHypixelKeyReminderStatus(settings);
        const next = JSON.stringify([reminder, pending]);
        if (signature === next) return;
        signature = next;
        const messages = {
            missing: 'Add a Hypixel API key to enable expiry reminders.',
            unknown: 'Key age is unknown. Save a new key to start the 48-hour reminder.',
            ready: 'Reminders start 3 hours before expiry.',
            soon: 'Your Hypixel API key expires within 3 hours. Refresh it soon.',
            urgent: 'Your Hypixel API key expires in less than 1 hour. Refresh it now.',
            expired: 'Your Hypixel API key has reached its 48-hour expiry. Refresh it now.'
        };
        status.textContent = messages[reminder.phase];
        const alert = { soon: 'Key expires within 3 hours', urgent: 'Key expires in less than 1 hour', expired: 'Key reached its 48-hour expiry' }[reminder.phase];
        summary.textContent = alert || 'Stats, guilds, status, and scans';
        summary.dataset.reminderAlert = String(Boolean(alert));
        expiry.textContent = reminder.expiresAt
            ? `Expiry: ${new Date(reminder.expiresAt).toLocaleString()} · 48 hours after saving a new key.`
            : 'Expiry is counted 48 hours from saving a new key.';
        if (reminder.snoozed) expiry.textContent += ` Reminders snoozed until ${new Date(reminder.snoozedUntil).toLocaleString()}.`;
        snooze.disabled = pending || !reminder.expiresAt || reminder.snoozed;
        snooze.textContent = pending ? 'Snoozing…' : reminder.snoozed ? 'Snoozed for 24 hours' : 'Snooze 24 hours';
    }

    dashboard.addEventListener('click', () => {
        Promise.resolve(openExternal('https://developer.hypixel.net/dashboard/'))
            .catch(() => setStatus('Could not open the Hypixel dashboard.', 'error'));
    });
    snooze.addEventListener('click', async () => {
        if (pending || snooze.disabled) return;
        const expectedKey = key;
        pending = true;
        update(latest);
        try {
            const keyMeta = await invoke('settings:save-hypixel-reminder-snooze', expectedKey);
            if (key === expectedKey) latest = { ...latest, keyMeta };
            await refresh();
        } catch (error) { setStatus(error?.message || 'Could not snooze key reminders.', 'error'); }
        finally { pending = false; update(latest); }
    });
    return { update };
}

module.exports = { mount };
