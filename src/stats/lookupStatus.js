'use strict';

// These failures describe a temporarily unavailable lookup service, not a
// conclusion about the player's identity. A previously confirmed nick may be
// kept through one of these failures while the next lookup is pending.
const TRANSIENT_PLAYER_LOOKUP_ERRORS = new Set([
    'lookup_failed',
    'hypixel_api_error',
    'hypixel_rate_limited',
    'hypixel_all_keys_unavailable'
]);

function isTransientPlayerLookupFailure(data = {}) {
    if (!data?.lookupFailed) return false;
    return TRANSIENT_PLAYER_LOOKUP_ERRORS.has(String(data.lookupErrorType || '').trim().toLowerCase());
}

function isConfirmedPlayerLookupFailure(data = {}) {
    return Boolean(data?.lookupFailed) && !isTransientPlayerLookupFailure(data);
}

module.exports = {
    TRANSIENT_PLAYER_LOOKUP_ERRORS,
    isTransientPlayerLookupFailure,
    isConfirmedPlayerLookupFailure
};
