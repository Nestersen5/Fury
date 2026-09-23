'use strict';

const { createFeatureStatus } = require('./feature_panel.js');
const chat = require('./chat_controller.js');

const API_KEY_TYPES = {
    hypixel: 'Hypixel',
    urchin: 'Urchin',
    urchinadmin: 'Urchin admin',
    aurora: 'Aurora',
    seraph: 'Seraph'
};

function apiKeyDisplay(value) {
    return value ? `\u00a7f${value}` : '\u00a77Not set';
}

function apiKeyAgeSuffix(timestamp) {
    if (!timestamp) return '';
    const updatedAt = new Date(String(timestamp).replace(' ', 'T'));
    if (Number.isNaN(updatedAt.getTime())) return '';
    const hours = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 3600000));
    return ` \u00a78(${hours} ${hours === 1 ? 'hour' : 'hours'} ago)`;
}

function formatUsageCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function createApiKeyCommandHandler(options = {}) {
    const sendChat = typeof options.sendChat === 'function' ? options.sendChat : () => {};
    const getKeys = typeof options.getKeys === 'function' ? options.getKeys : () => ({});
    const saveKeys = typeof options.saveKeys === 'function' ? options.saveKeys : () => {};
    const loadKeyMeta = typeof options.loadKeyMeta === 'function' ? options.loadKeyMeta : () => ({});
    const getHypixelApiUsageSnapshot = typeof options.getHypixelApiUsageSnapshot === 'function'
        ? options.getHypixelApiUsageSnapshot
        : () => ({});
    const getUrchinRateLimitSnapshot = typeof options.getUrchinRateLimitSnapshot === 'function'
        ? options.getUrchinRateLimitSnapshot
        : () => ({});
    const onKeyChanged = typeof options.onKeyChanged === 'function' ? options.onKeyChanged : () => {};

    function sendApiKeyUsage(client) {
        const panel = createFeatureStatus({ client, sendChat, title: 'API keys', section: 'system' });
        panel.open();
        Object.entries(API_KEY_TYPES).forEach(([key, label]) => panel.row([
            panel.label(label),
            chat.text(`/apikey ${key} <key>`, 'white')
        ]));
        panel.row([
            chat.text('/apikey view - saved keys; /apikey usage - request usage.', 'gray')
        ]);
        panel.close();
    }

    function sendHypixelApiUsage(client) {
        const usage = getHypixelApiUsageSnapshot();
        const urchinUsage = getUrchinRateLimitSnapshot();
        const headerText = usage.headers?.remaining !== null && usage.headers?.remaining !== undefined
            ? ` \u00a78| \u00a77Header remaining: \u00a7f${usage.headers.remaining}${usage.headers.resetInMs !== null ? ` \u00a78(reset ${formatUsageCountdown(usage.headers.resetInMs)})` : ''}`
            : '';
        const gameLabel = usage.currentGameActive
            ? `${usage.currentGame} \u00a78(${usage.currentGameMode || 'game'})`
            : `${usage.currentGame} \u00a78(no active game)`;

        const panel = createFeatureStatus({ client, sendChat, title: 'Hypixel API Usage', section: 'system' });
        panel.open();
        sendChat(client, `\u00a77Last 1 min: \u00a7f${usage.lastMinute} \u00a78| \u00a77Last 5 min: \u00a7f${usage.lastFiveMinutes}`);
        sendChat(client, `\u00a77This game: \u00a7f${gameLabel}`);
        sendChat(client, `\u00a77Local 5m window: \u00a7f${usage.currentWindow.count}\u00a77/\u00a7f${usage.limit} \u00a78(${usage.currentWindow.remaining} left, reset in ${formatUsageCountdown(usage.currentWindow.resetInMs)})`);
        sendChat(client, `\u00a77Queue: \u00a7f${usage.queue.active} active \u00a78/ \u00a7f${usage.queue.queued} queued \u00a78(concurrency ${usage.queue.concurrency})${usage.queue.cooldownInMs > 0 ? ` \u00a7cCooldown ${formatUsageCountdown(usage.queue.cooldownInMs)}` : ''}`);
        sendChat(client, `\u00a77Recent 429s: \u00a7f${usage.recent429}${headerText}`);
        if (Array.isArray(usage.keyPool) && usage.keyPool.length) {
            usage.keyPool.forEach(key => {
                const status = key.healthy ? '\u00a7ahealthy' : `\u00a7c${key.reason}`;
                sendChat(client, `\u00a77${key.label} key: ${status} \u00a78| \u00a77active \u00a7f${key.active} \u00a78| \u00a77requests \u00a7f${key.requests} \u00a78| \u00a77failures \u00a7f${key.failures}`);
            });
        }
        sendChat(client, '\u00a7d\u00a7lUrchin API Usage');
        if (urchinUsage.limit !== null && urchinUsage.remaining !== null) {
            sendChat(client, `\u00a77Remaining: \u00a7f${urchinUsage.remaining}\u00a77/\u00a7f${urchinUsage.limit}${urchinUsage.resetInMs !== null ? ` \u00a78(reset ${formatUsageCountdown(urchinUsage.resetInMs)})` : ''}`);
        } else {
            sendChat(client, '\u00a77Remaining: \u00a78Waiting for the next Urchin response header');
        }
        sendChat(client, `\u00a77Queue: \u00a7f${urchinUsage.queuedPlayers} players \u00a78| \u00a77In flight: \u00a7f${urchinUsage.requestInFlight ? 'Yes' : 'No'} \u00a78| \u00a77Cached: \u00a7f${urchinUsage.cachedPlayers}${urchinUsage.cooldownInMs > 0 ? ` \u00a7cCooldown ${formatUsageCountdown(urchinUsage.cooldownInMs)}` : ''}`);
        panel.close();
    }

    function handleApiKeyCommand(client, args) {
        const subCommand = String(args[1] || '').toLowerCase();
        const keyField = subCommand;

        if (!subCommand) {
            sendApiKeyUsage(client);
            return;
        }

        if (['usage', 'use', 'requests', 'limits', 'limit'].includes(subCommand)) {
            sendHypixelApiUsage(client);
            return;
        }

        const keys = getKeys();
        if (subCommand === 'view') {
            const meta = loadKeyMeta();
            const panel = createFeatureStatus({ client, sendChat, title: 'Saved API Keys', section: 'system' });
            panel.open();
            Object.entries(API_KEY_TYPES).forEach(([key, label]) => {
                sendChat(client, `\u00a7e${label}: ${apiKeyDisplay(keys[key])}`);
            });
            sendChat(client, `\u00a77Hypixel updated: \u00a7f${meta.hypixelUpdatedAt || 'Not tracked yet'}${apiKeyAgeSuffix(meta.hypixelUpdatedAt)}`);
            panel.row(panel.action('Edit keys', '/apikey', 'Choose a provider to update.'));
            panel.close();
            return;
        }

        if (!API_KEY_TYPES[subCommand] || args.length < 3) {
            sendApiKeyUsage(client);
            return;
        }

        const nextKey = args.slice(2).join(' ').trim();
        if (!nextKey) {
            sendApiKeyUsage(client);
            return;
        }

        const previousKey = keys[keyField];
        keys[keyField] = nextKey;
        saveKeys(keys);
        if (previousKey !== nextKey && ['hypixel', 'urchin', 'aurora', 'seraph'].includes(keyField)) {
            onKeyChanged(keyField, previousKey, nextKey);
        }

        const meta = loadKeyMeta();
        sendChat(client, `\u00a7a${API_KEY_TYPES[subCommand]} API key updated.`);
        if (keyField === 'hypixel') {
            sendChat(client, `\u00a77Hypixel updated: \u00a7f${meta.hypixelUpdatedAt || 'Just now'}${apiKeyAgeSuffix(meta.hypixelUpdatedAt)}`);
        }
    }

    return handleApiKeyCommand;
}

module.exports = {
    API_KEY_TYPES,
    apiKeyAgeSuffix,
    apiKeyDisplay,
    createApiKeyCommandHandler,
    formatUsageCountdown
};
