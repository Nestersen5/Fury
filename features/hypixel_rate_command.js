'use strict';

const { createApiRateCommandHandler } = require('./api_rate_command');
const { normalizeHypixelRequestSettings, HYPIXEL_REQUEST_SETTING_LIMITS } = require('./hypixel_api_client');

function createHypixelRateCommandHandler(options) {
    return createApiRateCommandHandler({ ...options, provider: 'Hypixel', command: '/hypixelrate',
        normalizeSettings: normalizeHypixelRequestSettings, limits: HYPIXEL_REQUEST_SETTING_LIMITS,
        delayKey: 'hypixelRequestDelayMs', concurrencyKey: 'hypixelRequestConcurrency', delayLabel: 'Game request delay',
        note: 'This is the base delay; jitter and quota slowdown still apply. Background checks retain their separate limits.' });
}

module.exports = { createHypixelRateCommandHandler };
