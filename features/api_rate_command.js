'use strict';

function createApiRateCommandHandler({ sendChat, getSettings, setSettings, provider, command,
    normalizeSettings, limits, delayKey, concurrencyKey, delayLabel = 'Delay', note = '' }) {
    const usage = client => {
        sendChat(client, `\u00a7b[${provider}] \u00a77${command} delay <${limits[delayKey].min}-${limits[delayKey].max} ms>`);
        sendChat(client, `\u00a77${command} concurrency <${limits[concurrencyKey].min}-${limits[concurrencyKey].max}> \u00a78| \u00a77${command} status/reset`);
    };
    const show = client => {
        const current = getSettings();
        sendChat(client, `\u00a7b[${provider}] \u00a77${delayLabel}: \u00a7f${current[delayKey]} ms \u00a78| \u00a77Concurrent reads: \u00a7f${current[concurrencyKey]}`);
        if (note) sendChat(client, `\u00a77${note}`);
    };
    return function handleApiRateCommand(client, args) {
        const sub = String(args[1] || 'status').toLowerCase();
        if ((args.length === 1 || args.length === 2) && sub === 'status') {
            show(client); usage(client); return;
        }
        const key = sub === 'delay' ? delayKey : sub === 'concurrency' ? concurrencyKey : null;
        let next;
        if (sub === 'reset' && args.length === 2) next = normalizeSettings();
        else if (key && args.length === 3) {
            const value = String(args[2]), number = Number(value), { min, max } = limits[key];
            if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
                sendChat(client, `\u00a7b[${provider}] \u00a7cUse a whole number from ${min} to ${max}${sub === 'delay' ? ' ms' : ''}.`);
                return;
            }
            next = { ...getSettings(), [key]: number };
        } else { usage(client); return; }
        try { setSettings(next); }
        catch (error) {
            sendChat(client, `\u00a7b[${provider}] \u00a7cCould not save settings. Your settings have not changed.`);
            return;
        }
        show(client);
    };
}

module.exports = { createApiRateCommandHandler };
