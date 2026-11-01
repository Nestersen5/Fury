'use strict';

const { createApiRateCommandHandler } = require('./api_rate_command');
const { normalizeUrchinRequestSettings, URCHIN_REQUEST_SETTING_LIMITS } = require('./urchin_client');

function createUrchinRateCommandHandler(options) {
    return createApiRateCommandHandler({ ...options, provider: 'Urchin', command: '/urchinrate',
        normalizeSettings: normalizeUrchinRequestSettings, limits: URCHIN_REQUEST_SETTING_LIMITS,
        delayKey: 'urchinRequestDelayMs', concurrencyKey: 'urchinRequestConcurrency' });
}

module.exports = { createUrchinRateCommandHandler };
