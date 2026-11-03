'use strict';

const DEFAULTS = Object.freeze({ enabled: true, others: true, mode: 'manual' });

function normalizeSettings(value) {
    return {
        enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
        others: typeof value?.others === 'boolean' ? value.others : DEFAULTS.others,
        mode: value?.mode === 'auto' ? 'auto' : 'manual'
    };
}

module.exports = { DEFAULTS, normalizeSettings };
